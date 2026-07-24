import { BlockList, isIP } from 'node:net';
import { z } from 'zod';

/**
 * Single typed, validated configuration module (ARCHITECTURE §13).
 * All runtime configuration is read here exactly once. Missing required
 * configuration aborts startup (AC-007); secrets are never logged (AC-042).
 */

/**
 * Validate a TRUSTED_PROXIES entry as a real IPv4/IPv6 address or CIDR.
 * Uses Node's `net.isIP` plus explicit prefix-length bounds (IPv4 ≤32, IPv6 ≤128).
 */
export function isTrustedProxyEntry(value: string): boolean {
  if (isIP(value) !== 0) return true;

  const slash = value.lastIndexOf('/');
  if (slash <= 0 || slash === value.length - 1) return false;

  const addr = value.slice(0, slash);
  const prefixRaw = value.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixRaw)) return false;

  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0) return false;

  const version = isIP(addr);
  if (version === 4) return prefix <= 32;
  if (version === 6) return prefix <= 128;
  return false;
}

/** Strip IPv4-mapped IPv6 so `::ffff:127.0.0.1` compares as `127.0.0.1`. */
export function normalizeIp(address: string | undefined | null): string | null {
  if (!address) return null;
  let value = address.trim();
  if (value.startsWith('::ffff:')) {
    value = value.slice('::ffff:'.length);
  }
  return isIP(value) !== 0 ? value : null;
}

/** True when `address` is exactly listed or covered by a CIDR in `trustedProxies`. */
export function isAddressInTrustedProxies(address: string, trustedProxies: string[]): boolean {
  const peer = normalizeIp(address);
  if (!peer || trustedProxies.length === 0) return false;

  const version = isIP(peer);
  if (version === 0) return false;

  const list = new BlockList();
  for (const entry of trustedProxies) {
    const entryVersion = isIP(entry);
    if (entryVersion === 4) {
      list.addAddress(entry, 'ipv4');
      continue;
    }
    if (entryVersion === 6) {
      list.addAddress(entry, 'ipv6');
      continue;
    }
    const slash = entry.lastIndexOf('/');
    if (slash <= 0) continue;
    const addr = entry.slice(0, slash);
    const prefix = Number(entry.slice(slash + 1));
    const cidrVersion = isIP(addr);
    if (cidrVersion === 4) list.addSubnet(addr, prefix, 'ipv4');
    else if (cidrVersion === 6) list.addSubnet(addr, prefix, 'ipv6');
  }

  return list.check(peer, version === 4 ? 'ipv4' : 'ipv6');
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
