/**
 * T-DAT-1/3: esporta → ripristina in una famiglia nuova → riesporta: stesso contenuto.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { componiFile, type FileEsportazione } from '../../src/dati/esportazione';
import type { RigaScaricata } from '../../src/dati/tipi';
import { type Banco, comando, creaFamiglia, nuovoBanco, type Utente } from './banco';

let banco: Banco;
beforeAll(async () => {
  banco = await nuovoBanco();
});
afterAll(async () => {
  await banco.chiudi();
});

async function esporta(u: Utente, famiglia: string): Promise<FileEsportazione> {
  const righe: RigaScaricata[] = [];
  let dopo = 0;
  for (;;) {
    const p = await u.scarica(famiglia, dopo, 3);
    righe.push(...(p.righe as RigaScaricata[]));
    if (p.righe.length) dopo = p.righe[p.righe.length - 1].seq;
    if (!p.altre) break;
  }
  return componiFile(righe, new Date());
}

/** Contenuto confrontabile: senza id, tempi, versioni e autori, con i riferimenti tradotti in nomi. */
function contenuto(f: FileEsportazione) {
  const nomi = new Map(f.tabelle.membro.map((m) => [m.id, m.nome]));
  return {
    famiglia: f.tabelle.famiglia.map((x) => ({ nome: x.nome, impostazioni: x.impostazioni })),
    membri: f.tabelle.membro
      .map((m) => ({ nome: m.nome, emoji: m.emoji, porzione: m.porzione, note: m.note, archiviato: m.archiviato, collegato: m.utente_id !== null }))
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome))),
    vincoli: f.tabelle.vincolo_alimentare
      .map((v) => ({ membro: nomi.get(String(v.membro_id)), tipo: v.tipo, oggetto: v.oggetto, severita: v.severita, fonte: v.fonte, testo: v.testo }))
      .sort((a, b) => `${a.membro}${a.oggetto}`.localeCompare(`${b.membro}${b.oggetto}`)),
  };
}

async function famigliaCompleta() {
  const u = await banco.utente();
  const { famiglia, membro } = await creaFamiglia(u, 'Casa Originale');
  const sara = randomUUID();
  await u.applica(comando('aggiungi_membro', famiglia, { id: sara, nome: 'Sara', emoji: '👧', porzione: 0.6, note: 'Mangia poco la sera' }));
  await u.applica(comando('aggiungi_vincolo', famiglia, { id: randomUUID(), membro_id: sara, tipo: 'allergia', oggetto: 'all:arachidi', severita: 'evitare_anche_tracce' }));
  await u.applica(comando('aggiungi_vincolo', famiglia, { id: randomUUID(), membro_id: membro, tipo: 'indicazione_medica', oggetto: 'txt:poco_sale', fonte: 'medico', testo: 'Poco sale' }));
  const tolto = randomUUID();
  await u.applica(comando('aggiungi_vincolo', famiglia, { id: tolto, membro_id: membro, tipo: 'esigenza', oggetto: 'cls:vegetariano' }));
  await u.applica(comando('rimuovi_vincolo', famiglia, { id: tolto }));
  return { u, famiglia };
}

describe('esportazione e ripristino', () => {
  it('esporta → ripristina in una famiglia nuova → riesporta: il contenuto coincide', async () => {
    const { u, famiglia } = await famigliaCompleta();
    const file = await esporta(u, famiglia);
    expect(file.conteggi).toMatchObject({ famiglia: 1, membro: 2, vincolo_alimentare: 2 });

    const nuova = randomUUID();
    const e = await u.applica(comando('ripristina_famiglia', nuova, { file: JSON.parse(JSON.stringify(file)) }));
    expect(e).toMatchObject({ esito: 'applicato', dettaglio: { membri: 2, vincoli: 2, ricette: 0, lotti: 0 } });

    const ripristinato = await esporta(u, nuova);
    expect(contenuto(ripristinato)).toEqual(contenuto(file));
    // Gli id sono nuovi: l'originale resta intatto e indipendente.
    const vecchi = new Set(file.tabelle.membro.map((m) => m.id));
    expect(ripristinato.tabelle.membro.some((m) => vecchi.has(m.id))).toBe(false);
    expect(contenuto(await esporta(u, famiglia))).toEqual(contenuto(file));
  });

  it('chi ripristina un file di un’altra persona diventa amministratore e ha il suo profilo', async () => {
    const { u, famiglia } = await famigliaCompleta();
    const file = await esporta(u, famiglia);
    const altro = await banco.utente();
    const nuova = randomUUID();
    const e = await altro.applica(comando('ripristina_famiglia', nuova, { file, nome_utente: 'Marco' }));
    expect(e.esito).toBe('applicato');
    const [ruolo] = await altro.sql('select ruolo from utente_famiglia where famiglia_id = $1 and utente_id = $2', [nuova, altro.id]);
    expect(ruolo.ruolo).toBe('amministratore');
    const membri = await altro.sql('select nome, utente_id from membro where famiglia_id = $1 order by nome', [nuova]);
    expect(membri.map((m) => [m.nome, m.utente_id === altro.id])).toEqual([
      ['Luca', false],
      ['Marco', true],
      ['Sara', false],
    ]);
  });

  it('un file non valido o manomesso non scrive nulla', async () => {
    const { u, famiglia } = await famigliaCompleta();
    const file = await esporta(u, famiglia);
    const casi: [unknown, string][] = [
      [{ ...file, formato: 'altro' }, 'file_non_riconosciuto'],
      [{ ...file, versione_schema: 99 }, 'versione_file_non_supportata'],
      [{ ...file, tabelle: { ...file.tabelle, lotto: undefined } }, 'file_incompleto'],
      [{ ...file, tabelle: { ...file.tabelle, membro: undefined } }, 'file_incompleto'],
      [{ ...file, tabelle: { ...file.tabelle, membro: [{ ...file.tabelle.membro[0], porzione: 9 }] } }, 'dati_non_validi'],
      [{ ...file, tabelle: { ...file.tabelle, membro: [{ ...file.tabelle.membro[0], famiglia_id: randomUUID() }] } }, 'file_incoerente'],
    ];
    for (const [f, motivo] of casi) {
      const nuova = randomUUID();
      const e = await u.applica(comando('ripristina_famiglia', nuova, { file: f }));
      expect(e.dettaglio.motivo).toBe(motivo);
      expect((await banco.sql('select count(*)::int as n from famiglia where id = $1', [nuova]))[0].n).toBe(0);
    }
  });

  it('ripetere lo stesso ripristino non crea una seconda famiglia', async () => {
    const { u, famiglia } = await famigliaCompleta();
    const file = await esporta(u, famiglia);
    const c = comando('ripristina_famiglia', randomUUID(), { file });
    await u.applica(c);
    expect(await u.applica(c)).toMatchObject({ esito: 'applicato', ripetuto: true });
    expect((await banco.sql('select count(*)::int as n from membro where famiglia_id = $1', [c.famiglia_id]))[0].n).toBe(2);
  });
});

describe('esportazione e ripristino con ricette e casa (versione 2)', () => {
  /** Ricette e casa confrontabili senza id: ingredienti e lotti per nome, quantità dai movimenti. */
  function ricetteECasa(f: FileEsportazione) {
    const ingredienti = new Map(f.tabelle.ingrediente.map((i) => [i.id, i.nome]));
    const nomeIng = (id: unknown) => (String(id).startsWith('ing:') ? String(id) : `famiglia:${ingredienti.get(String(id))}`);
    const titoli = new Map(f.tabelle.ricetta.map((r) => [r.id, r.titolo]));
    const nomeRic = (id: unknown) => (id == null ? null : String(id).startsWith('sys:') ? String(id) : `famiglia:${titoli.get(String(id))}`);
    const lotti = new Map(f.tabelle.lotto.map((l) => [l.id, `${l.nome}@${l.luogo}`]));
    return {
      ingredienti: f.tabelle.ingrediente.map((i) => ({ nome: i.nome, dimensione: i.dimensione, allergeni_noti: i.allergeni_noti })),
      ricette: f.tabelle.ricetta
        .map((r) => ({
          titolo: r.titolo,
          derivata_da: nomeRic(r.derivata_da),
          archiviata: r.archiviata,
          righe: f.tabelle.ricetta_ingrediente
            .filter((g) => g.ricetta_id === r.id)
            .map((g) => ({ ing: nomeIng(g.ingrediente_id), quantita: g.quantita, unita: g.unita, qb: g.qb }))
            .sort((a, b) => a.ing.localeCompare(b.ing)),
          passi: f.tabelle.ricetta_passo
            .filter((p) => p.ricetta_id === r.id)
            .map((p) => p.testo)
            .sort(),
        }))
        .sort((a, b) => String(a.titolo).localeCompare(String(b.titolo))),
      lotti: f.tabelle.lotto
        .map((l) => ({ nome: l.nome, ing: nomeIng(l.ingrediente_id), quantita: Number(l.quantita), luogo: l.luogo, data: l.data_limite, tipo: l.tipo_data, fonte: l.fonte_data }))
        .sort((a, b) => `${a.nome}${a.luogo}`.localeCompare(`${b.nome}${b.luogo}`)),
      movimenti: f.tabelle.movimento.map((m) => `${lotti.get(String(m.lotto_id))} ${m.causale} ${Number(m.variazione)}`).sort(),
    };
  }

  it('ricette, ingredienti della famiglia, lotti e movimenti tornano uguali', async () => {
    const { u, famiglia } = await famigliaCompleta();
    const kefir = randomUUID();
    await u.applica(comando('crea_ingrediente', famiglia, { id: kefir, nome: 'Kefir', dimensione: 'volume', reparto: 'latticini' }));
    const ricetta = randomUUID();
    await u.applica(
      comando('salva_ricetta', famiglia, {
        id: ricetta,
        nuova: true,
        campi: { titolo: 'Carbonara di casa', categoria: 'primo', porzioni: 4, derivata_da: 'sys:carbonara' },
        ingredienti: {
          aggiungi: [
            { id: randomUUID(), ingrediente_id: 'ing:spaghetti', quantita: 360, unita: 'g' },
            { id: randomUUID(), ingrediente_id: 'ing:pepe', quantita: null, unita: 'g', qb: true },
            { id: randomUUID(), ingrediente_id: kefir, quantita: 50, unita: 'ml', opzionale: true },
          ],
        },
        passi: { aggiungi: [{ id: randomUUID(), ordine: 1, testo: 'Come la classica, con più pasta.' }] },
      }),
    );
    const latte = randomUUID();
    await u.applica(comando('aggiungi_lotto', famiglia, { id: latte, ingrediente_id: 'ing:latte', nome: 'Latte', quantita: 1000, unita: 'ml', luogo: 'frigo', data_limite: '2026-11-03', tipo_data: 'scadenza', fonte_data: 'confezione' }));
    await u.applica(comando('scarica_lotto', famiglia, { lotto_id: latte, causale: 'consumo', quantita: 300 }));
    await u.applica(comando('scarica_lotto', famiglia, { lotto_id: latte, causale: 'spreco', quantita: 700 }));
    const carne = randomUUID();
    await u.applica(comando('aggiungi_lotto', famiglia, { id: carne, ingrediente_id: 'ing:manzo', nome: 'Fettine', quantita: 600, unita: 'g', luogo: 'frigo', tipo_data: 'sconosciuta' }));
    await u.applica(comando('sposta_lotto', famiglia, { lotto_id: carne, luogo: 'freezer', quantita: 200, nuovo_id: randomUUID() }));

    const file = await esporta(u, famiglia);
    expect(file.versione_schema).toBe(5);
    expect(file.conteggi).toMatchObject({ ingrediente: 1, ricetta: 1, ricetta_ingrediente: 3, ricetta_passo: 1, lotto: 3, movimento: 6 });

    const nuova = randomUUID();
    const e = await u.applica(comando('ripristina_famiglia', nuova, { file: JSON.parse(JSON.stringify(file)) }));
    expect(e).toMatchObject({ esito: 'applicato', dettaglio: { ingredienti: 1, ricette: 1, lotti: 3, movimenti: 6 } });
    const ripristinato = await esporta(u, nuova);
    expect(ricetteECasa(ripristinato)).toEqual(ricetteECasa(file));
    expect(contenuto(ripristinato)).toEqual(contenuto(file));
  });

  it('un file della versione 1 si ripristina ancora', async () => {
    const { u, famiglia } = await famigliaCompleta();
    const file = await esporta(u, famiglia);
    const v1 = {
      formato: file.formato,
      versione_schema: 1,
      esportato_il: file.esportato_il,
      tabelle: { famiglia: file.tabelle.famiglia, membro: file.tabelle.membro, vincolo_alimentare: file.tabelle.vincolo_alimentare },
      conteggi: { famiglia: 1, membro: 2, vincolo_alimentare: 2 },
    };
    const e = await u.applica(comando('ripristina_famiglia', randomUUID(), { file: v1 }));
    expect(e).toMatchObject({ esito: 'applicato', dettaglio: { membri: 2, vincoli: 2 } });
  });
});

describe('esportazione e ripristino del menu (versione 3)', () => {
  /** Menu confrontabile senza id: categorie per nome, persone per nome, ricette per titolo. */
  function menu(f: FileEsportazione) {
    const persone = new Map(f.tabelle.membro.map((m) => [m.id, m.nome]));
    const titoli = new Map(f.tabelle.ricetta.map((r) => [r.id, r.titolo]));
    const ric = (id: unknown) => (id == null ? null : String(id).startsWith('sys:') ? String(id) : `famiglia:${titoli.get(String(id))}`);
    const categorie = new Map(f.tabelle.categoria_pasto.map((c) => [c.id, c.chiave ?? `famiglia:${c.nome}`]));
    const cat = (c: unknown) => categorie.get(String(c)) ?? String(c);
    const portate = new Map(f.tabelle.portata.map((p) => [p.id, `${p.data} ${cat(p.categoria)} ${ric(p.ricetta_id) ?? p.testo}`]));
    return {
      categorie: f.tabelle.categoria_pasto.map((c) => `${c.chiave ?? c.nome} ${c.emoji ?? ''} ${c.attiva}`).sort(),
      portate: f.tabelle.portata
        .map((p) => ({ cosa: portate.get(p.id), porzioni: p.porzioni, origine: p.origine, bloccata: p.bloccata, note: p.note }))
        .sort((a, b) => String(a.cosa).localeCompare(String(b.cosa))),
      eccezioni: f.tabelle.eccezione_membro.map((e) => `${portate.get(String(e.portata_id))} ${persone.get(String(e.membro_id))} ${e.tipo} ${ric(e.ricetta_id) ?? e.testo}`).sort(),
      gusti: f.tabelle.gusto.map((g) => `${persone.get(String(g.membro_id))} ${g.ingrediente_id ?? ric(g.ricetta_id)} ${g.valore}`).sort(),
    };
  }

  it('categorie, portate, eccezioni e gusti tornano uguali; le portate tolte restano tolte', async () => {
    const { u, famiglia } = await famigliaCompleta();
    const sara = String((await banco.sql("select id from membro where famiglia_id = $1 and nome = 'Sara'", [famiglia]))[0].id);
    const torta = randomUUID();
    await u.applica(
      comando('salva_ricetta', famiglia, {
        id: torta,
        nuova: true,
        campi: { titolo: 'Torta della domenica', categoria: 'dolce', porzioni: 8 },
        ingredienti: { aggiungi: [{ id: randomUUID(), ingrediente_id: 'ing:mela', quantita: 500, unita: 'g' }] },
        passi: { aggiungi: [{ id: randomUUID(), ordine: 1, testo: 'Cuoci.' }] },
      }),
    );
    await u.applica(comando('imposta_categoria', famiglia, { chiave: 'merenda', attiva: true }));
    const brunch = randomUUID();
    await u.applica(comando('crea_categoria', famiglia, { id: brunch, nome: 'Brunch', emoji: '🥞' }));
    const cena = randomUUID();
    await u.applica(comando('aggiungi_portata', famiglia, { id: cena, data: '2026-11-03', categoria: 'cena', ricetta_id: 'sys:carbonara', porzioni: 3, note: 'Poco pepe' }));
    await u.applica(comando('aggiungi_portata', famiglia, { id: randomUUID(), data: '2026-11-08', categoria: brunch, ricetta_id: torta }));
    await u.applica(comando('aggiungi_portata', famiglia, { id: randomUUID(), data: '2026-11-04', categoria: 'merenda', testo: 'Frutta' }));
    const tolta = randomUUID();
    await u.applica(comando('aggiungi_portata', famiglia, { id: tolta, data: '2026-11-05', categoria: 'pranzo', testo: 'Avanzi' }));
    await u.applica(comando('rimuovi_portata', famiglia, { id: tolta }));
    await u.applica(comando('modifica_portata', famiglia, { id: cena, versione_attesa: 1, campi: { bloccata: true } }));
    await u.applica(comando('imposta_eccezione', famiglia, { id: randomUUID(), portata_id: cena, membro_id: sara, tipo: 'alternativa', ricetta_id: torta }));
    await u.applica(comando('imposta_gusto', famiglia, { id: randomUUID(), membro_id: sara, ingrediente_id: 'ing:zucchina', valore: 'non_piace' }));
    await u.applica(comando('imposta_gusto', famiglia, { id: randomUUID(), membro_id: sara, ricetta_id: torta, valore: 'piace' }));

    const file = await esporta(u, famiglia);
    expect(file.conteggi).toMatchObject({ categoria_pasto: 2, portata: 3, eccezione_membro: 1, gusto: 2 });
    const nuova = randomUUID();
    const e = await u.applica(comando('ripristina_famiglia', nuova, { file: JSON.parse(JSON.stringify(file)) }));
    expect(e).toMatchObject({ esito: 'applicato', dettaglio: { portate: 3 } });
    const ripristinato = await esporta(u, nuova);
    const vivi = (f: FileEsportazione): FileEsportazione => ({
      ...f,
      tabelle: Object.fromEntries(Object.entries(f.tabelle).map(([t, r]) => [t, r.filter((x) => x.eliminato_il == null)])) as FileEsportazione['tabelle'],
    });
    expect(menu(ripristinato)).toEqual(menu(vivi(file)));
    // Dopo il ripristino si continua a usare il menu come prima.
    expect((await u.applica(comando('imposta_categoria', nuova, { chiave: 'merenda', attiva: false }))).esito).toBe('applicato');
  });
});

describe('esportazione e ripristino di spesa e acquisti (versione 4)', () => {
  it('lista, acquisti e righe tornano uguali e restano legati ai lotti; un file della versione 3 si ripristina ancora', async () => {
    const { u, famiglia } = await famigliaCompleta();
    await u.applica(comando('aggiungi_voce', famiglia, { id: randomUUID(), testo: 'Detersivo', nota: 'quello verde' }));
    const voce = randomUUID();
    await u.applica(comando('aggiungi_voce', famiglia, { id: voce, ingrediente_id: 'ing:latte', quantita: 1000, unita: 'ml' }));
    const riga = randomUUID();
    await u.applica(
      comando('conferma_acquisto', famiglia, {
        id: randomUUID(),
        data: '2026-11-02',
        negozio: 'Mercato',
        righe: [
          { id: riga, voce_id: voce, ingrediente_id: 'ing:latte', quantita: 1000, unita: 'ml', prezzo: 1.29, lotto_id: randomUUID(), luogo: 'frigo' },
          { id: randomUUID(), nome: 'Pile', prezzo: 4 },
        ],
      }),
    );
    await u.applica(comando('correggi_riga_acquisto', famiglia, { id: riga, quantita_vista: 1000, quantita_nuova: 500 }));

    const file = await esporta(u, famiglia);
    expect(file.versione_schema).toBe(5);
    expect(file.conteggi).toMatchObject({ voce_spesa: 2, acquisto: 1, acquisto_riga: 2 });
    const nuova = randomUUID();
    expect(await u.applica(comando('ripristina_famiglia', nuova, { file: JSON.parse(JSON.stringify(file)) }))).toMatchObject({
      esito: 'applicato',
      dettaglio: { acquisti: 1 },
    });
    const spesa = async (f: string) =>
      banco.sql(
        `select coalesce(v.ingrediente_id, v.testo) as voce, v.stato, v.nota,
                (select string_agg(coalesce(r.ingrediente_id, r.nome) || ' ' || coalesce(r.quantita::text, '-') || ' ' || r.prezzo::text
                                   || ' ' || coalesce(l.quantita::text, 'nessun lotto'), ', ' order by r.nome)
                   from acquisto_riga r left join lotto l on l.id = r.lotto_id where r.famiglia_id = $1) as righe
           from voce_spesa v where v.famiglia_id = $1 order by coalesce(v.ingrediente_id, v.testo) collate "C"`,
        [f],
      );
    expect(await spesa(nuova)).toEqual(await spesa(famiglia));
    expect((await spesa(nuova))[1].righe).toBe('Pile - 4.00 nessun lotto, ing:latte 500 1.29 500');

    const v3 = JSON.parse(JSON.stringify(file));
    v3.versione_schema = 3;
    for (const t of ['voce_spesa', 'acquisto', 'acquisto_riga']) {
      delete v3.tabelle[t];
      delete v3.conteggi[t];
    }
    expect((await u.applica(comando('ripristina_famiglia', randomUUID(), { file: v3 }))).esito).toBe('applicato');
    const rotto = JSON.parse(JSON.stringify(file));
    delete rotto.tabelle.acquisto;
    expect((await u.applica(comando('ripristina_famiglia', randomUUID(), { file: rotto }))).dettaglio.motivo).toBe('file_incompleto');
  });
});

describe('esportazione e ripristino di scontrini e prodotti (versione 5)', () => {
  it('scontrino, righe e prodotti tornano uguali e restano legati agli acquisti; un file della versione 4 si ripristina ancora', async () => {
    const { u, famiglia } = await famigliaCompleta();
    await u.applica(comando('salva_prodotto', famiglia, { id: randomUUID(), codice: '8001234567890', ingrediente_id: 'ing:latte', nome: 'Latte intero', quantita: 1000, unita: 'ml' }));
    await u.applica(
      comando('importa_scontrino', famiglia, {
        id: randomUUID(),
        acquisto_id: randomUUID(),
        negozio: 'Supermercato',
        data: '2026-11-02',
        ora: '18:30',
        totale: 3.79,
        testo: 'SUPERMERCATO\nLATTE INTERO 1L 1,29',
        righe: [
          { id: randomUUID(), descrizione: 'LATTE INTERO 1L', prezzo: 1.29, nuova: { id: randomUUID(), lotto_id: randomUUID(), ingrediente_id: 'ing:latte', quantita: 1000, unita: 'ml', luogo: 'frigo' } },
          { id: randomUUID(), descrizione: 'SACCHETTO', prezzo: 0.1 },
          { id: randomUUID(), descrizione: 'PILE AA', prezzo: 2.4, nuova: { id: randomUUID() } },
        ],
      }),
    );
    const file = await esporta(u, famiglia);
    expect(file.versione_schema).toBe(5);
    expect(file.conteggi).toMatchObject({ prodotto: 1, scontrino: 1, scontrino_riga: 3, acquisto: 1, acquisto_riga: 2 });
    const nuova = randomUUID();
    expect((await u.applica(comando('ripristina_famiglia', nuova, { file: JSON.parse(JSON.stringify(file)) }))).esito).toBe('applicato');
    const scontrini = async (f: string) =>
      banco.sql(
        `select s.negozio, s.data::text, s.ora, s.testo, s.totale::text, s.impronta, a.fonte,
                (select string_agg(sr.descrizione || ' ' || coalesce(sr.prezzo::text, '-') || ' ' || coalesce(ar.ingrediente_id, ar.nome, 'solo scontrino'), ', ' order by sr.descrizione)
                   from scontrino_riga sr left join acquisto_riga ar on ar.id = sr.acquisto_riga_id where sr.scontrino_id = s.id) as righe,
                (select string_agg(p.codice || ' ' || p.ingrediente_id, ', ') from prodotto p where p.famiglia_id = $1) as prodotti
           from scontrino s join acquisto a on a.id = s.acquisto_id and a.scontrino_id = s.id where s.famiglia_id = $1`,
        [f],
      );
    expect(await scontrini(nuova)).toEqual(await scontrini(famiglia));
    expect((await scontrini(nuova))[0].righe).toBe('LATTE INTERO 1L 1.29 ing:latte, PILE AA 2.40 PILE AA, SACCHETTO 0.10 solo scontrino');

    const v4 = JSON.parse(JSON.stringify(file));
    v4.versione_schema = 4;
    for (const t of ['prodotto', 'scontrino', 'scontrino_riga']) {
      delete v4.tabelle[t];
      delete v4.conteggi[t];
    }
    expect((await u.applica(comando('ripristina_famiglia', randomUUID(), { file: v4 }))).esito).toBe('applicato');
    const rotto = JSON.parse(JSON.stringify(file));
    delete rotto.tabelle.scontrino;
    expect((await u.applica(comando('ripristina_famiglia', randomUUID(), { file: rotto }))).dettaglio.motivo).toBe('file_incompleto');
  });
});
