import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Small cryptographic helpers used across the API.
 *
 * Rule of thumb applied throughout: we store hashes of things that are
 * presented back to us (tokens, session identifiers), and HMACs of things we
 * issue and must later recognise as ours (quotes).
 */

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 hex. Used for token lookups, never for passwords. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) {
    // Compare equal-length digests so the wrong-length case costs the same.
    const digestA = createHash('sha256').update(bufferA).digest();
    const digestB = createHash('sha256').update(bufferB).digest();
    timingSafeEqual(digestA, digestB);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Tokenise an identifier so it can cross a partition boundary (guardrail G8).
 *
 * The token is deterministic, so the neutral tier can join on it, and
 * irreversible without the salt, so the neutral tier learns nothing from it.
 */
export function tokenise(salt: string, kind: string, value: string): string {
  return `${kind}_${createHmac('sha256', salt).update(`${kind}:${value}`).digest('hex').slice(0, 32)}`;
}

/** One-way hash for values we want to correlate but never read: IPs, user agents. */
export function pseudonymise(salt: string, value: string): string {
  return createHmac('sha256', salt).update(value).digest('hex').slice(0, 24);
}

/** Last four characters visible, the rest masked. Safe for display and logs. */
export function maskTail(value: string, visible = 4): string {
  if (value.length <= visible) return '*'.repeat(value.length);
  return `${'*'.repeat(value.length - visible)}${value.slice(-visible)}`;
}
