import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Same Vite web build runs in browser and Capacitor (PB-041 / AC-045–047).
 *
 * Auth: Better Auth cookie sessions. Preferred packaging sets `server.url` to the
 * API origin so the WebView is same-origin with `/api` cookies (no bearer tokens).
 *
 * HTTP cleartext is allowed only when CAPACITOR_HTTP_DEV=1 / VITE_CAPACITOR_HTTP_DEV=1
 * (explicit `npm run cap:dev` development mode). Release packages must use HTTPS.
 */

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

const httpDev =
  process.env.CAPACITOR_HTTP_DEV === '1' || process.env.VITE_CAPACITOR_HTTP_DEV === '1';
const packageMode = process.env.CAPACITOR_PACKAGE_MODE ?? (httpDev ? 'development' : 'local');
const serverUrlRaw = process.env.CAPACITOR_SERVER_URL ?? process.env.VITE_CAPACITOR_SERVER_URL;

let serverUrl: string | undefined;
if (serverUrlRaw) {
  const origin = parseOriginOnly(serverUrlRaw, 'CAPACITOR_SERVER_URL');
  if (packageMode === 'production') {
    if (!origin.startsWith('https://')) {
      throw new Error('Production Capacitor server.url must be https://');
    }
    const allowlist = parseAllowlist(process.env.VITE_PRODUCTION_API_ORIGINS);
    if (allowlist.length === 0) {
      throw new Error('VITE_PRODUCTION_API_ORIGINS is required for production Capacitor packaging');
    }
    if (!allowlist.includes(origin)) {
      throw new Error(
        `Capacitor server.url ${origin} is not in VITE_PRODUCTION_API_ORIGINS allowlist`,
      );
    }
  } else if (origin.startsWith('http://') && !httpDev) {
    throw new Error(
      'HTTP CAPACITOR_SERVER_URL requires CAPACITOR_HTTP_DEV=1 (use npm run cap:dev)',
    );
  }
  serverUrl = origin;
} else if (packageMode === 'production') {
  throw new Error(
    'Production Capacitor packaging requires CAPACITOR_SERVER_URL (HTTPS, allowlisted)',
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
