/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API origin for Capacitor native builds; empty in browser. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
