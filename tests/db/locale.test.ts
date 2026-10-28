/**
 * Il database sul dispositivo (PGlite): tutte le migrazioni girano come sul server e i comandi rispondono uguali.
 * Se una migrazione nuova usa qualcosa che PGlite non ha, questo test lo dice prima della pubblicazione.
 */
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE_SUPABASE, chiama, preparaDatabase, type Migrazione } from '../../src/piattaforma/locale/nucleo';

const RADICE = join(import.meta.dirname, '..', '..', 'supabase');
const migrazioni: Migrazione[] = [
  { nome: BASE_SUPABASE, sql: readFileSync(join(RADICE, 'tests', 'supabase-finto.sql'), 'utf8') },
  ...readdirSync(join(RADICE, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .map((nome) => ({ nome, sql: readFileSync(join(RADICE, 'migrations', nome), 'utf8') })),
];

const utente = randomUUID();
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await preparaDatabase(db, migrazioni, utente);
}, 120_000);
afterAll(async () => {
  await db.close();
});

const comando = (famiglia_id: string, tipo: string, dati: Record<string, unknown>) => ({ id: randomUUID(), famiglia_id, tipo, dati, versione_app: 1, dispositivo: 'test' });

describe('database sul dispositivo', () => {
  it('applica tutte le migrazioni, una volta sola', async () => {
    const r = await db.query<{ n: number }>('select count(*)::int as n from locale.migrazione');
    expect(r.rows[0].n).toBe(migrazioni.length);
    await preparaDatabase(db, migrazioni, utente);
    expect((await db.query<{ n: number }>('select count(*)::int as n from locale.migrazione')).rows[0].n).toBe(migrazioni.length);
  });

  it('crea la famiglia, applica i comandi e li scarica come il server', async () => {
    const famiglia = randomUUID();
    const e = await chiama<{ esito: string }>(db, utente, 'select public.applica_comando($1) as r', [
      comando(famiglia, 'crea_famiglia', { nome: 'Casa sul telefono', membro: { id: randomUUID(), nome: 'Io' } }),
    ]);
    expect(e.esito).toBe('applicato');
    const p = await chiama<{ esito: string }>(db, utente, 'select public.applica_comando($1) as r', [
      comando(famiglia, 'aggiungi_portata', { id: randomUUID(), data: '2026-11-03', categoria: 'cena', ricetta_id: 'sys:carbonara' }),
    ]);
    expect(p.esito).toBe('applicato');
    const pagina = await chiama<{ righe: { tabella: string }[] }>(db, utente, 'select public.scarica_modifiche($1, 0, 500) as r', [famiglia]);
    expect(pagina.righe.map((r) => r.tabella)).toEqual(expect.arrayContaining(['famiglia', 'membro', 'portata']));
    const mie = await chiama<{ nome: string }[]>(db, utente, `select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) as r from public.mie_famiglie() f`);
    expect(mie.map((f) => f.nome)).toContain('Casa sul telefono');
  });

  it('le regole valgono anche qui: un altro utente non vede la famiglia', async () => {
    const altro = randomUUID();
    await db.query('insert into auth.users (id) values ($1)', [altro]);
    const mie = await chiama<unknown[]>(db, altro, `select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) as r from public.mie_famiglie() f`);
    expect(mie).toEqual([]);
  });
});
