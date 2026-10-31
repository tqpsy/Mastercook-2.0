/**
 * Casa: lotti e movimenti (T-CAS, T-SCA-1, parte manuale di T-ACQ-1).
 * La quantità di un lotto è la somma dei suoi movimenti; i movimenti non cambiano e non si ripetono.
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

function lotto(extra: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    ingrediente_id: 'ing:uova',
    nome: 'Uova bio',
    quantita: 4,
    unita: 'pz',
    luogo: 'frigo',
    data_limite: '2026-11-05',
    tipo_data: 'scadenza',
    fonte_data: 'confezione',
    ...extra,
  };
}

async function quantita(id: string) {
  const [r] = await banco.sql<{ q: string; somma: string; chiuso: boolean }>(
    `select l.quantita as q, (select coalesce(sum(variazione), 0) from movimento m where m.lotto_id = l.id) as somma,
            l.chiuso_il is not null as chiuso
       from lotto l where l.id = $1`,
    [id],
  );
  return { quantita: Number(r.q), somma: Number(r.somma), chiuso: r.chiuso };
}

describe('lotti e movimenti', () => {
  it('T-CAS-1 la quantità è sempre la somma dei movimenti', async () => {
    const { u, famiglia } = await famigliaCon();
    const l = lotto({ ingrediente_id: 'ing:latte', unita: 'ml', quantita: 1000, nome: 'Latte intero' });
    expect((await u.applica(comando('aggiungi_lotto', famiglia, l))).esito).toBe('applicato');
    await u.applica(comando('scarica_lotto', famiglia, { lotto_id: l.id, causale: 'consumo', quantita: 250 }));
    await u.applica(comando('correggi_lotto', famiglia, { lotto_id: l.id, quantita_vista: 750, quantita_nuova: 700, nota: 'misurato' }));
    expect(await quantita(l.id)).toEqual({ quantita: 700, somma: 700, chiuso: false });
    const mov = await banco.sql('select causale, variazione from movimento where lotto_id = $1 order by seq', [l.id]);
    expect(mov.map((m) => [m.causale, Number(m.variazione)])).toEqual([
      ['carico', 1000],
      ['consumo', -250],
      ['correzione', -50],
    ]);
  });

  it('T-CAS-2 due yogurt con date diverse restano due lotti', async () => {
    const { u, famiglia } = await famigliaCon();
    const yogurt = { ingrediente_id: 'ing:yogurt', nome: 'Yogurt bianco', unita: 'g', quantita: 500 };
    await u.applica(comando('aggiungi_lotto', famiglia, lotto({ ...yogurt, data_limite: '2026-11-05' })));
    await u.applica(comando('aggiungi_lotto', famiglia, lotto({ ...yogurt, data_limite: '2026-11-12' })));
    const r = await banco.sql('select data_limite::text as d from lotto where famiglia_id = $1 order by data_limite', [famiglia]);
    expect(r.map((x) => x.d)).toEqual(['2026-11-05', '2026-11-12']);
  });

  it('T-CAS-3 spreco e scaduto hanno la loro causale; a zero il lotto si chiude, una correzione lo riapre', async () => {
    const { u, famiglia } = await famigliaCon();
    const l = lotto();
    await u.applica(comando('aggiungi_lotto', famiglia, l));
    await u.applica(comando('scarica_lotto', famiglia, { lotto_id: l.id, causale: 'spreco', quantita: 1, nota: 'aperto e dimenticato' }));
    await u.applica(comando('scarica_lotto', famiglia, { lotto_id: l.id, causale: 'scaduto', quantita: 3 }));
    expect(await quantita(l.id)).toEqual({ quantita: 0, somma: 0, chiuso: true });
    const mov = await banco.sql("select causale, variazione from movimento where lotto_id = $1 and causale <> 'carico' order by seq", [l.id]);
    expect(mov.map((m) => [m.causale, Number(m.variazione)])).toEqual([
      ['spreco', -1],
      ['scaduto', -3],
    ]);
    await u.applica(comando('correggi_lotto', famiglia, { lotto_id: l.id, quantita_vista: 0, quantita_nuova: 1 }));
    expect(await quantita(l.id)).toEqual({ quantita: 1, somma: 1, chiuso: false });
  });

  it('non si toglie più di quanto c’è; la causale deve essere tra quelle ammesse', async () => {
    const { u, famiglia } = await famigliaCon();
    const l = lotto();
    await u.applica(comando('aggiungi_lotto', famiglia, l));
    const e = await u.applica(comando('scarica_lotto', famiglia, { lotto_id: l.id, causale: 'consumo', quantita: 5 }));
    expect(e).toMatchObject({ esito: 'rifiutato', dettaglio: { motivo: 'quantita_insufficiente', disponibile: 4 } });
    const e2 = await u.applica(comando('scarica_lotto', famiglia, { lotto_id: l.id, causale: 'carico', quantita: 5 }));
    expect(e2.dettaglio.motivo).toBe('causale_non_ammessa');
    expect(await quantita(l.id)).toEqual({ quantita: 4, somma: 4, chiuso: false });
  });

  it('lo stesso scarico inviato due volte toglie una volta sola', async () => {
    const { u, famiglia } = await famigliaCon();
    const l = lotto();
    await u.applica(comando('aggiungi_lotto', famiglia, l));
    const c = comando('scarica_lotto', famiglia, { lotto_id: l.id, causale: 'consumo', quantita: 1 });
    const esiti = await Promise.all([u.applica(c), u.applica(c), u.applica(c)]);
    expect(esiti.filter((e) => !e.ripetuto)).toHaveLength(1);
    expect(await quantita(l.id)).toEqual({ quantita: 3, somma: 3, chiuso: false });
  });

  it('8 dispositivi prendono 1 uovo ciascuno da un lotto di 5: 5 riescono, 3 trovano il lotto vuoto', async () => {
    const { u, famiglia } = await famigliaCon();
    const l = lotto({ quantita: 5 });
    await u.applica(comando('aggiungi_lotto', famiglia, l));
    const esiti = await Promise.all(
      Array.from({ length: 8 }, () => u.applica(comando('scarica_lotto', famiglia, { lotto_id: l.id, causale: 'consumo', quantita: 1 }))),
    );
    expect(esiti.filter((e) => e.esito === 'applicato')).toHaveLength(5);
    expect(esiti.filter((e) => e.dettaglio.motivo === 'quantita_insufficiente')).toHaveLength(3);
    expect(await quantita(l.id)).toEqual({ quantita: 0, somma: 0, chiuso: true });
  });

  it('«ora ce ne sono X» con una quantità vista vecchia è un conflitto, non una sovrascrittura', async () => {
    const { u, famiglia } = await famigliaCon();
    const l = lotto();
    await u.applica(comando('aggiungi_lotto', famiglia, l));
    await u.applica(comando('scarica_lotto', famiglia, { lotto_id: l.id, causale: 'consumo', quantita: 1 }));
    const e = await u.applica(comando('correggi_lotto', famiglia, { lotto_id: l.id, quantita_vista: 4, quantita_nuova: 2 }));
    expect(e).toMatchObject({ esito: 'conflitto', dettaglio: { motivo: 'quantita_cambiata', valore_attuale: 3 } });
    expect(await quantita(l.id)).toEqual({ quantita: 3, somma: 3, chiuso: false });
  });

  it('spostare una parte crea un lotto nuovo con le stesse date; spostare tutto cambia solo il luogo', async () => {
    const { u, famiglia } = await famigliaCon();
    const l = lotto({ ingrediente_id: 'ing:manzo', unita: 'g', quantita: 800, nome: 'Fettine' });
    await u.applica(comando('aggiungi_lotto', famiglia, l));
    const nuovo = randomUUID();
    expect((await u.applica(comando('sposta_lotto', famiglia, { lotto_id: l.id, luogo: 'freezer', quantita: 300, nuovo_id: nuovo }))).esito).toBe(
      'applicato',
    );
    expect(await quantita(l.id)).toMatchObject({ quantita: 500, somma: 500 });
    expect(await quantita(nuovo)).toMatchObject({ quantita: 300, somma: 300 });
    const [n] = await banco.sql('select luogo, data_limite::text as d, tipo_data, fonte_data from lotto where id = $1', [nuovo]);
    expect(n).toEqual({ luogo: 'freezer', d: '2026-11-05', tipo_data: 'scadenza', fonte_data: 'confezione' });
    await u.applica(comando('sposta_lotto', famiglia, { lotto_id: l.id, luogo: 'freezer' }));
    const [v] = await banco.sql('select luogo from lotto where id = $1', [l.id]);
    expect(v.luogo).toBe('freezer');
  });

  it('spostare dal frigo alla dispensa come fa l’app (stima, quantità e nuovo_id a null) funziona', async () => {
    const { u, famiglia } = await famigliaCon();
    // Data letta dalla confezione: l'app non ricalcola niente e manda stima: null.
    const l = lotto({ ingrediente_id: 'ing:manzo', unita: 'g', quantita: 800, nome: 'Fettine', luogo: 'frigo' });
    await u.applica(comando('aggiungi_lotto', famiglia, l));
    const tutto = await u.applica(comando('sposta_lotto', famiglia, { lotto_id: l.id, luogo: 'dispensa', quantita: null, nuovo_id: null, stima: null }));
    expect(tutto.esito).toBe('applicato');
    const [v] = await banco.sql('select luogo, data_limite::text as d, tipo_data, fonte_data from lotto where id = $1', [l.id]);
    expect(v).toEqual({ luogo: 'dispensa', d: '2026-11-05', tipo_data: 'scadenza', fonte_data: 'confezione' });

    // Una parte, sempre con stima: null: lotto nuovo con le stesse date.
    const nuovo = randomUUID();
    const parte = await u.applica(comando('sposta_lotto', famiglia, { lotto_id: l.id, luogo: 'frigo', quantita: 200, nuovo_id: nuovo, stima: null }));
    expect(parte.esito).toBe('applicato');
    const [n] = await banco.sql('select luogo, data_limite::text as d, fonte_data from lotto where id = $1', [nuovo]);
    expect(n).toEqual({ luogo: 'frigo', d: '2026-11-05', fonte_data: 'confezione' });
    expect(await quantita(l.id)).toMatchObject({ quantita: 600, somma: 600 });

    // Data stimata e nessun ricalcolo (stima: null): la fonte della data resta quella di prima.
    const s = lotto({ tipo_data: 'stimata', fonte_data: 'app', calcolata_il: '2026-10-30T10:00:00Z', luogo: 'frigo' });
    expect((await u.applica(comando('aggiungi_lotto', famiglia, s))).esito).toBe('applicato');
    expect((await u.applica(comando('sposta_lotto', famiglia, { lotto_id: s.id, luogo: 'dispensa', quantita: null, nuovo_id: null, stima: null }))).esito).toBe(
      'applicato',
    );
    const [st] = await banco.sql('select luogo, tipo_data, fonte_data from lotto where id = $1', [s.id]);
    expect(st).toEqual({ luogo: 'dispensa', tipo_data: 'stimata', fonte_data: 'app' });
  });

  it('i movimenti non si modificano', async () => {
    const { u, famiglia } = await famigliaCon();
    const l = lotto();
    await u.applica(comando('aggiungi_lotto', famiglia, l));
    await expect(banco.sql('update movimento set variazione = 100 where lotto_id = $1', [l.id])).rejects.toThrow('movimento_immutabile');
    await expect(u.sql('update lotto set quantita = 100 where id = $1', [l.id])).rejects.toThrow(/permission denied/);
  });
});

describe('date e origine', () => {
  it('T-SCA-1 una data della confezione non è mai sostituita da una stima', async () => {
    const { u, famiglia } = await famigliaCon();
    const l = lotto();
    await u.applica(comando('aggiungi_lotto', famiglia, l));
    const stima = { data_limite: '2026-11-20', tipo_data: 'stimata', fonte_data: 'app', calcolata_il: new Date().toISOString() };
    const e = await u.applica(comando('modifica_lotto', famiglia, { id: l.id, versione_attesa: 2, campi: stima }));
    expect(e.dettaglio.motivo).toBe('data_confezione_protetta');
    const e2 = await u.applica(comando('sposta_lotto', famiglia, { lotto_id: l.id, luogo: 'dispensa', stima }));
    expect(e2.dettaglio.motivo).toBe('data_confezione_protetta');
    const [r] = await banco.sql('select data_limite::text as d, fonte_data from lotto where id = $1', [l.id]);
    expect(r).toEqual({ d: '2026-11-05', fonte_data: 'confezione' });
    // Correggere la data con un'altra letta dalla confezione si può.
    const e3 = await u.applica(comando('modifica_lotto', famiglia, { id: l.id, versione_attesa: 2, campi: { data_limite: '2026-11-06' } }));
    expect(e3.esito).toBe('applicato');
  });

  it('tipo, data e fonte devono essere coerenti: «sconosciuta» senza data, «stimata» con la data del calcolo', async () => {
    const { u, famiglia } = await famigliaCon();
    const sconosciutaConData = lotto({ tipo_data: 'sconosciuta', fonte_data: null });
    expect((await u.applica(comando('aggiungi_lotto', famiglia, sconosciutaConData))).dettaglio).toMatchObject({
      motivo: 'dati_non_validi',
      vincolo: 'data_coerente',
    });
    const stimaSenzaCalcolo = lotto({ tipo_data: 'stimata', fonte_data: 'app' });
    expect((await u.applica(comando('aggiungi_lotto', famiglia, stimaSenzaCalcolo))).dettaglio.vincolo).toBe('data_coerente');
    const sconosciuta = lotto({ ingrediente_id: 'ing:pasta', unita: 'g', quantita: 500, tipo_data: 'sconosciuta', fonte_data: null, data_limite: null });
    expect((await u.applica(comando('aggiungi_lotto', famiglia, sconosciuta))).esito).toBe('applicato');
  });

  it('T-ACQ-1 (parte manuale) un lotto a mano ha origine «manuale»; «acquisto» non si può scegliere', async () => {
    const { u, famiglia } = await famigliaCon();
    const e = await u.applica(comando('aggiungi_lotto', famiglia, lotto({ origine: 'acquisto' })));
    expect(e.dettaglio.motivo).toBe('origine_non_ammessa');
    const l = lotto();
    await u.applica(comando('aggiungi_lotto', famiglia, l));
    const [r] = await banco.sql('select origine from lotto where id = $1', [l.id]);
    expect(r.origine).toBe('manuale');
  });

  it('nessun lotto nasce senza una quantità inserita, e l’unità segue l’ingrediente', async () => {
    const { u, famiglia } = await famigliaCon();
    expect((await u.applica(comando('aggiungi_lotto', famiglia, lotto({ quantita: null })))).dettaglio.motivo).toBe('quantita_non_valida');
    expect((await u.applica(comando('aggiungi_lotto', famiglia, lotto({ quantita: 0 })))).dettaglio.motivo).toBe('quantita_non_valida');
    expect((await u.applica(comando('aggiungi_lotto', famiglia, lotto({ unita: 'g' })))).dettaglio.motivo).toBe('unita_incompatibile');
    expect((await banco.sql('select count(*)::int as n from lotto where famiglia_id = $1', [famiglia]))[0].n).toBe(0);
  });

  it('un’altra famiglia non vede i lotti e non può toccarli', async () => {
    const { u, famiglia } = await famigliaCon();
    const l = lotto();
    await u.applica(comando('aggiungi_lotto', famiglia, l));
    const altra = await famigliaCon();
    expect(await altra.u.sql('select id from lotto where id = $1', [l.id])).toHaveLength(0);
    expect(await altra.u.sql('select id from movimento where lotto_id = $1', [l.id])).toHaveLength(0);
    const e = await altra.u.applica(comando('scarica_lotto', altra.famiglia, { lotto_id: l.id, causale: 'consumo', quantita: 1 }));
    expect(e.dettaglio.motivo).toBe('lotto_non_trovato');
  });
});
