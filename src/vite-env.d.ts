/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `"1"` only in the `mock` mode: serves the windows from the in-memory dev backend. */
  readonly VITE_MOCK_IPC?: string;
}
