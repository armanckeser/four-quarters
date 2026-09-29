/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the deck locker Worker (worker/). Unset: links are file-only. */
  readonly VITE_QUARTERS_CLOUD?: string;
}
