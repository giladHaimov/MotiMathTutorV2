import { describe, expect, it } from 'vitest';
import {
  apiBaseUrlForRuntime,
  assertNativeRuntimeOrigins,
  assertProductionNativePackageOrigin,
  parseOriginAllowlist,
  resolveNativeApiBaseUrl,
  viteModeToRuntime,
} from './api-base-url.js';

describe('API origin validation (native vs browser)', () => {
  it('browser runtime ignores VITE_API_BASE_URL and uses same-origin', () => {
    expect(
      apiBaseUrlForRuntime({
        isNative: false,
        viteApiBaseUrl: 'http://evil.example',
        mode: 'production',
      }),
    ).toBe('');
  });

  it('native HTTP requires explicit http-dev mode', () => {
    expect(() => resolveNativeApiBaseUrl('http://10.0.2.2:8080', 'development')).toThrow(
      /HTTP development mode/,
    );
    expect(resolveNativeApiBaseUrl('http://10.0.2.2:8080', 'development', { httpDev: true })).toBe(
      'http://10.0.2.2:8080',
    );
    expect(resolveNativeApiBaseUrl('http://10.0.2.2:8080/', 'test', { httpDev: true })).toBe(
      'http://10.0.2.2:8080',
    );
  });

  it('native production requires https:// and exact allowlist match', () => {
    expect(() =>
      resolveNativeApiBaseUrl('http://api.example.com', 'production', {
        productionAllowlist: ['https://api.example.com'],
      }),
    ).toThrow(/https:\/\//);

    expect(() =>
      resolveNativeApiBaseUrl('https://api.example.com', 'production', {
        productionAllowlist: [],
      }),
    ).toThrow(/allowlist is required/);

    expect(() =>
      resolveNativeApiBaseUrl('https://evil.example.com', 'production', {
        productionAllowlist: ['https://api.example.com'],
      }),
    ).toThrow(/not in VITE_PRODUCTION_API_ORIGINS/);

    expect(
      resolveNativeApiBaseUrl('https://api.example.com/', 'production', {
        productionAllowlist: ['https://api.example.com'],
      }),
    ).toBe('https://api.example.com');
  });

  it('assertProductionNativePackageOrigin positive and negative', () => {
    expect(
      assertProductionNativePackageOrigin(
        'https://api.example.com',
        'https://api.example.com,https://other.example.com',
      ),
    ).toBe('https://api.example.com');

    expect(() =>
      assertProductionNativePackageOrigin('http://api.example.com', 'https://api.example.com'),
    ).toThrow(/https:\/\//);

    expect(() =>
      assertProductionNativePackageOrigin('https://api.example.com/v1', 'https://api.example.com'),
    ).toThrow(/origin only/);

    expect(() =>
      assertProductionNativePackageOrigin(
        'https://not-allowed.example.com',
        'https://api.example.com',
      ),
    ).toThrow(/not in VITE_PRODUCTION_API_ORIGINS/);
  });

  it('parseOriginAllowlist rejects non-origin entries', () => {
    expect(parseOriginAllowlist('https://a.example, https://b.example')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
    expect(() => parseOriginAllowlist('https://a.example/path')).toThrow(/origin-only/);
  });

  it('rejects missing, invalid, or credential-bearing URLs', () => {
    expect(() => resolveNativeApiBaseUrl(undefined, 'development', { httpDev: true })).toThrow(
      /required/,
    );
    expect(() => resolveNativeApiBaseUrl('not-a-url', 'development', { httpDev: true })).toThrow(
      /valid absolute URL/,
    );
    expect(() =>
      resolveNativeApiBaseUrl('ftp://api.example.com', 'development', { httpDev: true }),
    ).toThrow(/http:\/\/ or https:\/\//);
    expect(() =>
      resolveNativeApiBaseUrl('https://user:pass@api.example.com', 'production', {
        productionAllowlist: ['https://api.example.com'],
      }),
    ).toThrow(/credentials/);
  });

  it('rejects path, query, and hash — origin only', () => {
    expect(() =>
      resolveNativeApiBaseUrl('https://api.example.com/v1', 'production', {
        productionAllowlist: ['https://api.example.com'],
      }),
    ).toThrow(/origin only/);
    expect(() =>
      resolveNativeApiBaseUrl('https://api.example.com?x=1', 'production', {
        productionAllowlist: ['https://api.example.com'],
      }),
    ).toThrow(/origin only/);
    expect(() =>
      resolveNativeApiBaseUrl('https://api.example.com/#frag', 'production', {
        productionAllowlist: ['https://api.example.com'],
      }),
    ).toThrow(/origin only/);
  });

  it('assertNativeRuntimeOrigins fails production without allowlisted package origin', () => {
    expect(() =>
      assertNativeRuntimeOrigins({
        isNative: true,
        mode: 'production',
        productionAllowlistRaw: 'https://api.example.com',
      }),
    ).toThrow(/VITE_CAPACITOR_SERVER_URL/);

    expect(() =>
      assertNativeRuntimeOrigins({
        isNative: true,
        mode: 'production',
        capacitorServerUrl: 'https://evil.example.com',
        productionAllowlistRaw: 'https://api.example.com',
      }),
    ).toThrow(/not in VITE_PRODUCTION_API_ORIGINS/);

    expect(() =>
      assertNativeRuntimeOrigins({
        isNative: true,
        mode: 'production',
        capacitorServerUrl: 'https://api.example.com',
        productionAllowlistRaw: 'https://api.example.com',
      }),
    ).not.toThrow();
  });

  it('maps vite mode flags', () => {
    expect(viteModeToRuntime('development', false)).toBe('development');
    expect(viteModeToRuntime('production', true)).toBe('production');
    expect(viteModeToRuntime('test', false)).toBe('test');
  });
});
