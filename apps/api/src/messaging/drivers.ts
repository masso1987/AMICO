import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * Gateway drivers. Each turns (number, text) into one HTTPS call to an operator or
 * WhatsApp. They never log secrets and treat any network error or 5xx as retryable.
 *
 * The request formats follow the operators' published APIs:
 *  - Orange SMS API (developer.orange.com/apis/sms): OAuth2 client credentials, then
 *    POST /smsmessaging/v1/outbound/tel%3A%2B{sender}/requests.
 *  - MTN SMS V3 (developers.mtn.com): OAuth2 client credentials, then
 *    POST /v3/sms/messages/sms/outbound.
 *  - WhatsApp Cloud API (developers.facebook.com/docs/whatsapp/cloud-api): approved
 *    message template with one text parameter (business-initiated messages need a template).
 *  - HTTP gateway: any local SMS aggregator with a simple HTTPS API (URL + body template).
 * Endpoints are settings, so an operator can give you a different host without a code change.
 */

export interface SendResult {
  ok: boolean;
  providerMessageId?: string | null;
  error?: string;
  /** False for definitive refusals (bad number, rejected sender name). */
  retryable?: boolean;
}

export interface DriverContext {
  settings: Record<string, unknown>;
  secrets: Record<string, string>;
  locale: string;
  /** Opaque key for token caching. */
  cacheKey: string;
}

export interface Driver {
  readonly kind: string;
  readonly label: string;
  /** Validates non-secret settings. */
  readonly settingsSchema: z.ZodTypeAny;
  /** Names of the secret fields (write-only in the admin). */
  readonly secretFields: readonly string[];
  send(to: string, text: string, ctx: DriverContext): Promise<SendResult>;
}

const TIMEOUT_MS = 15_000;
const tokens = new Map<string, { token: string; expiresAt: number }>();

async function http(url: string, init: RequestInit): Promise<{ status: number; body: unknown; text: string }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, text };
}

function failure(status: number, text: string): SendResult {
  // 4xx (except 408/429) = the gateway refused this message; retrying won't help.
  const retryable = status >= 500 || status === 408 || status === 429 || status === 0;
  return { ok: false, retryable, error: `HTTP ${status}: ${text.slice(0, 300)}` };
}

async function clientCredentialsToken(cacheKey: string, url: string, init: RequestInit): Promise<string> {
  const cached = tokens.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const r = await http(url, { ...init, method: 'POST' });
  const b = r.body as { access_token?: string; expires_in?: number | string } | null;
  if (r.status >= 300 || !b?.access_token) throw new Error(`Token request failed: HTTP ${r.status} ${r.text.slice(0, 200)}`);
  tokens.set(cacheKey, { token: b.access_token, expiresAt: Date.now() + Number(b.expires_in ?? 3_000) * 1000 });
  return b.access_token;
}

export function forgetTokens(cacheKey: string) {
  tokens.delete(cacheKey);
}

const SenderName = z.string().trim().regex(/^[A-Za-z0-9 ]{1,11}$/, 'Up to 11 letters, digits or spaces');

// ------------------------------------------------------------------ Orange

const OrangeSettings = z.object({
  /** Your Orange sender number without "tel:+" (Cameroon: 2370000 unless Orange gave you another). */
  senderAddress: z.string().regex(/^\d{4,15}$/).default('2370000'),
  /** Approved sender name, e.g. AMICO. Empty = Orange's default for your account. */
  senderName: SenderName.or(z.literal('')).default(''),
  tokenUrl: z.string().url().default('https://api.orange.com/oauth/v3/token'),
  apiBase: z.string().url().default('https://api.orange.com/smsmessaging/v1'),
});

export const orangeSmsApi: Driver = {
  kind: 'ORANGE_SMS_API',
  label: 'Orange SMS API (developer.orange.com)',
  settingsSchema: OrangeSettings,
  secretFields: ['clientId', 'clientSecret'],
  async send(to, text, ctx) {
    const s = OrangeSettings.parse(ctx.settings);
    const basic = Buffer.from(`${ctx.secrets.clientId ?? ''}:${ctx.secrets.clientSecret ?? ''}`).toString('base64');
    const token = await clientCredentialsToken(ctx.cacheKey, s.tokenUrl, {
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: 'grant_type=client_credentials',
    });
    const sender = `tel:+${s.senderAddress}`;
    const r = await http(`${s.apiBase}/outbound/${encodeURIComponent(sender)}/requests`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        outboundSMSMessageRequest: {
          address: `tel:+${to}`,
          senderAddress: sender,
          ...(s.senderName ? { senderName: s.senderName } : {}),
          outboundSMSTextMessage: { message: text },
        },
      }),
    });
    if (r.status === 401) forgetTokens(ctx.cacheKey);
    if (r.status >= 300) return failure(r.status, r.text);
    const url = (r.body as { outboundSMSMessageRequest?: { resourceURL?: string } } | null)?.outboundSMSMessageRequest?.resourceURL ?? null;
    return { ok: true, providerMessageId: url ? url.split('/').pop() ?? url : null };
  },
};

// ------------------------------------------------------------------ MTN

const MtnSettings = z.object({
  /** Approved sender ID (short code or name), e.g. AMICO. */
  senderAddress: z.string().trim().min(1).max(15).default('AMICO'),
  /** Service code from your MTN bulk SMS subscription, if MTN gave you one. */
  serviceCode: z.string().trim().max(30).default(''),
  tokenUrl: z.string().url().default('https://api.mtn.com/v1/oauth/access_token?grant_type=client_credentials'),
  sendUrl: z.string().url().default('https://api.mtn.com/v3/sms/messages/sms/outbound'),
});

export const mtnSmsV3: Driver = {
  kind: 'MTN_SMS_V3',
  label: 'MTN SMS V3 (developers.mtn.com)',
  settingsSchema: MtnSettings,
  secretFields: ['clientId', 'clientSecret'],
  async send(to, text, ctx) {
    const s = MtnSettings.parse(ctx.settings);
    const token = await clientCredentialsToken(ctx.cacheKey, s.tokenUrl, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ client_id: ctx.secrets.clientId ?? '', client_secret: ctx.secrets.clientSecret ?? '' }).toString(),
    });
    const r = await http(s.sendUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        senderAddress: s.senderAddress,
        receiverAddress: [to],
        message: text,
        clientCorrelatorId: randomUUID(),
        ...(s.serviceCode ? { serviceCode: s.serviceCode } : {}),
        requestDeliveryReceipt: false,
      }),
    });
    if (r.status === 401) forgetTokens(ctx.cacheKey);
    if (r.status >= 300) return failure(r.status, r.text);
    const b = r.body as { transactionId?: string; data?: { requestId?: string }; requestId?: string } | null;
    return { ok: true, providerMessageId: b?.transactionId ?? b?.data?.requestId ?? b?.requestId ?? null };
  },
};

// ------------------------------------------------------------------ generic HTTP gateway (aggregators)

const HttpSettings = z.object({
  url: z.string().url(),
  method: z.enum(['POST', 'GET']).default('POST'),
  /** json or form. */
  format: z.enum(['json', 'form']).default('json'),
  /** Body (or query string for GET) with {{to}}, {{message}} and {{sender}} placeholders. */
  template: z.string().min(5).max(2_000).default('{"to":"{{to}}","from":"{{sender}}","text":"{{message}}"}'),
  sender: z.string().trim().max(15).default('AMICO'),
  /** Name of the auth header, e.g. Authorization or X-API-Key. */
  authHeader: z.string().trim().max(60).default('Authorization'),
});

function fill(template: string, values: Record<string, string>, escape: (v: string) => string) {
  return template.replace(/\{\{(to|message|sender)\}\}/g, (_, k: string) => escape(values[k] ?? ''));
}

export const httpGateway: Driver = {
  kind: 'HTTP_GATEWAY',
  label: 'SMS aggregator (HTTPS API)',
  settingsSchema: HttpSettings,
  secretFields: ['authValue'],
  async send(to, text, ctx) {
    const s = HttpSettings.parse(ctx.settings);
    const values = { to, message: text, sender: s.sender };
    const headers: Record<string, string> = {};
    if (ctx.secrets.authValue) headers[s.authHeader] = ctx.secrets.authValue;
    let url = s.url;
    let body: string | undefined;
    if (s.method === 'GET') {
      url += (url.includes('?') ? '&' : '?') + fill(s.template, values, encodeURIComponent);
    } else if (s.format === 'json') {
      headers['Content-Type'] = 'application/json';
      body = fill(s.template, values, (v) => JSON.stringify(v).slice(1, -1));
      JSON.parse(body); // refuse to send a malformed template
    } else {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = fill(s.template, values, encodeURIComponent);
    }
    const r = await http(url, { method: s.method, headers, body });
    if (r.status >= 300) return failure(r.status, r.text);
    const b = r.body as { id?: string; messageId?: string; message_id?: string } | null;
    return { ok: true, providerMessageId: b?.id ?? b?.messageId ?? b?.message_id ?? null };
  },
};

// ------------------------------------------------------------------ WhatsApp Cloud API

const WhatsAppSettings = z.object({
  /** Phone number ID from the WhatsApp Business account (not the phone number itself). */
  phoneNumberId: z.string().regex(/^\d{5,30}$/),
  apiVersion: z.string().regex(/^v\d+\.\d+$/).default('v21.0'),
  apiBase: z.string().url().default('https://graph.facebook.com'),
  /** An approved UTILITY template whose body is a single {{1}} parameter, e.g. "{{1}}". */
  templateName: z.string().regex(/^[a-z0-9_]{1,512}$/).default('amico_notice'),
  templateLanguageEn: z.string().min(2).max(10).default('en'),
  templateLanguageFr: z.string().min(2).max(10).default('fr'),
});

/** WhatsApp refuses template parameters with new lines, tabs or more than 4 spaces in a row. */
export function whatsappSafe(text: string): string {
  return text.replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 1_000);
}

export const whatsappCloud: Driver = {
  kind: 'WHATSAPP_CLOUD',
  label: 'WhatsApp Cloud API (Meta)',
  settingsSchema: WhatsAppSettings,
  secretFields: ['accessToken'],
  async send(to, text, ctx) {
    const s = WhatsAppSettings.parse(ctx.settings);
    const r = await http(`${s.apiBase.replace(/\/$/, '')}/${s.apiVersion}/${s.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.secrets.accessToken ?? ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: s.templateName,
          language: { code: ctx.locale === 'fr' ? s.templateLanguageFr : s.templateLanguageEn },
          components: [{ type: 'body', parameters: [{ type: 'text', text: whatsappSafe(text) }] }],
        },
      }),
    });
    if (r.status >= 300) return failure(r.status, r.text);
    const id = (r.body as { messages?: Array<{ id?: string }> } | null)?.messages?.[0]?.id ?? null;
    return { ok: true, providerMessageId: id };
  },
};

export const DRIVERS: Record<string, Driver> = Object.fromEntries([orangeSmsApi, mtnSmsV3, httpGateway, whatsappCloud].map((d) => [d.kind, d]));

/** Drivers each channel may use. */
export const CHANNEL_DRIVERS = {
  SMS_MTN: ['MTN_SMS_V3', 'HTTP_GATEWAY'],
  SMS_ORANGE: ['ORANGE_SMS_API', 'HTTP_GATEWAY'],
  WHATSAPP: ['WHATSAPP_CLOUD'],
} as const;

export const DEFAULT_DRIVER = { SMS_MTN: 'MTN_SMS_V3', SMS_ORANGE: 'ORANGE_SMS_API', WHATSAPP: 'WHATSAPP_CLOUD' } as const;
