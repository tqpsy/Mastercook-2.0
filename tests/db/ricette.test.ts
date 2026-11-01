/**
 * Catalogo di sistema e ricette della famiglia: unità coerenti, q.b. dichiarato, ricette di sistema
 * intoccabili, modifiche riga per riga da più dispositivi.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Catalogo } from '../../src/catalogo/tipi';
import { type Banco, comando, creaFamiglia, nuovoBanco, type Utente } from './banco';

const CATALOGO: Catalogo = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'src', 'catalogo', 'catalogo.json'), 'utf8'));

let banco: Banco;
beforeAll(async () => {
  banco = await nuovoBanco();
});
afterAll(async () => {
  await banco.chiudi();
});

function riga(ingrediente_id: string, quantita: number | null, unita: string, extra: Record<string, unknown> = {}) {
  return { id: randomUUID(), ingrediente_id, quantita, unita, qb: quantita === null, ...extra };
}

function nuovaRicetta(famiglia: string, campi: Record<string, unknown> = {}, ingredienti = [riga('ing:spaghetti', 320, 'g'), riga('ing:sale', null, 'g')]) {
  const id = randomUUID();
  return {
    id,
    c: comando('salva_ricetta', famiglia, {
      id,
      nuova: true,
      campi: { titolo: 'Spaghetti della nonna', categoria: 'primo', porzioni: 4, minuti_totali: 20, ...campi },
      ingredienti: { aggiungi: ingredienti },
      passi: { aggiungi: [{ id: randomUUID(), ordine: 1, testo: 'Cuoci la pasta.' }] },
    }),
  };
}

async function famigliaCon(): Promise<{ u: Utente; famiglia: string }> {
  const u = await banco.utente();
  const { famiglia } = await creaFamiglia(u);
  return { u, famiglia };
}

describe('catalogo di sistema nel database', () => {
  it('è lo stesso di src/catalogo/catalogo.json', async () => {
    const ing = await banco.sql<{ id: string; dimensione: string; allergeni: string[]; genitore: string | null }>(
      'select id, dimensione, allergeni, genitore from ingrediente where famiglia_id is null order by id collate "C"',
    );
    expect(ing.map((i) => i.id)).toEqual(CATALOGO.ingredienti.map((i) => i.id).sort());
    const perId = new Map(ing.map((i) => [i.id, i]));
    for (const i of CATALOGO.ingredienti) {
      expect(perId.get(i.id)).toMatchObject({ dimensione: i.dimensione, allergeni: i.allergeni, genitore: i.genitore });
    }
    const ric = await banco.sql<{ id: string; righe: number; passi: number }>(
      `select r.id, (select count(*)::int from ricetta_ingrediente g where g.ricetta_id = r.id) as righe,
              (select count(*)::int from ricetta_passo p where p.ricetta_id = r.id) as passi
         from ricetta r where r.famiglia_id is null`,
    );
    expect(ric).toHaveLength(CATALOGO.ricette.length);
    const perRicetta = new Map(ric.map((r) => [r.id, r]));
    for (const r of CATALOGO.ricette) expect(perRicetta.get(r.id)).toMatchObject({ righe: r.ingredienti.length, passi: r.passi.length });
  });

  it('chi è collegato legge il catalogo; non passa dallo scarico della famiglia', async () => {
    const { u, famiglia } = await famigliaCon();
    const [n] = await u.sql<{ n: number }>("select count(*)::int as n from ricetta where id = 'sys:carbonara'");
    expect(n.n).toBe(1);
    const p = await u.scarica(famiglia, 0);
    expect(p.righe.filter((r) => r.tabella === 'ricetta' || r.tabella === 'ingrediente')).toHaveLength(0);
  });

  it('una ricetta di sistema non si modifica né si cancella dall’app', async () => {
    const { u, famiglia } = await famigliaCon();
    const e = await u.applica(comando('salva_ricetta', famiglia, { id: 'sys:carbonara', versione_attesa: 1, campi: { titolo: 'Mia' } }));
    expect(e).toMatchObject({ esito: 'rifiutato', dettaglio: { motivo: 'ricetta_di_sistema' } });
    const e2 = await u.applica(comando('elimina_ricetta', famiglia, { id: 'sys:carbonara' }));
    expect(e2.dettaglio.motivo).toBe('ricetta_di_sistema');
    const e3 = await u.applica(comando('modifica_ingrediente', famiglia, { id: 'ing:uova', versione_attesa: 1, campi: { nome: 'x' } }));
    expect(e3.dettaglio.motivo).toBe('ingrediente_di_sistema');
  });
});

describe('ricette della famiglia', () => {
  it('si crea con ingredienti e passaggi; q.b. resta senza numero', async () => {
    const { u, famiglia } = await famigliaCon();
    const { id, c } = nuovaRicetta(famiglia);
    expect((await u.applica(c)).esito).toBe('applicato');
    const righe = await banco.sql('select ingrediente_id, quantita, qb from ricetta_ingrediente where ricetta_id = $1 order by ingrediente_id collate "C"', [id]);
    expect(righe).toEqual([
      { ingrediente_id: 'ing:sale', quantita: null, qb: true },
      { ingrediente_id: 'ing:spaghetti', quantita: '320', qb: false },
    ]);
    const p = await u.scarica(famiglia, 0);
    expect(p.righe.filter((r) => r.tabella === 'ricetta_ingrediente')).toHaveLength(2);
  });

  it('T-UNI-3 «10 g di uova» è rifiutato e non scrive nulla', async () => {
    const { u, famiglia } = await famigliaCon();
    const { id, c } = nuovaRicetta(famiglia, {}, [riga('ing:uova', 10, 'g')]);
    const e = await u.applica(c);
    expect(e).toMatchObject({ esito: 'rifiutato', dettaglio: { motivo: 'unita_incompatibile', ingrediente: 'ing:uova', dimensione: 'pezzi' } });
    expect((await banco.sql('select count(*)::int as n from ricetta where id = $1', [id]))[0].n).toBe(0);
  });

  it('una quantità senza unità, o un numero senza q.b. mancante, non si salva', async () => {
    const { u, famiglia } = await famigliaCon();
    const senzaUnita = nuovaRicetta(famiglia, {}, [riga('ing:spaghetti', 320, null as unknown as string)]);
    expect((await u.applica(senzaUnita.c)).dettaglio.motivo).toBe('dati_non_validi');
    const qbConNumero = nuovaRicetta(famiglia, {}, [riga('ing:sale', 5, 'g', { qb: true })]);
    expect((await u.applica(qbConNumero.c)).dettaglio.motivo).toBe('dati_non_validi');
    const zero = nuovaRicetta(famiglia, {}, [riga('ing:spaghetti', 0, 'g')]);
    expect((await u.applica(zero.c)).dettaglio.motivo).toBe('dati_non_validi');
  });

  it('senza ingredienti o senza passaggi non è una ricetta', async () => {
    const { u, famiglia } = await famigliaCon();
    const { c } = nuovaRicetta(famiglia, {}, []);
    expect((await u.applica(c)).dettaglio.motivo).toBe('ricetta_senza_ingredienti');
  });

  it('duplicare una ricetta di sistema crea una copia della famiglia che si può modificare', async () => {
    const { u, famiglia } = await famigliaCon();
    const { id, c } = nuovaRicetta(famiglia, { derivata_da: 'sys:carbonara', titolo: 'Carbonara di casa' });
    expect((await u.applica(c)).esito).toBe('applicato');
    const [r] = await banco.sql('select derivata_da, famiglia_id from ricetta where id = $1', [id]);
    expect(r).toEqual({ derivata_da: 'sys:carbonara', famiglia_id: famiglia });
    const finta = nuovaRicetta(famiglia, { derivata_da: 'sys:non_esiste' });
    expect((await u.applica(finta.c)).dettaglio.motivo).toBe('ricetta_non_trovata');
  });

  it('due dispositivi cambiano righe diverse: restano entrambe; la stessa riga: conflitto', async () => {
    const { u, famiglia } = await famigliaCon();
    const pasta = riga('ing:spaghetti', 320, 'g');
    const aglio = riga('ing:aglio', 10, 'g');
    const { id, c } = nuovaRicetta(famiglia, {}, [pasta, aglio]);
    await u.applica(c);
    const [a, b] = await Promise.all([
      u.applica(comando('salva_ricetta', famiglia, { id, ingredienti: { modifica: [{ id: pasta.id, versione_attesa: 1, campi: { quantita: 400 } }] } })),
      u.applica(comando('salva_ricetta', famiglia, { id, ingredienti: { modifica: [{ id: aglio.id, versione_attesa: 1, campi: { quantita: 15 } }] } })),
    ]);
    expect([a.esito, b.esito]).toEqual(['applicato', 'applicato']);
    const q = await banco.sql('select quantita from ricetta_ingrediente where ricetta_id = $1 order by ingrediente_id collate "C"', [id]);
    expect(q.map((x) => Number(x.quantita))).toEqual([15, 400]);

    const terzo = await u.applica(
      comando('salva_ricetta', famiglia, { id, ingredienti: { modifica: [{ id: pasta.id, versione_attesa: 1, campi: { quantita: 250 } }] } }),
    );
    expect(terzo).toMatchObject({ esito: 'conflitto', dettaglio: { motivo: 'stesso_campo' } });
  });

  it('archiviare e modificare la scheda vanno per campi', async () => {
    const { u, famiglia } = await famigliaCon();
    const { id, c } = nuovaRicetta(famiglia);
    await u.applica(c);
    const e = await u.applica(comando('salva_ricetta', famiglia, { id, versione_attesa: 1, campi: { archiviata: true } }));
    expect(e.esito).toBe('applicato');
    const e2 = await u.applica(comando('salva_ricetta', famiglia, { id, versione_attesa: 1, campi: { titolo: 'Nuovo titolo' } }));
    expect(e2.esito).toBe('applicato');
    const [r] = await banco.sql('select titolo, archiviata from ricetta where id = $1', [id]);
    expect(r).toEqual({ titolo: 'Nuovo titolo', archiviata: true });
  });

  it('un’altra famiglia non vede la ricetta e non può usarne gli ingredienti', async () => {
    const { u, famiglia } = await famigliaCon();
    const kefir = randomUUID();
    expect(
      (await u.applica(comando('crea_ingrediente', famiglia, { id: kefir, nome: 'Kefir', dimensione: 'volume', reparto: 'latticini' }))).esito,
    ).toBe('applicato');
    const { id, c } = nuovaRicetta(famiglia, {}, [riga(kefir, 200, 'ml')]);
    expect((await u.applica(c)).esito).toBe('applicato');

    const altra = await famigliaCon();
    expect(await altra.u.sql('select id from ricetta where id = $1', [id])).toHaveLength(0);
    expect(await altra.u.sql('select id from ingrediente where id = $1', [kefir])).toHaveLength(0);
    const furto = nuovaRicetta(altra.famiglia, {}, [riga(kefir, 200, 'ml')]);
    expect((await altra.u.applica(furto.c)).dettaglio.motivo).toBe('ingrediente_non_trovato');
  });

  it('un ingrediente della famiglia senza allergeni indicati resta «allergeni non noti»', async () => {
    const { u, famiglia } = await famigliaCon();
    const id = randomUUID();
    await u.applica(comando('crea_ingrediente', famiglia, { id, nome: 'Salsa misteriosa', dimensione: 'massa' }));
    const [r] = await banco.sql('select allergeni_noti, allergeni from ingrediente where id = $1', [id]);
    expect(r).toEqual({ allergeni_noti: false, allergeni: [] });
  });
});

describe('icona scelta per una ricetta', () => {
  it('si sceglie, si cambia, ripetuta non scrive di nuovo, si toglie; solo ricette visibili ed emoji vere', async () => {
    const { u, famiglia } = await famigliaCon();
    const icone = () => banco.sql(`select ricetta_id, emoji, versione from icona_ricetta where famiglia_id = $1 and eliminato_il is null`, [famiglia]);
    const scegli = (emoji: string | null, ricetta_id = 'sys:riso_basmati_spezie') => u.applica(comando('scegli_icona', famiglia, { id: randomUUID(), ricetta_id, emoji }));

    expect((await scegli('🍛')).esito).toBe('applicato');
    expect((await scegli('🍛')).esito).toBe('applicato');
    expect(await icone()).toEqual([{ ricetta_id: 'sys:riso_basmati_spezie', emoji: '🍛', versione: 1 }]);
    await scegli('🍚');
    expect(await icone()).toEqual([{ ricetta_id: 'sys:riso_basmati_spezie', emoji: '🍚', versione: 2 }]);
    await scegli(null);
    expect(await icone()).toEqual([]);

    expect((await scegli('ciao')).esito).not.toBe('applicato');
    expect((await scegli('mc:Lasagna')).esito).not.toBe('applicato');
    expect((await scegli('mc:lasagna <b>')).esito).not.toBe('applicato');
    expect((await scegli('mc:lasagna')).esito).toBe('applicato');
    expect(await icone()).toEqual([{ ricetta_id: 'sys:riso_basmati_spezie', emoji: 'mc:lasagna', versione: 1 }]);
    await scegli(null);
    expect((await scegli('🍛', 'sys:non_esiste')).esito).not.toBe('applicato');
    const altra = await famigliaCon();
    const { id, c } = nuovaRicetta(altra.famiglia);
    await altra.u.applica(c);
    expect((await scegli('🍛', id)).esito).not.toBe('applicato');
    expect(await icone()).toEqual([]);
  });
});

describe('ricette segnate ⭐ preferite e 💫 per ospiti', () => {
  it('si segnano, ripetute non scrivono due volte, si tolgono; solo ricette visibili e segni noti', async () => {
    const { u, famiglia } = await famigliaCon();
    const impostazioni = async () => (await banco.sql<{ i: Record<string, unknown> }>(`select impostazioni as i from famiglia where id = $1`, [famiglia]))[0].i;
    const segna = (segno: string, ricetta_id: string, attivo = true) => u.applica(comando('segna_ricetta', famiglia, { ricetta_id, segno, attivo }));

    expect((await segna('preferita', 'sys:carbonara')).esito).toBe('applicato');
    expect((await segna('preferita', 'sys:carbonara')).esito).toBe('applicato');
    await segna('preferita', 'sys:riso_basmati_spezie');
    await segna('ospiti', 'sys:carbonara');
    expect(await impostazioni()).toMatchObject({ preferite: ['sys:carbonara', 'sys:riso_basmati_spezie'], per_ospiti: ['sys:carbonara'] });
    await segna('preferita', 'sys:carbonara', false);
    await segna('preferita', 'sys:carbonara', false);
    expect(await impostazioni()).toMatchObject({ preferite: ['sys:riso_basmati_spezie'], per_ospiti: ['sys:carbonara'] });

    expect((await segna('altro', 'sys:carbonara')).esito).not.toBe('applicato');
    expect((await segna('preferita', 'sys:non_esiste')).esito).not.toBe('applicato');
    const altra = await famigliaCon();
    const { id, c } = nuovaRicetta(altra.famiglia);
    await altra.u.applica(c);
    expect((await segna('ospiti', id)).esito).not.toBe('applicato');
    expect(await impostazioni()).toMatchObject({ preferite: ['sys:riso_basmati_spezie'], per_ospiti: ['sys:carbonara'] });
  });
});

describe('ricetta segnata «va bene» per un membro', () => {
  it('si segna, si aggiorna alla nuova versione, ripetuta non scrive, si toglie; solo membri e ricette della famiglia', async () => {
    const { u, famiglia } = await famigliaCon();
    const [m] = await banco.sql<{ id: string }>(`select id from membro where famiglia_id = $1 limit 1`, [famiglia]);
    const righe = () => banco.sql(`select ricetta_id, versione_ricetta, versione from ricetta_verificata where famiglia_id = $1 and eliminato_il is null`, [famiglia]);
    const segna = (va_bene: boolean, versione_ricetta = 1, extra: Record<string, unknown> = {}) =>
      u.applica(comando('verifica_ricetta', famiglia, { id: randomUUID(), membro_id: m.id, ricetta_id: 'sys:carbonara', versione_ricetta, va_bene, ...extra }));

    expect((await segna(true)).esito).toBe('applicato');
    expect((await segna(true)).esito).toBe('applicato');
    expect(await righe()).toEqual([{ ricetta_id: 'sys:carbonara', versione_ricetta: 1, versione: 1 }]);
    await segna(true, 2);
    expect(await righe()).toEqual([{ ricetta_id: 'sys:carbonara', versione_ricetta: 2, versione: 2 }]);
    await segna(false);
    expect(await righe()).toEqual([]);

    const altra = await famigliaCon();
    const [suo] = await banco.sql<{ id: string }>(`select id from membro where famiglia_id = $1 limit 1`, [altra.famiglia]);
    expect((await segna(true, 1, { membro_id: suo.id })).esito).not.toBe('applicato');
    expect((await segna(true, 1, { ricetta_id: 'sys:non_esiste' })).esito).not.toBe('applicato');
    expect(await righe()).toEqual([]);
  });

  it('«non va bene» si segna, passa a «va bene» e si toglie; una scelta sconosciuta è rifiutata', async () => {
    const { u, famiglia } = await famigliaCon();
    const [m] = await banco.sql<{ id: string }>(`select id from membro where famiglia_id = $1 limit 1`, [famiglia]);
    const righe = () => banco.sql(`select va_bene, versione from ricetta_verificata where famiglia_id = $1 and eliminato_il is null`, [famiglia]);
    const scegli = (scelta: string) =>
      u.applica(comando('verifica_ricetta', famiglia, { id: randomUUID(), membro_id: m.id, ricetta_id: 'sys:carbonara', versione_ricetta: 1, va_bene: scelta === 'va_bene', scelta }));

    expect((await scegli('non_va_bene')).esito).toBe('applicato');
    await scegli('non_va_bene');
    expect(await righe()).toEqual([{ va_bene: false, versione: 1 }]);
    await scegli('va_bene');
    expect(await righe()).toEqual([{ va_bene: true, versione: 2 }]);
    await scegli('non_va_bene');
    expect(await righe()).toEqual([{ va_bene: false, versione: 3 }]);
    await scegli('togli');
    expect(await righe()).toEqual([]);
    expect((await scegli('forse')).esito).not.toBe('applicato');
  });
});

describe('ricette collegate: una base dentro la ricetta', () => {
  const lasagna = (famiglia: string, basi: Record<string, unknown>) => {
    const { id, c } = nuovaRicetta(famiglia, { titolo: 'Lasagna di Luca', categoria: 'piatto_unico' }, [riga('ing:carne_macinata', 500, 'g')]);
    c.dati.basi = basi;
    return { id, c };
  };
  const righeBase = (id: string) =>
    banco.sql<{ ingrediente_id: string; quantita: string | null; dosi: string }>(
      'select ingrediente_id, quantita, dosi from ricetta_ingrediente where ricetta_id = $1 and da_ricetta_id is not null and eliminato_il is null order by ingrediente_id collate "C"',
      [id],
    );

  it('la besciamella fatta in casa entra con le sue righe moltiplicate per le dosi', async () => {
    const { u, famiglia } = await famigliaCon();
    const { id, c } = lasagna(famiglia, { imposta: [{ ricetta_id: 'sys:besciamella', dosi: 0.5 }] });
    expect((await u.applica(c)).esito).toBe('applicato');
    const righe = await righeBase(id);
    expect(righe.map((r) => [r.ingrediente_id, Number(r.quantita)])).toEqual([
      ['ing:burro', 50],
      ['ing:farina', 50],
      ['ing:latte', 500],
      ['ing:noce_moscata', 0.5],
      ['ing:sale', 2.5],
    ]);
    expect(righe.every((r) => Number(r.dosi) === 0.5)).toBe(true);
    const p = await u.scarica(famiglia, 0);
    expect(p.righe.filter((r) => r.tabella === 'ricetta_ingrediente')).toHaveLength(6);
  });

  it('cambiare le dosi o togliere la base riscrive le righe', async () => {
    const { u, famiglia } = await famigliaCon();
    const { id, c } = lasagna(famiglia, { imposta: [{ ricetta_id: 'sys:besciamella', dosi: 1 }] });
    await u.applica(c);
    expect((await u.applica(comando('salva_ricetta', famiglia, { id, basi: { imposta: [{ ricetta_id: 'sys:besciamella', dosi: 2 }] } }))).esito).toBe('applicato');
    expect(Number((await righeBase(id)).find((r) => r.ingrediente_id === 'ing:latte')!.quantita)).toBe(2000);
    expect((await u.applica(comando('salva_ricetta', famiglia, { id, basi: { rimuovi: ['sys:besciamella'] } }))).esito).toBe('applicato');
    expect(await righeBase(id)).toEqual([]);
  });

  it('se la base della famiglia cambia, la ricetta che la usa si aggiorna', async () => {
    const { u, famiglia } = await famigliaCon();
    const latte = riga('ing:latte', 800, 'ml');
    const salsa = nuovaRicetta(famiglia, { titolo: 'Besciamella mia', categoria: 'base' }, [latte, riga('ing:burro', 80, 'g')]);
    await u.applica(salsa.c);
    const { id, c } = lasagna(famiglia, { imposta: [{ ricetta_id: salsa.id, dosi: 1 }] });
    await u.applica(c);
    await u.applica(comando('salva_ricetta', famiglia, { id: salsa.id, ingredienti: { modifica: [{ id: latte.id, versione_attesa: 1, campi: { quantita: 1000 } }] } }));
    expect(Number((await righeBase(id)).find((r) => r.ingrediente_id === 'ing:latte')!.quantita)).toBe(1000);
  });

  it('solo le basi, e un solo livello', async () => {
    const { u, famiglia } = await famigliaCon();
    const nonBase = lasagna(famiglia, { imposta: [{ ricetta_id: 'sys:carbonara', dosi: 1 }] });
    expect((await u.applica(nonBase.c)).dettaglio.motivo).toBe('base_non_valida');
    const salsa = nuovaRicetta(famiglia, { titolo: 'Salsa', categoria: 'base' }, [riga('ing:latte', 500, 'ml')]);
    await u.applica(salsa.c);
    const { c } = lasagna(famiglia, { imposta: [{ ricetta_id: salsa.id, dosi: 1 }] });
    await u.applica(c);
    const dentro = await u.applica(comando('salva_ricetta', famiglia, { id: salsa.id, basi: { imposta: [{ ricetta_id: 'sys:besciamella', dosi: 1 }] } }));
    expect(dentro.dettaglio.motivo).toBe('base_non_valida');
  });
});
