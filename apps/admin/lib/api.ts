/**
 * Back-office API client.
 *
 * Deliberately a separate module from the sender app's client, with a separate
 * storage key. The two applications never share a session (BUILD_PLAN Phase 9),
 * and the tokens are signed with different keys, so mixing them up would fail
 * signature verification rather than merely an authorisation check — but they
 * are kept apart at this level too, so the mistake cannot be made.
 */

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const REFRESH_KEY = 'morapay.admin.refresh';

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export interface StaffSession {
  accessToken: string;
  refreshToken: string;
  staff: { id: string; email: string; displayName: string; roles: string[] };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: { code?: string; message?: string },
  ) {
    super(body.message ?? 'Request failed');
    this.name = 'ApiError';
  }

  get code(): string {
    return this.body.code ?? 'ERROR';
  }
}

export function setStaffSession(session: StaffSession): void {
  accessToken = session.accessToken;
  window.localStorage.setItem(REFRESH_KEY, session.refreshToken);
}

export function clearStaffSession(): void {
  accessToken = null;
  window.localStorage.removeItem(REFRESH_KEY);
}

async function refresh(): Promise<boolean> {
  const refreshToken =
    typeof window === 'undefined' ? null : window.localStorage.getItem(REFRESH_KEY);
  if (refreshToken === null) return false;

  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${API_BASE}/admin/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        clearStaffSession();
        return false;
      }
      setStaffSession((await response.json()) as StaffSession);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const send = (): Promise<Response> =>
    fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(accessToken === null ? {} : { authorization: `Bearer ${accessToken}` }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });

  let response = await send();
  if (response.status === 401 && (await refresh())) {
    response = await send();
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text === '' ? {} : (JSON.parse(text) as unknown);
  if (!response.ok)
    throw new ApiError(response.status, payload as { code?: string; message?: string });
  return payload as T;
}

export async function restoreStaffSession(): Promise<boolean> {
  if (accessToken !== null) return true;
  return refresh();
}
