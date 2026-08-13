/// <reference types="vite/client" />

/**
 * Augments Vite's ImportMetaEnv so the backend URL is a typed, optional string
 * rather than `any`. Copy `.env.example` to `.env` to point the frontend at a
 * backend other than http://localhost:4000.
 */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
