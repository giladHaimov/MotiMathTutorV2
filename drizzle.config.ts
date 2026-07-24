import { defineConfig } from 'drizzle-kit';

/**
 * Explicit-SQL migration pipeline (ARCHITECTURE §2). `drizzle-kit generate`
 * reads the combined schema (generated auth + hand-written product) and emits
 * SQL migration files into db/migrations. `npm run db:migrate` applies them.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './apps/api/src/db/schema/index.ts',
  out: './db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/reasoning_tutor',
  },
  strict: true,
  verbose: true,
});
