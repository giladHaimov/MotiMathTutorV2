/**
 * Native Capacitor clients identify themselves so the API may issue bearer
 * session tokens. Browser clients must not receive `set-auth-token`.
 */
export const NATIVE_CLIENT_HEADER = 'x-client-platform';
export const NATIVE_CLIENT_VALUE = 'capacitor';

const NATIVE_ORIGINS = new Set([
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'https://localhost',
  'capacitor://',
]);

export function isNativeClientRequest(headers: {
  'x-client-platform'?: string | string[] | undefined;
  origin?: string | string[] | undefined;
}): boolean {
  const platform = headerValue(headers['x-client-platform']);
  if (platform === NATIVE_CLIENT_VALUE) return true;

  // Secondary signal for Capacitor WebView origins (never sufficient alone for
  // issuance without the platform header in the auth route — see callers).
  const origin = headerValue(headers.origin);
  return origin !== null && NATIVE_ORIGINS.has(origin);
}

/** Issuance requires the explicit native platform header (not Origin spoof alone). */
export function shouldIssueBearerToken(headers: {
  'x-client-platform'?: string | string[] | undefined;
  [key: string]: string | string[] | undefined;
}): boolean {
  return headerValue(headers['x-client-platform']) === NATIVE_CLIENT_VALUE;
}

function headerValue(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
