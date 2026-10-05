import {
  createHmac,
  randomBytes,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';

/**
 * Callback security primitives (TECHNICAL_ARCHITECTURE §4.1).
 *
 * Written directly against the FreshPay defects catalogued in §1.2:
 *
 *   - the signature covers `timestamp + "." + raw_body`, over raw bytes,
 *     before JSON parsing, so a re-serialised body cannot be substituted;
 *   - comparison is constant-time — the Node and Java reference samples in the
 *     FreshPay spec use `===` and `.equals`, which leak by timing;
 *   - a timestamp is inside the signed material, so a captured callback cannot
 *     be replayed later;
 *   - encryption, where a partner insists on it, is AES-256-GCM with a random
 *     96-bit IV prepended. Never IV = key. Never CBC without a separate MAC.
 */

const SIGNATURE_ENCODING = 'hex';

/** HMAC-SHA256 over the exact bytes a partner signed. */
export function computeSignature(secret: string, timestamp: string, rawBody: Buffer): Buffer {
  const hmac = createHmac('sha256', secret);
  hmac.update(timestamp);
  hmac.update('.');
  hmac.update(rawBody);
  return hmac.digest();
}

export function signPayload(secret: string, timestamp: string, rawBody: Buffer): string {
  return computeSignature(secret, timestamp, rawBody).toString(SIGNATURE_ENCODING);
}

/**
 * Constant-time verification.
 *
 * `timingSafeEqual` throws when the buffers differ in length, which would leak
 * length by exception. Comparing a fixed-length HMAC of the candidate against a
 * fixed-length HMAC of the expected value removes that channel.
 */
export function verifySignature(
  secret: string,
  timestamp: string,
  rawBody: Buffer,
  presented: string,
): boolean {
  const expected = computeSignature(secret, timestamp, rawBody);
  let candidate: Buffer;
  try {
    candidate = Buffer.from(presented, SIGNATURE_ENCODING);
  } catch {
    return false;
  }
  if (candidate.length !== expected.length) {
    // Still do the work, so a wrong-length signature costs the same as a
    // right-length one.
    const normalised = createHmac('sha256', secret).update(candidate).digest();
    const reference = createHmac('sha256', secret).update(expected).digest();
    timingSafeEqual(normalised, reference);
    return false;
  }
  return timingSafeEqual(candidate, expected);
}

/** Reject anything outside ±`skewSeconds`. Default 300s, per the spec. */
export function withinSkew(
  timestamp: string,
  skewSeconds: number,
  now: Date = new Date(),
): boolean {
  const parsed = parseTimestamp(timestamp);
  if (parsed === null) return false;
  return Math.abs(now.getTime() - parsed.getTime()) <= skewSeconds * 1000;
}

/** Accepts unix seconds, unix milliseconds, or ISO-8601. */
export function parseTimestamp(timestamp: string): Date | null {
  const trimmed = timestamp.trim();
  if (trimmed === '') return null;

  if (/^\d+$/.test(trimmed)) {
    const value = Number(trimmed);
    const asDate = new Date(trimmed.length >= 13 ? value : value * 1000);
    return Number.isNaN(asDate.getTime()) ? null : asDate;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// ---------------------------------------------------------------------------
// Payload encryption, for partners that require it
// ---------------------------------------------------------------------------

const IV_BYTES = 12; // 96 bits, the value GCM is specified for
const TAG_BYTES = 16;

export class CipherContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CipherContractError';
  }
}

/**
 * AES-256-GCM. The IV is random per message and prepended; the auth tag
 * follows it. A 32-byte key is required — a 16-byte key silently selecting
 * AES-128 while the documentation claims AES-256 is exactly the FreshPay
 * defect (§1.2 issue 2), so the length is checked rather than assumed.
 */
export function encryptPayload(key: Buffer, plaintext: Buffer): Buffer {
  assertKeyLength(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

export function decryptPayload(key: Buffer, sealed: Buffer): Buffer {
  assertKeyLength(key);
  if (sealed.length < IV_BYTES + TAG_BYTES) {
    throw new CipherContractError('Sealed payload is shorter than its own header');
  }
  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = sealed.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    // GCM authentication failed: the payload was altered, or the key is wrong.
    throw new CipherContractError('Sealed payload failed authentication');
  }
}

function assertKeyLength(key: Buffer): void {
  if (key.length !== 32) {
    throw new CipherContractError(
      `AES-256-GCM requires a 32-byte key; received ${key.length} bytes. ` +
        'A 16-byte key would silently select AES-128 — see TECHNICAL_ARCHITECTURE §1.2 issue 2.',
    );
  }
}

// ---------------------------------------------------------------------------
// Money at the boundary (TECHNICAL_ARCHITECTURE §3.3)
// ---------------------------------------------------------------------------

export class ProviderContractViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderContractViolation';
  }
}

/**
 * Providers send "100", 100.0, "1,888,590.00" — all of it untrusted.
 *
 * A non-integer JSON number is refused outright: by the time it reaches us the
 * precision question has already been answered by a parser we do not control,
 * and guessing is how rounding errors enter a ledger.
 */
export function normaliseProviderAmount(raw: unknown): string {
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw)) {
      throw new ProviderContractViolation(
        `Provider sent the non-integer numeric amount ${raw}; refusing to guess precision`,
      );
    }
    return String(raw);
  }
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/[\s,_]/g, '');
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
      throw new ProviderContractViolation(
        `Provider sent an unparseable amount: ${JSON.stringify(raw)}`,
      );
    }
    return cleaned;
  }
  throw new ProviderContractViolation(
    `Provider sent an amount of type ${typeof raw}; expected a string or an integer`,
  );
}
