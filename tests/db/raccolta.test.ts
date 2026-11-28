/**
 * Raccolta differenziata: i giorni di ogni tipo di raccolta, salvati nelle impostazioni della famiglia.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Banco, comando, creaFamiglia, nuovoBanco } from './banco';

let banco: Banco;
beforeAll(async () => {
  banco = await nuovoBanco();
});
afterAll(async () => {
  await banco.chiudi();
});

describe('raccolta differenziata', () => {
  it('si salva nelle impostazioni, si toglie con null; solo tipi e giorni validi', async () => {
    const u = await banco.utente();
    const { famiglia } = await creaFamiglia(u);
    const raccolta = async () => (await banco.sql<{ r: unknown }>(`select impostazioni -> 'raccolta' as r from famiglia where id = $1`, [famiglia]))[0].r;

    const scelta = { organico: [1, 4], carta: [2], plastica: [3, 6], vetro: [5], indifferenziato: [0] };
    expect((await u.applica(comando('imposta_raccolta', famiglia, { raccolta: scelta }))).esito).toBe('applicato');
    expect(await raccolta()).toEqual(scelta);

    expect((await u.applica(comando('imposta_raccolta', famiglia, { raccolta: { organico: [7] } }))).esito).toBe('rifiutato');
    expect((await u.applica(comando('imposta_raccolta', famiglia, { raccolta: { organico: [1.5] } }))).esito).toBe('rifiutato');
    expect((await u.applica(comando('imposta_raccolta', famiglia, { raccolta: { carta_straccia: [1] } }))).esito).toBe('rifiutato');
    expect((await u.applica(comando('imposta_raccolta', famiglia, { raccolta: 'lunedì' }))).esito).toBe('rifiutato');
    // Niente è stato scritto dai comandi rifiutati.
    expect(await raccolta()).toEqual(scelta);

    expect((await u.applica(comando('imposta_raccolta', famiglia, { raccolta: null }))).esito).toBe('applicato');
    expect(await raccolta()).toBeNull();
  });
});
