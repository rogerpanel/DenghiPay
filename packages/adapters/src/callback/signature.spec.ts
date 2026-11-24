import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  CipherContractError,
  ProviderContractViolation,
  computeSignature,
  decryptPayload,
  encryptPayload,
  normaliseProviderAmount,
  parseTimestamp,
  signPayload,
  verifySignature,
  withinSkew,
} from './signature';

const SECRET = 'a-signing-secret-for-tests-only';
const BODY = Buffer.from(JSON.stringify({ event_id: 'evt_1', provider_ref: 'NG-SIM-1' }));
const TIMESTAMP = '1786579200'; // 2026-08-13T00:00:00Z

/**
 * Callback security conformance suite — BUILD_PLAN 11.7, added by
 * TECHNICAL_ARCHITECTURE §7. Every case here must fail closed.
 */
describe('callback conformance — signature', () => {
  it('accepts a correctly signed body', () => {
    const signature = signPayload(SECRET, TIMESTAMP, BODY);
    expect(verifySignature(SECRET, TIMESTAMP, BODY, signature)).toBe(true);
  });

  it('rejects a forged signature', () => {
    expect(verifySignature(SECRET, TIMESTAMP, BODY, 'de'.repeat(32))).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    const signature = signPayload('some-other-secret', TIMESTAMP, BODY);
    expect(verifySignature(SECRET, TIMESTAMP, BODY, signature)).toBe(false);
  });

  it('rejects a signature of the same body under a different timestamp', () => {
    // The timestamp is inside the signed material, which is what makes a
    // captured callback unusable later (§1.2 issue 5).
    const signature = signPayload(SECRET, '1786579500', BODY);
    expect(verifySignature(SECRET, TIMESTAMP, BODY, signature)).toBe(false);
  });

  it('rejects a body that was re-serialised after signing', () => {
    const signature = signPayload(SECRET, TIMESTAMP, BODY);
    // Same JSON semantically, different bytes. Signing raw bytes is the point.
    const reserialised = Buffer.from(
      JSON.stringify({ provider_ref: 'NG-SIM-1', event_id: 'evt_1' }),
    );
    expect(verifySignature(SECRET, TIMESTAMP, reserialised, signature)).toBe(false);
  });

  it('rejects a truncated or overlong signature without throwing', () => {
    const signature = signPayload(SECRET, TIMESTAMP, BODY);
    expect(verifySignature(SECRET, TIMESTAMP, BODY, signature.slice(0, 40))).toBe(false);
    expect(verifySignature(SECRET, TIMESTAMP, BODY, `${signature}ff`)).toBe(false);
    expect(verifySignature(SECRET, TIMESTAMP, BODY, '')).toBe(false);
    expect(verifySignature(SECRET, TIMESTAMP, BODY, 'not-hex-at-all!!')).toBe(false);
  });

  it('produces a fixed-length digest regardless of body size', () => {
    const small = computeSignature(SECRET, TIMESTAMP, Buffer.from('a'));
    const large = computeSignature(SECRET, TIMESTAMP, randomBytes(100_000));
    expect(small.length).toBe(32);
    expect(large.length).toBe(32);
  });

  it('uses a constant-time comparison', () => {
    // A guard against someone "simplifying" verifySignature to ===. If the
    // implementation ever stops calling timingSafeEqual, this reads the source
    // and fails.
    const source = verifySignature.toString();
    expect(source).toContain('timingSafeEqual');
    expect(source).not.toMatch(/presented\s*===\s*/);
  });
});

describe('callback conformance — freshness', () => {
  const now = new Date('2026-08-13T00:00:00Z');

  it('accepts a timestamp inside the window', () => {
    expect(withinSkew('1786579200', 300, now)).toBe(true);
    expect(withinSkew('1786579100', 300, now)).toBe(true);
    expect(withinSkew('1786579400', 300, now)).toBe(true);
  });

  it('rejects a stale timestamp', () => {
    expect(withinSkew('1786578000', 300, now)).toBe(false);
  });

  it('rejects a timestamp from the future beyond the window', () => {
    expect(withinSkew('1786583200', 300, now)).toBe(false);
  });

  it('rejects a malformed timestamp rather than treating it as zero', () => {
    expect(withinSkew('', 300, now)).toBe(false);
    expect(withinSkew('not-a-time', 300, now)).toBe(false);
    expect(parseTimestamp('nonsense')).toBeNull();
  });

  it('accepts unix seconds, unix milliseconds and ISO-8601', () => {
    expect(parseTimestamp('1786579200')?.toISOString()).toBe('2026-08-13T00:00:00.000Z');
    expect(parseTimestamp('1786579200000')?.toISOString()).toBe('2026-08-13T00:00:00.000Z');
    expect(parseTimestamp('2026-08-13T00:00:00Z')?.toISOString()).toBe('2026-08-13T00:00:00.000Z');
  });
});

describe('callback conformance — payload encryption', () => {
  const key = randomBytes(32);

  it('round-trips through AES-256-GCM', () => {
    const sealed = encryptPayload(key, BODY);
    expect(decryptPayload(key, sealed).toString()).toBe(BODY.toString());
  });

  it('uses a fresh IV per message, so identical plaintexts differ in ciphertext', () => {
    // The FreshPay samples set IV = SECRET_KEY, which defeats the mode entirely
    // (§1.2 issue 3).
    const a = encryptPayload(key, BODY);
    const b = encryptPayload(key, BODY);
    expect(a.equals(b)).toBe(false);
    expect(a.subarray(0, 12).equals(b.subarray(0, 12))).toBe(false);
  });

  it('refuses a 16-byte key rather than silently becoming AES-128', () => {
    // §1.2 issue 2: documented as AES-256, implemented as AES-128.
    expect(() => encryptPayload(randomBytes(16), BODY)).toThrow(CipherContractError);
  });

  it('rejects a tampered ciphertext', () => {
    const sealed = encryptPayload(key, BODY);
    sealed[sealed.length - 1] ^= 0xff;
    expect(() => decryptPayload(key, sealed)).toThrow(CipherContractError);
  });

  it('rejects a tampered IV', () => {
    const sealed = encryptPayload(key, BODY);
    sealed[0] ^= 0xff;
    expect(() => decryptPayload(key, sealed)).toThrow(CipherContractError);
  });

  it('rejects a payload shorter than its own header', () => {
    expect(() => decryptPayload(key, Buffer.alloc(8))).toThrow(CipherContractError);
  });

  it('rejects decryption under the wrong key', () => {
    const sealed = encryptPayload(key, BODY);
    expect(() => decryptPayload(randomBytes(32), sealed)).toThrow(CipherContractError);
  });
});

describe('callback conformance — money at the boundary', () => {
  it('accepts integer numbers and well-formed strings', () => {
    expect(normaliseProviderAmount(100)).toBe('100');
    expect(normaliseProviderAmount('100')).toBe('100');
    expect(normaliseProviderAmount('1,888,590.00')).toBe('1888590.00');
    expect(normaliseProviderAmount(' 42.50 ')).toBe('42.50');
  });

  it('refuses a JSON float rather than guessing precision', () => {
    // §1.2 issue 7: "Amount": 100.0 in a response body.
    expect(() => normaliseProviderAmount(100.5)).toThrow(ProviderContractViolation);
    expect(() => normaliseProviderAmount(0.1 + 0.2)).toThrow(ProviderContractViolation);
  });

  it('refuses anything that is not a string or an integer', () => {
    expect(() => normaliseProviderAmount(null)).toThrow(ProviderContractViolation);
    expect(() => normaliseProviderAmount(undefined)).toThrow(ProviderContractViolation);
    expect(() => normaliseProviderAmount({ amount: 10 })).toThrow(ProviderContractViolation);
    expect(() => normaliseProviderAmount('ten naira')).toThrow(ProviderContractViolation);
  });
});
