/**
 * API client.
 *
 * Talks to the NestJS API from the browser. Two things it does that a naive
 * fetch wrapper does not:
 *
 *  - the access token lives in memory, and only the refresh token is persisted,
 *    so an XSS that reads localStorage gets a token that is useless without the
 *    refresh endpoint's rotation check;
 *  - a 401 triggers exactly one refresh attempt, and concurrent callers share
 *    it rather than each starting their own.
 */

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const REFRESH_STORAGE_KEY = 'morapay.refresh';

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export interface ApiErrorBody {
  code: string;
  message: string;
  issues?: Array<{ path: string; message: string }>;
  [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message ?? 'Request failed');
    this.name = 'ApiError';
  }

  get code(): string {
    return this.body.code ?? 'ERROR';
  }
}

export function setSession(tokens: { accessToken: string; refreshToken: string }): void {
  accessToken = tokens.accessToken;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(REFRESH_STORAGE_KEY, tokens.refreshToken);
  }
}

export function clearSession(): void {
  accessToken = null;
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(REFRESH_STORAGE_KEY);
  }
}

export function storedRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(REFRESH_STORAGE_KEY);
}

export function hasSession(): boolean {
  return accessToken !== null || storedRefreshToken() !== null;
}

async function refreshSession(): Promise<boolean> {
  const refreshToken = storedRefreshToken();
  if (refreshToken === null) return false;

  // One refresh at a time. Refresh tokens rotate, so two concurrent attempts
  // would present the same token twice and the server would — correctly —
  // treat the second as a replay and kill the whole session family.
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        clearSession();
        return false;
      }
      const session = (await response.json()) as { accessToken: string; refreshToken: string };
      setSession(session);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  /** Set false for endpoints that must not attempt a refresh, e.g. login. */
  authenticated?: boolean;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, idempotencyKey, authenticated = true } = options;

  const send = async (): Promise<Response> =>
    fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(authenticated && accessToken !== null
          ? { authorization: `Bearer ${accessToken}` }
          : {}),
        ...(idempotencyKey === undefined ? {} : { 'idempotency-key': idempotencyKey }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  let response = await send();

  if (response.status === 401 && authenticated) {
    if (await refreshSession()) {
      response = await send();
    }
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const payload = text === '' ? {} : (JSON.parse(text) as unknown);

  if (!response.ok) {
    throw new ApiError(response.status, payload as ApiErrorBody);
  }

  return payload as T;
}

/**
 * A fresh idempotency key per confirmed transfer.
 *
 * Generated once when the send flow reaches its review step and reused for
 * every retry of that same confirmation, which is precisely what makes a
 * double-tap on a flaky connection safe.
 */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Restore a session on first paint, before rendering anything authenticated. */
export async function restoreSession(): Promise<boolean> {
  if (accessToken !== null) return true;
  return refreshSession();
}

/**
 * The corridors this sender can actually use.
 *
 * Filtered at the server by residency, not here. The catalogue is 212 corridors
 * and about 104 KB across fifteen countries; a sender can use fourteen of them.
 * Asking for the whole thing and filtering afterwards is ~97 KB of a mobile data
 * plan and several seconds of blank screen per visit.
 */
export function corridorsPath(residency: string | null): string {
  return residency === null ? '/corridors' : `/corridors?from=${encodeURIComponent(residency)}`;
}

/**
 * The corridor this sender last sent on, remembered on their own device.
 *
 * Keyed by user id, because a shared phone is normal in the markets we serve
 * and the previous person's destination is not this person's business.
 *
 * Every access is wrapped: `localStorage` throws outright in a private window
 * on some browsers and when site data is blocked, and a remembered convenience
 * must never be the reason a send screen fails to render. A miss simply means
 * the first corridor in the list, which is where this started.
 *
 * Only a corridor id — two country codes — is stored. Nothing about amounts,
 * recipients or people.
 */
const LAST_CORRIDOR_PREFIX = 'morapay.lastCorridor.';

export function lastCorridor(userId: string | null): string | null {
  if (userId === null) return null;
  try {
    return window.localStorage.getItem(LAST_CORRIDOR_PREFIX + userId);
  } catch {
    return null;
  }
}

export function rememberCorridor(userId: string | null, corridorId: string): void {
  if (userId === null) return;
  try {
    window.localStorage.setItem(LAST_CORRIDOR_PREFIX + userId, corridorId);
  } catch {
    // Storage unavailable. The sender picks their corridor next time; nothing else breaks.
  }
}
