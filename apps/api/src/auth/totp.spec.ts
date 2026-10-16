import { base32Decode, base32Encode, hotp, newSecret, otpauthUrl, totp, verifyTotp } from './totp';

// RFC 6238 Appendix B (SHA-1) secret: ASCII "12345678901234567890"
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('base32 round-trips', () => {
    const buf = Buffer.from('any bytes \x00\xff here');
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
    expect(base32Encode(Buffer.from('12345678901234567890'))).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('matches the RFC 4226 HOTP vectors', () => {
    const key = Buffer.from('12345678901234567890');
    expect([0, 1, 2, 9].map((c) => hotp(key, c))).toEqual(['755224', '287082', '359152', '520489']);
  });

  it('matches the RFC 6238 TOTP vectors (last 6 digits)', () => {
    expect(totp(RFC_SECRET, 59_000)).toBe('287082');
    expect(totp(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
    expect(totp(RFC_SECRET, 1_234_567_890_000)).toBe('005924');
    expect(totp(RFC_SECRET, 2_000_000_000_000)).toBe('279037');
  });

  it('accepts one step of clock drift, not two', () => {
    const now = 1_700_000_000_000;
    const s = newSecret();
    expect(verifyTotp(s, totp(s, now - 30_000), { now })).not.toBeNull();
    expect(verifyTotp(s, totp(s, now + 30_000), { now })).not.toBeNull();
    expect(verifyTotp(s, totp(s, now - 90_000), { now })).toBeNull();
  });

  it('refuses a code that was already used', () => {
    const now = 1_700_000_000_000;
    const s = newSecret();
    const code = totp(s, now);
    const step = verifyTotp(s, code, { now });
    expect(step).not.toBeNull();
    expect(verifyTotp(s, code, { now, lastUsedStep: step })).toBeNull();
  });

  it('rejects malformed codes', () => {
    expect(verifyTotp(newSecret(), '12345')).toBeNull();
    expect(verifyTotp(newSecret(), 'abcdef')).toBeNull();
  });

  it('builds an authenticator URL', () => {
    expect(otpauthUrl('ABC', 'ops@amico.cm')).toBe('otpauth://totp/AMICO%3Aops%40amico.cm?secret=ABC&issuer=AMICO&algorithm=SHA1&digits=6&period=30');
  });
});
