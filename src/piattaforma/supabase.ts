/**
 * Collegamento con Supabase: accesso con Google e trasporto dei comandi.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CHIAVE, SUPABASE_URL } from '../config';
import { type Comando, ErroreRete, type Esito, type Pagina, type Trasporto } from '../dati/tipi';

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  client ??= createClient(SUPABASE_URL, SUPABASE_CHIAVE, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  });
  return client;
}

/** Indirizzo a cui Google riporta dopo l'accesso: la pagina attuale, compreso un eventuale invito. */
export async function accediConGoogle(): Promise<void> {
  const { error } = await supabase().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href, queryParams: { prompt: 'select_account' } },
  });
  if (error) throw error;
}

export async function esci(): Promise<void> {
  await supabase().auth.signOut();
}

interface ErrorePostgrest {
  message: string;
  code?: string;
  status?: number;
}

/**
 * Traduce gli errori della chiamata: la rete assente o un server irraggiungibile diventano
 * ErroreRete (il comando si ripresenterà con lo stesso id); un accesso scaduto diventa un
 * rifiuto transitorio, così la coda si ferma finché non si accede di nuovo.
 */
function errore(e: ErrorePostgrest): Esito | never {
  const scaduto = e.code === 'PGRST301' || e.code === 'PGRST303' || e.status === 401 || /jwt/i.test(e.message);
  if (scaduto) return { esito: 'rifiutato', transitorio: true, dettaglio: { motivo: 'non_autenticato' } };
  throw new ErroreRete(e.message);
}

async function chiama<T>(funzione: string, argomenti: Record<string, unknown>): Promise<T> {
  let risposta;
  try {
    risposta = await supabase().rpc(funzione, argomenti);
  } catch (e) {
    throw new ErroreRete(String(e));
  }
  if (risposta.error) {
    const esito = errore({ ...risposta.error, status: risposta.status });
    return esito as T;
  }
  return risposta.data as T;
}

export const trasportoSupabase: Trasporto & { entra(c: Comando): Promise<Esito> } = {
  applica: (comando) => chiama<Esito>('applica_comando', { comando }),
  entra: (comando) => chiama<Esito>('entra_con_invito', { comando }),
  async scarica(famiglia, dopo, limite) {
    const r = await chiama<Pagina | Esito>('scarica_modifiche', { p_famiglia: famiglia, p_dopo: dopo, p_limite: limite ?? 500 });
    if ('esito' in r) return { righe: [], altre: false, errore: 'non_autenticato' };
    return r;
  },
};

export interface FamigliaMia {
  famiglia_id: string;
  nome: string;
  ruolo: 'amministratore' | 'membro';
}

export async function mieFamiglie(): Promise<FamigliaMia[]> {
  const r = await chiama<FamigliaMia[] | Esito>('mie_famiglie', {});
  if (!Array.isArray(r)) throw new ErroreRete('accesso scaduto');
  return r;
}

/** Avvisa quando sul server arriva un comando della famiglia, per scaricare subito. */
export function ascoltaFamiglia(famiglia: string, avviso: () => void): () => void {
  const canale = supabase()
    .channel(`famiglia:${famiglia}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comando', filter: `famiglia_id=eq.${famiglia}` }, avviso)
    .subscribe();
  return () => {
    void supabase().removeChannel(canale);
  };
}
