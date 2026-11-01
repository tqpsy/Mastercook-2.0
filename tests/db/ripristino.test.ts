/**
 * T-DAT-1/3: esporta → ripristina in una famiglia nuova → riesporta: stesso contenuto.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import catalogo from '../../src/catalogo/catalogo.json';
import type { Catalogo } from '../../src/catalogo/tipi';
import { componiFile, type FileEsportazione } from '../../src/dati/esportazione';
import { convertiVecchio, leggiVecchio } from '../../src/dati/migrazione';
import type { RigaScaricata } from '../../src/dati/tipi';
import { fileVecchio } from '../vecchio-esempio';
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
    expect(file.versione_schema).toBe(10);
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
    expect(file.versione_schema).toBe(10);
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
    expect(file.versione_schema).toBe(10);
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

describe('esportazione e ripristino dei consumi (versione 6)', () => {
  it('conferme con le revisioni, consumi e avanzi tornano uguali; un file della versione 5 si ripristina ancora', async () => {
    const { u, famiglia } = await famigliaCompleta();
    const lotto = randomUUID();
    await u.applica(comando('aggiungi_lotto', famiglia, { id: lotto, ingrediente_id: 'ing:spaghetti', quantita: 500, unita: 'g', luogo: 'dispensa', tipo_data: 'sconosciuta' }));
    const portata = randomUUID();
    await u.applica(comando('aggiungi_portata', famiglia, { id: portata, data: '2026-11-03', categoria: 'cena', ricetta_id: 'sys:carbonara', porzioni: 4 }));
    await u.applica(
      comando('conferma_pasto', famiglia, {
        id: randomUUID(),
        portata_id: portata,
        esito: 'come_previsto',
        avanzi: [{ lotto_id: randomUUID(), nome: 'Carbonara', quantita: 1, luogo: 'frigo', tipo_data: 'sconosciuta' }],
      }),
    );
    await u.applica(
      comando('conferma_pasto', famiglia, {
        id: randomUUID(),
        portata_id: portata,
        esito: 'quantita_diverse',
        revisione_attesa: 1,
        righe: [{ ingrediente_id: 'ing:spaghetti', unita: 'g', quantita: 200 }],
      }),
    );
    const file = await esporta(u, famiglia);
    expect(file.versione_schema).toBe(10);
    expect(file.conteggi).toMatchObject({ conferma_pasto: 2 });
    const nuova = randomUUID();
    expect((await u.applica(comando('ripristina_famiglia', nuova, { file: JSON.parse(JSON.stringify(file)) }))).esito).toBe('applicato');
    const consumi = async (f: string) =>
      banco.sql(
        `select c.revisione, c.esito, c.attiva,
                (select string_agg(r.ingrediente_id || ' ' || r.quantita_prevista::text || '→' || r.quantita_usata::text, ', ' order by r.ingrediente_id collate "C")
                   from consumo_riga r where r.conferma_id = c.id) as righe,
                (select sum(l.quantita)::text from consumo_lotto l where l.conferma_id = c.id) as preso,
                (select string_agg(a.nome || ' ' || a.quantita::text, ', ') from lotto a where a.conferma_id = c.id) as avanzi,
                (select string_agg(l.ingrediente_id || ' ' || l.quantita::text, ', ' order by l.ingrediente_id collate "C") from lotto l where l.famiglia_id = $1) as casa
           from conferma_pasto c where c.famiglia_id = $1 order by c.revisione`,
        [f],
      );
    expect(await consumi(nuova)).toEqual(await consumi(famiglia));
    expect((await consumi(nuova))[1]).toMatchObject({ attiva: true, preso: '-120', casa: 'ing:avanzo 1, ing:spaghetti 300' });

    const v6 = JSON.parse(JSON.stringify(file));
    v6.versione_schema = 6;
    for (const t of ['icona_ricetta', 'ricetta_verificata', 'pasto_fisso']) {
      delete v6.tabelle[t];
      delete v6.conteggi[t];
    }
    expect((await u.applica(comando('ripristina_famiglia', randomUUID(), { file: v6 }))).esito).toBe('applicato');

    const v5 = JSON.parse(JSON.stringify(v6));
    v5.versione_schema = 5;
    for (const t of ['conferma_pasto', 'consumo_riga', 'consumo_lotto']) {
      delete v5.tabelle[t];
      delete v5.conteggi[t];
    }
    expect((await u.applica(comando('ripristina_famiglia', randomUUID(), { file: v5 }))).esito).toBe('applicato');
  });
});

describe('esportazione e ripristino delle icone (versione 7)', () => {
  it('l’icona scelta per una ricetta di Mastercook torna uguale', async () => {
    const { u, famiglia } = await famigliaCompleta();
    await u.applica(comando('scegli_icona', famiglia, { id: randomUUID(), ricetta_id: 'sys:riso_basmati_spezie', emoji: '🍛' }));
    const file = await esporta(u, famiglia);
    expect(file.conteggi).toMatchObject({ icona_ricetta: 1 });
    const nuova = randomUUID();
    expect((await u.applica(comando('ripristina_famiglia', nuova, { file: JSON.parse(JSON.stringify(file)) }))).esito).toBe('applicato');
    expect(await banco.sql(`select ricetta_id, emoji from icona_ricetta where famiglia_id = $1 and eliminato_il is null`, [nuova])).toEqual([
      { ricetta_id: 'sys:riso_basmati_spezie', emoji: '🍛' },
    ]);
  });
});

describe('esportazione e ripristino dei «va bene» (versione 8)', () => {
  it('il «va bene» di una ricetta di Mastercook torna per lo stesso membro; un file della versione 7 si ripristina ancora', async () => {
    const { u, famiglia } = await famigliaCompleta();
    const [m] = await banco.sql<{ id: string; nome: string }>(`select id, nome from membro where famiglia_id = $1 order by nome limit 1`, [famiglia]);
    await u.applica(comando('verifica_ricetta', famiglia, { id: randomUUID(), membro_id: m.id, ricetta_id: 'sys:carbonara', versione_ricetta: 1, va_bene: true }));
    const file = await esporta(u, famiglia);
    expect(file.conteggi).toMatchObject({ ricetta_verificata: 1 });
    const nuova = randomUUID();
    expect((await u.applica(comando('ripristina_famiglia', nuova, { file: JSON.parse(JSON.stringify(file)) }))).esito).toBe('applicato');
    expect(
      await banco.sql(`select m.nome, v.ricetta_id, v.versione_ricetta from ricetta_verificata v join membro m on m.id = v.membro_id where v.famiglia_id = $1`, [nuova]),
    ).toEqual([{ nome: m.nome, ricetta_id: 'sys:carbonara', versione_ricetta: 1 }]);

    // Il «non va bene» torna com'era.
    await u.applica(comando('verifica_ricetta', famiglia, { id: randomUUID(), membro_id: m.id, ricetta_id: 'sys:carbonara', versione_ricetta: 1, va_bene: false, scelta: 'non_va_bene' }));
    const conNo = await esporta(u, famiglia);
    const altra = randomUUID();
    expect((await u.applica(comando('ripristina_famiglia', altra, { file: JSON.parse(JSON.stringify(conNo)) }))).esito).toBe('applicato');
    expect(await banco.sql(`select va_bene from ricetta_verificata where famiglia_id = $1 and eliminato_il is null`, [altra])).toEqual([{ va_bene: false }]);

    const v7 = JSON.parse(JSON.stringify(file));
    v7.versione_schema = 7;
    for (const t of ['ricetta_verificata', 'pasto_fisso']) {
      delete v7.tabelle[t];
      delete v7.conteggi[t];
    }
    expect((await u.applica(comando('ripristina_famiglia', randomUUID(), { file: v7 }))).esito).toBe('applicato');
  });
});

describe('esportazione e ripristino dei pasti fissi (versione 9)', () => {
  it('la regola torna con i suoi giorni legati e non si duplicano prolungando; un file della versione 8 si ripristina ancora', async () => {
    const { u, famiglia } = await famigliaCompleta();
    const [{ d: oggi }] = await banco.sql<{ d: string }>(`select current_date::text as d`);
    await u.applica(comando('fissa_pasto', famiglia, { id: randomUUID(), categoria: 'colazione', testo: 'Latte', dal: oggi, fino_a: oggi }));
    const file = await esporta(u, famiglia);
    expect(file.conteggi).toMatchObject({ pasto_fisso: 1 });
    const nuova = randomUUID();
    expect((await u.applica(comando('ripristina_famiglia', nuova, { file: JSON.parse(JSON.stringify(file)) }))).esito).toBe('applicato');
    await u.applica(comando('prolunga_pasti_fissi', nuova, { fino_a: oggi }));
    expect(
      await banco.sql(`select p.testo, f.testo as regola from portata p join pasto_fisso f on f.id = p.fisso_id where p.famiglia_id = $1 and p.eliminato_il is null`, [nuova]),
    ).toEqual([{ testo: 'Latte', regola: 'Latte' }]);

    const v8 = JSON.parse(JSON.stringify(file));
    v8.versione_schema = 8;
    delete v8.tabelle.pasto_fisso;
    delete v8.conteggi.pasto_fisso;
    expect((await u.applica(comando('ripristina_famiglia', randomUUID(), { file: v8 }))).esito).toBe('applicato');
  });
});

describe('esportazione e ripristino dei piatti che durano più giorni (versione 10)', () => {
  it('l’avanzo torna legato al suo piatto; un file della versione 9 si ripristina ancora', async () => {
    const { u, famiglia } = await famigliaCompleta();
    const torta = randomUUID();
    await u.applica(comando('aggiungi_portata', famiglia, { id: torta, data: '2026-11-08', categoria: 'merenda', ricetta_id: 'sys:carbonara' }));
    await u.applica(comando('aggiungi_avanzo', famiglia, { id: randomUUID(), avanzo_di: torta, data: '2026-11-09', categoria: 'colazione' }));
    const file = await esporta(u, famiglia);
    expect(file.versione_schema).toBe(10);
    const nuova = randomUUID();
    expect((await u.applica(comando('ripristina_famiglia', nuova, { file: JSON.parse(JSON.stringify(file)) }))).esito).toBe('applicato');
    expect(
      await banco.sql(
        `select a.data::text as giorno, o.data::text as cucinato from portata a join portata o on o.id = a.avanzo_di where a.famiglia_id = $1 and a.eliminato_il is null`,
        [nuova],
      ),
    ).toEqual([{ giorno: '2026-11-09', cucinato: '2026-11-08' }]);

    const v9 = JSON.parse(JSON.stringify(file));
    v9.versione_schema = 9;
    for (const p of v9.tabelle.portata) delete p.avanzo_di;
    expect((await u.applica(comando('ripristina_famiglia', randomUUID(), { file: v9 }))).esito).toBe('applicato');
  });
});

describe('importazione dal vecchio Mastercook (Fase 7)', () => {
  it('il file convertito entra in una famiglia nuova con persone, vincoli, ricette, casa, menu e gusti', async () => {
    const u = await banco.utente();
    const l = leggiVecchio(fileVecchio());
    if (!l.valido) throw new Error(l.motivo);
    const { file, rapporto } = convertiVecchio(l.file, catalogo as Catalogo, { io: 'm1', utente_id: u.id, oggi: '2026-10-27', adesso: new Date() });
    const nuova = randomUUID();
    const e = await u.applica(comando('ripristina_famiglia', nuova, { file: JSON.parse(JSON.stringify(file)), nome: rapporto.nome }));
    expect(e).toMatchObject({ esito: 'applicato', dettaglio: { membri: 2, vincoli: 5, ricette: 1, lotti: 4, portate: 3 } });

    // Chi importa è «Luca» del vecchio, non un profilo in più.
    const membri = await u.sql('select nome, porzione::float as porzione, utente_id from membro where famiglia_id = $1 order by nome', [nuova]);
    expect(membri.map((m) => [m.nome, m.porzione, m.utente_id === u.id])).toEqual([
      ['Luca', 1, true],
      ['Sara', 0.6, false],
    ]);
    const lotti = await u.sql('select nome, ingrediente_id, quantita::float as quantita, tipo_data, data_limite::text from lotto where famiglia_id = $1 order by nome', [nuova]);
    expect(lotti.find((x) => x.nome === 'Latte intero')).toMatchObject({ ingrediente_id: 'ing:latte', quantita: 750, tipo_data: 'stimata', data_limite: '2026-10-29' });
    expect(lotti.find((x) => x.nome === 'Lasagne avanzate')).toMatchObject({ ingrediente_id: 'ing:avanzo', quantita: 2 });
    const righe = await u.sql(
      `select i.nome, ri.quantita::float as quantita, ri.qb from ricetta_ingrediente ri join ingrediente i on i.id = ri.ingrediente_id
        where ri.famiglia_id = $1 order by ri.ordine`,
      [nuova],
    );
    expect(righe.map((r) => [r.nome, r.quantita, r.qb])).toEqual([
      ['Farina 00', 300, false],
      ['Uova', null, true],
      ['Pinoli della nonna', 30, false],
      ['Sale', null, true],
    ]);
    const menu = await u.sql('select data::text, categoria, ricetta_id is not null as ricetta, testo from portata where famiglia_id = $1 order by data, ordine', [nuova]);
    expect(menu).toHaveLength(3);
    const gusti = await u.sql('select valore from gusto where famiglia_id = $1 order by valore', [nuova]);
    expect(gusti.map((g) => g.valore)).toEqual(['non_piace', 'piace']);
  });
});

describe('eliminare una famiglia (ritorno indietro)', () => {
  it('solo un amministratore, solo con il nome giusto; cancella tutto e solo quella famiglia', async () => {
    const u = await banco.utente();
    const l = leggiVecchio(fileVecchio());
    if (!l.valido) throw new Error(l.motivo);
    const { file } = convertiVecchio(l.file, catalogo as Catalogo, { io: 'm1', utente_id: u.id, oggi: '2026-10-27', adesso: new Date() });
    const importata = randomUUID();
    await u.applica(comando('ripristina_famiglia', importata, { file, nome: 'Casa importata' }));
    const { famiglia: altra } = await creaFamiglia(u, 'Casa vera');

    // Un membro che non amministra non può.
    const c = await u.applica(comando('crea_invito', importata, { id: randomUUID(), giorni: 1, usi_massimi: 1 }));
    const sara = await banco.utente();
    await sara.entra(comando('entra_con_invito', randomUUID(), { codice: c.dettaglio.codice, membro: { id: randomUUID(), nome: 'Sara' } }));
    expect((await sara.applica(comando('elimina_famiglia', importata, { nome: 'Casa importata' }))).dettaglio.motivo).toBe('solo_amministratore');
    // Il nome sbagliato non elimina nulla.
    expect((await u.applica(comando('elimina_famiglia', importata, { nome: 'Casa' }))).dettaglio.motivo).toBe('nome_non_corrisponde');

    const conta = async (f: string) =>
      (await banco.sql(
        `select (select count(*) from membro where famiglia_id = $1) + (select count(*) from lotto where famiglia_id = $1)
              + (select count(*) from ricetta where famiglia_id = $1) + (select count(*) from portata where famiglia_id = $1)
              + (select count(*) from comando where famiglia_id = $1) + (select count(*) from utente_famiglia where famiglia_id = $1) as n`,
        [f],
      ))[0].n;
    expect(Number(await conta(importata))).toBeGreaterThan(0);
    const prima = Number(await conta(altra));

    expect(await u.applica(comando('elimina_famiglia', importata, { nome: ' Casa importata ' }))).toMatchObject({ esito: 'applicato', dettaglio: { eliminata: true } });
    expect(Number(await conta(importata))).toBe(0);
    expect((await banco.sql('select count(*)::int as n from famiglia where id = $1', [importata]))[0].n).toBe(0);
    expect(Number(await conta(altra))).toBe(prima);
  });
});

describe('esportazione e ripristino delle ricette segnate ⭐ e 💫', () => {
  it('le ricette di Mastercook restano segnate, quelle della famiglia prendono l’id nuovo', async () => {
    const { u, famiglia } = await famigliaCompleta();
    const mia = randomUUID();
    await u.applica(
      comando('salva_ricetta', famiglia, {
        id: mia,
        nuova: true,
        campi: { titolo: 'Torta della zia', categoria: 'dolce', porzioni: 8 },
        ingredienti: { aggiungi: [{ id: randomUUID(), ingrediente_id: 'ing:farina', quantita: 300, unita: 'g' }] },
        passi: { aggiungi: [{ id: randomUUID(), ordine: 1, testo: 'Impasta e cuoci.' }] },
      }),
    );
    await u.applica(comando('segna_ricetta', famiglia, { ricetta_id: 'sys:carbonara', segno: 'preferita', attivo: true }));
    await u.applica(comando('segna_ricetta', famiglia, { ricetta_id: mia, segno: 'preferita', attivo: true }));
    await u.applica(comando('segna_ricetta', famiglia, { ricetta_id: mia, segno: 'ospiti', attivo: true }));
    const file = await esporta(u, famiglia);
    const nuova = randomUUID();
    expect((await u.applica(comando('ripristina_famiglia', nuova, { file: JSON.parse(JSON.stringify(file)) }))).esito).toBe('applicato');
    const [{ id: copia }] = await banco.sql<{ id: string }>(`select id from ricetta where famiglia_id = $1 and titolo = 'Torta della zia'`, [nuova]);
    expect(copia).not.toBe(mia);
    const [{ i }] = await banco.sql<{ i: Record<string, unknown> }>(`select impostazioni as i from famiglia where id = $1`, [nuova]);
    expect(i).toMatchObject({ preferite: ['sys:carbonara', copia], per_ospiti: [copia] });
  });
});
