/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Native Capacitor builds only. Browser must leave unset (same-origin).
   * Production native requires https://; http:// only in development/test.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
