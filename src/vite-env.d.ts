/// <reference types="vite/client" />

// Fontsource variable font packages ship CSS only (no type declarations)
declare module '@fontsource-variable/geist'
declare module '@fontsource-variable/geist-mono'

interface ImportMetaEnv {
  readonly VITE_AI_BACKEND_URL?: string;
  readonly VITE_BACKEND_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
