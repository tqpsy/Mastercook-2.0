/**
 * «Il mio frigorifero»: il frigo configurato nelle impostazioni della famiglia e il posto dei lotti.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Banco, comando, creaFamiglia, nuovoBanco } from './banco';

let banco: Banco;
beforeAll(async () => {
  banco = await nuovoBanco();
});
afterAll(async () => {
  await banco.chiudi();
});

const FRIGO = { ripiani: 4, cassetti: 1, balconcini: 4, sportello: 'dx', litri: 250, freezer: { posizione: 'sotto', parti: 3, tipo: 'cassetti', litri: null } };

describe('il mio frigorifero', () => {
  it('si salva nelle impostazioni, si toglie con null; niente testi giganti', async () => {
    const u = await banco.utente();
    const { famiglia } = await creaFamiglia(u);
    const frigo = async () => (await banco.sql<{ f: unknown }>(`select impostazioni -> 'frigo' as f from famiglia where id = $1`, [famiglia]))[0].f;
    expect((await u.applica(comando('imposta_frigo', famiglia, { frigo: FRIGO }))).esito).toBe('applicato');
    expect(await frigo()).toEqual(FRIGO);
    expect((await u.applica(comando('imposta_frigo', famiglia, { frigo: 'grande' }))).esito).toBe('rifiutato');
    expect((await u.applica(comando('imposta_frigo', famiglia, { frigo: { x: 'y'.repeat(2000) } }))).esito).toBe('rifiutato');
    expect((await u.applica(comando('imposta_frigo', famiglia, { frigo: null }))).esito).toBe('applicato');
    expect(await frigo()).toBeNull();
  });

  it('un lotto ricorda il posto (non in dispensa) e si può cambiare', async () => {
    const u = await banco.utente();
    const { famiglia } = await creaFamiglia(u);
    const base = { ingrediente_id: 'ing:uova', quantita: 6, unita: 'pz', tipo_data: 'sconosciuta' };
    const id = randomUUID();
    expect((await u.applica(comando('aggiungi_lotto', famiglia, { ...base, id, luogo: 'frigo', posto: 'r2' }))).esito).toBe('applicato');
    const posto = async (x: string) => (await banco.sql<{ posto: string | null; versione: number }>(`select posto, versione from lotto where id = $1`, [x]))[0];
    expect((await posto(id)).posto).toBe('r2');

    const inDispensa = randomUUID();
    await u.applica(comando('aggiungi_lotto', famiglia, { ...base, id: inDispensa, luogo: 'dispensa', posto: 'r2' }));
    expect((await posto(inDispensa)).posto).toBeNull();

    expect((await u.applica(comando('aggiungi_lotto', famiglia, { ...base, id: randomUUID(), luogo: 'frigo', posto: 'sul tavolo' }))).esito).not.toBe('applicato');

    const { versione } = await posto(id);
    expect((await u.applica(comando('modifica_lotto', famiglia, { id, versione_attesa: versione, campi: { posto: 's1' } }))).esito).toBe('applicato');
    expect((await posto(id)).posto).toBe('s1');
  });
});
