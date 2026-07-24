/**
 * Separates browser vs native API origin configuration.
 *
 * - Browser: always same-origin relative URLs (ignores VITE_API_BASE_URL).
 * - Native (Capacitor): requires VITE_API_BASE_URL; production must be https://;
 *   http:// is allowed only in development/test.
 */

export type ClientRuntimeMode = 'development' | 'production' | 'test';

export function resolveNativeApiBaseUrl(raw: string | undefined, mode: ClientRuntimeMode): string {
  const value = (raw ?? '').trim();
  if (!value) {
    throw new Error('VITE_API_BASE_URL is required for native Capacitor builds');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('VITE_API_BASE_URL must be a valid absolute URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('VITE_API_BASE_URL must use http:// or https://');
  }

  if (mode === 'production' && url.protocol !== 'https:') {
    throw new Error('VITE_API_BASE_URL must use https:// in production native builds');
  }

  if (url.username || url.password) {
    throw new Error('VITE_API_BASE_URL must not embed credentials');
  }

  return value.replace(/\/$/, '');
}

export function apiBaseUrlForRuntime(options: {
  isNative: boolean;
  viteApiBaseUrl?: string;
  mode: ClientRuntimeMode;
}): string {
  // Browser configuration is intentionally separate: never use the native env var.
  if (!options.isNative) return '';
  return resolveNativeApiBaseUrl(options.viteApiBaseUrl, options.mode);
}

export function viteModeToRuntime(mode: string, prod: boolean): ClientRuntimeMode {
  if (mode === 'test') return 'test';
  if (prod || mode === 'production') return 'production';
  return 'development';
}
