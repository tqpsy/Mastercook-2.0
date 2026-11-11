/**
 * Banco di prova del database: un Postgres vero, un database nuovo per ogni file di test,
 * lo stesso SQL che va su Supabase più il file che imita la parte di Supabase usata dallo schema.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const RADICE = join(import.meta.dirname, '..', '..');
const INDIRIZZO = process.env.MC_DATABASE_URL ?? 'postgres://postgres@localhost:54329/postgres?host=/tmp/pg';

export const VERSIONE_APP = 1;

export interface Esito {
  id?: string;
  esito: 'applicato' | 'conflitto' | 'rifiutato';
  dettaglio: Record<string, unknown> & { motivo?: string };
  ripetuto?: boolean;
  transitorio?: boolean;
  famiglia_id?: string;
}

export interface Comando {
  id: string;
  famiglia_id: string;
  tipo: string;
  dati: Record<string, unknown>;
  versione_app: number;
  dispositivo?: string;
}

export function comando(tipo: string, famiglia_id: string, dati: Record<string, unknown> = {}): Comando {
  return { id: randomUUID(), famiglia_id, tipo, dati, versione_app: VERSIONE_APP, dispositivo: 'test' };
}

export function fileMigrazioni(): string[] {
  const cartella = join(RADICE, 'supabase', 'migrations');
  return readdirSync(cartella)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(cartella, f));
}

export interface Banco {
  pool: pg.Pool;
  nome: string;
  utente(): Promise<Utente>;
  /** Esegue SQL come proprietario del database (fuori dalle regole per riga). */
  sql<T extends pg.QueryResultRow = pg.QueryResultRow>(testo: string, valori?: unknown[]): Promise<T[]>;
  chiudi(): Promise<void>;
}

export interface Utente {
  id: string;
  applica(c: Comando): Promise<Esito>;
  entra(c: Comando): Promise<Esito>;
  scarica(famiglia: string, dopo: number, limite?: number): Promise<{ righe: RigaScaricata[]; altre: boolean; errore?: string }>;
  /** SQL come utente collegato, soggetto alle regole per riga. */
  sql<T extends pg.QueryResultRow = pg.QueryResultRow>(testo: string, valori?: unknown[]): Promise<T[]>;
}

export interface RigaScaricata {
  tabella: string;
  seq: number;
  riga: Record<string, unknown> & { id: string };
}

export async function nuovoBanco(): Promise<Banco> {
  const nome = `mc_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const amministrazione = new pg.Client({ connectionString: INDIRIZZO });
  await amministrazione.connect();
  await amministrazione.query(`create database ${nome}`);
  await amministrazione.end();

  const url = new URL(INDIRIZZO);
  url.pathname = `/${nome}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 12 });
  // Alla chiusura il database viene cancellato con le connessioni ancora aperte nel pool.
  pool.on('error', () => undefined);
  await pool.query(readFileSync(join(RADICE, 'supabase', 'tests', 'supabase-finto.sql'), 'utf8'));
  for (const f of fileMigrazioni()) await pool.query(readFileSync(f, 'utf8'));

  async function comeUtente<T extends pg.QueryResultRow>(id: string, testo: string, valori: unknown[] = []): Promise<T[]> {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role authenticated');
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id, role: 'authenticated' })]);
      const r = await client.query<T>(testo, valori);
      await client.query('commit');
      return r.rows;
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  return {
    pool,
    nome,
    async utente() {
      const id = randomUUID();
      await pool.query('insert into auth.users (id) values ($1)', [id]);
      return {
        id,
        sql: (testo, valori) => comeUtente(id, testo, valori),
        async applica(c) {
          const [r] = await comeUtente<{ e: Esito }>(id, 'select public.applica_comando($1) as e', [c]);
          return r.e;
        },
        async entra(c) {
          const [r] = await comeUtente<{ e: Esito }>(id, 'select public.entra_con_invito($1) as e', [c]);
          return r.e;
        },
        async scarica(famiglia, dopo, limite) {
          const [r] = await comeUtente<{ e: { righe: RigaScaricata[]; altre: boolean; errore?: string } }>(
            id,
            'select public.scarica_modifiche($1, $2, $3) as e',
            [famiglia, dopo, limite ?? 500],
          );
          return r.e;
        },
      };
    },
    async sql(testo, valori) {
      return (await pool.query(testo, valori)).rows;
    },
    async chiudi() {
      await pool.end();
      const a = new pg.Client({ connectionString: INDIRIZZO });
      await a.connect();
      await a.query(`drop database if exists ${nome} with (force)`);
      await a.end();
    },
  };
}

/** Crea una famiglia con il suo primo membro; restituisce gli id. */
export async function creaFamiglia(u: Utente, nome = 'Casa Rossi') {
  const famiglia = randomUUID();
  const membro = randomUUID();
  const e = await u.applica(comando('crea_famiglia', famiglia, { nome, membro: { id: membro, nome: 'Luca', emoji: '🧑' } }));
  if (e.esito !== 'applicato') throw new Error(`crea_famiglia: ${JSON.stringify(e)}`);
  return { famiglia, membro };
}
