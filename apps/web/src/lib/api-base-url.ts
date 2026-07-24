/**
 * Native Capacitor API origin policy.
 *
 * - Browser: always same-origin relative URLs (ignores native env vars).
 * - Native production: HTTPS origin-only AND exact match against
 *   `VITE_PRODUCTION_API_ORIGINS`.
 * - Native HTTP-dev: HTTP allowed only when `VITE_CAPACITOR_HTTP_DEV=1`.
 *
 * Preferred packaging loads the SPA from `VITE_CAPACITOR_SERVER_URL` (same-origin
 * cookies). Absolute `VITE_API_BASE_URL` is optional.
 */

import { CAPACITOR_SERVER_ORIGIN_ENV } from './capacitor-env.js';

export type ClientRuntimeMode = 'development' | 'production' | 'test';

export function parseOriginAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const url = new URL(entry);
      if (url.pathname !== '/' && url.pathname !== '') {
        throw new Error(`Allowlist entry must be origin-only: ${entry}`);
      }
      if (url.search || url.hash || url.username || url.password) {
        throw new Error(`Allowlist entry must be origin-only: ${entry}`);
      }
      return url.origin;
    });
}

export function parseOriginOnly(raw: string, label = 'API origin'): string {
  const value = raw.trim();
  if (!value) {
    throw new Error(`${label} is required`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid absolute URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} must use http:// or https://`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not embed credentials`);
  }
  const path = url.pathname === '/' ? '' : url.pathname;
  if (path !== '' || url.search !== '' || url.hash !== '') {
    throw new Error(`${label} must be an origin only (scheme://host[:port])`);
  }
  return url.origin;
}

export function resolveNativeApiBaseUrl(
  raw: string | undefined,
  mode: ClientRuntimeMode,
  options: {
    httpDev?: boolean;
    productionAllowlist?: string[];
  } = {},
): string {
  const origin = parseOriginOnly(
    raw ?? '',
    'VITE_API_BASE_URL is required for native Capacitor builds and',
  );

  const httpDev = options.httpDev === true;
  const allowlist = options.productionAllowlist ?? [];

  if (mode === 'production') {
    if (origin.startsWith('http://')) {
      throw new Error('VITE_API_BASE_URL must use https:// in production native builds');
    }
    if (allowlist.length === 0) {
      throw new Error(
        'VITE_PRODUCTION_API_ORIGINS allowlist is required for production native builds',
      );
    }
    if (!allowlist.includes(origin)) {
      throw new Error(
        `VITE_API_BASE_URL origin ${origin} is not in VITE_PRODUCTION_API_ORIGINS allowlist`,
      );
    }
    return origin;
  }

  if (origin.startsWith('http://') && !httpDev) {
    throw new Error(
      'HTTP native API origins require explicit Capacitor HTTP development mode (VITE_CAPACITOR_HTTP_DEV=1)',
    );
  }

  return origin;
}

export function apiBaseUrlForRuntime(options: {
  isNative: boolean;
  viteApiBaseUrl?: string;
  mode: ClientRuntimeMode;
  httpDev?: boolean;
  productionAllowlistRaw?: string;
}): string {
  if (!options.isNative) return '';
  if (options.viteApiBaseUrl === '' || options.viteApiBaseUrl === undefined) {
    return '';
  }
  return resolveNativeApiBaseUrl(options.viteApiBaseUrl, options.mode, {
    httpDev: options.httpDev,
    productionAllowlist: parseOriginAllowlist(options.productionAllowlistRaw),
  });
}

export function viteModeToRuntime(mode: string, prod: boolean): ClientRuntimeMode {
  if (mode === 'test') return 'test';
  if (prod || mode === 'production') return 'production';
  return 'development';
}

/** Build-time / startup check for Capacitor packaging (release). */
export function assertProductionNativePackageOrigin(
  serverUrl: string,
  allowlistRaw: string | undefined,
): string {
  const origin = parseOriginOnly(serverUrl, CAPACITOR_SERVER_ORIGIN_ENV);
  if (!origin.startsWith('https://')) {
    throw new Error(`Production ${CAPACITOR_SERVER_ORIGIN_ENV} must be https://`);
  }
  const allowlist = parseOriginAllowlist(allowlistRaw);
  if (allowlist.length === 0) {
    throw new Error('VITE_PRODUCTION_API_ORIGINS is required for production Capacitor packaging');
  }
  if (!allowlist.includes(origin)) {
    throw new Error(
      `${CAPACITOR_SERVER_ORIGIN_ENV} origin ${origin} is not in VITE_PRODUCTION_API_ORIGINS allowlist`,
    );
  }
  return origin;
}

/**
 * Fail fast on native production misconfiguration (allowlist / HTTPS / HTTP-dev).
 * Called at app startup for Capacitor packages.
 */
export function assertNativeRuntimeOrigins(options: {
  isNative: boolean;
  mode: ClientRuntimeMode;
  httpDev?: boolean;
  viteApiBaseUrl?: string;
  capacitorServerUrl?: string;
  productionAllowlistRaw?: string;
}): void {
  if (!options.isNative) return;

  const allowlist = parseOriginAllowlist(options.productionAllowlistRaw);

  if (options.mode === 'production') {
    const packageOrigin = options.capacitorServerUrl?.trim() || options.viteApiBaseUrl?.trim();
    if (!packageOrigin) {
      throw new Error(
        `Production native builds require ${CAPACITOR_SERVER_ORIGIN_ENV} (or VITE_API_BASE_URL)`,
      );
    }
    assertProductionNativePackageOrigin(packageOrigin, options.productionAllowlistRaw);
    if (options.viteApiBaseUrl?.trim()) {
      resolveNativeApiBaseUrl(options.viteApiBaseUrl, 'production', {
        productionAllowlist: allowlist,
      });
    }
    return;
  }

  if (options.viteApiBaseUrl?.trim()) {
    resolveNativeApiBaseUrl(options.viteApiBaseUrl, options.mode, {
      httpDev: options.httpDev === true,
      productionAllowlist: allowlist,
    });
  }
  if (options.capacitorServerUrl?.trim()?.startsWith('http://') && options.httpDev !== true) {
    throw new Error(`HTTP ${CAPACITOR_SERVER_ORIGIN_ENV} requires VITE_CAPACITOR_HTTP_DEV=1`);
  }
}
