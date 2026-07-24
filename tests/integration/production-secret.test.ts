import { describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const composeFile = join(root, 'docker-compose.yml');

/**
 * Production must fail closed without BETTER_AUTH_SECRET (AC-007 / release gate):
 * - application process aborts before listening
 * - docker compose refuses to start the app service (healthcheck never healthy)
 * - providing a real secret allows compose config / startup path to proceed
 *
 * Full container health with a valid secret is also exercised by `npm run verify`
 * (docker compose up + /health).
 */
describe('production BETTER_AUTH_SECRET fail-closed', () => {
  it('application startup aborts in production when BETTER_AUTH_SECRET is missing', async () => {
    const env = { ...process.env };
    delete env.BETTER_AUTH_SECRET;

    const child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/server.ts'], {
      cwd: root,
      env: {
        ...env,
        NODE_ENV: 'production',
        PORT: '18081',
        DATABASE_URL:
          process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5439/reasoning_tutor',
        BETTER_AUTH_URL: 'http://localhost:18081',
        TRUSTED_ORIGINS: 'http://localhost:18081',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdout = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    const exitCode = await new Promise<number>((resolve) => {
      child.on('exit', (code) => resolve(code ?? 1));
    });

    expect(exitCode).not.toBe(0);
    const combined = `${stdout}\n${stderr}`;
    expect(combined).toMatch(/BETTER_AUTH_SECRET|Invalid configuration|Fatal startup error/i);

    // Process never became a listening server — health must not succeed.
    let healthOk = false;
    try {
      const res = await fetch('http://localhost:18081/health');
      healthOk = res.ok;
    } catch {
      healthOk = false;
    }
    expect(healthOk).toBe(false);
  }, 60_000);

  it('docker compose fails closed without BETTER_AUTH_SECRET (no healthy app)', () => {
    const env = { ...process.env };
    delete env.BETTER_AUTH_SECRET;

    const result = spawnSync(
      'docker',
      ['compose', '-f', composeFile, '-p', `prodsecret-neg-${Date.now()}`, 'up', '-d', 'app'],
      {
        cwd: root,
        env,
        encoding: 'utf8',
      },
    );

    expect(result.status).not.toBe(0);
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).toMatch(/BETTER_AUTH_SECRET is required/);
  }, 60_000);

  it('docker compose accepts configuration once BETTER_AUTH_SECRET is provided', () => {
    const result = spawnSync('docker', ['compose', '-f', composeFile, 'config'], {
      cwd: root,
      env: {
        ...process.env,
        BETTER_AUTH_SECRET: 'integration-prod-secret-please-change-32',
      },
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/BETTER_AUTH_SECRET/);
    expect(result.stdout).not.toMatch(/compose-only-example-secret-change-me/);
  });
});
