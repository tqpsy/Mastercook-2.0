/**
 * Menu della settimana (T-PIA, T-SYN-1/6/7 lato server, eccezioni, gusti, categorie).
 * Pianificare è un'intenzione: non scrive mai in casa.
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

async function famigliaCon(): Promise<{ u: Utente; famiglia: string; membro: string }> {
  const u = await banco.utente();
  const { famiglia, membro } = await creaFamiglia(u);
  return { u, famiglia, membro };
}

function portata(extra: Record<string, unknown> = {}) {
  return { id: randomUUID(), data: '2026-11-03', categoria: 'cena', ricetta_id: 'sys:carbonara', ...extra };
}

async function statoCasa(famiglia: string) {
  const [r] = await banco.sql<{ lotti: string; movimenti: number }>(
    `select coalesce(jsonb_agg(jsonb_build_object('id', id, 'q', quantita) order by id)::text, '[]') as lotti,
            (select count(*)::int from movimento where famiglia_id = $1) as movimenti
       from lotto where famiglia_id = $1`,
    [famiglia],
  );
  return r;
}

describe('pianificare non tocca la casa', () => {
  it('T-PIA-1…4 aggiungere, cambiare ricetta e porzioni, spostare e togliere: zero movimenti, casa identica', async () => {
    const { u, famiglia } = await famigliaCon();
    await u.applica(comando('aggiungi_lotto', famiglia, { id: randomUUID(), ingrediente_id: 'ing:uova', quantita: 6, unita: 'pz', luogo: 'frigo', tipo_data: 'sconosciuta' }));
    const prima = await statoCasa(famiglia);

    const p = portata();
    expect((await u.applica(comando('aggiungi_portata', famiglia, p))).esito).toBe('applicato');
    expect((await u.applica(comando('modifica_portata', famiglia, { id: p.id, versione_attesa: 1, campi: { ricetta_id: 'sys:frittata_zucchine' } }))).esito).toBe('applicato');
    expect((await u.applica(comando('modifica_portata', famiglia, { id: p.id, versione_attesa: 2, campi: { porzioni: 6 } }))).esito).toBe('applicato');
    expect((await u.applica(comando('modifica_portata', famiglia, { id: p.id, versione_attesa: 3, campi: { data: '2026-11-05', categoria: 'pranzo' } }))).esito).toBe('applicato');
    expect((await u.applica(comando('rimuovi_portata', famiglia, { id: p.id }))).esito).toBe('applicato');

    expect(await statoCasa(famiglia)).toEqual(prima);
    expect(prima.movimenti).toBe(1);
  });

  it('una portata è una ricetta oppure un testo libero, e il pasto deve esistere', async () => {
    const { u, famiglia } = await famigliaCon();
    expect((await u.applica(comando('aggiungi_portata', famiglia, portata({ ricetta_id: null, testo: 'Pizza da asporto' })))).esito).toBe('applicato');
    const e1 = await u.applica(comando('aggiungi_portata', famiglia, portata({ testo: 'Anche testo' })));
    expect(e1.dettaglio).toMatchObject({ motivo: 'dati_non_validi', vincolo: 'ricetta_o_testo' });
    const e2 = await u.applica(comando('aggiungi_portata', famiglia, portata({ categoria: 'brunch' })));
    expect(e2.dettaglio.motivo).toBe('categoria_non_trovata');
    const e3 = await u.applica(comando('aggiungi_portata', famiglia, portata({ origine: 'automatica' })));
    expect(e3.dettaglio.motivo).toBe('origine_non_ammessa');
  });

  it('T-PIA-7 spostare una portata da martedì a giovedì mantiene id ed eccezioni', async () => {
    const { u, famiglia, membro } = await famigliaCon();
    const p = portata({ data: '2026-11-03' });
    await u.applica(comando('aggiungi_portata', famiglia, p));
    await u.applica(comando('imposta_eccezione', famiglia, { id: randomUUID(), portata_id: p.id, membro_id: membro, tipo: 'non_mangia' }));
    await u.applica(comando('modifica_portata', famiglia, { id: p.id, versione_attesa: 1, campi: { data: '2026-11-05' } }));
    const [r] = await banco.sql('select data::text, (select count(*)::int from eccezione_membro e where e.portata_id = p.id and e.eliminato_il is null) as eccezioni from portata p where id = $1', [p.id]);
    expect(r).toEqual({ data: '2026-11-05', eccezioni: 1 });
  });

  it('T-PIA-5 ripetere la settimana copia portate ed eccezioni con nuovi id e origine «ripetuta»', async () => {
    const { u, famiglia, membro } = await famigliaCon();
    const a = portata({ data: '2026-11-02', categoria: 'pranzo' });
    const b = portata({ data: '2026-11-04', ricetta_id: null, testo: 'Avanzi' });
    const tolta = portata({ data: '2026-11-05' });
    const ecc = randomUUID();
    for (const x of [a, b, tolta]) await u.applica(comando('aggiungi_portata', famiglia, x));
    await u.applica(comando('imposta_eccezione', famiglia, { id: ecc, portata_id: a.id, membro_id: membro, tipo: 'alternativa', testo: 'Riso in bianco' }));
    await u.applica(comando('rimuovi_portata', famiglia, { id: tolta.id }));

    const copie = [a, b, tolta].map((x) => ({ da: x.id, id: randomUUID(), data: x.data.replace('-11-0', '-11-1') }));
    const e = await u.applica(comando('ripeti_portate', famiglia, { portate: copie, eccezioni: [{ da: ecc, id: randomUUID(), portata_id: copie[0].id }] }));
    expect(e).toMatchObject({ esito: 'applicato', dettaglio: { copiate: 2, saltate: 1 } });
    const righe = await banco.sql(
      `select data::text, categoria, ricetta_id, testo, origine from portata where id = any($1::uuid[]) order by data`,
      [copie.map((c) => c.id)],
    );
    expect(righe).toEqual([
      { data: '2026-11-12', categoria: 'pranzo', ricetta_id: 'sys:carbonara', testo: null, origine: 'ripetuta' },
      { data: '2026-11-14', categoria: 'cena', ricetta_id: null, testo: 'Avanzi', origine: 'ripetuta' },
    ]);
    const [x] = await banco.sql('select tipo, testo from eccezione_membro where portata_id = $1', [copie[0].id]);
    expect(x).toEqual({ tipo: 'alternativa', testo: 'Riso in bianco' });
  });
});

describe('più dispositivi sullo stesso menu', () => {
  it('T-SYN-1 A e B aggiungono due portate diverse alla stessa cena nello stesso momento: ci sono entrambe', async () => {
    const { u, famiglia } = await famigliaCon();
    const a = portata();
    const b = portata({ ricetta_id: 'sys:pasta_pomodoro' });
    const esiti = await Promise.all([u.applica(comando('aggiungi_portata', famiglia, a)), u.applica(comando('aggiungi_portata', famiglia, b))]);
    expect(esiti.map((e) => e.esito)).toEqual(['applicato', 'applicato']);
    const righe = await banco.sql(`select ricetta_id from portata where famiglia_id = $1 and data = '2026-11-03' and categoria = 'cena' order by ricetta_id collate "C"`, [famiglia]);
    expect(righe.map((r) => r.ricetta_id)).toEqual(['sys:carbonara', 'sys:pasta_pomodoro']);
  });

  it('T-SYN-6/7 campi diversi della stessa portata si uniscono; lo stesso campo è un conflitto visibile', async () => {
    const { u, famiglia } = await famigliaCon();
    const p = portata();
    await u.applica(comando('aggiungi_portata', famiglia, p));
    const [x, y] = await Promise.all([
      u.applica(comando('modifica_portata', famiglia, { id: p.id, versione_attesa: 1, campi: { porzioni: 3 } })),
      u.applica(comando('modifica_portata', famiglia, { id: p.id, versione_attesa: 1, campi: { note: 'Senza pepe' } })),
    ]);
    expect([x.esito, y.esito]).toEqual(['applicato', 'applicato']);
    const z = await u.applica(comando('modifica_portata', famiglia, { id: p.id, versione_attesa: 1, campi: { porzioni: 5 } }));
    expect(z).toMatchObject({ esito: 'conflitto', dettaglio: { motivo: 'stesso_campo' } });
    const [r] = await banco.sql('select porzioni::float as porzioni, note from portata where id = $1', [p.id]);
    expect(r).toEqual({ porzioni: 3, note: 'Senza pepe' });
  });
});

describe('eccezioni, gusti e categorie', () => {
  it('una sola eccezione per persona e portata; chi non sapeva della scelta di un altro riceve un conflitto', async () => {
    const { u, famiglia, membro } = await famigliaCon();
    const p = portata();
    await u.applica(comando('aggiungi_portata', famiglia, p));
    const prima = { id: randomUUID(), portata_id: p.id, membro_id: membro, tipo: 'non_mangia' };
    expect((await u.applica(comando('imposta_eccezione', famiglia, prima))).esito).toBe('applicato');
    // Lo stesso, da un altro telefono: già fatto.
    expect((await u.applica(comando('imposta_eccezione', famiglia, { ...prima, id: randomUUID() }))).dettaglio).toHaveProperty('gia_presente');
    const diversa = { id: randomUUID(), portata_id: p.id, membro_id: membro, tipo: 'alternativa', ricetta_id: 'sys:pasta_pomodoro' };
    expect(await u.applica(comando('imposta_eccezione', famiglia, diversa))).toMatchObject({ esito: 'conflitto', dettaglio: { motivo: 'eccezione_cambiata' } });
    expect((await u.applica(comando('imposta_eccezione', famiglia, { ...diversa, versione_attesa: 1 }))).esito).toBe('applicato');
    const righe = await banco.sql('select tipo, ricetta_id from eccezione_membro where portata_id = $1 and eliminato_il is null', [p.id]);
    expect(righe).toEqual([{ tipo: 'alternativa', ricetta_id: 'sys:pasta_pomodoro' }]);
    const bad = await u.applica(comando('imposta_eccezione', famiglia, { id: randomUUID(), portata_id: p.id, membro_id: randomUUID(), tipo: 'non_mangia' }));
    expect(bad.dettaglio.motivo).toBe('membro_non_trovato');
  });

  it('togliere una portata toglie anche le sue eccezioni', async () => {
    const { u, famiglia, membro } = await famigliaCon();
    const p = portata();
    await u.applica(comando('aggiungi_portata', famiglia, p));
    await u.applica(comando('imposta_eccezione', famiglia, { id: randomUUID(), portata_id: p.id, membro_id: membro, tipo: 'non_mangia' }));
    await u.applica(comando('rimuovi_portata', famiglia, { id: p.id }));
    expect(await banco.sql('select 1 from eccezione_membro where portata_id = $1 and eliminato_il is null', [p.id])).toEqual([]);
  });

  it('gusti: uno per persona e alimento, dichiarati e modificabili', async () => {
    const { u, famiglia, membro } = await famigliaCon();
    const g = { id: randomUUID(), membro_id: membro, ingrediente_id: 'ing:zucchina', valore: 'non_piace' };
    expect((await u.applica(comando('imposta_gusto', famiglia, g))).esito).toBe('applicato');
    expect((await u.applica(comando('imposta_gusto', famiglia, { ...g, id: randomUUID(), valore: 'piace' }))).esito).toBe('conflitto');
    expect((await u.applica(comando('imposta_gusto', famiglia, { ...g, id: randomUUID(), valore: 'piace', versione_attesa: 1 }))).esito).toBe('applicato');
    await u.applica(comando('imposta_gusto', famiglia, { id: randomUUID(), membro_id: membro, ricetta_id: 'sys:carbonara', valore: 'piace' }));
    const righe = await banco.sql('select coalesce(ingrediente_id, ricetta_id) as cosa, valore from gusto where membro_id = $1 and eliminato_il is null order by 1', [membro]);
    expect(righe).toEqual([
      { cosa: 'ing:zucchina', valore: 'piace' },
      { cosa: 'sys:carbonara', valore: 'piace' },
    ]);
  });

  it('categorie: si accendono quelle standard e si creano quelle della famiglia', async () => {
    const { u, famiglia } = await famigliaCon();
    await u.applica(comando('imposta_categoria', famiglia, { chiave: 'merenda', attiva: true }));
    await u.applica(comando('imposta_categoria', famiglia, { chiave: 'merenda', attiva: true }));
    await u.applica(comando('imposta_categoria', famiglia, { chiave: 'colazione', attiva: false }));
    const brunch = randomUUID();
    await u.applica(comando('crea_categoria', famiglia, { id: brunch, nome: 'Brunch', emoji: '🥞' }));
    expect((await u.applica(comando('aggiungi_portata', famiglia, portata({ categoria: brunch })))).esito).toBe('applicato');
    const righe = await banco.sql('select coalesce(chiave, nome) as c, attiva from categoria_pasto where famiglia_id = $1 order by 1', [famiglia]);
    expect(righe).toEqual([
      { c: 'Brunch', attiva: true },
      { c: 'colazione', attiva: false },
      { c: 'merenda', attiva: true },
    ]);
  });

  it('una ricetta nel menu non si cancella: si archivia', async () => {
    const { u, famiglia } = await famigliaCon();
    const id = randomUUID();
    const creata = await u.applica(
      comando('salva_ricetta', famiglia, {
        id,
        nuova: true,
        campi: { titolo: 'Torta di mele', categoria: 'dolce', porzioni: 8, minuti_totali: 60 },
        ingredienti: { aggiungi: [{ id: randomUUID(), ingrediente_id: 'ing:mela', quantita: 500, unita: 'g', ordine: 1 }] },
        passi: { aggiungi: [{ id: randomUUID(), ordine: 1, testo: 'Cuoci.' }] },
      }),
    );
    expect(creata.esito, JSON.stringify(creata)).toBe('applicato');
    await u.applica(comando('aggiungi_portata', famiglia, portata({ ricetta_id: id })));
    expect((await u.applica(comando('elimina_ricetta', famiglia, { id }))).dettaglio.motivo).toBe('ricetta_nel_menu');
    expect((await u.applica(comando('salva_ricetta', famiglia, { id, versione_attesa: 1, campi: { archiviata: true } }))).esito).toBe('applicato');
  });

  it('un’altra famiglia non vede il menu e non può usarne ricette e persone', async () => {
    const a = await famigliaCon();
    const p = portata();
    await a.u.applica(comando('aggiungi_portata', a.famiglia, p));
    const b = await famigliaCon();
    expect(await b.u.sql('select * from portata where id = $1', [p.id])).toEqual([]);
    const e = await b.u.applica(comando('imposta_eccezione', b.famiglia, { id: randomUUID(), portata_id: p.id, membro_id: a.membro, tipo: 'non_mangia' }));
    expect(e.esito).toBe('rifiutato');
    expect(await b.u.applica(comando('modifica_portata', a.famiglia, { id: p.id, versione_attesa: 1, campi: { porzioni: 2 } }))).toMatchObject({
      esito: 'rifiutato',
      dettaglio: { motivo: 'non_autorizzato' },
    });
  });
});

describe('pasti fissi', () => {
  const giorno = (n: number) => banco.sql<{ d: string }>(`select (current_date + $1::int)::text as d`, [n]).then((r) => r[0].d);
  const fissi = (famiglia: string) =>
    banco.sql<{ data: string; testo: string; origine: string; eliminata: boolean }>(
      `select data::text, testo, origine, eliminato_il is not null as eliminata from portata where famiglia_id = $1 and categoria = 'colazione' order by data, testo`,
      [famiglia],
    );

  it('dalla portata di oggi, ogni giorno per due settimane; prolungare non crea doppioni; un giorno tolto resta tolto', async () => {
    const { u, famiglia } = await famigliaCon();
    const oggi = await giorno(0);
    const prima = randomUUID();
    await u.applica(comando('aggiungi_portata', famiglia, { id: prima, data: oggi, categoria: 'colazione', testo: 'Latte e biscotti' }));
    const regola = randomUUID();
    expect((await u.applica(comando('fissa_pasto', famiglia, { id: regola, categoria: 'colazione', testo: 'Latte e biscotti', dal: oggi, da_portata: prima }))).esito).toBe(
      'applicato',
    );
    let righe = await fissi(famiglia);
    expect(righe).toHaveLength(14);
    expect(righe[0]).toMatchObject({ data: oggi, origine: 'manuale' });
    expect(righe.slice(1).every((r) => r.origine === 'fissa')).toBe(true);

    const domani = (await banco.sql<{ id: string }>(`select id from portata where fisso_id = $1 and data = current_date + 1`, [regola]))[0].id;
    await u.applica(comando('rimuovi_portata', famiglia, { id: domani }));
    await u.applica(comando('prolunga_pasti_fissi', famiglia, { fino_a: await giorno(20) }));
    await u.applica(comando('prolunga_pasti_fissi', famiglia, { fino_a: await giorno(20) }));
    righe = await fissi(famiglia);
    expect(righe.filter((r) => !r.eliminata)).toHaveLength(20);
    expect(righe.find((r) => r.data === (righe[1]?.data ?? ''))?.eliminata).toBe(true);
  });

  it('cambiare da un giorno in poi: i giorni dopo passano al piatto nuovo, quelli prima e i confermati restano', async () => {
    const { u, famiglia } = await famigliaCon();
    const oggi = await giorno(0);
    const vecchia = randomUUID();
    await u.applica(comando('fissa_pasto', famiglia, { id: vecchia, categoria: 'colazione', testo: 'Caffè', dal: oggi, fino_a: await giorno(6) }));
    const oggiId = (await banco.sql<{ id: string }>(`select id from portata where fisso_id = $1 and data = current_date`, [vecchia]))[0].id;
    await u.applica(comando('conferma_pasto', famiglia, { id: randomUUID(), portata_id: oggiId, esito: 'come_previsto' }));

    const dal = await giorno(3);
    const tieni = (await banco.sql<{ id: string }>(`select id from portata where fisso_id = $1 and data = $2`, [vecchia, dal]))[0].id;
    expect((await u.applica(comando('modifica_portata', famiglia, { id: tieni, versione_attesa: 1, campi: { testo: 'Cappuccino' } }))).esito).toBe('applicato');
    expect((await u.applica(comando('ferma_pasto_fisso', famiglia, { id: vecchia, dal, tieni }))).esito).toBe('applicato');
    await u.applica(comando('fissa_pasto', famiglia, { id: randomUUID(), categoria: 'colazione', testo: 'Cappuccino', dal, da_portata: tieni, fino_a: await giorno(6) }));

    const vive = (await fissi(famiglia)).filter((r) => !r.eliminata);
    expect(vive.map((r) => r.testo)).toEqual(['Caffè', 'Caffè', 'Caffè', 'Cappuccino', 'Cappuccino', 'Cappuccino', 'Cappuccino']);
    expect((await banco.sql(`select al::text from pasto_fisso where id = $1`, [vecchia]))[0]).toEqual({ al: await giorno(2) });

    // Fermare da oggi non toglie la colazione già confermata.
    await u.applica(comando('ferma_pasto_fisso', famiglia, { id: vecchia, dal: oggi }));
    expect((await fissi(famiglia)).filter((r) => !r.eliminata && r.testo === 'Caffè').map((r) => r.data)).toEqual([oggi]);
  });
});
