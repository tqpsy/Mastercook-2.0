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
  async caricaFoto(percorso, file) {
    let risposta;
    try {
      risposta = await supabase().storage.from('foto').upload(percorso, file, { upsert: true, contentType: file.type || 'image/jpeg' });
    } catch (e) {
      throw new ErroreRete(String(e));
    }
    if (risposta.error) {
      if (risposta.error.name === 'StorageUnknownError' || !navigator.onLine) throw new ErroreRete(risposta.error.message);
      throw new Error(risposta.error.message);
    }
  },
};

/** Scarica una foto dal deposito; `null` senza rete o se il file non c'è. */
export async function scaricaFoto(percorso: string): Promise<Blob | null> {
  try {
    const { data } = await supabase().storage.from('foto').download(percorso);
    return data ?? null;
  } catch {
    return null;
  }
}

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

/**
 * Elimina la famiglia per sempre: prima le foto delle ricette dal deposito (finché si è membri e si può),
 * poi tutto il resto con un comando. Serve la rete; il comando chiede il nome scritto come conferma.
 */
export async function eliminaFamiglia(famiglia: string, nome: string, dispositivo: string, versione_app: number): Promise<Esito> {
  try {
    const deposito = supabase().storage.from('foto');
    const { data } = await deposito.list(famiglia, { limit: 1000 });
    if (data?.length) await deposito.remove(data.map((f) => `${famiglia}/${f.name}`));
  } catch {
    // Se le foto non si tolgono restano illeggibili: nessuno è più membro della famiglia.
  }
  return trasportoSupabase.applica({ id: crypto.randomUUID(), famiglia_id: famiglia, tipo: 'elimina_famiglia', dati: { nome }, versione_app, dispositivo });
}

/** La versione dell'informativa accettata; `null` se non ancora. Senza rete: ErroreRete. */
export async function mioConsenso(): Promise<number | null> {
  const r = await chiama<number | null | Esito>('mio_consenso', {});
  if (r !== null && typeof r === 'object') throw new ErroreRete('accesso scaduto');
  return r;
}

export async function registraConsenso(versione: number): Promise<void> {
  const r = await chiama<number | Esito>('registra_consenso', { p_versione: versione });
  if (r !== versione) throw new ErroreRete('consenso non registrato');
}

export interface AnteprimaEliminazione {
  cancellate: { famiglia_id: string; nome: string }[];
  lasciate: { famiglia_id: string; nome: string }[];
}

export async function anteprimaEliminazione(): Promise<AnteprimaEliminazione> {
  const r = await chiama<AnteprimaEliminazione | Esito>('anteprima_eliminazione_account', {});
  if ('esito' in r) throw new ErroreRete('accesso scaduto');
  return r;
}

/**
 * Elimina il proprio account: prima le foto delle famiglie dove si è soli (finché si è membri e si può),
 * poi il database cancella quelle famiglie, fa uscire dalle altre e toglie l'utente.
 */
export async function eliminaMioAccount(anteprima: AnteprimaEliminazione): Promise<Esito> {
  for (const f of anteprima.cancellate) {
    try {
      const deposito = supabase().storage.from('foto');
      const { data } = await deposito.list(f.famiglia_id, { limit: 1000 });
      if (data?.length) await deposito.remove(data.map((x) => `${f.famiglia_id}/${x.name}`));
    } catch {
      // Le foto rimaste non sono più leggibili da nessuno.
    }
  }
  const esito = await chiama<Esito>('elimina_mio_account', { p_conferma: 'ELIMINA' });
  if (esito.esito === 'applicato') await supabase().auth.signOut({ scope: 'local' });
  return esito;
}
