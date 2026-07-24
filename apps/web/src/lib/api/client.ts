import type { ActionRequest, Dashboard, Me, PublicSession } from '@app/contracts';

/**
 * Thin API client. The client only renders server state and sends structured
 * actions — it never decides semantic validity (PB-039 / AC-050). All requests
 * send credentials so the Better Auth cookie session is included.
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  const data = text.length > 0 ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = (data?.error ?? { code: 'INTERNAL_ERROR', message: 'Request failed' }) as ApiError;
    throw new ApiRequestError(res.status, err, data?.current_state as PublicSession | undefined);
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
  signOut: () => request<unknown>('/api/auth/sign-out', { method: 'POST', body: '{}' }),
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
