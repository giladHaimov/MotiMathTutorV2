import { describe, expect, it } from 'vitest';
import {
  isAddressInTrustedProxies,
  isTrustedProxyEntry,
  loadConfig,
  normalizeIp,
  sanitizedConfig,
  trustProxyOption,
} from './index.js';

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
      TRUSTED_PROXIES: '127.0.0.1, 10.0.0.0/8, ::1, 2001:db8::/32',
    });
    expect(config.TRUSTED_PROXIES).toEqual(['127.0.0.1', '10.0.0.0/8', '::1', '2001:db8::/32']);
    expect(trustProxyOption(config)).toEqual(['127.0.0.1', '10.0.0.0/8', '::1', '2001:db8::/32']);
  });

  it('rejects invalid TRUSTED_PROXIES entries', () => {
    expect(() => loadConfig({ ...base, TRUSTED_PROXIES: 'not-an-ip' })).toThrow(/TRUSTED_PROXIES/);
  });

  it('aborts when a required secret is missing (AC-007)', () => {
    const { BETTER_AUTH_SECRET: _omit, ...rest } = base;
    expect(() => loadConfig(rest)).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('aborts production when BETTER_AUTH_SECRET is a documented placeholder', () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        BETTER_AUTH_SECRET: 'compose-only-example-secret-change-me',
      }),
    ).toThrow(/placeholder|BETTER_AUTH_SECRET/);
  });

  it('allows a non-placeholder secret in production', () => {
    const config = loadConfig({
      ...base,
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET: 'a-real-production-secret-value-32chars',
    });
    expect(config.NODE_ENV).toBe('production');
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

describe('isTrustedProxyEntry (net.isIP + CIDR prefix bounds)', () => {
  it('accepts valid IPv4 addresses', () => {
    expect(isTrustedProxyEntry('127.0.0.1')).toBe(true);
    expect(isTrustedProxyEntry('10.0.0.1')).toBe(true);
    expect(isTrustedProxyEntry('192.168.1.255')).toBe(true);
  });

  it('accepts valid IPv4 CIDRs', () => {
    expect(isTrustedProxyEntry('10.0.0.0/8')).toBe(true);
    expect(isTrustedProxyEntry('192.168.0.0/16')).toBe(true);
    expect(isTrustedProxyEntry('0.0.0.0/0')).toBe(true);
    expect(isTrustedProxyEntry('255.255.255.255/32')).toBe(true);
  });

  it('accepts valid IPv6 addresses', () => {
    expect(isTrustedProxyEntry('::1')).toBe(true);
    expect(isTrustedProxyEntry('2001:db8::1')).toBe(true);
    expect(isTrustedProxyEntry('fe80::1')).toBe(true);
  });

  it('accepts valid IPv6 CIDRs', () => {
    expect(isTrustedProxyEntry('2001:db8::/32')).toBe(true);
    expect(isTrustedProxyEntry('::1/128')).toBe(true);
    expect(isTrustedProxyEntry('fe80::/10')).toBe(true);
  });

  it('rejects malformed IPv4/IPv6 and invalid prefix lengths', () => {
    expect(isTrustedProxyEntry('not:an-ip')).toBe(false);
    expect(isTrustedProxyEntry('garbage:value/64')).toBe(false);
    expect(isTrustedProxyEntry('not-an-ip')).toBe(false);
    expect(isTrustedProxyEntry('1.2.3.4/99')).toBe(false);
    expect(isTrustedProxyEntry('1.2.3.4/-1')).toBe(false);
    expect(isTrustedProxyEntry('1.2.3.4/')).toBe(false);
    expect(isTrustedProxyEntry('/24')).toBe(false);
    expect(isTrustedProxyEntry('192.168.1.1/')).toBe(false);
    expect(isTrustedProxyEntry('999.1.1.1')).toBe(false);
    expect(isTrustedProxyEntry('::1/129')).toBe(false);
    expect(isTrustedProxyEntry('2001:db8::/129')).toBe(false);
    expect(isTrustedProxyEntry('2001:db8::/abc')).toBe(false);
  });

  it('loadConfig rejects the same malformed values', () => {
    for (const bad of ['not:an-ip', 'garbage:value/64', '1.2.3.4/99', '::1/129']) {
      expect(() => loadConfig({ ...base, TRUSTED_PROXIES: bad })).toThrow(/TRUSTED_PROXIES/);
    }
  });
});

describe('normalizeIp / isAddressInTrustedProxies', () => {
  it('normalizes IPv4-mapped IPv6 peers', () => {
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeIp('127.0.0.1')).toBe('127.0.0.1');
  });

  it('matches exact and CIDR trusted proxies', () => {
    expect(isAddressInTrustedProxies('127.0.0.1', ['127.0.0.1'])).toBe(true);
    expect(isAddressInTrustedProxies('10.1.2.3', ['10.0.0.0/8'])).toBe(true);
    expect(isAddressInTrustedProxies('11.0.0.1', ['10.0.0.0/8'])).toBe(false);
    expect(isAddressInTrustedProxies('2001:db8::abcd', ['2001:db8::/32'])).toBe(true);
    expect(isAddressInTrustedProxies('::ffff:127.0.0.1', ['127.0.0.1'])).toBe(true);
  });

  it('matches exact IPv6 trusted proxies without throwing', () => {
    expect(isAddressInTrustedProxies('::1', ['::1'])).toBe(true);
    expect(isAddressInTrustedProxies('2001:db8::1', ['2001:db8::1'])).toBe(true);
  });

  it('rejects exact IPv6 non-matches', () => {
    expect(isAddressInTrustedProxies('2001:db8::2', ['2001:db8::1'])).toBe(false);
    expect(isAddressInTrustedProxies('::2', ['::1'])).toBe(false);
  });
});
