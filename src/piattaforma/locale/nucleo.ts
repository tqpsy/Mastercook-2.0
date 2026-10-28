/**
 * Il database della famiglia sul dispositivo: lo stesso Postgres del server (PGlite, Postgres compilato per il
 * browser) con le stesse migrazioni, quindi le stesse regole, gli stessi comandi e gli stessi controlli.
 * Qui solo la parte che non dipende dal browser: la usano l'app (in un worker) e i test (in Node).
 */
import type { PGliteInterface, Transaction } from '@electric-sql/pglite';

export interface Migrazione {
  nome: string;
  sql: string;
}

/** Il nome con cui si registra il file che imita la parte di Supabase usata dallo schema (ruoli, auth, storage). */
export const BASE_SUPABASE = '00000000000000_supabase_finto.sql';

/**
 * Prepara il database: applica una volta sola, in ordine, la base e le migrazioni che mancano (quelle nuove
 * arrivano con gli aggiornamenti dell'app), poi registra l'utente. Ogni migrazione è una transazione.
 * `avanzamento` riceve quante ne mancano: la prima volta sono tutte e servono alcuni secondi.
 */
export async function preparaDatabase(
  db: PGliteInterface,
  migrazioni: Migrazione[],
  utenteId: string,
  avanzamento?: (fatte: number, totali: number) => void,
): Promise<void> {
  await db.exec('create schema if not exists locale; create table if not exists locale.migrazione (nome text primary key, applicata_il timestamptz not null default now())');
  const fatte = new Set((await db.query<{ nome: string }>('select nome from locale.migrazione')).rows.map((r) => r.nome));
  const mancanti = [...migrazioni].sort((a, b) => a.nome.localeCompare(b.nome)).filter((m) => !fatte.has(m.nome));
  let n = 0;
  for (const m of mancanti) {
    avanzamento?.(n, mancanti.length);
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query('insert into locale.migrazione (nome) values ($1)', [m.nome]);
    });
    n++;
  }
  avanzamento?.(n, mancanti.length);
  await db.query('insert into auth.users (id) values ($1) on conflict (id) do nothing', [utenteId]);
}

/** Esegue come l'utente collegato, con le regole per riga del database: come una chiamata dell'app al server. */
export function comeUtente<T>(db: PGliteInterface, utenteId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec('set local role authenticated');
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: utenteId, role: 'authenticated' })]);
    return fn(tx);
  });
}

/** Una funzione del database che restituisce un solo valore, chiamata come l'utente. */
export async function chiama<T>(db: PGliteInterface, utenteId: string, testo: string, valori: unknown[] = []): Promise<T> {
  return comeUtente(db, utenteId, async (tx) => (await tx.query<{ r: T }>(testo, valori)).rows[0].r);
}
