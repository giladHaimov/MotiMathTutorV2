import type { ActionRequest, Dashboard, Me, PublicSession } from '@app/contracts';
import {
  apiBaseUrl,
  clearStoredAuthToken,
  isNativePlatform,
  loadStoredAuthToken,
  NATIVE_CLIENT_HEADER,
  NATIVE_CLIENT_VALUE,
  storeAuthToken,
} from '../platform.js';

/**
 * Thin API client. The client only renders server state and sends structured
 * actions — it never decides semantic validity (PB-039 / AC-050).
 *
 * Web uses Better Auth cookie sessions only. Capacitor native uses the approved
 * bearer/session-token path: token issued only to native clients, stored in
 * Keychain/Keystore-backed secure storage, sent as `Authorization: Bearer`.
 */

export interface ApiError {
  code: string;
  message: string;
  request_id?: string;
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiError,
    public readonly currentState?: PublicSession,
  ) {
    super(body.message);
  }
}

/** Thrown when fetch fails before an HTTP response (offline / aborted / DNS). */
export class NetworkError extends Error {
  constructor(message = 'Network request failed') {
    super(message);
    this.name = 'NetworkError';
  }
}

let bearerToken: string | null = null;
let tokenReady: Promise<void> | null = null;

/** Load any securely stored bearer token once at startup (native only). */
export function initApiClient(): Promise<void> {
  if (!tokenReady) {
    tokenReady = (async () => {
      bearerToken = await loadStoredAuthToken();
    })();
  }
  return tokenReady;
}

function resolveUrl(path: string): string {
  const base = apiBaseUrl();
  return base ? `${base}${path}` : path;
}

function baseHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(extra ?? {}),
  };
  if (isNativePlatform()) {
    headers[NATIVE_CLIENT_HEADER] = NATIVE_CLIENT_VALUE;
    if (bearerToken) {
      headers.Authorization = `Bearer ${bearerToken}`;
    }
  }
  return headers;
}

async function maybeCaptureAuthToken(res: Response): Promise<void> {
  if (!isNativePlatform()) return;
  const token = res.headers.get('set-auth-token');
  if (!token) return;
  bearerToken = token;
  await storeAuthToken(token);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  await initApiClient();
  const headers = baseHeaders(init.headers as Record<string, string> | undefined);

  let res: Response;
  try {
    res = await fetch(resolveUrl(path), {
      ...init,
      credentials: 'include',
      headers,
    });
  } catch {
    throw new NetworkError();
  }

  await maybeCaptureAuthToken(res);

  const text = await res.text();
  let data: unknown = null;
  if (text.length > 0) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      if (!res.ok) {
        throw new ApiRequestError(res.status, {
          code: 'INTERNAL_ERROR',
          message: 'Request failed',
        });
      }
      throw new NetworkError('Invalid response body');
    }
  }

  if (!res.ok) {
    const record = data as { error?: ApiError; current_state?: PublicSession } | null;
    const err = (record?.error ?? {
      code: 'INTERNAL_ERROR',
      message: 'Request failed',
    }) as ApiError;
    throw new ApiRequestError(res.status, err, record?.current_state);
  }
  return data as T;
}

export const api = {
  signUp: (email: string, password: string, name: string) =>
    request<unknown>('/api/auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }),
  signIn: (email: string, password: string) =>
    request<unknown>('/api/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  signOut: async () => {
    try {
      await request<unknown>('/api/auth/sign-out', { method: 'POST', body: '{}' });
    } finally {
      bearerToken = null;
      await clearStoredAuthToken();
    }
  },
  me: () => request<Me>('/api/me'),
  dashboard: () => request<Dashboard>('/api/dashboard'),
  startSession: () => request<PublicSession>('/api/sessions', { method: 'POST', body: '{}' }),
  getSession: (id: string) => request<PublicSession>(`/api/sessions/${id}`),
  submitAction: (id: string, action: ActionRequest) =>
    request<PublicSession>(`/api/sessions/${id}/actions`, {
      method: 'POST',
      body: JSON.stringify(action),
    }),
};

/** Browser-safe unique id for `client_action_id` (idempotent retries). */
export function newClientActionId(): string {
  return crypto.randomUUID();
}
