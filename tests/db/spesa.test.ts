/**
 * Lista della spesa e acquisti (T-SPE, T-ACQ). La lista è un'intenzione: solo la conferma di un
 * acquisto entra in casa, una volta sola; annulli e correzioni lasciano la cronologia.
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

const SETTIMANA = { dal: '2026-11-02', al: '2026-11-08' };

async function famigliaCon(): Promise<{ u: Utente; famiglia: string }> {
  const u = await banco.utente();
  const { famiglia } = await creaFamiglia(u);
  return { u, famiglia };
}

async function piatto(u: Utente, famiglia: string, ricetta_id: string, porzioni: number, data = '2026-11-03') {
  const id = randomUUID();
  await u.applica(comando('aggiungi_portata', famiglia, { id, data, categoria: 'cena', ricetta_id, porzioni }));
  return id;
}

async function lotto(u: Utente, famiglia: string, ingrediente_id: string, quantita: number, unita = 'g') {
  const id = randomUUID();
  await u.applica(comando('aggiungi_lotto', famiglia, { id, ingrediente_id, quantita, unita, luogo: 'dispensa', tipo_data: 'sconosciuta' }));
  return id;
}

const ricalcola = (u: Utente, famiglia: string) => u.applica(comando('ricalcola_spesa', famiglia, SETTIMANA));

/** Le voci vive, per ingrediente o testo. */
async function voci(famiglia: string) {
  return banco.sql<{ id: string; cosa: string; q: number; stato: string; tipo: string; npn: boolean }>(
    `select id, coalesce(ingrediente_id, testo) as cosa, coalesce(quantita_scelta, quantita_richiesta)::float as q, stato, tipo,
            non_piu_necessaria as npn
       from voce_spesa where famiglia_id = $1 and eliminato_il is null order by coalesce(ingrediente_id, testo) collate "C", stato`,
    [famiglia],
  );
}
const quanto = async (famiglia: string, cosa: string) => (await voci(famiglia)).find((v) => v.cosa === cosa && v.stato === 'da_acquistare')?.q ?? 0;

async function statoCasa(famiglia: string) {
  const [r] = await banco.sql<{ lotti: string; movimenti: number }>(
    `select coalesce(jsonb_agg(jsonb_build_object('id', id, 'q', quantita) order by id)::text, '[]') as lotti,
            (select count(*)::int from movimento where famiglia_id = $1) as movimenti
       from lotto where famiglia_id = $1`,
    [famiglia],
  );
  return r;
}

describe('fabbisogno e lista', () => {
  it('T-SPE-7 200 g + 300 g di spaghetti da due ricette = 500 g; con 400 g in casa se ne comprano 100', async () => {
    const { u, famiglia } = await famigliaCon();
    await piatto(u, famiglia, 'sys:carbonara', 2.5); // 320 g × 2,5/4 = 200 g
    await piatto(u, famiglia, 'sys:spaghetti_aglio_olio', 3.75, '2026-11-05'); // 300 g
    await ricalcola(u, famiglia);
    expect(await quanto(famiglia, 'ing:spaghetti')).toBe(500);
    await lotto(u, famiglia, 'ing:spaghetti', 400);
    await ricalcola(u, famiglia);
    expect(await quanto(famiglia, 'ing:spaghetti')).toBe(100);
    expect(await quanto(famiglia, 'ing:guanciale')).toBe(93.8);
    // Sale, olio e pepe si danno per presenti; il prezzemolo è facoltativo.
    const cose = (await voci(famiglia)).map((v) => v.cosa);
    expect(cose).not.toContain('ing:sale');
    expect(cose).not.toContain('ing:olio_evo');
    expect(cose).not.toContain('ing:prezzemolo');
    // Fuori dalla settimana non conta.
    await piatto(u, famiglia, 'sys:carbonara', 4, '2026-11-20');
    await ricalcola(u, famiglia);
    expect(await quanto(famiglia, 'ing:spaghetti')).toBe(100);
  });

  it('T-SPE-9 gli spaghetti in casa coprono la «pasta» di una ricetta, non il contrario; prima i più specifici', async () => {
    const a = await famigliaCon();
    await piatto(a.u, a.famiglia, 'sys:pasta_pomodoro', 4); // 320 g di pasta qualsiasi
    await lotto(a.u, a.famiglia, 'ing:spaghetti', 500);
    await ricalcola(a.u, a.famiglia);
    expect(await quanto(a.famiglia, 'ing:pasta')).toBe(0);

    const b = await famigliaCon();
    await piatto(b.u, b.famiglia, 'sys:carbonara', 4); // 320 g di spaghetti
    await lotto(b.u, b.famiglia, 'ing:pasta', 500);
    await ricalcola(b.u, b.famiglia);
    expect(await quanto(b.famiglia, 'ing:spaghetti')).toBe(320);

    const c = await famigliaCon();
    await piatto(c.u, c.famiglia, 'sys:pasta_pomodoro', 4);
    await piatto(c.u, c.famiglia, 'sys:carbonara', 4);
    await lotto(c.u, c.famiglia, 'ing:spaghetti', 400);
    await ricalcola(c.u, c.famiglia);
    expect(await quanto(c.famiglia, 'ing:spaghetti')).toBe(0);
    expect(await quanto(c.famiglia, 'ing:pasta')).toBe(240);
  });

  it('le porzioni automatiche contano chi mangia; chi mangia altro porta la sua ricetta', async () => {
    const u = await banco.utente();
    const { famiglia, membro } = await creaFamiglia(u);
    const sara = randomUUID();
    await u.applica(comando('aggiungi_membro', famiglia, { id: sara, nome: 'Sara', porzione: 0.5 }));
    const p = randomUUID();
    await u.applica(comando('aggiungi_portata', famiglia, { id: p, data: '2026-11-03', categoria: 'cena', ricetta_id: 'sys:carbonara' }));
    await ricalcola(u, famiglia);
    expect(await quanto(famiglia, 'ing:uova')).toBe(1.5); // 4 uova × 1,5/4
    await u.applica(comando('imposta_eccezione', famiglia, { id: randomUUID(), portata_id: p, membro_id: sara, tipo: 'alternativa', ricetta_id: 'sys:pasta_pomodoro' }));
    await u.applica(comando('imposta_eccezione', famiglia, { id: randomUUID(), portata_id: p, membro_id: membro, tipo: 'non_mangia' }));
    await ricalcola(u, famiglia);
    expect(await quanto(famiglia, 'ing:uova')).toBe(0);
    expect(await quanto(famiglia, 'ing:pasta')).toBe(40); // 320 g × 0,5/4
  });

  it('T-SPE-6 dieci ricalcoli: stesse voci, stessi id', async () => {
    const { u, famiglia } = await famigliaCon();
    await piatto(u, famiglia, 'sys:carbonara', 4);
    await ricalcola(u, famiglia);
    const prima = await voci(famiglia);
    for (let i = 0; i < 10; i++) await ricalcola(u, famiglia);
    expect(await voci(famiglia)).toEqual(prima);
    expect(prima.length).toBe(4);
  });

  it('T-SPE-1/2 aggiungere una voce e metterla nel carrello non cambia la casa', async () => {
    const { u, famiglia } = await famigliaCon();
    await lotto(u, famiglia, 'ing:latte', 500, 'ml');
    const casa = await statoCasa(famiglia);
    const id = randomUUID();
    expect((await u.applica(comando('aggiungi_voce', famiglia, { id, ingrediente_id: 'ing:latte', quantita: 1000, unita: 'ml' }))).esito).toBe('applicato');
    expect((await u.applica(comando('imposta_stato_voce', famiglia, { id, stato: 'nel_carrello' }))).esito).toBe('applicato');
    expect((await u.applica(comando('imposta_stato_voce', famiglia, { id, stato: 'nel_carrello' }))).esito).toBe('applicato');
    expect(await statoCasa(famiglia)).toEqual(casa);
    const testo = await u.applica(comando('aggiungi_voce', famiglia, { id: randomUUID(), testo: 'Detersivo piatti' }));
    expect(testo.esito).toBe('applicato');
    const male = await u.applica(comando('aggiungi_voce', famiglia, { id: randomUUID(), ingrediente_id: 'ing:latte', quantita: 2, unita: 'pz' }));
    expect(male.dettaglio.motivo).toBe('unita_incompatibile');
  });

  it('T-SPE-3 togliere dal menu: la voce da comprare sparisce, quella nel carrello resta «non più necessaria»', async () => {
    const { u, famiglia } = await famigliaCon();
    const p = await piatto(u, famiglia, 'sys:carbonara', 4);
    await ricalcola(u, famiglia);
    const guanciale = (await voci(famiglia)).find((v) => v.cosa === 'ing:guanciale')!;
    await u.applica(comando('imposta_stato_voce', famiglia, { id: guanciale.id, stato: 'nel_carrello' }));
    await ricalcola(u, famiglia);
    // Nel carrello conta come già in arrivo: nessuna seconda voce.
    expect((await voci(famiglia)).filter((v) => v.cosa === 'ing:guanciale')).toEqual([{ ...guanciale, stato: 'nel_carrello' }]);
    await u.applica(comando('rimuovi_portata', famiglia, { id: p }));
    await ricalcola(u, famiglia);
    expect(await voci(famiglia)).toEqual([{ ...guanciale, stato: 'nel_carrello', npn: true }]);
    // Rimesso il piatto, torna necessaria.
    await piatto(u, famiglia, 'sys:carbonara', 4);
    await ricalcola(u, famiglia);
    expect((await voci(famiglia)).find((v) => v.id === guanciale.id)?.npn).toBe(false);
  });

  it('T-SPE-5 una voce a mano resta dopo qualsiasi ricalcolo e conta come già in lista', async () => {
    const { u, famiglia } = await famigliaCon();
    await piatto(u, famiglia, 'sys:carbonara', 4);
    await u.applica(comando('aggiungi_voce', famiglia, { id: randomUUID(), ingrediente_id: 'ing:uova', quantita: 6, unita: 'pz' }));
    await ricalcola(u, famiglia);
    expect((await voci(famiglia)).filter((v) => v.cosa === 'ing:uova')).toMatchObject([{ tipo: 'manuale', q: 6 }]);
    await banco.sql(`update portata set eliminato_il = now() where famiglia_id = $1`, [famiglia]);
    for (let i = 0; i < 3; i++) await ricalcola(u, famiglia);
    expect((await voci(famiglia)).map((v) => v.cosa)).toEqual(['ing:uova']);
  });

  it('una quantità scelta a mano vale più del calcolo e la voce non sparisce da sola', async () => {
    const { u, famiglia } = await famigliaCon();
    const p = await piatto(u, famiglia, 'sys:carbonara', 4);
    await ricalcola(u, famiglia);
    const pecorino = (await voci(famiglia)).find((v) => v.cosa === 'ing:pecorino')!;
    expect((await u.applica(comando('modifica_voce', famiglia, { id: pecorino.id, versione_attesa: 1, campi: { quantita_scelta: 200 } }))).esito).toBe('applicato');
    const vietato = await u.applica(comando('modifica_voce', famiglia, { id: pecorino.id, versione_attesa: 2, campi: { quantita_richiesta: 5 } }));
    expect(vietato.dettaglio.motivo).toBe('campo_non_ammesso');
    await u.applica(comando('rimuovi_portata', famiglia, { id: p }));
    await ricalcola(u, famiglia);
    expect((await voci(famiglia)).find((v) => v.id === pecorino.id)).toMatchObject({ q: 200, npn: true });
  });
});

describe('acquisti', () => {
  function conferma(famiglia: string, righe: Record<string, unknown>[], id = randomUUID()) {
    return comando('conferma_acquisto', famiglia, {
      id,
      data: '2026-11-02',
      negozio: 'Mercato',
      righe: righe.map((r) => ({ id: randomUUID(), lotto_id: randomUUID(), luogo: 'frigo', ...r })),
    });
  }

  it('T-ACQ-1 solo la conferma crea lotti «acquisto»; le voci diventano acquistate', async () => {
    const { u, famiglia } = await famigliaCon();
    const vietato = await u.applica(comando('aggiungi_lotto', famiglia, { id: randomUUID(), ingrediente_id: 'ing:latte', quantita: 1000, unita: 'ml', luogo: 'frigo', tipo_data: 'sconosciuta', origine: 'acquisto' }));
    expect(vietato.dettaglio.motivo).toBe('origine_non_ammessa');
    const voce = randomUUID();
    await u.applica(comando('aggiungi_voce', famiglia, { id: voce, ingrediente_id: 'ing:latte', quantita: 1000, unita: 'ml' }));
    await u.applica(comando('imposta_stato_voce', famiglia, { id: voce, stato: 'nel_carrello' }));
    const c = conferma(famiglia, [
      { voce_id: voce, ingrediente_id: 'ing:latte', quantita: 1000, unita: 'ml', prezzo: 1.29 },
      { nome: 'Detersivo', prezzo: 2.5 },
    ]);
    expect(await u.applica(c)).toMatchObject({ esito: 'applicato', dettaglio: { righe: 2, lotti: 1 } });
    const [l] = await banco.sql('select origine, quantita::float as q, data_acquisto::text from lotto where famiglia_id = $1', [famiglia]);
    expect(l).toEqual({ origine: 'acquisto', q: 1000, data_acquisto: '2026-11-02' });
    const [a] = await banco.sql('select fonte, negozio, stato from acquisto where famiglia_id = $1', [famiglia]);
    expect(a).toEqual({ fonte: 'carrello', negozio: 'Mercato', stato: 'confermato' });
    expect((await voci(famiglia)).map((v) => v.stato)).toEqual(['acquistata']);
    // Una voce acquistata non si rimette nel carrello per sbaglio da un altro telefono.
    expect((await u.applica(comando('imposta_stato_voce', famiglia, { id: voce, stato: 'nel_carrello' }))).dettaglio.motivo).toBe('gia_acquistata');
  });

  it('T-ACQ-3 la stessa conferma inviata due volte (anche come comando nuovo) carica una volta sola', async () => {
    const { u, famiglia } = await famigliaCon();
    const c = conferma(famiglia, [{ ingrediente_id: 'ing:uova', quantita: 6, unita: 'pz' }]);
    await u.applica(c);
    expect(await u.applica(c)).toMatchObject({ esito: 'applicato', ripetuto: true });
    const altro = { ...c, id: randomUUID() };
    expect((await u.applica(altro)).dettaglio).toHaveProperty('gia_confermato');
    expect(await statoCasa(famiglia)).toMatchObject({ movimenti: 1 });
    const [{ q }] = await banco.sql('select sum(quantita)::float as q from lotto where famiglia_id = $1', [famiglia]);
    expect(q).toBe(6);
  });

  it('T-SPE-4 cambiare il menu dopo un acquisto non tocca acquisto e lotti; ciò che è in casa copre il fabbisogno', async () => {
    const { u, famiglia } = await famigliaCon();
    const p = await piatto(u, famiglia, 'sys:carbonara', 4);
    await ricalcola(u, famiglia);
    const guanciale = (await voci(famiglia)).find((v) => v.cosa === 'ing:guanciale')!;
    await u.applica(conferma(famiglia, [{ voce_id: guanciale.id, ingrediente_id: 'ing:guanciale', quantita: 200, unita: 'g' }]));
    await ricalcola(u, famiglia);
    expect(await quanto(famiglia, 'ing:guanciale')).toBe(0);
    const casa = await statoCasa(famiglia);
    await u.applica(comando('rimuovi_portata', famiglia, { id: p }));
    await ricalcola(u, famiglia);
    expect(await statoCasa(famiglia)).toEqual(casa);
    expect((await voci(famiglia)).find((v) => v.id === guanciale.id)?.stato).toBe('acquistata');
  });

  it('T-ACQ-6/8 annullare: movimenti «annullo» opposti, cronologia intera; ciò che è già usato resta usato e si dice', async () => {
    const { u, famiglia } = await famigliaCon();
    const latte = randomUUID();
    const uova = randomUUID();
    const id = randomUUID();
    await u.applica(
      conferma(
        famiglia,
        [
          { ingrediente_id: 'ing:latte', quantita: 1000, unita: 'ml', lotto_id: latte },
          { ingrediente_id: 'ing:uova', quantita: 6, unita: 'pz', lotto_id: uova },
        ],
        id,
      ),
    );
    await u.applica(comando('scarica_lotto', famiglia, { lotto_id: uova, causale: 'consumo', quantita: 2 }));
    const e = await u.applica(comando('annulla_acquisto', famiglia, { id }));
    expect(e).toMatchObject({ esito: 'applicato', dettaglio: { gia_usati: [{ ingrediente_id: 'ing:uova', acquistato: 6, tolto: 4 }] } });
    const lotti = await banco.sql('select quantita::float as q from lotto where id = any($1::uuid[]) order by id', [[latte, uova].sort()]);
    expect(lotti.map((l) => l.q)).toEqual([0, 0]);
    const storia = await banco.sql(`select causale, variazione::float as v from movimento where lotto_id = $1 order by seq`, [latte]);
    expect(storia).toEqual([
      { causale: 'carico', v: 1000 },
      { causale: 'annullo', v: -1000 },
    ]);
    expect((await u.applica(comando('annulla_acquisto', famiglia, { id }))).dettaglio).toHaveProperty('gia_annullato');
    const [a] = await banco.sql('select stato from acquisto where id = $1', [id]);
    expect(a.stato).toBe('annullato');
  });

  it('T-ACQ-7 correggere 2 l in 1 l: un solo movimento di −1 l; il prezzo si aggiunge dopo', async () => {
    const { u, famiglia } = await famigliaCon();
    const riga = randomUUID();
    const lottoId = randomUUID();
    await u.applica(conferma(famiglia, [{ id: riga, ingrediente_id: 'ing:latte', quantita: 2000, unita: 'ml', lotto_id: lottoId }]));
    const e = await u.applica(comando('correggi_riga_acquisto', famiglia, { id: riga, quantita_vista: 2000, quantita_nuova: 1000, prezzo: 1.1 }));
    expect(e.esito).toBe('applicato');
    const storia = await banco.sql(`select causale, variazione::float as v from movimento where lotto_id = $1 order by seq`, [lottoId]);
    expect(storia).toEqual([
      { causale: 'carico', v: 2000 },
      { causale: 'correzione', v: -1000 },
    ]);
    const [r] = await banco.sql('select quantita::float as q, prezzo::float as p from acquisto_riga where id = $1', [riga]);
    expect(r).toEqual({ q: 1000, p: 1.1 });
    const vecchio = await u.applica(comando('correggi_riga_acquisto', famiglia, { id: riga, quantita_vista: 2000, quantita_nuova: 500 }));
    expect(vecchio).toMatchObject({ esito: 'conflitto', dettaglio: { motivo: 'quantita_cambiata' } });
  });

  it('un’altra famiglia non può annullare né confermare con le cose di un’altra', async () => {
    const a = await famigliaCon();
    const id = randomUUID();
    await a.u.applica(conferma(a.famiglia, [{ ingrediente_id: 'ing:uova', quantita: 6, unita: 'pz' }], id));
    const b = await famigliaCon();
    expect((await b.u.applica(comando('annulla_acquisto', b.famiglia, { id }))).dettaglio.motivo).toBe('non_trovato');
    expect((await b.u.applica(conferma(b.famiglia, [{ ingrediente_id: 'ing:uova', quantita: 6, unita: 'pz' }], id))).dettaglio.motivo).toBe('non_trovato');
    expect(await b.u.sql('select * from acquisto where id = $1', [id])).toEqual([]);
  });
});
