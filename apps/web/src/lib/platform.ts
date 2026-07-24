import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import { apiBaseUrlForRuntime, viteModeToRuntime, type ClientRuntimeMode } from './api-base-url.js';

/** Header native Capacitor clients send so the API may issue bearer tokens. */
export const NATIVE_CLIENT_HEADER = 'X-Client-Platform';
export const NATIVE_CLIENT_VALUE = 'capacitor';

/**
 * Thin Capacitor/platform helpers. Semantic validity is never decided here —
 * these only handle native packaging concerns (secure auth token storage,
 * connectivity, app lifecycle resume) per ARCHITECTURE §17.
 */

export function isNativePlatform(): boolean {
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor;
    return cap?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

function runtimeMode(): ClientRuntimeMode {
  return viteModeToRuntime(import.meta.env.MODE, import.meta.env.PROD);
}

/** API origin: empty in browser; validated absolute URL on native only. */
export function apiBaseUrl(): string {
  return apiBaseUrlForRuntime({
    isNative: isNativePlatform(),
    viteApiBaseUrl: import.meta.env.VITE_API_BASE_URL,
    mode: runtimeMode(),
  });
}

const AUTH_TOKEN_KEY = 'auth_token';

let secureReady: Promise<void> | null = null;

async function ensureSecureStorage(): Promise<void> {
  if (!secureReady) {
    secureReady = (async () => {
      await SecureStorage.setKeyPrefix('reasoning_tutor_');
      await SecureStorage.setSynchronize(false);
      // Device-local keychain item — does not migrate via iCloud/encrypted backups.
      await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly);
    })();
  }
  await secureReady;
}

export async function loadStoredAuthToken(): Promise<string | null> {
  if (!isNativePlatform()) return null;
  try {
    await ensureSecureStorage();
    const value = await SecureStorage.getItem(AUTH_TOKEN_KEY);
    return value;
  } catch {
    return null;
  }
}

export async function storeAuthToken(token: string): Promise<void> {
  if (!isNativePlatform()) return;
  await ensureSecureStorage();
  await SecureStorage.setItem(AUTH_TOKEN_KEY, token);
}

export async function clearStoredAuthToken(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    await ensureSecureStorage();
    await SecureStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function subscribeOnlineStatus(onChange: (online: boolean) => void): () => void {
  const notify = () => onChange(typeof navigator === 'undefined' ? true : navigator.onLine);
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  notify();
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
}

/**
 * Resume hooks: browser visibility + Capacitor appStateChange.
 * Caller reloads authoritative server session — clients never invent state.
 */
export function subscribeAppResume(onResume: () => void): () => void {
  const onVisibility = () => {
    if (document.visibilityState === 'visible') onResume();
  };
  document.addEventListener('visibilitychange', onVisibility);

  let removeNative: (() => void) | undefined;
  void (async () => {
    if (!isNativePlatform()) return;
    try {
      const { App } = await import('@capacitor/app');
      const handle = await App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) onResume();
      });
      removeNative = () => {
        void handle.remove();
      };
    } catch {
      // Capacitor App plugin not available — visibility listener still works.
    }
  })();

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    removeNative?.();
  };
}
