/**
 * Thin Capacitor/platform helpers. Semantic validity is never decided here —
 * these only handle native packaging concerns (auth token storage, connectivity,
 * app lifecycle resume) per ARCHITECTURE §17.
 */

export function isNativePlatform(): boolean {
  try {
    // Dynamic access so the web build does not require Capacitor at runtime.
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor;
    return cap?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** API origin for native WebViews; empty string keeps relative URLs in the browser. */
export function apiBaseUrl(): string {
  const fromEnv = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? '';
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return '';
}

const AUTH_TOKEN_KEY = 'reasoning_tutor_auth_token';

export async function loadStoredAuthToken(): Promise<string | null> {
  if (!isNativePlatform()) return null;
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: AUTH_TOKEN_KEY });
    return value;
  } catch {
    return null;
  }
}

export async function storeAuthToken(token: string): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key: AUTH_TOKEN_KEY, value: token });
  } catch {
    // Preferences unavailable in plain browser tests — ignore.
  }
}

export async function clearStoredAuthToken(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.remove({ key: AUTH_TOKEN_KEY });
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
