/**
 * Conferma dei pasti e consumi (T-CON). Solo la conferma toglie dalla casa, una volta sola; una correzione
 * sposta solo la differenza; il piano del menu non cambia; previsto e usato restano distinti.
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

async function piatto(u: Utente, famiglia: string, ricetta_id = 'sys:carbonara', porzioni = 4, data = '2026-11-03') {
  const id = randomUUID();
  const e = await u.applica(comando('aggiungi_portata', famiglia, { id, data, categoria: 'cena', ricetta_id, porzioni }));
  expect(e.esito).toBe('applicato');
  return id;
}

async function lotto(u: Utente, famiglia: string, ingrediente_id: string, quantita: number, unita = 'g', data_limite: string | null = null) {
  const id = randomUUID();
  const date = data_limite ? { tipo_data: 'scadenza', data_limite, fonte_data: 'confezione' } : { tipo_data: 'sconosciuta' };
  const e = await u.applica(comando('aggiungi_lotto', famiglia, { id, ingrediente_id, quantita, unita, luogo: 'dispensa', ...date }));
  expect(e.esito).toBe('applicato');
  return id;
}

const conferma = (famiglia: string, portata_id: string, esito: string, extra: Record<string, unknown> = {}) =>
  comando('conferma_pasto', famiglia, { id: randomUUID(), portata_id, esito, ...extra });

const quantita = async (id: string) => Number((await banco.sql<{ q: string }>('select quantita as q from lotto where id = $1', [id]))[0].q);
const movimenti = (famiglia: string) =>
  banco.sql<{ causale: string; v: number }>(
    `select causale, variazione::float as v from movimento where famiglia_id = $1 and causale <> 'carico' order by seq`,
    [famiglia],
  );

describe('conferma del pasto', () => {
  it('T-CON-1/5 «come previsto» toglie il previsto; previsto e usato restano leggibili; sale e pepe no', async () => {
    const { u, famiglia } = await famigliaCon();
    const spaghetti = await lotto(u, famiglia, 'ing:spaghetti', 500);
    const uova = await lotto(u, famiglia, 'ing:uova', 6, 'pz');
    const portata = await piatto(u, famiglia);
    // Il menu da solo non toglie niente.
    expect(await quantita(spaghetti)).toBe(500);
    const e = await u.applica(conferma(famiglia, portata, 'come_previsto'));
    expect(e).toMatchObject({ esito: 'applicato', dettaglio: { revisione: 1, movimenti: 2 } });
    // Guanciale e pecorino non c'erano: si dice, non si inventa.
    expect((e.dettaglio.mancanti as { ingrediente_id: string }[]).map((m) => m.ingrediente_id).sort()).toEqual(['ing:guanciale', 'ing:pecorino']);
    expect(await quantita(spaghetti)).toBe(180);
    expect(await quantita(uova)).toBe(2);
    const righe = await banco.sql(
      `select ingrediente_id, quantita_prevista::float as previsto, quantita_usata::float as usato from consumo_riga where famiglia_id = $1 order by ingrediente_id collate "C"`,
      [famiglia],
    );
    expect(righe).toEqual([
      { ingrediente_id: 'ing:guanciale', previsto: 150, usato: 150 },
      { ingrediente_id: 'ing:pecorino', previsto: 60, usato: 60 },
      { ingrediente_id: 'ing:spaghetti', previsto: 320, usato: 320 },
      { ingrediente_id: 'ing:uova', previsto: 4, usato: 4 },
    ]);
  });

  it('T-CON-2 la stessa conferma inviata due volte toglie una volta', async () => {
    const { u, famiglia } = await famigliaCon();
    const spaghetti = await lotto(u, famiglia, 'ing:spaghetti', 500);
    const portata = await piatto(u, famiglia);
    const c = conferma(famiglia, portata, 'come_previsto');
    await u.applica(c);
    expect((await u.applica(c)).ripetuto).toBe(true);
    expect(await quantita(spaghetti)).toBe(180);
  });

  it('T-CON-3 due dispositivi confermano insieme: una conferma, uno scarico, l’altro riceve gia_confermato', async () => {
    const { u, famiglia } = await famigliaCon();
    const spaghetti = await lotto(u, famiglia, 'ing:spaghetti', 1000);
    const portata = await piatto(u, famiglia);
    const esiti = await Promise.all([u.applica(conferma(famiglia, portata, 'come_previsto')), u.applica(conferma(famiglia, portata, 'come_previsto'))]);
    expect(esiti.map((e) => e.esito).sort()).toEqual(['applicato', 'conflitto']);
    expect(esiti.find((e) => e.esito === 'conflitto')?.dettaglio.motivo).toBe('gia_confermato');
    expect(await quantita(spaghetti)).toBe(680);
  });

  it('T-CON-4 correzione da 320 g a 200 g: un solo movimento di +120 g', async () => {
    const { u, famiglia } = await famigliaCon();
    const spaghetti = await lotto(u, famiglia, 'ing:spaghetti', 500);
    const portata = await piatto(u, famiglia);
    await u.applica(conferma(famiglia, portata, 'come_previsto'));
    const righe = [{ ingrediente_id: 'ing:spaghetti', unita: 'g', quantita: 200 }];
    // Chi corregge una revisione che non è più quella vede il conflitto.
    expect((await u.applica(conferma(famiglia, portata, 'quantita_diverse', { revisione_attesa: 2, righe }))).dettaglio.motivo).toBe('conferma_cambiata');
    expect(await u.applica(conferma(famiglia, portata, 'quantita_diverse', { revisione_attesa: 1, righe }))).toMatchObject({
      esito: 'applicato',
      dettaglio: { revisione: 2, movimenti: 1 },
    });
    expect(await quantita(spaghetti)).toBe(300);
    expect(await movimenti(famiglia)).toEqual([
      { causale: 'consumo', v: -320 },
      { causale: 'correzione', v: 120 },
    ]);
    const attive = await banco.sql('select revisione, esito from conferma_pasto where portata_id = $1 and attiva', [portata]);
    expect(attive).toEqual([{ revisione: 2, esito: 'quantita_diverse' }]);
    // Annullare (saltato) restituisce il resto, sempre a differenza.
    await u.applica(conferma(famiglia, portata, 'saltato', { revisione_attesa: 2 }));
    expect(await quantita(spaghetti)).toBe(500);
  });

  it('T-CON-6 «altro piatto»: la portata prevista resta identica, si toglie ciò che si è mangiato davvero', async () => {
    const { u, famiglia } = await famigliaCon();
    const spaghetti = await lotto(u, famiglia, 'ing:spaghetti', 500);
    const portata = await piatto(u, famiglia);
    const prima = await banco.sql('select data, categoria, ricetta_id, porzioni, versione from portata where id = $1', [portata]);
    await u.applica(conferma(famiglia, portata, 'altro_piatto', { ricetta_id: 'sys:spaghetti_aglio_olio', porzioni: 2 }));
    expect(await banco.sql('select data, categoria, ricetta_id, porzioni, versione from portata where id = $1', [portata])).toEqual(prima);
    expect(await quantita(spaghetti)).toBe(340);
    const [c] = await banco.sql('select esito, ricetta_id, porzioni::float as p from conferma_pasto where portata_id = $1', [portata]);
    expect(c).toEqual({ esito: 'altro_piatto', ricetta_id: 'sys:spaghetti_aglio_olio', p: 2 });
    // Un piatto senza ricetta («pizza fuori») non toglie niente, ma resta scritto.
    const altra = await piatto(u, famiglia, 'sys:carbonara', 4, '2026-11-04');
    expect((await u.applica(conferma(famiglia, altra, 'altro_piatto', { testo: 'Pizza fuori' }))).esito).toBe('applicato');
    expect(await quantita(spaghetti)).toBe(340);
  });

  it('T-CON-7 «saltato»: nessuno scarico', async () => {
    const { u, famiglia } = await famigliaCon();
    const spaghetti = await lotto(u, famiglia, 'ing:spaghetti', 500);
    const portata = await piatto(u, famiglia);
    expect((await u.applica(conferma(famiglia, portata, 'saltato'))).dettaglio).toMatchObject({ movimenti: 0 });
    expect(await quantita(spaghetti)).toBe(500);
    expect(await movimenti(famiglia)).toEqual([]);
  });

  it('T-CON-8 si toglie prima dai lotti che scadono prima; gli spaghetti valgono come pasta', async () => {
    const { u, famiglia } = await famigliaCon();
    const tardi = await lotto(u, famiglia, 'ing:spaghetti', 500, 'g', '2027-06-01');
    const presto = await lotto(u, famiglia, 'ing:spaghetti', 200, 'g', '2026-11-10');
    const senza = await lotto(u, famiglia, 'ing:spaghetti', 500);
    const portata = await piatto(u, famiglia);
    await u.applica(conferma(famiglia, portata, 'come_previsto'));
    expect([await quantita(presto), await quantita(tardi), await quantita(senza)]).toEqual([0, 380, 500]);
    // Una ricetta che chiede «pasta» prende anche dagli spaghetti.
    const pasta = await piatto(u, famiglia, 'sys:carbonara', 4, '2026-11-05');
    await u.applica(conferma(famiglia, pasta, 'quantita_diverse', { righe: [{ ingrediente_id: 'ing:pasta', unita: 'g', quantita: 100 }] }));
    expect(await quantita(tardi)).toBe(280);
  });

  it('avanzi: un lotto «avanzo» in porzioni, legato alla conferma; dati non validi non scrivono nulla', async () => {
    const { u, famiglia } = await famigliaCon();
    const portata = await piatto(u, famiglia);
    const avanzo = randomUUID();
    const c = conferma(famiglia, portata, 'come_previsto', {
      avanzi: [{ lotto_id: avanzo, nome: 'Spaghetti alla carbonara', quantita: 2, luogo: 'frigo', data_limite: '2026-11-04', tipo_data: 'stimata', fonte_data: 'app', calcolata_il: '2026-11-03T20:00:00Z' }],
    });
    expect((await u.applica(c)).esito).toBe('applicato');
    const [l] = await banco.sql('select ingrediente_id, nome, quantita::float as q, unita, origine, tipo_data, conferma_id from lotto where id = $1', [avanzo]);
    expect(l).toEqual({ ingrediente_id: 'ing:avanzo', nome: 'Spaghetti alla carbonara', q: 2, unita: 'pz', origine: 'avanzo', tipo_data: 'stimata', conferma_id: c.dati.id });

    const altra = await piatto(u, famiglia, 'sys:carbonara', 4, '2026-11-06');
    expect((await u.applica(conferma(famiglia, altra, 'quantita_diverse'))).dettaglio.motivo).toBe('dati_non_validi');
    expect((await u.applica(conferma(famiglia, altra, 'boh'))).dettaglio.motivo).toBe('dati_non_validi');
    expect((await u.applica(conferma(famiglia, altra, 'altro_piatto'))).dettaglio.motivo).toBe('dati_non_validi');
    expect((await u.applica(conferma(famiglia, randomUUID(), 'saltato'))).dettaglio.motivo).toBe('portata_non_trovata');
    const negativo = await u.applica(conferma(famiglia, altra, 'quantita_diverse', { righe: [{ ingrediente_id: 'ing:spaghetti', unita: 'g', quantita: -1 }] }));
    expect(negativo.dettaglio.motivo).toBe('quantita_non_valida');
    expect((await banco.sql('select count(*)::int as n from conferma_pasto where portata_id = $1', [altra]))[0].n).toBe(0);
    // Un'altra famiglia non conferma i pasti di questa.
    const { u: v, famiglia: estranea } = await famigliaCon();
    expect((await v.applica(conferma(estranea, altra, 'saltato'))).dettaglio.motivo).toBe('portata_non_trovata');
  });
});
