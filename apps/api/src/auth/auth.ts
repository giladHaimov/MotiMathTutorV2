import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import { db } from '../db/index.js';
import type { AppConfig } from '../config/index.js';
import * as authSchema from '../db/schema/auth-schema.js';

/**
 * Real Better Auth instance (AC-001): email/password, Drizzle adapter, real
 * PostgreSQL. The auth tables are OWNED by Better Auth's official generator —
 * `npm run auth:generate` writes `db/schema/auth-schema.ts`. Custom model names
 * (below) map those tables to `auth_users/auth_sessions/auth_accounts/
 * auth_verifications` (ARCHITECTURE §9.1–9.4) and MUST be set before generating.
 *
 * Rate limiting uses Better Auth defaults (including the 3/10s special rule for
 * sign-up/sign-in). Those limits are never weakened. X-Forwarded-For is honored
 * only when `TRUSTED_PROXIES` is explicitly configured; otherwise it is ignored
 * so direct clients cannot spoof their IP for per-IP rate limits.
 *
 * The bearer plugin enables the approved Capacitor session-token path
 * (ARCHITECTURE §2 / §17): clients may authenticate with
 * `Authorization: Bearer <session token>` in addition to cookies.
 */
export function createAuth(config: AppConfig) {
  const trustForwardedIp = config.TRUSTED_PROXIES.length > 0;

  return betterAuth({
    appName: 'reasoning-tutor',
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.BETTER_AUTH_URL,
    basePath: '/api/auth',
    trustedOrigins: config.TRUSTED_ORIGINS,
    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
    emailAndPassword: {
      enabled: true,
      // MVP keeps registration simple; verification flow tables still exist in schema.
      requireEmailVerification: false,
      autoSignIn: true,
    },
    user: { modelName: 'auth_users' },
    session: { modelName: 'auth_sessions' },
    account: { modelName: 'auth_accounts' },
    verification: { modelName: 'auth_verifications' },
    plugins: [bearer()],
    advanced: {
      ipAddress: trustForwardedIp
        ? {
            ipAddressHeaders: ['x-forwarded-for'],
            trustedProxies: [...config.TRUSTED_PROXIES],
          }
        : {
            // Empty list disables the Better Auth default of reading X-Forwarded-For
            // (see getIp: `ipAddressHeaders || DEFAULT_IP_HEADERS`).
            ipAddressHeaders: [],
          },
    },
    // Better Auth defaults enable rate limiting only when NODE_ENV=production.
    // Keep the library's window/max/special rules, but always enforce them so
    // test/dev cannot silently lose per-IP signup protection.
    rateLimit: {
      enabled: true,
    },
    // Better Auth generates its own string IDs (the auth_* PKs have no DB default).
  });
}

export type Auth = ReturnType<typeof createAuth>;
