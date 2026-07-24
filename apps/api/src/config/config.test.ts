import { describe, expect, it } from 'vitest';
import { loadConfig, sanitizedConfig, trustProxyOption } from './index.js';

const base = {
  DATABASE_URL: 'postgres://u:secretpw@localhost:5432/db',
  BETTER_AUTH_SECRET: 'a-sufficiently-long-secret-value',
  BETTER_AUTH_URL: 'http://localhost:8080',
  TRUSTED_ORIGINS: 'http://localhost:5173, http://localhost:8080',
};

describe('config', () => {
  it('parses a valid environment and splits trusted origins', () => {
    const config = loadConfig({ ...base });
    expect(config.PORT).toBe(8080);
    expect(config.TRUSTED_ORIGINS).toEqual(['http://localhost:5173', 'http://localhost:8080']);
    expect(config.TRUSTED_PROXIES).toEqual([]);
    expect(trustProxyOption(config)).toBe(false);
  });

  it('parses explicit TRUSTED_PROXIES IP/CIDR list for reverse-proxy mode', () => {
    const config = loadConfig({
      ...base,
      TRUSTED_PROXIES: '127.0.0.1, 10.0.0.0/8',
    });
    expect(config.TRUSTED_PROXIES).toEqual(['127.0.0.1', '10.0.0.0/8']);
    expect(trustProxyOption(config)).toEqual(['127.0.0.1', '10.0.0.0/8']);
  });

  it('rejects invalid TRUSTED_PROXIES entries', () => {
    expect(() => loadConfig({ ...base, TRUSTED_PROXIES: 'not-an-ip' })).toThrow(/TRUSTED_PROXIES/);
  });

  it('aborts when a required secret is missing (AC-007)', () => {
    const { BETTER_AUTH_SECRET: _omit, ...rest } = base;
    expect(() => loadConfig(rest)).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('aborts when DATABASE_URL is missing (AC-007)', () => {
    const { DATABASE_URL: _omit, ...rest } = base;
    expect(() => loadConfig(rest)).toThrow(/DATABASE_URL/);
  });

  it('redacts secrets in the sanitized view (AC-042)', () => {
    const config = loadConfig({ ...base });
    const safe = sanitizedConfig(config);
    expect(safe.BETTER_AUTH_SECRET).toBe('[REDACTED]');
    expect(String(safe.DATABASE_URL)).not.toContain('secretpw');
    expect(safe.TRUSTED_PROXIES).toEqual([]);
  });
});
