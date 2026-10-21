/// <reference types="vite/client" />

/** App version from package.json, injected at build time (vite.config.ts). */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** `"1"` only in the `mock` mode: serves the windows from the in-memory dev backend. */
  readonly VITE_MOCK_IPC?: string;
}
