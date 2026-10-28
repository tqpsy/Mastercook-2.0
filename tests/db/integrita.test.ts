/**
 * Integrità del nucleo (migrazione 20261113000000_nucleo_integrita.sql): casi in cui due telefoni, o due strade
 * diverse, contavano due volte o perdevano dati. Ogni caso era stato riprodotto prima della correzione.
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
const oggi = () => new Date().toISOString().slice(0, 10);
const domani = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const giorno = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const ieri = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

async function lotto(u: Utente, famiglia: string, ingrediente_id: string, quantita: number, unita = 'g') {
  const id = randomUUID();
  const e = await u.applica(comando('aggiungi_lotto', famiglia, { id, ingrediente_id, quantita, unita, luogo: 'dispensa', tipo_data: 'sconosciuta' }));
  expect(e.esito).toBe('applicato');
  return id;
}
const totale = async (famiglia: string, ing: string) =>
  Number((await banco.sql<{ q: string }>(`select coalesce(sum(quantita),0)::float as q from lotto where famiglia_id = $1 and ingrediente_id = $2`, [famiglia, ing]))[0].q);

describe('stesso carrello confermato da due telefoni', () => {
  it('la seconda conferma non carica di nuovo e dice quali voci erano già acquistate', async () => {
    const { u, famiglia } = await famigliaCon();
    const voce = randomUUID();
    await u.applica(comando('aggiungi_voce', famiglia, { id: voce, ingrediente_id: 'ing:latte', quantita: 1000, unita: 'ml' }));
    await u.applica(comando('imposta_stato_voce', famiglia, { id: voce, stato: 'nel_carrello' }));
    // Ogni telefono costruisce la conferma con crypto.randomUUID() (Spesa.tsx, ConfermaSpesa.conferma).
    const conferma = () =>
      comando('conferma_acquisto', famiglia, {
        id: randomUUID(),
        fonte: 'carrello',
        data: '2026-11-02',
        righe: [{ id: randomUUID(), voce_id: voce, ingrediente_id: 'ing:latte', quantita: 1000, unita: 'ml', lotto_id: randomUUID(), luogo: 'frigo' }],
      });
    const a = await u.applica(conferma());
    const b = await u.applica(conferma());
    expect(a.esito).toBe('applicato');
    expect(b.esito).toBe('applicato');
    expect(b.dettaglio).toMatchObject({ righe: 0, lotti: 0, gia_acquistate: [voce] });
    expect(await totale(famiglia, 'ing:latte')).toBe(1000);
  });
});

describe('scontrino importato prima della conferma del carrello', () => {
  it('lo scontrino carica il latte e segna acquistata la voce: la conferma del carrello non lo ricarica', async () => {
    const { u, famiglia } = await famigliaCon();
    const voce = randomUUID();
    await u.applica(comando('aggiungi_voce', famiglia, { id: voce, ingrediente_id: 'ing:latte', quantita: 1000, unita: 'ml' }));
    await u.applica(comando('imposta_stato_voce', famiglia, { id: voce, stato: 'nel_carrello' }));
    const s = await u.applica(
      comando('importa_scontrino', famiglia, {
        id: randomUUID(),
        acquisto_id: randomUUID(),
        negozio: 'Super',
        data: oggi(),
        ora: '18:30',
        totale: 1.29,
        righe: [{ id: randomUUID(), descrizione: 'LATTE INTERO 1L', prezzo: 1.29, nuova: { id: randomUUID(), lotto_id: randomUUID(), ingrediente_id: 'ing:latte', quantita: 1000, unita: 'ml' } }],
      }),
    );
    expect(s.esito).toBe('applicato');
    expect((await banco.sql('select stato from voce_spesa where id = $1', [voce]))[0].stato).toBe('acquistata');
    const c = await u.applica(
      comando('conferma_acquisto', famiglia, {
        id: randomUUID(),
        data: oggi(),
        righe: [{ id: randomUUID(), voce_id: voce, ingrediente_id: 'ing:latte', quantita: 1000, unita: 'ml', lotto_id: randomUUID() }],
      }),
    );
    expect(c.esito).toBe('applicato');
    expect(c.dettaglio).toMatchObject({ gia_acquistate: [voce] });
    expect(await totale(famiglia, 'ing:latte')).toBe(1000);
  });
});

describe('ospiti segnati da due telefoni', () => {
  it('chi li segna senza aver visto quelli dell’altro riceve un conflitto: l’allergia resta', async () => {
    const { u, famiglia } = await famigliaCon();
    const data = domani();
    const da = (dispositivo: string, dati: Record<string, unknown>) => ({ ...comando('imposta_ospiti', famiglia, dati), dispositivo });
    const a = await u.applica(da('telefono', { data, categoria: 'cena', adulti: 2, bambini: 0, oggetti: ['all:arachidi'], dispositivo: 'telefono' }));
    const b = await u.applica(da('tablet', { data, categoria: 'cena', adulti: 4, bambini: 0, oggetti: [], dispositivo: 'tablet' }));
    expect(a.esito).toBe('applicato');
    expect(b.esito).toBe('conflitto');
    expect(b.dettaglio.motivo).toBe('ospiti_cambiati');
    const righe = await banco.sql('select adulti, oggetti from ospiti_pasto where famiglia_id = $1 and eliminato_il is null', [famiglia]);
    expect(righe).toEqual([{ adulti: 2, oggetti: ['all:arachidi'] }]);
    // Lo stesso telefono che cambia di nuovo prima di aver ricevuto la sua riga non è in conflitto con sé stesso.
    const c = await u.applica(da('telefono', { data, categoria: 'cena', adulti: 3, bambini: 0, oggetti: ['all:arachidi'], dispositivo: 'telefono' }));
    expect(c.esito).toBe('applicato');
    // Rimandare gli stessi valori non è un conflitto.
    const d = await u.applica(da('tablet', { data, categoria: 'cena', adulti: 3, bambini: 0, oggetti: ['all:arachidi'], dispositivo: 'tablet' }));
    expect(d.esito).toBe('applicato');
  });
});

describe('«va bene» e cambio di ingredienti', () => {
  it('aggiungere solo un ingrediente è una versione nuova: il «va bene» non vale più', async () => {
    const { u, famiglia, membro } = await famigliaCon();
    const ricetta = randomUUID();
    const e = await u.applica(
      comando('salva_ricetta', famiglia, {
        id: ricetta,
        nuova: true,
        campi: { titolo: 'Insalata', categoria: 'contorno', porzioni: 2 },
        ingredienti: { aggiungi: [{ id: randomUUID(), ingrediente_id: 'ing:pomodoro', quantita: 200, unita: 'g' }] },
        passi: { aggiungi: [{ id: randomUUID(), testo: 'Taglia' }] },
      }),
    );
    expect(e.esito).toBe('applicato');
    const v1 = Number((await banco.sql('select versione from ricetta where id = $1', [ricetta]))[0].versione);
    await u.applica(comando('verifica_ricetta', famiglia, { id: randomUUID(), membro_id: membro, ricetta_id: ricetta, va_bene: true, versione_ricetta: v1 }));
    // Un ingrediente nuovo della famiglia: allergeni_noti è falso per default.
    const ing = randomUUID();
    await u.applica(comando('crea_ingrediente', famiglia, { id: ing, nome: 'Salsa della nonna', dimensione: 'massa' }));
    // EditorRicetta.tsx: se cambiano solo gli ingredienti non manda «campi».
    const m = await u.applica(comando('salva_ricetta', famiglia, { id: ricetta, ingredienti: { aggiungi: [{ id: randomUUID(), ingrediente_id: ing, quantita: 50, unita: 'g' }] } }));
    expect(m.esito).toBe('applicato');
    const [r] = await banco.sql('select versione from ricetta where id = $1', [ricetta]);
    const [vv] = await banco.sql('select versione_ricetta from ricetta_verificata where ricetta_id = $1 and eliminato_il is null', [ricetta]);
    expect(Number(r.versione)).toBe(v1 + 1);
    expect(Number(vv.versione_ricetta)).not.toBe(Number(r.versione));
  });
});

describe('la lista e i pasti già confermati', () => {
  it('dopo la conferma di oggi il ricalcolo non chiede di ricomprare quello che si è appena usato', async () => {
    const { u, famiglia } = await famigliaCon();
    await lotto(u, famiglia, 'ing:spaghetti', 500);
    const portata = randomUUID();
    await u.applica(comando('aggiungi_portata', famiglia, { id: portata, data: oggi(), categoria: 'pranzo', ricetta_id: 'sys:carbonara', porzioni: 4 }));
    const periodo = { dal: oggi(), al: domani() };
    await u.applica(comando('ricalcola_spesa', famiglia, periodo));
    const prima = await banco.sql(`select quantita_richiesta::float as q from voce_spesa where famiglia_id = $1 and ingrediente_id = 'ing:spaghetti' and eliminato_il is null`, [famiglia]);
    expect(prima).toEqual([]); // 500 g in casa bastano per 320 g
    expect((await u.applica(comando('conferma_pasto', famiglia, { id: randomUUID(), portata_id: portata, esito: 'come_previsto' }))).esito).toBe('applicato');
    await u.applica(comando('ricalcola_spesa', famiglia, periodo));
    const dopo = await banco.sql(`select quantita_richiesta::float as q from voce_spesa where famiglia_id = $1 and ingrediente_id = 'ing:spaghetti' and eliminato_il is null`, [famiglia]);
    expect(dopo).toEqual([]);
  });
});

describe('avanzi e correzione della conferma', () => {
  it('rev1 con 2 porzioni avanzate, rev2 con 3: in frigo ce ne sono 3; rev3 «saltato»: nessuna', async () => {
    const { u, famiglia } = await famigliaCon();
    const portata = randomUUID();
    await u.applica(comando('aggiungi_portata', famiglia, { id: portata, data: oggi(), categoria: 'cena', ricetta_id: 'sys:carbonara', porzioni: 4 }));
    const av = (q: number) => [{ lotto_id: randomUUID(), nome: 'Carbonara', quantita: q, luogo: 'frigo' }];
    expect((await u.applica(comando('conferma_pasto', famiglia, { id: randomUUID(), portata_id: portata, esito: 'come_previsto', avanzi: av(2) }))).esito).toBe('applicato');
    expect((await u.applica(comando('conferma_pasto', famiglia, { id: randomUUID(), portata_id: portata, esito: 'come_previsto', revisione_attesa: 1, avanzi: av(3) }))).esito).toBe('applicato');
    expect(await totale(famiglia, 'ing:avanzo')).toBe(3);
    expect((await u.applica(comando('conferma_pasto', famiglia, { id: randomUUID(), portata_id: portata, esito: 'saltato', revisione_attesa: 2 }))).esito).toBe('applicato');
    expect(await totale(famiglia, 'ing:avanzo')).toBe(0);
  });
});

describe('togliere una portata già confermata', () => {
  it('si rifiuta; la conferma resta correggibile e «saltato» restituisce tutto', async () => {
    const { u, famiglia } = await famigliaCon();
    await lotto(u, famiglia, 'ing:spaghetti', 500);
    const portata = randomUUID();
    await u.applica(comando('aggiungi_portata', famiglia, { id: portata, data: oggi(), categoria: 'cena', ricetta_id: 'sys:carbonara', porzioni: 4 }));
    await u.applica(comando('conferma_pasto', famiglia, { id: randomUUID(), portata_id: portata, esito: 'come_previsto' }));
    const r = await u.applica(comando('rimuovi_portata', famiglia, { id: portata }));
    expect(r.esito).toBe('rifiutato');
    expect(r.dettaglio.motivo).toBe('portata_confermata');
    const c = await u.applica(comando('conferma_pasto', famiglia, { id: randomUUID(), portata_id: portata, esito: 'saltato', revisione_attesa: 1 }));
    expect(c.esito).toBe('applicato');
    expect(await totale(famiglia, 'ing:spaghetti')).toBe(500);
    expect((await u.applica(comando('rimuovi_portata', famiglia, { id: portata }))).esito).toBe('applicato');
  });
});

describe('scarico mentre un comando è in corso', () => {
  it('la pulizia degli ospiti aspetta il comando: il cursore non salta la sua riga', async () => {
    const { u, famiglia } = await famigliaCon();
    await banco.sql(`insert into ospiti_pasto (id, famiglia_id, data, categoria, adulti, bambini, oggetti) values ($1, $2, $3, 'cena', 2, 0, '{}')`, [
      randomUUID(),
      famiglia,
      ieri(),
    ]);
    // Ieri sera il telefono ha scaricato tutto, ospiti con le esigenze compresi (qui: si scrivono e si porta il cursore al massimo seq).
    await banco.sql(`update ospiti_pasto set oggetti = '{all:latte}' where famiglia_id = $1`, [famiglia]);
    const [m] = await banco.sql<{ s: string }>(`select max(seq)::text as s from (select seq from ospiti_pasto where famiglia_id = $1 union all select seq from comando where famiglia_id = $1 union all select seq from membro where famiglia_id = $1) x`, [famiglia]);
    let cursore = Number(m.s);

    // Oggi: un altro telefono applica un comando; la sua transazione è ancora aperta (seq già assegnato).
    const portata = randomUUID();
    const client = await banco.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role authenticated');
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: u.id, role: 'authenticated' })]);
      const r = await client.query('select public.applica_comando($1) as e', [
        comando('aggiungi_portata', famiglia, { id: portata, data: domani(), categoria: 'cena', ricetta_id: 'sys:carbonara' }),
      ]);
      expect(r.rows[0].e.esito).toBe('applicato');
      // Intanto questo telefono scarica: la pulizia degli ospiti deve aspettare la fine del comando.
      const scarico = u.scarica(famiglia, cursore);
      await new Promise((r) => setTimeout(r, 200));
      await client.query('commit');
      const p = await scarico;
      expect(p.righe.some((x) => x.tabella === 'ospiti_pasto')).toBe(true);
      expect(p.righe.some((x) => x.tabella === 'portata' && x.riga.id === portata)).toBe(true);
      cursore = p.righe[p.righe.length - 1].seq;
    } finally {
      client.release();
    }
    expect((await u.scarica(famiglia, cursore)).righe).toEqual([]);
  });
});

describe('stesso scontrino letto una volta con il QR e una senza', () => {
  it('è riconosciuto in tutte e due le direzioni: il latte entra una volta', async () => {
    const { u, famiglia } = await famigliaCon();
    const s = (extra: Record<string, unknown>) =>
      comando('importa_scontrino', famiglia, {
        id: randomUUID(),
        acquisto_id: randomUUID(),
        negozio: 'Super',
        data: '2026-11-02',
        ora: '18:30',
        totale: 1.29,
        righe: [{ id: randomUUID(), descrizione: 'LATTE 1L', prezzo: 1.29, nuova: { id: randomUUID(), lotto_id: randomUUID(), ingrediente_id: 'ing:latte', quantita: 1000, unita: 'ml' } }],
        ...extra,
      });
    expect((await u.applica(s({}))).dettaglio).toMatchObject({ nuove: 1 });
    const qr = 'https://ivaservizi.agenziaentrate.gov.it/ser/api/documenti/v1/doc/123';
    expect((await u.applica(s({ qr }))).dettaglio).toHaveProperty('gia_importato');
    expect(await totale(famiglia, 'ing:latte')).toBe(1000);
    // Al contrario: prima con il QR, poi senza.
    const altra = await creaFamiglia(u);
    const t = (extra: Record<string, unknown>) => ({ ...s(extra), famiglia_id: altra.famiglia });
    expect((await u.applica(t({ qr }))).dettaglio).toMatchObject({ nuove: 1 });
    expect((await u.applica(t({}))).dettaglio).toHaveProperty('gia_importato');
    expect(await totale(altra.famiglia, 'ing:latte')).toBe(1000);
    // Un altro scontrino dello stesso negozio e giorno, con un altro totale, entra.
    expect((await u.applica(s({ totale: 3.5 }))).dettaglio).toMatchObject({ nuove: 1 });
  });
});

const totaleDi = async (famiglia: string, ings: string[]) =>
  Number((await banco.sql<{ q: string }>(`select coalesce(sum(quantita),0)::float as q from lotto where famiglia_id = $1 and ingrediente_id = any($2)`, [famiglia, ings]))[0].q);

describe('ricetta salvata dall’editor (manda sempre anche passi vuoti)', () => {
  it('aggiungere un ingrediente con passi vuoti alza la versione', async () => {
    const { u, famiglia } = await famigliaCon();
    const ricetta = randomUUID();
    await u.applica(
      comando('salva_ricetta', famiglia, {
        id: ricetta,
        nuova: true,
        campi: { titolo: 'Insalata', categoria: 'contorno', porzioni: 2 },
        ingredienti: { aggiungi: [{ id: randomUUID(), ingrediente_id: 'ing:pomodoro', quantita: 200, unita: 'g' }] },
        passi: { aggiungi: [{ id: randomUUID(), testo: 'Taglia' }] },
      }),
    );
    const v1 = Number((await banco.sql('select versione from ricetta where id = $1', [ricetta]))[0].versione);
    const m = await u.applica(
      comando('salva_ricetta', famiglia, {
        id: ricetta,
        ingredienti: { aggiungi: [{ id: randomUUID(), ingrediente_id: 'ing:latte', quantita: 50, unita: 'ml' }], modifica: [], rimuovi: [] },
        passi: { aggiungi: [], modifica: [], rimuovi: [] },
      }),
    );
    expect(m.esito).toBe('applicato');
    const v2 = Number((await banco.sql('select versione from ricetta where id = $1', [ricetta]))[0].versione);
    expect(v2).toBe(v1 + 1);
  });
});

describe('scontrini con QR diversi', () => {
  it('stesso negozio, giorno e totale, senza ora: sono due scontrini', async () => {
    const { u, famiglia } = await famigliaCon();
    const s = (qr: string) =>
      comando('importa_scontrino', famiglia, {
        id: randomUUID(),
        acquisto_id: randomUUID(),
        negozio: 'Bar Centrale',
        data: '2026-11-02',
        totale: 1.2,
        qr,
        righe: [{ id: randomUUID(), descrizione: 'LATTE', prezzo: 1.2, nuova: { id: randomUUID(), lotto_id: randomUUID(), ingrediente_id: 'ing:latte', quantita: 500, unita: 'ml' } }],
      });
    expect((await u.applica(s('https://x/doc/111'))).dettaglio).toMatchObject({ nuove: 1 });
    const b = await u.applica(s('https://x/doc/222'));
    expect(b.dettaglio).toMatchObject({ nuove: 1 });
    expect(await totaleDi(famiglia, ['ing:latte'])).toBe(1000);
  });
});

describe('scontrino vecchio e carrello di oggi', () => {
  it('uno scontrino di 10 giorni fa non segna acquistata la voce nel carrello', async () => {
    const { u, famiglia } = await famigliaCon();
    const voce = randomUUID();
    await u.applica(comando('aggiungi_voce', famiglia, { id: voce, ingrediente_id: 'ing:latte', quantita: 2000, unita: 'ml' }));
    await u.applica(comando('imposta_stato_voce', famiglia, { id: voce, stato: 'nel_carrello' }));
    const s = await u.applica(
      comando('importa_scontrino', famiglia, {
        id: randomUUID(),
        acquisto_id: randomUUID(),
        negozio: 'Altro',
        data: giorno(-10),
        ora: '10:00',
        totale: 1.29,
        righe: [{ id: randomUUID(), descrizione: 'LATTE', prezzo: 1.29, nuova: { id: randomUUID(), lotto_id: randomUUID(), ingrediente_id: 'ing:latte', quantita: 1000, unita: 'ml' } }],
      }),
    );
    expect(s.esito).toBe('applicato');
    expect((await banco.sql('select stato from voce_spesa where id = $1', [voce]))[0].stato).toBe('nel_carrello');
    const c = await u.applica(
      comando('conferma_acquisto', famiglia, {
        id: randomUUID(),
        data: giorno(0),
        righe: [{ id: randomUUID(), voce_id: voce, ingrediente_id: 'ing:latte', quantita: 2000, unita: 'ml', lotto_id: randomUUID() }],
      }),
    );
    expect(c.dettaglio).toMatchObject({ righe: 1, lotti: 1 });
    expect(await totaleDi(famiglia, ['ing:latte'])).toBe(3000);
  });
});

describe('scontrino con un ingrediente più specifico della voce', () => {
  it('voce «funghi» nel carrello, scontrino «porcini»: la voce è acquistata e la conferma non ricarica', async () => {
    const { u, famiglia } = await famigliaCon();
    const voce = randomUUID();
    await u.applica(comando('aggiungi_voce', famiglia, { id: voce, ingrediente_id: 'ing:funghi', quantita: 300, unita: 'g' }));
    await u.applica(comando('imposta_stato_voce', famiglia, { id: voce, stato: 'nel_carrello' }));
    await u.applica(
      comando('importa_scontrino', famiglia, {
        id: randomUUID(),
        acquisto_id: randomUUID(),
        negozio: 'Super',
        data: giorno(0),
        ora: '18:00',
        totale: 4.5,
        righe: [{ id: randomUUID(), descrizione: 'PORCINI 300G', prezzo: 4.5, nuova: { id: randomUUID(), lotto_id: randomUUID(), ingrediente_id: 'ing:porcini', quantita: 300, unita: 'g' } }],
      }),
    );
    expect((await banco.sql('select stato from voce_spesa where id = $1', [voce]))[0].stato).toBe('acquistata');
    const c = await u.applica(
      comando('conferma_acquisto', famiglia, {
        id: randomUUID(),
        data: giorno(0),
        righe: [{ id: randomUUID(), voce_id: voce, ingrediente_id: 'ing:funghi', quantita: 300, unita: 'g', lotto_id: randomUUID() }],
      }),
    );
    expect(c.dettaglio).toMatchObject({ lotti: 0, gia_acquistate: [voce] });
    expect(await totaleDi(famiglia, ['ing:funghi', 'ing:porcini'])).toBe(300);
  });
});

describe('correzione degli avanzi dopo che una parte è già stata mangiata', () => {
  it('rev1 3 avanzi, domani se ne mangia 1, rev2 «3 avanzi»: in frigo restano 2; rev3 «4 avanzi»: 3', async () => {
    const { u, famiglia } = await famigliaCon();
    const oggiP = randomUUID();
    const domaniP = randomUUID();
    await u.applica(comando('aggiungi_portata', famiglia, { id: oggiP, data: giorno(0), categoria: 'cena', ricetta_id: 'sys:carbonara', porzioni: 4 }));
    expect((await u.applica(comando('aggiungi_avanzo', famiglia, { id: domaniP, avanzo_di: oggiP, data: giorno(1), categoria: 'pranzo', porzioni: 1 }))).esito).toBe('applicato');
    const av = (q: number) => [{ lotto_id: randomUUID(), nome: 'Carbonara', quantita: q, luogo: 'frigo' }];
    expect((await u.applica(comando('conferma_pasto', famiglia, { id: randomUUID(), portata_id: oggiP, esito: 'come_previsto', avanzi: av(3) }))).esito).toBe('applicato');
    const e = await u.applica(comando('conferma_pasto', famiglia, { id: randomUUID(), portata_id: domaniP, esito: 'come_previsto' }));
    expect(e.esito).toBe('applicato');
    expect(await totaleDi(famiglia, ['ing:avanzo'])).toBe(2);
    expect((await u.applica(comando('conferma_pasto', famiglia, { id: randomUUID(), portata_id: oggiP, esito: 'come_previsto', revisione_attesa: 1, avanzi: av(3) }))).esito).toBe('applicato');
    expect(await totaleDi(famiglia, ['ing:avanzo'])).toBe(2);
    expect((await u.applica(comando('conferma_pasto', famiglia, { id: randomUUID(), portata_id: oggiP, esito: 'come_previsto', revisione_attesa: 2, avanzi: av(4) }))).esito).toBe('applicato');
    expect(await totaleDi(famiglia, ['ing:avanzo'])).toBe(3);
  });
});
