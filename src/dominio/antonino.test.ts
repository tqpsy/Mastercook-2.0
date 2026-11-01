import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { equilibrio, gruppiDi, memoriaDa, pesoMemoria, PESI_BASE, REGOLE_BASE, regoleDa, regoleDaSalvare } from './antonino';
import { candidate, type ContestoProposte, proponi } from './proposte';
import { Indice } from './ricette';

const indice = new Indice(catalogo as Catalogo);
const r = (id: string) => indice.perId.get(id)!;
const persone = [{ id: 'luca', nome: 'Luca', porzione: 1 }];
const base: ContestoProposte = { persone, vincoli: [], gusti: [], inCasa: [], urgenti: [], recenti: [], regole: REGOLE_BASE, oggi: '2026-11-02' };
const settimana = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
const posti = settimana.flatMap((data) => [
  { data, categoria: 'pranzo' },
  { data, categoria: 'cena' },
]);

describe('Antonino: gruppi delle ricette', () => {
  it('riconosce pesce, legumi, carne rossa, salumi e verdure', () => {
    expect(gruppiDi(indice, r('sys:salmone_forno')).has('pesce')).toBe(true);
    expect(gruppiDi(indice, r('sys:pasta_ceci')).has('legumi')).toBe(true);
    expect(gruppiDi(indice, r('sys:pizzaiola')).has('carne_rossa')).toBe(true);
    expect(gruppiDi(indice, r('sys:carbonara')).has('salumi')).toBe(true);
    expect(gruppiDi(indice, r('sys:cotolette_pollo')).has('carne_bianca')).toBe(true);
    expect(gruppiDi(indice, r('sys:pasta_zucchine')).has('verdure')).toBe(true);
  });
});

describe('Antonino: settimana equilibrata', () => {
  it('rispetta gli obiettivi di base: pesce e legumi almeno 2, carne rossa e salumi al massimo 1', () => {
    const p = proponi(indice, posti, base, new Map(), new Map(), { piatti: [] });
    expect(p).toHaveLength(14);
    const voci = equilibrio(indice, p, REGOLE_BASE, settimana);
    for (const v of voci.filter((x) => x.gruppo !== 'verdure_giorni')) expect(v.stato, v.nome).toBe('ok');
  });

  it('conta i piatti già nel menu: con due piatti di carne rossa già messi non ne propone altri', () => {
    const gia = [
      { data: '2026-11-02', ricetta: r('sys:pizzaiola') },
      { data: '2026-11-03', ricetta: r('sys:tagliatelle_ragu') },
    ];
    const p = proponi(indice, posti.slice(4), base, new Map(), new Map(), { piatti: gia });
    expect(p.some((x) => gruppiDi(indice, x.ricetta).has('carne_rossa'))).toBe(false);
  });

  it('le regole si possono insegnare: con pesce almeno 4 ne propone 4', () => {
    const regole = regoleDa({ antonino: { regole: { obiettivi: { pesce: { min: 4, max: 5 } } } } });
    const p = proponi(indice, posti, { ...base, regole }, new Map(), new Map(), { piatti: [] });
    expect(p.filter((x) => gruppiDi(indice, x.ricetta).has('pesce')).length).toBeGreaterThanOrEqual(4);
  });

  it('valori strani nelle regole si ignorano e si salva solo ciò che cambia', () => {
    const regole = regoleDa({ antonino: { regole: { obiettivi: { pesce: { min: -1, max: 'tanti' }, legumi: { min: 3 } }, pesi: { scade: 99, piace: 5 } } } });
    expect(regole.obiettivi.pesce).toEqual({});
    expect(regole.obiettivi.legumi).toEqual({ min: 3 });
    expect(regole.pesi.scade).toBe(PESI_BASE.scade);
    expect(regole.pesi.piace).toBe(5);
    expect(regoleDaSalvare(REGOLE_BASE)).toEqual({});
    expect(regoleDaSalvare(regole)).toEqual({ obiettivi: { pesce: {}, legumi: { min: 3 } }, pesi: { piace: 5 } });
  });
});

describe('Antonino: memoria', () => {
  const memoria = memoriaDa({
    antonino: {
      scartate: { 'sys:carbonara': { n: 5, ultima: '2026-11-01' }, 'sys:lasagne': { n: 1, ultima: '2026-06-01' } },
      scelte: { 'sys:pasta_zucchine': { n: 2, ultima: '2026-10-30' } },
      mai_piu: ['sys:pasta_tonno', 3],
    },
  });

  it('scartare abbassa (al massimo 3 volte), scegliere alza, i ricordi vecchi contano la metà', () => {
    expect(pesoMemoria(memoria, 'sys:carbonara', PESI_BASE, '2026-11-02').punti).toBe(-3 * PESI_BASE.scartata);
    expect(pesoMemoria(memoria, 'sys:lasagne', PESI_BASE, '2026-11-02').punti).toBe(-0.5 * PESI_BASE.scartata);
    expect(pesoMemoria(memoria, 'sys:pasta_zucchine', PESI_BASE, '2026-11-02')).toEqual({ punti: 2 * PESI_BASE.scelta, motivo: 'la scegliete spesso' });
  });

  it('«non proporla più» toglie la ricetta dalle idee', () => {
    expect(memoria.maiPiu).toEqual(new Set(['sys:pasta_tonno']));
    const ids = (c: ContestoProposte) => candidate(indice, 'pranzo', c).map((x) => x.ricetta.id);
    expect(ids(base)).toContain('sys:pasta_tonno');
    expect(ids({ ...base, memoria })).not.toContain('sys:pasta_tonno');
    const prima = ids(base).indexOf('sys:carbonara');
    expect(ids({ ...base, memoria }).indexOf('sys:carbonara')).toBeGreaterThan(prima);
  });
});
