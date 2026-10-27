/**
 * Scontrini e prodotti (T-ACQ-2, T-ACQ-4, T-ACQ-5). Lo scontrino rivisto da una persona entra una volta sola:
 * le righe già confermate dal carrello prendono solo il prezzo, le nuove entrano in casa.
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

async function famigliaCon(): Promise<{ u: Utente; famiglia: string }> {
  const u = await banco.utente();
  const { famiglia } = await creaFamiglia(u);
  return { u, famiglia };
}

function scontrino(famiglia: string, righe: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return comando('importa_scontrino', famiglia, {
    id: randomUUID(),
    acquisto_id: randomUUID(),
    negozio: 'Supermercato Rossi',
    data: '2026-11-02',
    ora: '18:30',
    totale: 5.79,
    righe: righe.map((r) => ({ id: randomUUID(), ...r })),
    ...extra,
  });
}

const nuova = (ingrediente_id: string, quantita: number, unita: string) => ({ id: randomUUID(), lotto_id: randomUUID(), ingrediente_id, quantita, unita, luogo: 'frigo' });

async function casa(famiglia: string) {
  return banco.sql<{ ingrediente_id: string; origine: string; q: number }>(
    `select ingrediente_id, origine, quantita::float as q from lotto where famiglia_id = $1 order by ingrediente_id collate "C"`,
    [famiglia],
  );
}

describe('scontrini', () => {
  it('T-ACQ-2 le righe nuove creano un acquisto «scontrino» e i lotti; il resto resta sullo scontrino', async () => {
    const { u, famiglia } = await famigliaCon();
    const c = scontrino(famiglia, [
      { descrizione: 'LATTE INTERO 1L', prezzo: 1.29, nuova: nuova('ing:latte', 1000, 'ml') },
      { descrizione: 'DETERSIVO PIATTI', prezzo: 2.1, nuova: { id: randomUUID() } },
      { descrizione: 'SHOPPER', prezzo: 0.1 },
    ]);
    expect(await u.applica(c)).toMatchObject({ esito: 'applicato', dettaglio: { abbinate: 0, nuove: 2 } });
    expect(await casa(famiglia)).toEqual([{ ingrediente_id: 'ing:latte', origine: 'scontrino', q: 1000 }]);
    const [a] = await banco.sql('select fonte, negozio, data::text, scontrino_id is not null as con_scontrino from acquisto where famiglia_id = $1', [famiglia]);
    expect(a).toEqual({ fonte: 'scontrino', negozio: 'Supermercato Rossi', data: '2026-11-02', con_scontrino: true });
    const righe = await banco.sql(
      `select sr.descrizione, sr.prezzo::text, ar.nome, ar.ingrediente_id from scontrino_riga sr left join acquisto_riga ar on ar.id = sr.acquisto_riga_id
        where sr.famiglia_id = $1 order by sr.descrizione collate "C"`,
      [famiglia],
    );
    expect(righe).toEqual([
      { descrizione: 'DETERSIVO PIATTI', prezzo: '2.10', nome: 'DETERSIVO PIATTI', ingrediente_id: null },
      { descrizione: 'LATTE INTERO 1L', prezzo: '1.29', nome: null, ingrediente_id: 'ing:latte' },
      { descrizione: 'SHOPPER', prezzo: '0.10', nome: null, ingrediente_id: null },
    ]);
    // Annullare l'acquisto toglie dalla casa anche quello che è entrato dallo scontrino.
    expect((await u.applica(comando('annulla_acquisto', famiglia, { id: c.dati.acquisto_id }))).esito).toBe('applicato');
    expect((await casa(famiglia))[0].q).toBe(0);
  });

  it('T-ACQ-4 una riga già confermata dal carrello prende solo il prezzo: niente doppio carico', async () => {
    const { u, famiglia } = await famigliaCon();
    const riga = randomUUID();
    const acquisto = randomUUID();
    await u.applica(
      comando('conferma_acquisto', famiglia, {
        id: acquisto,
        data: '2026-11-02',
        righe: [{ id: riga, ingrediente_id: 'ing:latte', quantita: 1000, unita: 'ml', lotto_id: randomUUID(), luogo: 'frigo' }],
      }),
    );
    const c = scontrino(famiglia, [
      { descrizione: 'LATTE INTERO 1L', prezzo: 1.29, abbina: riga },
      { descrizione: 'BANANE', prezzo: 1.8, nuova: nuova('ing:banana', 600, 'g') },
    ]);
    expect(await u.applica(c)).toMatchObject({ esito: 'applicato', dettaglio: { abbinate: 1, nuove: 1 } });
    expect(await casa(famiglia)).toEqual([
      { ingrediente_id: 'ing:banana', origine: 'scontrino', q: 600 },
      { ingrediente_id: 'ing:latte', origine: 'acquisto', q: 1000 },
    ]);
    const [r] = await banco.sql('select prezzo::text, (select scontrino_id is not null from acquisto where id = $2) as legato from acquisto_riga where id = $1', [riga, acquisto]);
    expect(r).toEqual({ prezzo: '1.29', legato: true });
    expect((await banco.sql('select count(*)::int as n from movimento where famiglia_id = $1', [famiglia]))[0].n).toBe(2);

    // La stessa riga non si abbina a un secondo scontrino.
    const altro = await u.applica(scontrino(famiglia, [{ descrizione: 'LATTE', prezzo: 1.5, abbina: riga }], { ora: '19:00' }));
    expect(altro.dettaglio.motivo).toBe('riga_gia_abbinata');
    // Né una riga di un'altra famiglia.
    const { u: v, famiglia: altra } = await famigliaCon();
    const estranea = await v.applica(scontrino(altra, [{ descrizione: 'LATTE', prezzo: 1, abbina: riga }]));
    expect(estranea.dettaglio.motivo).toBe('riga_non_trovata');
  });

  it('T-ACQ-5 lo stesso scontrino importato due volte viene riconosciuto e non carica di nuovo', async () => {
    const { u, famiglia } = await famigliaCon();
    const primo = await u.applica(scontrino(famiglia, [{ descrizione: 'LATTE', prezzo: 1.29, nuova: nuova('ing:latte', 1000, 'ml') }]));
    expect(primo.esito).toBe('applicato');
    // Riletto da un altro telefono: id diversi, stesso negozio (scritto un po' diverso), data, ora e totale.
    const doppio = await u.applica(
      scontrino(famiglia, [{ descrizione: 'LATTE', prezzo: 1.29, nuova: nuova('ing:latte', 1000, 'ml') }], { negozio: 'SUPERMERCATO ROSSI.' }),
    );
    expect(doppio).toMatchObject({ esito: 'applicato', dettaglio: { gia_importato: expect.any(String) } });
    expect(await casa(famiglia)).toHaveLength(1);
    // Con il QR fa fede il QR.
    const qr = { qr: 'https://ade.example/scontrino?id=123&tot=5.79' };
    expect((await u.applica(scontrino(famiglia, [], { ...qr, ora: '10:00' }))).dettaglio).toEqual({ abbinate: 0, nuove: 0 });
    expect((await u.applica(scontrino(famiglia, [], { ...qr, ora: '10:01' }))).dettaglio).toHaveProperty('gia_importato');
    // Un altro scontrino dello stesso negozio e giorno, con un totale diverso, è un altro scontrino.
    expect((await u.applica(scontrino(famiglia, [], { totale: 12 }))).dettaglio).toEqual({ abbinate: 0, nuove: 0 });
  });

  it('dati non validi: quantità, data e unità sbagliate non scrivono nulla', async () => {
    const { u, famiglia } = await famigliaCon();
    const senzaQuantita = await u.applica(scontrino(famiglia, [{ descrizione: 'LATTE', prezzo: 1, nuova: { ...nuova('ing:latte', 0, 'ml') } }]));
    expect(senzaQuantita.dettaglio.motivo).toBe('quantita_non_valida');
    const senzaData = await u.applica(scontrino(famiglia, [], { data: null }));
    expect(senzaData.dettaglio.motivo).toBe('dati_non_validi');
    const unita = await u.applica(scontrino(famiglia, [{ descrizione: 'LATTE', prezzo: 1, nuova: nuova('ing:latte', 1000, 'g') }]));
    expect(unita.esito).toBe('rifiutato');
    expect((await banco.sql('select count(*)::int as n from scontrino where famiglia_id = $1', [famiglia]))[0].n).toBe(0);
  });
});

describe('prodotti', () => {
  it('un codice a barre per famiglia: salvarlo di nuovo lo aggiorna; il formato deve avere un’unità coerente', async () => {
    const { u, famiglia } = await famigliaCon();
    const id = randomUUID();
    expect((await u.applica(comando('salva_prodotto', famiglia, { id, codice: '8001234567890', ingrediente_id: 'ing:latte', nome: 'Latte intero', quantita: 1000, unita: 'ml' }))).esito).toBe(
      'applicato',
    );
    const dopo = await u.applica(comando('salva_prodotto', famiglia, { id: randomUUID(), codice: '8001234567890', ingrediente_id: 'ing:latte', nome: 'Latte scremato', quantita: 500, unita: 'ml' }));
    expect(dopo.dettaglio).toEqual({ aggiornato: id });
    const prodotti = await banco.sql('select id, nome, quantita::float as q from prodotto where famiglia_id = $1', [famiglia]);
    expect(prodotti).toEqual([{ id, nome: 'Latte scremato', q: 500 }]);
    expect((await u.applica(comando('salva_prodotto', famiglia, { id: randomUUID(), codice: '12ab', ingrediente_id: 'ing:latte' }))).esito).toBe('rifiutato');
    expect((await u.applica(comando('salva_prodotto', famiglia, { id: randomUUID(), codice: '80012345', ingrediente_id: 'ing:latte', quantita: 1, unita: 'g' }))).esito).toBe('rifiutato');
    // Un'altra famiglia ha i suoi codici e non vede questi.
    const { u: v, famiglia: altra } = await famigliaCon();
    expect((await v.applica(comando('salva_prodotto', altra, { id: randomUUID(), codice: '8001234567890', ingrediente_id: 'ing:pasta' }))).esito).toBe('applicato');
    expect(await v.sql('select famiglia_id from prodotto')).toEqual([{ famiglia_id: altra }]);
  });
});
