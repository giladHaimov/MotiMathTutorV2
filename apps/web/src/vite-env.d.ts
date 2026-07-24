/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional absolute API origin for native Capacitor when not using same-origin
   * `VITE_CAPACITOR_SERVER_URL` packaging. Production requires https:// + allowlist.
   * HTTP only with VITE_CAPACITOR_HTTP_DEV=1.
   */
  readonly VITE_API_BASE_URL?: string;
  /** Explicit Capacitor HTTP development mode (permits cleartext HTTP). */
  readonly VITE_CAPACITOR_HTTP_DEV?: string;
  /** Comma-separated HTTPS origins allowed for production native packaging. */
  readonly VITE_PRODUCTION_API_ORIGINS?: string;
  /**
   * Canonical Capacitor server.url / package origin (same-origin cookie packaging).
   * Used at vite build time (runtime assert) and by capacitor.config.ts (sync).
   */
  readonly VITE_CAPACITOR_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
