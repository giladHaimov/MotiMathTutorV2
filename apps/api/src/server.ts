import { buildApp } from './app.js';
import { getConfig, loadConfig } from './config/index.js';
import { getPool, closePool } from './db/pool.js';

/**
 * Production entrypoint. Validates configuration and database connectivity at
 * startup; aborts (rather than falling back insecurely) if either fails
 * (ARCHITECTURE §16, PB-042/AC-007).
 */
async function main(): Promise<void> {
  // Validate configuration first — missing required config aborts startup.
  loadConfig();
  const config = getConfig();

  // Verify real database connectivity before accepting traffic.
  await getPool().query('select 1');

  const app = await buildApp({ config });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await closePool();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('Fatal startup error:', message);
  if (/BETTER_AUTH_SECRET/i.test(message)) {
    console.error(
      'BETTER_AUTH_SECRET is required in production and must not be a placeholder. Set a strong secret and restart.',
    );
  }
  process.exit(1);
});
