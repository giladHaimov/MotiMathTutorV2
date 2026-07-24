import {
  apiBaseUrlForRuntime,
  assertNativeRuntimeOrigins,
  viteModeToRuntime,
  type ClientRuntimeMode,
} from './api-base-url.js';
import {
  CAPACITOR_HTTP_DEV_ENV,
  CAPACITOR_SERVER_ORIGIN_ENV,
  PRODUCTION_API_ORIGINS_ENV,
  readCapacitorHttpDev,
  readCapacitorServerOrigin,
  readProductionApiOrigins,
} from './capacitor-env.js';

/**
 * Thin Capacitor/platform helpers. Semantic validity is never decided here —
 * packaging, connectivity, and app lifecycle only (ARCHITECTURE §17).
 *
 * Authentication is Better Auth cookie sessions for browser and Capacitor
 * WebView (same-origin via `VITE_CAPACITOR_SERVER_URL` / server.url).
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

function httpDevEnabled(): boolean {
  return readCapacitorHttpDev({
    [CAPACITOR_HTTP_DEV_ENV]: import.meta.env.VITE_CAPACITOR_HTTP_DEV,
  });
}

/**
 * Fail build/startup when production native origin policy is violated.
 * Uses the same env key as capacitor.config.ts (`VITE_CAPACITOR_SERVER_URL`).
 */
export function assertPlatformApiOrigins(): void {
  assertNativeRuntimeOrigins({
    isNative: isNativePlatform(),
    mode: runtimeMode(),
    httpDev: httpDevEnabled(),
    viteApiBaseUrl: import.meta.env.VITE_API_BASE_URL,
    capacitorServerUrl: readCapacitorServerOrigin({
      [CAPACITOR_SERVER_ORIGIN_ENV]: import.meta.env.VITE_CAPACITOR_SERVER_URL,
    }),
    productionAllowlistRaw: readProductionApiOrigins({
      [PRODUCTION_API_ORIGINS_ENV]: import.meta.env.VITE_PRODUCTION_API_ORIGINS,
    }),
  });
}

/**
 * API origin for fetch:
 * - Browser / Capacitor same-origin packaging: empty (relative `/api`).
 * - Optional absolute native override only when explicitly configured.
 */
export function apiBaseUrl(): string {
  return apiBaseUrlForRuntime({
    isNative: isNativePlatform(),
    viteApiBaseUrl: import.meta.env.VITE_API_BASE_URL,
    mode: runtimeMode(),
    httpDev: httpDevEnabled(),
    productionAllowlistRaw: readProductionApiOrigins({
      [PRODUCTION_API_ORIGINS_ENV]: import.meta.env.VITE_PRODUCTION_API_ORIGINS,
    }),
  });
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
