/**
 * Integer helpers. All money is whole FCFA held in JS numbers that must be safe
 * integers; intermediate products use BigInt so `amount × bps` or
 * `amount × ppm` can never lose precision.
 */

export type Rounding = 'UP' | 'DOWN' | 'HALF_UP';

export class InvalidAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAmountError';
  }
}

export function assertFcfa(value: number, label: string, { allowZero = true } = {}): void {
  if (!Number.isSafeInteger(value)) throw new InvalidAmountError(`${label} must be a whole number of FCFA (got ${value})`);
  if (value < 0 || (!allowZero && value === 0)) throw new InvalidAmountError(`${label} must be ${allowZero ? '≥ 0' : '> 0'} (got ${value})`);
}

/** Divides two non-negative integers with an explicit rounding rule. */
export function divRound(numerator: bigint, denominator: bigint, rounding: Rounding): bigint {
  if (denominator <= 0n) throw new RangeError('denominator must be positive');
  if (numerator < 0n) throw new RangeError('numerator must be non-negative');
  const q = numerator / denominator;
  const r = numerator % denominator;
  if (r === 0n) return q;
  switch (rounding) {
    case 'DOWN':
      return q;
    case 'UP':
      return q + 1n;
    case 'HALF_UP':
      return r * 2n >= denominator ? q + 1n : q;
  }
}

export function toSafeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new InvalidAmountError(`${label} overflows the safe integer range`);
  }
  return Number(value);
}

/** amount × bps / 10_000 */
export function applyBps(amount: number, bps: number, rounding: Rounding): number {
  return toSafeNumber(divRound(BigInt(amount) * BigInt(bps), 10_000n, rounding), 'percentage');
}

/** amount × ppm / 1_000_000 */
export function applyPpm(amount: number, ppm: number, rounding: Rounding): number {
  return toSafeNumber(divRound(BigInt(amount) * BigInt(ppm), 1_000_000n, rounding), 'conversion');
}
