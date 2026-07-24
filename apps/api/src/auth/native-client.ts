/**
 * Native Capacitor clients identify themselves so the API may issue bearer
 * session tokens. Browser clients must not receive `set-auth-token`.
 *
 * Issuance requires BOTH:
 * - `X-Client-Platform: capacitor`
 * - `Origin` in the strict Capacitor WebView allowlist
 *
 * A spoofed platform header from a browser origin must not issue a bearer token.
 */
export const NATIVE_CLIENT_HEADER = 'x-client-platform';
export const NATIVE_CLIENT_VALUE = 'capacitor';

/** Exact Origin values used by Capacitor WebViews (not Vite/dev browser ports). */
export const NATIVE_WEBVIEW_ORIGINS = new Set([
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'https://localhost',
]);

export function isNativeWebViewOrigin(origin: string | null): boolean {
  return origin !== null && NATIVE_WEBVIEW_ORIGINS.has(origin);
}

export function isNativeClientRequest(headers: {
  'x-client-platform'?: string | string[] | undefined;
  origin?: string | string[] | undefined;
  [key: string]: string | string[] | undefined;
}): boolean {
  const platform = headerValue(headers['x-client-platform']);
  const origin = headerValue(headers.origin);
  return platform === NATIVE_CLIENT_VALUE && isNativeWebViewOrigin(origin);
}

/** Issuance requires platform header AND a Capacitor WebView Origin. */
export function shouldIssueBearerToken(headers: {
  'x-client-platform'?: string | string[] | undefined;
  origin?: string | string[] | undefined;
  [key: string]: string | string[] | undefined;
}): boolean {
  return isNativeClientRequest(headers);
}

function headerValue(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
