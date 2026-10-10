/** Quote validity rules. The clock is always passed in so these stay pure and testable. */

export const DEFAULT_QUOTE_TTL_SECONDS = 600;

export function quoteWindow(now: Date, ttlSeconds: number = DEFAULT_QUOTE_TTL_SECONDS): { createdAt: Date; expiresAt: Date } {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 86_400) {
    throw new RangeError('Quote TTL must be between 30 seconds and 24 hours');
  }
  return { createdAt: now, expiresAt: new Date(now.getTime() + ttlSeconds * 1000) };
}

export function isQuoteExpired(expiresAt: Date, now: Date): boolean {
  return now.getTime() >= expiresAt.getTime();
}

export type AcceptanceCheck =
  | { acceptable: true }
  | { acceptable: false; code: 'QUOTE_EXPIRED' | 'PRICING_CHANGED'; message: string };

/**
 * Can a customer still accept this quote? A quote whose pricing rule (or provider fee rule)
 * has been superseded must be re-issued and re-confirmed, even if not yet expired.
 */
export function checkQuoteAcceptable(args: {
  expiresAt: Date;
  now: Date;
  quotedRuleVersion: number;
  currentRuleVersion: number | null;
  quotedProviderFeeRuleVersion: number | null;
  currentProviderFeeRuleVersion: number | null;
}): AcceptanceCheck {
  if (isQuoteExpired(args.expiresAt, args.now)) {
    return { acceptable: false, code: 'QUOTE_EXPIRED', message: 'This quote has expired. Please request a new quote.' };
  }
  if (args.currentRuleVersion !== args.quotedRuleVersion || args.currentProviderFeeRuleVersion !== args.quotedProviderFeeRuleVersion) {
    return {
      acceptable: false,
      code: 'PRICING_CHANGED',
      message: 'Pricing for this service has changed. Please review and confirm the new quote.',
    };
  }
  return { acceptable: true };
}
