/**
 * «Cucina passo passo» di una ricetta fuori dal menu: alla fine si tolgono dalla casa i suoi ingredienti.
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

const quantita = async (id: string) => Number((await banco.sql<{ q: string }>('select quantita as q from lotto where id = $1', [id]))[0].q);

describe('ricetta cucinata fuori dal menu', () => {
  it('toglie gli ingredienti per le porzioni scelte, prima dai lotti che scadono prima, una volta sola', async () => {
    const u = await banco.utente();
    const { famiglia } = await creaFamiglia(u);
    const vecchi = randomUUID();
    const nuovi = randomUUID();
    await u.applica(comando('aggiungi_lotto', famiglia, { id: vecchi, ingrediente_id: 'ing:spaghetti', quantita: 100, unita: 'g', luogo: 'dispensa', data_limite: '2026-11-10', tipo_data: 'scadenza' }));
    await u.applica(comando('aggiungi_lotto', famiglia, { id: nuovi, ingrediente_id: 'ing:spaghetti', quantita: 500, unita: 'g', luogo: 'dispensa', data_limite: '2027-05-01', tipo_data: 'scadenza' }));

    // La carbonara del catalogo: 320 g di spaghetti per 4 porzioni → 160 g per 2.
    const c = comando('usa_ricetta', famiglia, { id: randomUUID(), ricetta_id: 'sys:carbonara', porzioni: 2 });
    const e = await u.applica(c);
    expect(e).toMatchObject({ esito: 'applicato', dettaglio: { movimenti: 2 } });
    expect(await quantita(vecchi)).toBe(0);
    expect(await quantita(nuovi)).toBe(440);
    // Ciò che non c'è in casa torna come mancante.
    expect((e.dettaglio.mancanti as { ingrediente_id: string }[]).map((m) => m.ingrediente_id)).toContain('ing:guanciale');

    // Lo stesso comando ripetuto non toglie due volte.
    await u.applica(c);
    expect(await quantita(nuovi)).toBe(440);
  });

  it('rifiuta ricette che non ci sono e porzioni non valide', async () => {
    const u = await banco.utente();
    const { famiglia } = await creaFamiglia(u);
    expect(await u.applica(comando('usa_ricetta', famiglia, { id: randomUUID(), ricetta_id: 'sys:non-esiste', porzioni: 2 }))).toMatchObject({ esito: 'rifiutato' });
    expect(await u.applica(comando('usa_ricetta', famiglia, { id: randomUUID(), ricetta_id: 'sys:carbonara', porzioni: 0 }))).toMatchObject({ esito: 'rifiutato' });
  });
});
