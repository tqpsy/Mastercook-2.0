/**
 * Confezioni uguali: il lotto ricorda quanto contiene una confezione («500 g × 2»), la quantità resta il totale.
 * Ogni comando che crea un lotto accetta `confezione` accanto all'id del lotto.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { componiFile } from '../../src/dati/esportazione';
import type { RigaScaricata } from '../../src/dati/tipi';
import { type Banco, comando, creaFamiglia, nuovoBanco, type Utente } from './banco';

let banco: Banco;
beforeAll(async () => {
  banco = await nuovoBanco();
});
afterAll(async () => {
  await banco.chiudi();
});

async function famigliaCon(): Promise<{ u: Utente; famiglia: string }> {
  const u = await banco.utente();
  const { famiglia } = await creaFamiglia(u);
  return { u, famiglia };
}

const lotto = async (id: string) =>
  (await banco.sql<{ quantita: string; confezione: string | null; luogo: string }>('select quantita, confezione, luogo from lotto where id = $1', [id]))[0];

describe('confezioni uguali', () => {
  it('aggiungi in casa: 2 confezioni da 500 g sono un lotto da 1000 g con confezione 500', async () => {
    const { u, famiglia } = await famigliaCon();
    const id = randomUUID();
    const e = await u.applica(comando('aggiungi_lotto', famiglia, { id, ingrediente_id: 'ing:pasta', quantita: 1000, unita: 'g', confezione: 500, luogo: 'dispensa', tipo_data: 'sconosciuta' }));
    expect(e.esito).toBe('applicato');
    expect(await lotto(id)).toMatchObject({ quantita: '1000', confezione: '500' });
    // Senza confezione resta come prima.
    const altro = randomUUID();
    await u.applica(comando('aggiungi_lotto', famiglia, { id: altro, ingrediente_id: 'ing:pasta', quantita: 500, unita: 'g', luogo: 'dispensa', tipo_data: 'sconosciuta' }));
    expect((await lotto(altro)).confezione).toBeNull();
  });

  it('una confezione non valida è rifiutata', async () => {
    const { u, famiglia } = await famigliaCon();
    const e = await u.applica(comando('aggiungi_lotto', famiglia, { id: randomUUID(), ingrediente_id: 'ing:pasta', quantita: 1000, unita: 'g', confezione: -5, luogo: 'dispensa', tipo_data: 'sconosciuta' }));
    expect(e.esito).toBe('rifiutato');
  });

  it('scontrino, conferma della spesa e riga da completare portano la confezione', async () => {
    const { u, famiglia } = await famigliaCon();
    const daScontrino = randomUUID();
    const e = await u.applica(
      comando('importa_scontrino', famiglia, {
        id: randomUUID(),
        acquisto_id: randomUUID(),
        data: '2026-11-10',
        righe: [
          { id: randomUUID(), descrizione: 'YOGURT', prezzo: 1.8, nuova: { id: randomUUID(), lotto_id: daScontrino, ingrediente_id: 'ing:yogurt', quantita: 375, unita: 'g', confezione: 125, luogo: 'frigo', tipo_data: 'sconosciuta' } },
          { id: randomUUID(), descrizione: 'BURRO', prezzo: 2, nuova: { id: randomUUID(), ingrediente_id: 'ing:burro', luogo: 'frigo' } },
        ],
      }),
    );
    expect(e.esito).toBe('applicato');
    expect(await lotto(daScontrino)).toMatchObject({ quantita: '375', confezione: '125' });

    const daSpesa = randomUUID();
    expect(
      (
        await u.applica(
          comando('conferma_acquisto', famiglia, {
            id: randomUUID(),
            data: '2026-11-10',
            righe: [{ id: randomUUID(), ingrediente_id: 'ing:latte', quantita: 2000, unita: 'ml', confezione: 1000, lotto_id: daSpesa, luogo: 'frigo' }],
          }),
        )
      ).esito,
    ).toBe('applicato');
    expect(await lotto(daSpesa)).toMatchObject({ quantita: '2000', confezione: '1000' });

    const [riga] = await banco.sql<{ id: string }>("select id from acquisto_riga where famiglia_id = $1 and ingrediente_id = 'ing:burro'", [famiglia]);
    const completo = randomUUID();
    expect((await u.applica(comando('completa_riga_acquisto', famiglia, { id: riga.id, lotto_id: completo, quantita: 500, unita: 'g', confezione: 250, luogo: 'frigo' }))).esito).toBe('applicato');
    expect(await lotto(completo)).toMatchObject({ quantita: '500', confezione: '250' });
  });

  it('spostando una parte il lotto nuovo tiene la confezione; a occhio la perde; si cambia con modifica_lotto', async () => {
    const { u, famiglia } = await famigliaCon();
    const id = randomUUID();
    await u.applica(comando('aggiungi_lotto', famiglia, { id, ingrediente_id: 'ing:pollo', quantita: 800, unita: 'g', confezione: 400, luogo: 'frigo', tipo_data: 'sconosciuta' }));
    const nuovo = randomUUID();
    expect((await u.applica(comando('sposta_lotto', famiglia, { lotto_id: id, luogo: 'freezer', quantita: 400, nuovo_id: nuovo }))).esito).toBe('applicato');
    expect(await lotto(nuovo)).toMatchObject({ quantita: '400', confezione: '400', luogo: 'freezer' });

    const [{ versione }] = await banco.sql<{ versione: number }>('select versione from lotto where id = $1', [id]);
    expect((await u.applica(comando('modifica_lotto', famiglia, { id, versione_attesa: versione, campi: { confezione: 200 } }))).esito).toBe('applicato');
    expect((await lotto(id)).confezione).toBe('200');

    const occhio = randomUUID();
    await u.applica(comando('cambia_livello', famiglia, { lotto_id: id, livello: 'tanto', pezzi: 2, nuovo_id: occhio }));
    expect((await lotto(occhio)).confezione).toBeNull();
    const formaggio = randomUUID();
    await u.applica(comando('aggiungi_lotto', famiglia, { id: formaggio, ingrediente_id: 'ing:parmigiano', quantita: 2, unita: 'pz', livello: 'tanto', confezione: 200, luogo: 'frigo', tipo_data: 'sconosciuta' }));
    expect((await lotto(formaggio)).confezione).toBeNull();
  });

  it('esporta e ripristina la confezione', async () => {
    const { u, famiglia } = await famigliaCon();
    await u.applica(comando('aggiungi_lotto', famiglia, { id: randomUUID(), ingrediente_id: 'ing:pasta', quantita: 1000, unita: 'g', confezione: 500, luogo: 'dispensa', tipo_data: 'sconosciuta' }));
    const righe: RigaScaricata[] = [];
    let dopo = 0;
    for (;;) {
      const p = await u.scarica(famiglia, dopo, 200);
      righe.push(...(p.righe as RigaScaricata[]));
      if (p.righe.length) dopo = p.righe[p.righe.length - 1].seq;
      if (!p.altre) break;
    }
    const nuova = randomUUID();
    const e = await u.applica(comando('ripristina_famiglia', nuova, { file: JSON.parse(JSON.stringify(componiFile(righe, new Date()))) }));
    expect(e.esito).toBe('applicato');
    expect(await banco.sql('select quantita, confezione from lotto where famiglia_id = $1', [nuova])).toEqual([{ quantita: '1000', confezione: '500' }]);
  });
});
