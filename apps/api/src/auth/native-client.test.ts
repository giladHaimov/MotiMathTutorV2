import { describe, expect, it } from 'vitest';
import { shouldIssueBearerToken, isNativeClientRequest } from './native-client.js';

describe('native client bearer issuance gate', () => {
  it('issues bearer only when platform header AND Capacitor WebView Origin are present', () => {
    expect(
      shouldIssueBearerToken({
        'x-client-platform': 'capacitor',
        origin: 'capacitor://localhost',
      }),
    ).toBe(true);
    expect(
      shouldIssueBearerToken({
        'x-client-platform': ['capacitor'],
        origin: 'https://localhost',
      }),
    ).toBe(true);
    expect(shouldIssueBearerToken({})).toBe(false);
    expect(shouldIssueBearerToken({ 'x-client-platform': 'capacitor' })).toBe(false);
    expect(shouldIssueBearerToken({ origin: 'capacitor://localhost' })).toBe(false);
    expect(shouldIssueBearerToken({ 'x-client-platform': 'browser' })).toBe(false);
  });

  it('rejects spoofed platform header from browser Origins', () => {
    expect(
      shouldIssueBearerToken({
        'x-client-platform': 'capacitor',
        origin: 'http://localhost:5173',
      }),
    ).toBe(false);
    expect(
      shouldIssueBearerToken({
        'x-client-platform': 'capacitor',
        origin: 'http://localhost:8080',
      }),
    ).toBe(false);
    expect(isNativeClientRequest({ origin: 'http://localhost:5173' })).toBe(false);
    expect(
      isNativeClientRequest({
        'x-client-platform': 'capacitor',
        origin: 'capacitor://localhost',
      }),
    ).toBe(true);
  });
});
