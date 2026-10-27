import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { valutaPerFamiglia } from './compatibilita';
import { candidate, type ContestoProposte, proponi } from './proposte';
import { Indice } from './ricette';

const indice = new Indice(catalogo as Catalogo);
const persone = [
  { id: 'luca', nome: 'Luca', porzione: 1 },
  { id: 'sara', nome: 'Sara', porzione: 0.5 },
];
const base: ContestoProposte = { persone, vincoli: [], gusti: [], inCasa: [], urgenti: [], recenti: [] };
const settimana = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
const posti = settimana.flatMap((data) => [
  { data, categoria: 'pranzo' },
  { data, categoria: 'cena' },
]);

describe('proposte del menu', () => {
  it('un piatto per ogni pasto, mai lo stesso due volte, e a pranzo e cena due tipi diversi', () => {
    const p = proponi(indice, posti, base);
    expect(p).toHaveLength(14);
    expect(new Set(p.map((x) => x.ricetta.id)).size).toBe(14);
    for (const data of settimana) {
      const [a, b] = p.filter((x) => x.data === data).map((x) => x.ricetta);
      expect(a.categoria === 'primo' && b.categoria === 'primo').toBe(false);
    }
  });

  it('nessuna proposta viola un vincolo: con l’allergia alle uova solo ricette adatte', () => {
    const vincoli = [{ membro_id: 'sara', tipo: 'allergia', oggetto: 'all:uova' }];
    const p = proponi(indice, posti, { ...base, vincoli });
    expect(p.length).toBeGreaterThan(0);
    for (const x of p) expect(valutaPerFamiglia(indice, x.ricetta, persone, vincoli).esito).toBe('adatta');
  });

  it('con un dubbio scritto a mano non si propone niente, finché la famiglia non segna «va bene»', () => {
    const vincoli = [{ membro_id: 'sara', tipo: 'intolleranza', oggetto: 'txt:qualcosa', testo: 'niente di strano' }];
    expect(candidate(indice, 'cena', { ...base, vincoli })).toEqual([]);
    const r = indice.perId.get('sys:carbonara')!;
    const verifiche = [{ membro_id: 'sara', ricetta_id: r.id, versione_ricetta: r.versione ?? 1 }];
    expect(candidate(indice, 'cena', { ...base, vincoli, verifiche }).map((x) => x.ricetta.id)).toEqual([r.id]);
  });

  it('prima ciò che scade presto; niente piatti con un ingrediente che a qualcuno non piace', () => {
    const [prima] = candidate(indice, 'cena', { ...base, urgenti: ['ing:zucchina'] });
    expect(prima.ricetta.ingredienti.some((g) => indice.antenati(g.ingrediente_id).includes('ing:zucchina'))).toBe(true);
    expect(prima.motivi[0]).toMatch(/zucchin. che scade presto/);
    const gusti = [{ id: 'g', membro_id: 'luca', ingrediente_id: 'ing:zucchina', ricetta_id: null, valore: 'non_piace' as const }];
    const senza = candidate(indice, 'cena', { ...base, urgenti: ['ing:zucchina'], gusti });
    expect(senza.some((x) => x.ricetta.ingredienti.some((g) => indice.antenati(g.ingrediente_id).includes('ing:zucchina') && !g.opzionale))).toBe(false);
  });

  it('i piatti già in menu nei giorni vicini scendono; «un’altra» non ripropone la stessa', () => {
    const [prima] = candidate(indice, 'cena', base);
    const [dopo] = candidate(indice, 'cena', { ...base, recenti: [prima.ricetta.id] });
    expect(dopo.ricetta.id).not.toBe(prima.ricetta.id);
    const [p] = proponi(indice, [{ data: '2026-11-02', categoria: 'cena' }], base, new Map(), new Map([['2026-11-02|cena', [prima.ricetta.id]]]));
    expect(p.ricetta.id).not.toBe(prima.ricetta.id);
  });

  it('pasti senza ricette adatte (lo spuntino) non si propongono', () => {
    expect(proponi(indice, [{ data: '2026-11-02', categoria: 'spuntino' }], base)).toEqual([]);
  });
});
