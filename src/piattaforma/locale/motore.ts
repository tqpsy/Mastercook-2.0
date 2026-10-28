/**
 * Le famiglie tenute solo sul dispositivo: il database (PGlite) vive nell'archivio del browser, per utente,
 * e risponde agli stessi comandi del server. Si carica solo per chi ha una famiglia così: chi usa il server
 * non scarica nulla in più.
 */
import { PGliteWorker } from '@electric-sql/pglite/worker';
import { type Comando, type Esito, type Pagina, type Trasporto } from '../../dati/tipi';
import { BASE_SUPABASE, chiama, comeUtente, type Migrazione, preparaDatabase } from './nucleo';
import base from '../../../supabase/tests/supabase-finto.sql?raw';

const FILE_MIGRAZIONI = import.meta.glob('../../../supabase/migrations/*.sql', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;

async function migrazioni(): Promise<Migrazione[]> {
  const elenco = await Promise.all(Object.entries(FILE_MIGRAZIONI).map(async ([percorso, carica]) => ({ nome: percorso.split('/').pop()!, sql: await carica() })));
  return [{ nome: BASE_SUPABASE, sql: base }, ...elenco];
}

const CHIAVE_PRESENTE = 'mc-locale-';

/** Su questo dispositivo l'utente ha (o ha avuto) una famiglia locale: solo allora si apre il database. */
export function haFamiglieLocali(utenteId: string): boolean {
  try {
    return localStorage.getItem(CHIAVE_PRESENTE + utenteId) === '1';
  } catch {
    return false;
  }
}

function segna(utenteId: string, presente: boolean) {
  try {
    if (presente) localStorage.setItem(CHIAVE_PRESENTE + utenteId, '1');
    else localStorage.removeItem(CHIAVE_PRESENTE + utenteId);
  } catch {
    // Senza archivio del browser la famiglia locale non potrebbe comunque restare.
  }
}

const nomeDati = (utenteId: string) => `mastercook-locale-${utenteId}`;

type Ascoltatore = (fatte: number, totali: number) => void;
const ascoltatori = new Set<Ascoltatore>();
let aperto: { utenteId: string; db: Promise<PGliteWorker> } | null = null;

/** Segue la preparazione del database (la prima volta richiede qualche secondo). */
export function seguiPreparazione(f: Ascoltatore): () => void {
  ascoltatori.add(f);
  return () => ascoltatori.delete(f);
}

/** Apre (una volta per pagina) il database dell'utente, applicando le migrazioni che mancano. */
export function database(utenteId: string): Promise<PGliteWorker> {
  if (aperto?.utenteId === utenteId) return aperto.db;
  const db = (async () => {
    const w = new Worker(new URL('./motore.worker.ts', import.meta.url), { type: 'module' });
    const pg = await PGliteWorker.create(w, { dataDir: `idb://${nomeDati(utenteId)}` });
    await preparaDatabase(pg, await migrazioni(), utenteId, (fatte, totali) => ascoltatori.forEach((a) => a(fatte, totali)));
    return pg;
  })();
  aperto = { utenteId, db };
  db.catch(() => {
    if (aperto?.db === db) aperto = null;
  });
  return db;
}

/** Il trasporto della famiglia locale: i comandi vanno al database del dispositivo, mai in rete. */
export function trasportoLocale(utenteId: string): Trasporto {
  return {
    async applica(comando: Comando) {
      const db = await database(utenteId);
      const esito = await chiama<Esito>(db, utenteId, 'select public.applica_comando($1) as r', [comando]);
      if (esito.esito === 'applicato' && (comando.tipo === 'crea_famiglia' || comando.tipo === 'ripristina_famiglia')) segna(utenteId, true);
      return esito;
    },
    async scarica(famiglia, dopo, limite) {
      const db = await database(utenteId);
      const r = await chiama<Pagina & { errore?: string }>(db, utenteId, 'select public.scarica_modifiche($1, $2, $3) as r', [famiglia, dopo, limite ?? 500]);
      return r.errore ? { righe: [], altre: false, errore: r.errore } : r;
    },
  };
}

export interface FamigliaLocale {
  famiglia_id: string;
  nome: string;
  ruolo: 'amministratore' | 'membro';
}

export async function famiglieLocali(utenteId: string): Promise<FamigliaLocale[]> {
  if (!haFamiglieLocali(utenteId)) return [];
  const db = await database(utenteId);
  return chiama<FamigliaLocale[]>(db, utenteId, `select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) as r from public.mie_famiglie() f`);
}

/** Le funzioni del database per la chiave Gemini, come sul server ma sul dispositivo. */
export async function chiamaLocale<T>(utenteId: string, funzione: 'stato_chiave_gemini' | 'imposta_chiave_gemini', argomenti: unknown[]): Promise<T> {
  const db = await database(utenteId);
  const segnaposto = argomenti.map((_, i) => `$${i + 1}`).join(', ');
  return chiama<T>(db, utenteId, `select public.${funzione}(${segnaposto}) as r`, argomenti);
}

/**
 * La chiave Gemini della famiglia locale, per chiamare Gemini dal telefono: resta sul dispositivo.
 * Solo per chi fa parte della famiglia (lo controlla il database con le sue regole).
 */
export async function chiaveGeminiLocale(utenteId: string, famiglia: string): Promise<string | null> {
  const db = await database(utenteId);
  const membro = await comeUtente(db, utenteId, async (tx) => (await tx.query('select 1 from public.famiglia where id = $1', [famiglia])).rows.length > 0);
  if (!membro) return null;
  const r = await db.query<{ r: { chiave: string | null } }>('select public.chiave_gemini_per_foto($1) as r', [famiglia]);
  return r.rows[0]?.r.chiave ?? null;
}

/** Cancella tutte le famiglie locali dell'utente da questo dispositivo (eliminazione dell'account). */
export async function cancellaLocale(utenteId: string): Promise<void> {
  if (aperto?.utenteId === utenteId) {
    const db = await aperto.db.catch(() => null);
    await db?.close().catch(() => undefined);
    aperto = null;
  }
  segna(utenteId, false);
  await new Promise<void>((ok) => {
    const r = indexedDB.deleteDatabase(`/pglite/${nomeDati(utenteId)}`);
    r.onsuccess = r.onerror = r.onblocked = () => ok();
  });
}
