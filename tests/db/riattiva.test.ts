/**
 * Dopo l'acquisto: riattivare un acquisto annullato e cambiare l'alimento di una riga (richiesta del 10/11/2026).
 * Annullare toglie le quantità dalla casa e lo scontrino non si può importare due volte: se l'annullo è un errore,
 * si torna indietro. E se la lettura ha abbinato una riga all'ingrediente sbagliato, si corregge senza rifare tutto.
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

const nuova = (ingrediente_id: string, quantita: number, unita: string) => ({ id: randomUUID(), lotto_id: randomUUID(), ingrediente_id, quantita, unita, luogo: 'frigo' });

function scontrino(famiglia: string, righe: Record<string, unknown>[]) {
  return comando('importa_scontrino', famiglia, {
    id: randomUUID(),
    acquisto_id: randomUUID(),
    negozio: 'Supermercato Rossi',
    data: '2026-11-10',
    ora: '18:30',
    totale: 5,
    righe: righe.map((r) => ({ id: randomUUID(), ...r })),
  });
}

async function casa(famiglia: string) {
  return banco.sql<{ ingrediente_id: string; q: number }>(`select ingrediente_id, quantita::float as q from lotto where famiglia_id = $1 order by ingrediente_id collate "C"`, [famiglia]);
}

describe('riattivare un acquisto annullato', () => {
  it('rimette in casa quanto l’annullo aveva tolto; ripetuto non carica due volte', async () => {
    const { u, famiglia } = await famigliaCon();
    const c = scontrino(famiglia, [
      { descrizione: 'LATTE INTERO 1L', prezzo: 1.29, nuova: nuova('ing:latte', 1000, 'ml') },
      { descrizione: 'PETTO DI POLLO', prezzo: 5.5, nuova: nuova('ing:petto_pollo', 500, 'g') },
    ]);
    await u.applica(c);
    const acquisto = c.dati.acquisto_id;
    await u.applica(comando('annulla_acquisto', famiglia, { id: acquisto }));
    expect((await casa(famiglia)).map((x) => x.q)).toEqual([0, 0]);

    const r = await u.applica(comando('riattiva_acquisto', famiglia, { id: acquisto }));
    expect(r.esito).toBe('applicato');
    expect(await casa(famiglia)).toEqual([
      { ingrediente_id: 'ing:latte', q: 1000 },
      { ingrediente_id: 'ing:petto_pollo', q: 500 },
    ]);
    const [a] = await banco.sql<{ stato: string; annullato: boolean }>('select stato, annullato_il is not null as annullato from acquisto where id = $1', [acquisto]);
    expect(a).toEqual({ stato: 'confermato', annullato: false });

    // Un altro telefono che riattiva lo stesso acquisto: niente doppio carico.
    expect(await u.applica(comando('riattiva_acquisto', famiglia, { id: acquisto }))).toMatchObject({ esito: 'applicato', dettaglio: { gia_attivo: acquisto } });
    expect((await casa(famiglia)).map((x) => x.q)).toEqual([1000, 500]);
  });

  it('se una parte era già stata usata, si rimette solo quel che l’annullo aveva tolto', async () => {
    const { u, famiglia } = await famigliaCon();
    const riga = nuova('ing:latte', 1000, 'ml');
    const c = scontrino(famiglia, [{ descrizione: 'LATTE INTERO 1L', prezzo: 1.29, nuova: riga }]);
    await u.applica(c);
    // Prima dell'annullo si usano 300 ml: l'annullo toglie i 700 rimasti.
    expect((await u.applica(comando('scarica_lotto', famiglia, { lotto_id: riga.lotto_id, quantita: 300, causale: 'consumo' }))).esito).toBe('applicato');
    await u.applica(comando('annulla_acquisto', famiglia, { id: c.dati.acquisto_id }));
    expect((await casa(famiglia)).map((x) => x.q)).toEqual([0]);
    await u.applica(comando('riattiva_acquisto', famiglia, { id: c.dati.acquisto_id }));
    expect((await casa(famiglia)).map((x) => x.q)).toEqual([700]);
    // Annullare e riattivare più volte non fa crescere la quantità.
    await u.applica(comando('annulla_acquisto', famiglia, { id: c.dati.acquisto_id }));
    await u.applica(comando('riattiva_acquisto', famiglia, { id: c.dati.acquisto_id }));
    expect((await casa(famiglia)).map((x) => x.q)).toEqual([700]);
  });

  it('un acquisto riattivato si può correggere e annullare di nuovo; uno mai annullato resta com’è', async () => {
    const { u, famiglia } = await famigliaCon();
    const riga = nuova('ing:latte', 1000, 'ml');
    const c = scontrino(famiglia, [{ descrizione: 'LATTE INTERO 1L', prezzo: 1.29, nuova: riga }]);
    await u.applica(c);
    expect(await u.applica(comando('riattiva_acquisto', famiglia, { id: c.dati.acquisto_id }))).toMatchObject({ dettaglio: { gia_attivo: c.dati.acquisto_id } });
    await u.applica(comando('annulla_acquisto', famiglia, { id: c.dati.acquisto_id }));
    // Annullato: le righe non si correggono; riattivato sì.
    expect((await u.applica(comando('correggi_riga_acquisto', famiglia, { id: riga.id, prezzo: 1.5 }))).esito).toBe('rifiutato');
    await u.applica(comando('riattiva_acquisto', famiglia, { id: c.dati.acquisto_id }));
    expect((await u.applica(comando('correggi_riga_acquisto', famiglia, { id: riga.id, prezzo: 1.5 }))).esito).toBe('applicato');
    expect((await u.applica(comando('annulla_acquisto', famiglia, { id: c.dati.acquisto_id }))).esito).toBe('applicato');
    expect((await casa(famiglia)).map((x) => x.q)).toEqual([0]);
  });

  it('un acquisto che non c’è, o di un’altra famiglia, non si riattiva', async () => {
    const { u, famiglia } = await famigliaCon();
    const altro = await famigliaCon();
    const c = scontrino(altro.famiglia, [{ descrizione: 'LATTE', prezzo: 1, nuova: nuova('ing:latte', 1000, 'ml') }]);
    await altro.u.applica(c);
    await altro.u.applica(comando('annulla_acquisto', altro.famiglia, { id: c.dati.acquisto_id }));
    expect((await u.applica(comando('riattiva_acquisto', famiglia, { id: c.dati.acquisto_id }))).esito).toBe('rifiutato');
    expect((await u.applica(comando('riattiva_acquisto', famiglia, { id: randomUUID() }))).esito).toBe('rifiutato');
    expect((await casa(altro.famiglia)).map((x) => x.q)).toEqual([0]);
  });
});

describe('cambiare l’alimento di una riga', () => {
  /** Due ingredienti di sistema che si misurano allo stesso modo, e uno che si conta a pezzi. */
  async function ingredienti() {
    const volume = await banco.sql<{ id: string }>(`select id from ingrediente where famiglia_id is null and dimensione = 'volume' and id <> 'ing:latte' order by id limit 1`);
    const pezzi = await banco.sql<{ id: string }>(`select id from ingrediente where famiglia_id is null and dimensione = 'pezzi' order by id limit 1`);
    return { volume: volume[0].id, pezzi: pezzi[0].id };
  }

  it('il lotto passa all’ingrediente giusto: stessa quantità, stessi movimenti', async () => {
    const { u, famiglia } = await famigliaCon();
    const { volume } = await ingredienti();
    const riga = nuova('ing:latte', 1000, 'ml');
    await u.applica(scontrino(famiglia, [{ descrizione: 'PANNA UHT 1L', prezzo: 1.9, nuova: riga }]));
    const r = await u.applica(comando('cambia_ingrediente_riga', famiglia, { id: riga.id, ingrediente_id: volume, ingrediente_visto: 'ing:latte' }));
    expect(r).toMatchObject({ esito: 'applicato', dettaglio: { prima: 'ing:latte' } });
    expect(await casa(famiglia)).toEqual([{ ingrediente_id: volume, q: 1000 }]);
    const [a] = await banco.sql<{ ingrediente_id: string; lotto: string }>('select ingrediente_id, lotto_id::text as lotto from acquisto_riga where id = $1', [riga.id]);
    expect(a).toEqual({ ingrediente_id: volume, lotto: riga.lotto_id });
    const [{ n }] = await banco.sql<{ n: number }>('select count(*)::int as n from movimento where lotto_id = $1', [riga.lotto_id]);
    expect(n).toBe(1);
    // La stessa scelta ripetuta non cambia niente; il testo letto sullo scontrino resta quello.
    expect((await u.applica(comando('cambia_ingrediente_riga', famiglia, { id: riga.id, ingrediente_id: volume }))).esito).toBe('applicato');
    const [s] = await banco.sql<{ descrizione: string }>('select descrizione from scontrino_riga where acquisto_riga_id = $1', [riga.id]);
    expect(s.descrizione).toBe('PANNA UHT 1L');
  });

  it('un’unità incompatibile (g → pezzi) si rifiuta e non cambia niente', async () => {
    const { u, famiglia } = await famigliaCon();
    const { pezzi } = await ingredienti();
    const riga = nuova('ing:petto_pollo', 500, 'g');
    await u.applica(scontrino(famiglia, [{ descrizione: 'PETTO DI POLLO', prezzo: 5, nuova: riga }]));
    expect((await u.applica(comando('cambia_ingrediente_riga', famiglia, { id: riga.id, ingrediente_id: pezzi }))).esito).toBe('rifiutato');
    expect(await casa(famiglia)).toEqual([{ ingrediente_id: 'ing:petto_pollo', q: 500 }]);
  });

  it('ingrediente che non c’è o di un’altra famiglia, acquisto annullato: rifiutati; ingrediente cambiato nel frattempo: conflitto', async () => {
    const { u, famiglia } = await famigliaCon();
    const altro = await famigliaCon();
    const mio = randomUUID();
    await altro.u.applica(comando('crea_ingrediente', altro.famiglia, { id: mio, nome: 'Cosa mia', dimensione: 'volume', reparto: 'altro', allergeni: [], allergeni_noti: true, classi: [], emoji: '🛒' }));
    const riga = nuova('ing:latte', 1000, 'ml');
    const c = scontrino(famiglia, [
      { descrizione: 'LATTE', prezzo: 1, nuova: riga },
    ]);
    await u.applica(c);
    const prova = (x: Record<string, unknown>) => u.applica(comando('cambia_ingrediente_riga', famiglia, x));
    expect((await prova({ id: riga.id, ingrediente_id: 'ing:non_esiste' })).esito).toBe('rifiutato');
    expect((await prova({ id: riga.id, ingrediente_id: mio })).esito).toBe('rifiutato');
    expect((await prova({ id: randomUUID(), ingrediente_id: 'ing:latte' })).esito).toBe('rifiutato');
    const { volume } = await ingredienti();
    expect((await prova({ id: riga.id, ingrediente_id: volume, ingrediente_visto: 'ing:altro' })).esito).toBe('conflitto');
    await u.applica(comando('annulla_acquisto', famiglia, { id: c.dati.acquisto_id }));
    expect((await prova({ id: riga.id, ingrediente_id: volume })).esito).toBe('rifiutato');
    expect((await casa(famiglia)).map((x) => x.ingrediente_id)).toEqual(['ing:latte']);
  });

  it('una riga ancora «da completare» (senza quantità) cambia ingrediente, e poi si completa con quello giusto', async () => {
    const { u, famiglia } = await famigliaCon();
    const { volume } = await ingredienti();
    const riga = { id: randomUUID(), lotto_id: randomUUID(), ingrediente_id: 'ing:latte', luogo: 'frigo' };
    await u.applica(scontrino(famiglia, [{ descrizione: 'PANNA', prezzo: 1.9, nuova: riga }]));
    expect((await casa(famiglia)).length).toBe(0);
    expect((await u.applica(comando('cambia_ingrediente_riga', famiglia, { id: riga.id, ingrediente_id: volume }))).esito).toBe('applicato');
    const lotto = randomUUID();
    expect((await u.applica(comando('completa_riga_acquisto', famiglia, { id: riga.id, lotto_id: lotto, quantita: 250, unita: 'ml', luogo: 'frigo' }))).esito).toBe('applicato');
    expect(await casa(famiglia)).toEqual([{ ingrediente_id: volume, q: 250 }]);
  });

  it('una riga segnata «non un alimento» per errore diventa un alimento da completare, che poi entra in casa', async () => {
    const { u, famiglia } = await famigliaCon();
    const spatzle = { id: randomUUID() };
    const c = scontrino(famiglia, [
      { descrizione: 'IPERAL SPATZLE', prezzo: 1.99, nuova: spatzle },
      { descrizione: 'LATTE', prezzo: 1, nuova: nuova('ing:latte', 1000, 'ml') },
    ]);
    await u.applica(c);
    expect(await casa(famiglia)).toEqual([{ ingrediente_id: 'ing:latte', q: 1000 }]);
    const riga = () => banco.sql<{ ingrediente_id: string | null; quantita: string | null; unita: string | null; lotto_id: string | null; prezzo: string }>('select ingrediente_id, quantita::text, unita, lotto_id::text, prezzo::text from acquisto_riga where id = $1', [spatzle.id]);
    expect((await riga())[0]).toMatchObject({ ingrediente_id: null, lotto_id: null });

    // Chi vedeva «nessun alimento» è d'accordo: la riga prende l'ingrediente, ma non entra ancora in casa.
    const r = await u.applica(comando('cambia_ingrediente_riga', famiglia, { id: spatzle.id, ingrediente_id: 'ing:pasta', ingrediente_visto: '' }));
    expect(r).toMatchObject({ esito: 'applicato', dettaglio: { da_completare: true } });
    expect((await riga())[0]).toEqual({ ingrediente_id: 'ing:pasta', quantita: null, unita: null, lotto_id: null, prezzo: '1.99' });
    expect((await casa(famiglia)).map((x) => x.ingrediente_id)).toEqual(['ing:latte']);

    // Ora si completa come ogni altra riga: la quantità la scrive una persona e il lotto nasce con la data dell'acquisto.
    const lotto = randomUUID();
    expect((await u.applica(comando('completa_riga_acquisto', famiglia, { id: spatzle.id, lotto_id: lotto, quantita: 500, unita: 'g', luogo: 'dispensa' }))).esito).toBe('applicato');
    expect(await casa(famiglia)).toEqual([
      { ingrediente_id: 'ing:latte', q: 1000 },
      { ingrediente_id: 'ing:pasta', q: 500 },
    ]);
  });

  it('una riga non alimentare: ingrediente che non c’è o di un’altra famiglia si rifiutano, e se qualcuno l’ha già resa alimento è un conflitto', async () => {
    const { u, famiglia } = await famigliaCon();
    const altro = await famigliaCon();
    const mio = randomUUID();
    await altro.u.applica(comando('crea_ingrediente', altro.famiglia, { id: mio, nome: 'Cosa mia', dimensione: 'massa', reparto: 'altro', allergeni: [], allergeni_noti: true, classi: [], emoji: '🛒' }));
    const detersivo = { id: randomUUID() };
    await u.applica(scontrino(famiglia, [{ descrizione: 'DETERSIVO', prezzo: 2, nuova: detersivo }]));
    const prova = (x: Record<string, unknown>) => u.applica(comando('cambia_ingrediente_riga', famiglia, { id: detersivo.id, ...x }));
    expect((await prova({ ingrediente_id: 'ing:non_esiste' })).esito).toBe('rifiutato');
    expect((await prova({ ingrediente_id: mio })).esito).toBe('rifiutato');
    expect((await prova({ ingrediente_id: 'ing:pasta' })).esito).toBe('applicato');
    // Un altro telefono vedeva ancora «nessun alimento»: la riga ora ne ha uno, è un conflitto.
    expect((await prova({ ingrediente_id: 'ing:riso', ingrediente_visto: '' })).esito).toBe('conflitto');
  });
});
