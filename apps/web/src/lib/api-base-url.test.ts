import { describe, expect, it } from 'vitest';
import {
  apiBaseUrlForRuntime,
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

  it('native development may use http://', () => {
    expect(resolveNativeApiBaseUrl('http://10.0.2.2:8080', 'development')).toBe(
      'http://10.0.2.2:8080',
    );
    expect(resolveNativeApiBaseUrl('http://10.0.2.2:8080/', 'test')).toBe('http://10.0.2.2:8080');
  });

  it('native production requires https://', () => {
    expect(() => resolveNativeApiBaseUrl('http://api.example.com', 'production')).toThrow(
      /https:\/\//,
    );
    expect(resolveNativeApiBaseUrl('https://api.example.com/', 'production')).toBe(
      'https://api.example.com',
    );
  });

  it('rejects missing, invalid, or credential-bearing URLs', () => {
    expect(() => resolveNativeApiBaseUrl(undefined, 'development')).toThrow(/required/);
    expect(() => resolveNativeApiBaseUrl('not-a-url', 'development')).toThrow(/valid absolute URL/);
    expect(() => resolveNativeApiBaseUrl('ftp://api.example.com', 'development')).toThrow(
      /http:\/\/ or https:\/\//,
    );
    expect(() =>
      resolveNativeApiBaseUrl('https://user:pass@api.example.com', 'production'),
    ).toThrow(/credentials/);
  });

  it('maps vite mode flags', () => {
    expect(viteModeToRuntime('development', false)).toBe('development');
    expect(viteModeToRuntime('production', true)).toBe('production');
    expect(viteModeToRuntime('test', false)).toBe('test');
  });
});
