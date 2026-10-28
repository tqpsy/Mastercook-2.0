/**
 * Indirizzo del progetto Supabase e chiave pubblica (publishable/anon). Sono pensati per stare
 * nell'app: l'accesso ai dati è protetto dalle regole del database, non da questa chiave.
 * La chiave di servizio non deve mai comparire qui.
 */
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://mxotaznwiuysvwswbrrs.supabase.co';
export const SUPABASE_CHIAVE = import.meta.env.VITE_SUPABASE_CHIAVE ?? 'sb_publishable_h6O3wJJvEUMACnNjc1r2Ww_EuS4vKG0';

export const configurato = SUPABASE_URL !== '' && SUPABASE_CHIAVE !== '';

/**
 * ID client OAuth di Google (tipo «Applicazione web», lo stesso progetto dell'accesso): serve solo per la copia
 * sul Drive di chi la sceglie. Non è un segreto: Google lo accetta solo dal sito dell'app.
 */
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '482205981080-7p0d3h797nbm2gtb9h3iediib5rcihs3.apps.googleusercontent.com';
