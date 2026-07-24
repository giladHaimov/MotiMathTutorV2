import { z } from 'zod';

/**
 * Single typed, validated configuration module (ARCHITECTURE §13).
 * All runtime configuration is read here exactly once. Missing required
 * configuration aborts startup (AC-007); secrets are never logged (AC-042).
 */
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
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ENGINE_VERSION: z.string().min(1).default('1.0.0'),
  CONTENT_SEED_MODE: z.enum(['off', 'import']).default('off'),
});

export type AppConfig = Omit<z.infer<typeof configSchema>, 'TRUSTED_ORIGINS'> & {
  TRUSTED_ORIGINS: string[];
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
  return parsed.data;
}

export function getConfig(): AppConfig {
  if (!cached) {
    cached = loadConfig();
  }
  return cached;
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
