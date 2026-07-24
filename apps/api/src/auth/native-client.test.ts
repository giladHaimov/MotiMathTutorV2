import { describe, expect, it } from 'vitest';
import { shouldIssueBearerToken, isNativeClientRequest } from './native-client.js';

describe('native client bearer issuance gate', () => {
  it('issues bearer only when X-Client-Platform is capacitor', () => {
    expect(shouldIssueBearerToken({ 'x-client-platform': 'capacitor' })).toBe(true);
    expect(shouldIssueBearerToken({})).toBe(false);
    expect(shouldIssueBearerToken({ 'x-client-platform': 'browser' })).toBe(false);
    expect(shouldIssueBearerToken({ 'x-client-platform': ['capacitor'] })).toBe(true);
  });

  it('recognizes Capacitor origins as native signals without granting issuance alone', () => {
    expect(isNativeClientRequest({ origin: 'capacitor://localhost' })).toBe(true);
    expect(isNativeClientRequest({ origin: 'http://localhost:5173' })).toBe(false);
  });
});
