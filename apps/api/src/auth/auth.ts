import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
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
 * Authentication for web and Capacitor is **cookie session only**. Capacitor
 * packages load the SPA from the API origin (`server.url`) so cookies are
 * same-origin. Caller-controlled headers/Origin checks are not used for auth.
 *
 * Rate limiting uses Better Auth defaults (including the 3/10s special rule for
 * sign-up/sign-in). Those limits are never weakened. X-Forwarded-For is honored
 * only when `TRUSTED_PROXIES` is explicitly configured; otherwise it is ignored
 * so direct clients cannot spoof their IP for per-IP rate limits.
 */
export function createAuth(config: AppConfig) {
  const trustForwardedIp = config.TRUSTED_PROXIES.length > 0;
  const secureCookies = config.NODE_ENV === 'production';

  return betterAuth({
    appName: 'reasoning-tutor',
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.BETTER_AUTH_URL,
    basePath: '/api/auth',
    trustedOrigins: config.TRUSTED_ORIGINS,
    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: true,
    },
    user: { modelName: 'auth_users' },
    session: { modelName: 'auth_sessions' },
    account: { modelName: 'auth_accounts' },
    verification: { modelName: 'auth_verifications' },
    advanced: {
      defaultCookieAttributes: {
        httpOnly: true,
        // Same-origin Capacitor packaging uses Lax; Secure in production HTTPS.
        sameSite: 'lax',
        secure: secureCookies,
        path: '/',
      },
      ipAddress: trustForwardedIp
        ? {
            ipAddressHeaders: ['x-forwarded-for'],
            trustedProxies: [...config.TRUSTED_PROXIES],
          }
        : {
            ipAddressHeaders: [],
          },
    },
    rateLimit: {
      enabled: true,
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
