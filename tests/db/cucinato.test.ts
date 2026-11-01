/**
 * «Cucinato»: il piatto preparato in anticipo toglie subito gli ingredienti e va in casa come piatto pronto;
 * quando si mangia gli ingredienti non escono una seconda volta e restano le porzioni avanzate.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Banco, comando, creaFamiglia, nuovoBanco, type Utente } from './banco';

let banco: Banco;
beforeAll(async () => {
  banco = await nuovoBanco();
});
afterAll(async () => {
  await banco.chiudi();
});

async function pronti(): Promise<{ u: Utente; famiglia: string; spaghetti: string; portata: string }> {
  const u = await banco.utente();
  const { famiglia } = await creaFamiglia(u);
  const spaghetti = randomUUID();
  await u.applica(comando('aggiungi_lotto', famiglia, { id: spaghetti, ingrediente_id: 'ing:spaghetti', quantita: 500, unita: 'g', luogo: 'dispensa', tipo_data: 'sconosciuta' }));
  const portata = randomUUID();
  await u.applica(comando('aggiungi_portata', famiglia, { id: portata, data: '2026-11-03', categoria: 'cena', ricetta_id: 'sys:carbonara', porzioni: 4 }));
  return { u, famiglia, spaghetti, portata };
}

const quantita = async (id: string) => Number((await banco.sql<{ q: string }>('select quantita as q from lotto where id = $1', [id]))[0].q);
const cucina = (famiglia: string, portata_id: string, id = randomUUID()) =>
  comando('cucina_portata', famiglia, { id, portata_id, nome: 'Carbonara', porzioni: 4, luogo: 'frigo', data_limite: '2026-11-03', tipo_data: 'scadenza', fonte_data: 'utente' });

describe('piatto cucinato in anticipo', () => {
  it('toglie gli ingredienti una volta sola e lascia in casa le porzioni avanzate', async () => {
    const { u, famiglia, spaghetti, portata } = await pronti();
    const pronto = randomUUID();
    const e = await u.applica(cucina(famiglia, portata, pronto));
    expect(e.esito).toBe('applicato');
    expect(await quantita(spaghetti)).toBe(180);
    expect(await quantita(pronto)).toBe(4);
    expect((await banco.sql('select portata_id, origine, luogo from lotto where id = $1', [pronto]))[0]).toEqual({ portata_id: portata, origine: 'avanzo', luogo: 'frigo' });
    // Una seconda volta no.
    expect((await u.applica(cucina(famiglia, portata))).esito).toBe('rifiutato');

    // Mangiato come previsto con 1 porzione avanzata: niente ingredienti, il piatto pronto scende a 1.
    const c = await u.applica(
      comando('conferma_pasto', famiglia, { id: randomUUID(), portata_id: portata, esito: 'come_previsto', avanzi: [{ lotto_id: randomUUID(), nome: 'Carbonara', quantita: 1, luogo: 'frigo' }] }),
    );
    expect(c.esito).toBe('applicato');
    expect(await quantita(spaghetti)).toBe(180);
    expect(await quantita(pronto)).toBe(1);
    expect((await banco.sql<{ n: number }>(`select count(*)::int as n from lotto where famiglia_id = $1 and ingrediente_id = 'ing:avanzo'`, [famiglia]))[0].n).toBe(1);
  });

  it('saltato: il piatto pronto resta in casa', async () => {
    const { u, famiglia, spaghetti, portata } = await pronti();
    const pronto = randomUUID();
    await u.applica(cucina(famiglia, portata, pronto));
    await u.applica(comando('conferma_pasto', famiglia, { id: randomUUID(), portata_id: portata, esito: 'saltato' }));
    expect(await quantita(spaghetti)).toBe(180);
    expect(await quantita(pronto)).toBe(4);
  });

  it('un pasto già confermato non si cucina', async () => {
    const { u, famiglia, portata } = await pronti();
    await u.applica(comando('conferma_pasto', famiglia, { id: randomUUID(), portata_id: portata, esito: 'come_previsto' }));
    expect(await u.applica(cucina(famiglia, portata))).toMatchObject({ esito: 'rifiutato' });
  });
});
