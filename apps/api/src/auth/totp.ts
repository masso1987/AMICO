import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30-second steps): the scheme used by Google
 * Authenticator, Microsoft Authenticator, Authy, FreeOTP and others.
 * Implemented on node:crypto so no third-party code touches staff secrets.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;
export const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret, base32 — the RFC 4226 recommended length. */
export function newSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function stepAt(timeMs: number): number {
  return Math.floor(timeMs / 1000 / STEP_SECONDS);
}

export function totp(secretBase32: string, timeMs = Date.now()): string {
  return hotp(base32Decode(secretBase32), stepAt(timeMs));
}

/**
 * Checks a code against the current step and one step either side (clock drift).
 * Returns the matched step so the caller can refuse its reuse, or null.
 * Steps at or below `lastUsedStep` are rejected (replay protection).
 */
export function verifyTotp(secretBase32: string, code: string, opts: { now?: number; lastUsedStep?: number | null; window?: number } = {}): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const current = stepAt(opts.now ?? Date.now());
  const window = opts.window ?? 1;
  for (let d = -window; d <= window; d++) {
    const step = current + d;
    if (opts.lastUsedStep != null && step <= opts.lastUsedStep) continue;
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

export function otpauthUrl(secretBase32: string, account: string, issuer = 'AMICO'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}
