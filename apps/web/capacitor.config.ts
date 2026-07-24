import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Same Vite web build runs in browser and Capacitor (PB-041 / AC-045–047).
 *
 * Auth: Better Auth cookie sessions. Packaging sets `server.url` from the
 * canonical env key `VITE_CAPACITOR_SERVER_URL` (same name embedded by Vite for
 * runtime asserts in `src/lib/capacitor-env.ts` — keep them identical).
 *
 * HTTP cleartext is allowed only when VITE_CAPACITOR_HTTP_DEV=1
 * (explicit `npm run cap:dev`). Release packages must use HTTPS.
 *
 * NOTE: This file is loaded by Cap CLI via require() — do not import from src/.
 */

/** Must match CAPACITOR_SERVER_ORIGIN_ENV in src/lib/capacitor-env.ts */
const SERVER_ORIGIN_ENV = 'VITE_CAPACITOR_SERVER_URL';
/** Must match CAPACITOR_HTTP_DEV_ENV in src/lib/capacitor-env.ts */
const HTTP_DEV_ENV = 'VITE_CAPACITOR_HTTP_DEV';
/** Must match PRODUCTION_API_ORIGINS_ENV in src/lib/capacitor-env.ts */
const PRODUCTION_ORIGINS_ENV = 'VITE_PRODUCTION_API_ORIGINS';

function parseOriginOnly(raw: string, label: string): string {
  const value = raw.trim();
  if (!value) throw new Error(`${label} is required`);
  const url = new URL(value);
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

function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => parseOriginOnly(entry, `Allowlist entry ${entry}`));
}

const httpDev = process.env[HTTP_DEV_ENV] === '1';
const packageMode = process.env.CAPACITOR_PACKAGE_MODE ?? (httpDev ? 'development' : 'local');
const serverUrlRaw = process.env[SERVER_ORIGIN_ENV]?.trim();

let serverUrl: string | undefined;
if (serverUrlRaw) {
  const origin = parseOriginOnly(serverUrlRaw, SERVER_ORIGIN_ENV);
  if (packageMode === 'production') {
    if (!origin.startsWith('https://')) {
      throw new Error(`Production ${SERVER_ORIGIN_ENV} must be https://`);
    }
    const allowlist = parseAllowlist(process.env[PRODUCTION_ORIGINS_ENV]);
    if (allowlist.length === 0) {
      throw new Error(`${PRODUCTION_ORIGINS_ENV} is required for production Capacitor packaging`);
    }
    if (!allowlist.includes(origin)) {
      throw new Error(
        `${SERVER_ORIGIN_ENV} origin ${origin} is not in ${PRODUCTION_ORIGINS_ENV} allowlist`,
      );
    }
  } else if (origin.startsWith('http://') && !httpDev) {
    throw new Error(`HTTP ${SERVER_ORIGIN_ENV} requires ${HTTP_DEV_ENV}=1 (use npm run cap:dev)`);
  }
  serverUrl = origin;
} else if (packageMode === 'production') {
  throw new Error(
    `Production Capacitor packaging requires ${SERVER_ORIGIN_ENV} (HTTPS, allowlisted)`,
  );
}

const config: CapacitorConfig = {
  appId: 'com.reasoningtutor.app',
  appName: 'Reasoning Tutor',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    ...(serverUrl
      ? {
          url: serverUrl,
          cleartext: httpDev && serverUrl.startsWith('http://'),
        }
      : {}),
  },
};

export default config;
