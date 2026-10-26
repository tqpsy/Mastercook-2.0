/**
 * Indirizzo del progetto Supabase e chiave pubblica (publishable/anon). Sono pensati per stare
 * nell'app: l'accesso ai dati è protetto dalle regole del database, non da questa chiave.
 * La chiave di servizio non deve mai comparire qui.
 */
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://mxotaznwiuysvwswbrrs.supabase.co';
export const SUPABASE_CHIAVE = import.meta.env.VITE_SUPABASE_CHIAVE ?? 'sb_publishable_h6O3wJJvEUMACnNjc1r2Ww_EuS4vKG0';

export const configurato = SUPABASE_URL !== '' && SUPABASE_CHIAVE !== '';
