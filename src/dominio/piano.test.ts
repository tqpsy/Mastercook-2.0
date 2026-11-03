import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { composizione, gruppiDi, notaComposizione, PIANO_VUOTO, pianoAcceso, REGOLE_BASE, regoleDa, regoleDaSalvare } from './antonino';
import { comandoRicetta, leggiPiano, regoleConPiano, ricetteNuove } from './piano';
import { candidate, type ContestoProposte, proponi } from './proposte';
import { Indice } from './ricette';

const indice = new Indice(catalogo as Catalogo);
const persone = [{ id: 'luca', nome: 'Luca', porzione: 1 }];
const settimana = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
const posti = settimana.flatMap((data) => [
  { data, categoria: 'pranzo' },
  { data, categoria: 'cena' },
]);

/** Un piano d'esempio (non quello vero di una famiglia). */
const esempio = {
  formato: 'mastercook-piano',
  versione: 1,
  nome: 'Piano di prova',
  regole: {
    obiettivi: { pesce: { min: 3, max: 3 }, legumi: { min: 2, max: 2 }, salumi: { max: 2 } },
    piano: { cena_senza_carboidrati: true, legumi_senza_cereali: true, pranzo_con_carboidrati: true, verdure_a_ogni_pasto: true, preferiti: ['ing:farro', 'ing:riso_basmati', 'non valido'] },
  },
  ricette: [
    {
      titolo: 'Pancake d’avena',
      categoria: 'colazione',
      porzioni: 1,
      minuti_totali: 10,
      ingredienti: [
        { ingrediente_id: 'ing:uova', quantita: 1, unita: 'pz' },
        { ingrediente_id: 'ing:fiocchi_avena', quantita: 30, unita: 'g', testo: 'Farina d’avena' },
        { ingrediente_id: 'ing:burro', qb: true, testo: 'Burro chiarificato' },
      ],
      passi: ['Sbatti l’uovo con la farina d’avena.', 'Cuoci in padella.'],
    },
  ],
};

describe('Piano del nutrizionista: il file', () => {
  it('legge regole e ricette, ignora i valori strani e segna nome e data', () => {
    const p = leggiPiano(JSON.stringify(esempio), '2026-11-03');
    expect(p.nome).toBe('Piano di prova');
    expect(p.regole.obiettivi.pesce).toEqual({ min: 3, max: 3 });
    expect(p.regole.obiettivi.carne_rossa).toEqual(REGOLE_BASE.obiettivi.carne_rossa);
    expect(p.regole.piano).toMatchObject({ cenaSenzaCarboidrati: true, legumiSenzaCereali: true, preferiti: ['ing:farro', 'ing:riso_basmati'], caricato_il: '2026-11-03' });
    expect(p.ricette).toHaveLength(1);
    expect(p.ricette[0].ingredienti[2]).toMatchObject({ qb: true, quantita: null, unita: null });
  });

  it('rifiuta file che non sono un piano o con ricette incomplete', () => {
    expect(() => leggiPiano('non json', '2026-11-03')).toThrow(/non è un piano/);
    expect(() => leggiPiano(JSON.stringify({ formato: 'altro' }), '2026-11-03')).toThrow(/non è un piano/);
    expect(() => leggiPiano(JSON.stringify({ ...esempio, versione: 2 }), '2026-11-03')).toThrow(/versione più nuova/);
    const rotta = { ...esempio, ricette: [{ ...esempio.ricette[0], ingredienti: [{ ingrediente_id: 'ing:uova' }] }] };
    expect(() => leggiPiano(JSON.stringify(rotta), '2026-11-03')).toThrow(/n\. 1/);
  });

  it('si salva e si rilegge uguale, tenendo i pesi della famiglia', () => {
    const p = leggiPiano(JSON.stringify(esempio), '2026-11-03');
    const attuali = regoleDa({ antonino: { regole: { pesi: { piace: 5 } } } });
    const salvate = regoleDaSalvare(regoleConPiano(attuali, p));
    expect(JSON.stringify(salvate).length).toBeLessThan(4000);
    const rilette = regoleDa({ antonino: { regole: salvate } });
    expect(rilette.piano).toEqual(p.regole.piano);
    expect(rilette.pesi.piace).toBe(5);
    expect(regoleDaSalvare({ ...rilette, piano: PIANO_VUOTO }).piano).toBeUndefined();
    expect(pianoAcceso(REGOLE_BASE.piano)).toBe(false);
  });

  it('non ripete le ricette che la famiglia ha già e prepara il comando per crearle', () => {
    const p = leggiPiano(JSON.stringify(esempio), '2026-11-03');
    expect(ricetteNuove(p, ['pancake d’avena'])).toHaveLength(0);
    let n = 0;
    const c = comandoRicetta(p.ricette[0], () => `id-${++n}`) as { id: string; nuova: boolean; ingredienti: { aggiungi: { ordine: number }[] }; passi: { aggiungi: unknown[] } };
    expect(c.id).toBe('id-1');
    expect(c.nuova).toBe(true);
    expect(c.ingredienti.aggiungi.map((g) => g.ordine)).toEqual([0, 1, 2]);
    expect(c.passi.aggiungi).toHaveLength(2);
  });
});

describe('Piano del nutrizionista: Antonino lo segue', () => {
  const regole = leggiPiano(JSON.stringify(esempio), '2026-11-03').regole;
  const contesto: ContestoProposte = { persone, vincoli: [], gusti: [], inCasa: [], urgenti: [], recenti: [], regole, oggi: '2026-11-02' };

  it('a cena propone piatti senza carboidrati e mai legumi con un cereale', () => {
    const p = proponi(indice, posti, contesto, new Map(), new Map(), { piatti: [] });
    const cene = p.filter((x) => x.categoria === 'cena');
    expect(cene.length).toBe(7);
    for (const x of cene) {
      expect(composizione(indice, x.ricetta).carboidrati).toBe(false);
      expect(gruppiDi(indice, x.ricetta).has('legumi')).toBe(false);
    }
    for (const x of p) expect(gruppiDi(indice, x.ricetta).has('legumi') && !!composizione(indice, x.ricetta).cereale).toBe(false);
  });

  it('a pranzo preferisce un carboidrato e gli alimenti del piano', () => {
    const pranzi = candidate(indice, 'pranzo', contesto).slice(0, 10);
    for (const x of pranzi) {
      const c = composizione(indice, x.ricetta);
      expect(c.carboidrati || gruppiDi(indice, x.ricetta).has('legumi')).toBe(true);
    }
    const farro = candidate(indice, 'pranzo', contesto).find((x) => x.motivi.some((m) => m.startsWith('dal piano')));
    expect(farro).toBeDefined();
  });

  it('pasta a cena scende ma si spiega', () => {
    const pasta = candidate(indice, 'cena', contesto, { categoria: 'primo' }).find((x) => x.ricetta.id === 'sys:pasta_zucchine');
    expect(pasta?.motivi).toContain('⚠️ carboidrati a cena');
  });

  it('senza piano le proposte non cambiano', () => {
    const senza = candidate(indice, 'cena', { ...contesto, regole: REGOLE_BASE }).map((x) => x.ricetta.id);
    const ancora = candidate(indice, 'cena', { ...contesto, regole: { ...regole, piano: PIANO_VUOTO, obiettivi: REGOLE_BASE.obiettivi } }).map((x) => x.ricetta.id);
    expect(ancora).toEqual(senza);
  });

  it('i consigli sotto il piatto seguono il piano', () => {
    const c = { carboidrati: false, proteine: true, verdure: true, integrale: false };
    expect(notaComposizione(c, 'secondo')).toBe('da completare con pane, patate o un cereale');
    expect(notaComposizione(c, 'secondo', regole.piano)).toBe('a cena basta così, a pranzo con un cereale o patate');
    expect(notaComposizione({ ...c, proteine: false, carboidrati: true }, 'primo', regole.piano)).toBe('da completare con uova, pesce, carne o formaggio');
  });
});
