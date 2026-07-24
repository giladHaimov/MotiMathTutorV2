import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '../db/index.js';
import { getConfig } from '../config/index.js';
import * as authSchema from '../db/schema/auth-schema.js';

/**
 * Real Better Auth instance (AC-001): email/password, Drizzle adapter, real
 * PostgreSQL. The auth tables are OWNED by Better Auth's official generator —
 * `npm run auth:generate` writes `db/schema/auth-schema.ts`. Custom model names
 * (below) map those tables to `auth_users/auth_sessions/auth_accounts/
 * auth_verifications` (ARCHITECTURE §9.1–9.4) and MUST be set before generating.
 *
 * Rate limiting uses Better Auth defaults (including the 3/10s special rule for
 * sign-up/sign-in). Tests must not weaken these limits — E2E/integration isolate
 * clients with unique `X-Forwarded-For` values instead.
 */
const config = getConfig();

// Reuse the shared, pool-resilient Drizzle proxy so Better Auth survives a
// pool teardown/reconnect (e.g. process restart) exactly like product queries.
export const auth = betterAuth({
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
  advanced: {
    // Resolve the client IP from the proxy header for per-IP auth rate limiting.
    ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
  },
  // Better Auth generates its own string IDs (the auth_* PKs have no DB default).
});

export type Auth = typeof auth;
