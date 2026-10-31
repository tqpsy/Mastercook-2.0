/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_CHIAVE?: string;
}

/** Data e ora in cui è stata preparata questa versione dell'app (vite.config.ts). */
declare const __COSTRUITA_IL__: string | undefined;
