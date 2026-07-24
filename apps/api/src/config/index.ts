import { z } from 'zod';

/**
 * Single typed, validated configuration module (ARCHITECTURE §13).
 * All runtime configuration is read here exactly once. Missing required
 * configuration aborts startup (AC-007); secrets are never logged (AC-042).
 */

/** True for a single IPv4 address or IPv4 CIDR (e.g. 10.0.0.1, 10.0.0.0/8). */
function isIpv4OrCidr(value: string): boolean {
  const match = /^(?<ip>(?:\d{1,3}\.){3}\d{1,3})(?:\/(?<prefix>\d{1,2}))?$/.exec(value);
  if (!match?.groups?.ip) return false;
  const octets = match.groups.ip.split('.').map(Number);
  if (octets.some((o) => o > 255)) return false;
  if (match.groups.prefix !== undefined) {
    const prefix = Number(match.groups.prefix);
    if (prefix > 32) return false;
  }
  return true;
}

/** True for a basic IPv6 address or IPv6 CIDR. */
function isIpv6OrCidr(value: string): boolean {
  if (!value.includes(':')) return false;
  const [addr, prefix] = value.split('/');
  if (!addr || addr.length < 2) return false;
  if (prefix !== undefined) {
    const p = Number(prefix);
    if (!Number.isInteger(p) || p < 0 || p > 128) return false;
  }
  return true;
}

export function isTrustedProxyEntry(value: string): boolean {
  return isIpv4OrCidr(value) || isIpv6OrCidr(value);
}

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  BETTER_AUTH_SECRET: z.string().min(16, 'BETTER_AUTH_SECRET must be at least 16 characters'),
  BETTER_AUTH_URL: z.string().url('BETTER_AUTH_URL must be a valid URL'),
  TRUSTED_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  /**
   * Proxies trusted to set X-Forwarded-For. Default empty (safe): Fastify
   * trustProxy is false and Better Auth ignores X-Forwarded-For, so direct
   * clients cannot spoof their IP for auth rate limits. Behind a reverse
   * proxy, set explicit IP/CIDR entries only (never blank-trust-all).
   */
  TRUSTED_PROXIES: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .superRefine((entries, ctx) => {
      for (const entry of entries) {
        if (!isTrustedProxyEntry(entry)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `TRUSTED_PROXIES entry "${entry}" must be an IP or CIDR`,
          });
        }
      }
    }),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ENGINE_VERSION: z.string().min(1).default('1.0.0'),
  CONTENT_SEED_MODE: z.enum(['off', 'import']).default('off'),
});

export type AppConfig = Omit<
  z.infer<typeof configSchema>,
  'TRUSTED_ORIGINS' | 'TRUSTED_PROXIES'
> & {
  TRUSTED_ORIGINS: string[];
  TRUSTED_PROXIES: string[];
};

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // Abort startup rather than run with insecure defaults.
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data as AppConfig;
}

export function getConfig(): AppConfig {
  if (!cached) {
    cached = loadConfig();
  }
  return cached;
}

/** Fastify `trustProxy` option: false by default; otherwise the explicit proxy list. */
export function trustProxyOption(config: AppConfig): false | string[] {
  return config.TRUSTED_PROXIES.length > 0 ? config.TRUSTED_PROXIES : false;
}

/** A log-safe view of configuration: secrets are redacted (AC-042). */
export function sanitizedConfig(config: AppConfig): Record<string, unknown> {
  return {
    NODE_ENV: config.NODE_ENV,
    PORT: config.PORT,
    DATABASE_URL: redactUrlSecret(config.DATABASE_URL),
    BETTER_AUTH_SECRET: '[REDACTED]',
    BETTER_AUTH_URL: config.BETTER_AUTH_URL,
    TRUSTED_ORIGINS: config.TRUSTED_ORIGINS,
    TRUSTED_PROXIES: config.TRUSTED_PROXIES,
    LOG_LEVEL: config.LOG_LEVEL,
    ENGINE_VERSION: config.ENGINE_VERSION,
    CONTENT_SEED_MODE: config.CONTENT_SEED_MODE,
  };
}

/** Mask any password embedded in a connection URL. */
function redactUrlSecret(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '[unparseable-url]';
  }
}
