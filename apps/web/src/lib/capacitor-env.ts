/**
 * Canonical Capacitor packaging environment keys.
 *
 * One name only: Vite embeds `VITE_*` into the client bundle, and the same
 * process.env keys are read by capacitor.config.ts at sync/package time so
 * config-time `server.url` and runtime validation cannot diverge.
 */
export const CAPACITOR_SERVER_ORIGIN_ENV = 'VITE_CAPACITOR_SERVER_URL' as const;
export const CAPACITOR_HTTP_DEV_ENV = 'VITE_CAPACITOR_HTTP_DEV' as const;
export const PRODUCTION_API_ORIGINS_ENV = 'VITE_PRODUCTION_API_ORIGINS' as const;

export type EnvMap = Record<string, string | undefined>;

export function readCapacitorServerOrigin(env: EnvMap): string | undefined {
  const raw = env[CAPACITOR_SERVER_ORIGIN_ENV];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function readCapacitorHttpDev(env: EnvMap): boolean {
  return env[CAPACITOR_HTTP_DEV_ENV] === '1';
}

export function readProductionApiOrigins(env: EnvMap): string | undefined {
  const raw = env[PRODUCTION_API_ORIGINS_ENV];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
