import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { candidate, type ContestoProposte } from './proposte';
import { Indice } from './ricette';
import { type ContestoSuggerimenti, segniDa, SENZA_SEGNI, suggerisci, testoMancanti, ultimeVolte } from './suggerimenti';

const indice = new Indice(catalogo as Catalogo);
const carbonara = indice.perId.get('sys:carbonara')!;
const persone = [{ id: 'luca', nome: 'Luca', porzione: 1 }];
const base: ContestoSuggerimenti = { modo: 'casa', inCasa: new Set(), urgenti: [], segni: SENZA_SEGNI, persone, gusti: [], ultimaVolta: new Map(), oggi: '2026-11-01' };
const ricette = indice.ricette.filter((r) => !r.archiviata);

describe('suggerimenti «con ciò che ho»', () => {
  it('solo ricette a cui mancano al massimo due ingredienti, prima quelle con tutto in casa', () => {
    const inCasa = new Set(['ing:spaghetti', 'ing:guanciale', 'ing:uova', 'ing:pecorino']);
    const s = suggerisci(indice, ricette, { ...base, inCasa });
    expect(s.length).toBeGreaterThan(0);
    const posto = s.findIndex((x) => x.ricetta.id === carbonara.id);
    expect(posto).toBeGreaterThanOrEqual(0);
    expect(s[posto].motivi[0]).toBe('tutto in casa');
    // Prima tutte quelle complete, poi quelle a cui manca qualcosa.
    const complete = s.filter((x) => x.motivi[0] === 'tutto in casa').length;
    expect(s.slice(0, complete).every((x) => x.motivi[0] === 'tutto in casa')).toBe(true);
    for (const x of s) expect(x.motivi[0]).toMatch(/^(tutto in casa|manca .+|mancano .+ e .+)$/);
    expect(s.some((x) => /^mancano .+, .+ e/.test(x.motivi[0]))).toBe(false);
  });

  it('con la casa vuota non suggerisce niente; dice cosa manca', () => {
    expect(suggerisci(indice, ricette, base)).toEqual([]);
    expect(testoMancanti(indice, carbonara, new Set(['ing:spaghetti', 'ing:guanciale', 'ing:uova']))).toBe('manca pecorino romano');
    expect(testoMancanti(indice, carbonara, new Set(['ing:spaghetti', 'ing:guanciale']))).toBe('mancano uova e pecorino romano');
  });
});

describe('suggerimenti «dal ricettario»', () => {
  it('tutto il ricettario, prima le ⭐ preferite; quelle appena fatte scendono', () => {
    const tutte = suggerisci(indice, ricette, { ...base, modo: 'ricettario' });
    expect(tutte.length).toBeGreaterThan(100);
    const segni = { preferite: new Set([carbonara.id]), perOspiti: new Set<string>() };
    const [prima] = suggerisci(indice, ricette, { ...base, modo: 'ricettario', segni });
    expect(prima.ricetta.id).toBe(carbonara.id);
    expect(prima.motivi).toContain('⭐ preferita');
    const ultimaVolta = ultimeVolte([{ data: '2026-10-30', ricetta_id: carbonara.id }, { data: '2026-11-05', ricetta_id: 'sys:altro' }], '2026-11-01');
    expect(ultimaVolta.has('sys:altro')).toBe(false);
    const [dopo] = suggerisci(indice, ricette, { ...base, modo: 'ricettario', segni, ultimaVolta });
    expect(dopo.ricetta.id).not.toBe(carbonara.id);
  });

  it('niente ricette che a qualcuno non piacciono', () => {
    const gusti = [{ id: 'g', membro_id: 'luca', ingrediente_id: null, ricetta_id: carbonara.id, valore: 'non_piace' as const }];
    expect(suggerisci(indice, ricette, { ...base, modo: 'ricettario', gusti }).some((x) => x.ricetta.id === carbonara.id)).toBe(false);
  });

  it('i segni si leggono dalle impostazioni ignorando valori strani', () => {
    expect(segniDa({ preferite: ['sys:a', 3], per_ospiti: 'x' })).toEqual({ preferite: new Set(['sys:a']), perOspiti: new Set() });
    expect(segniDa(undefined)).toEqual(SENZA_SEGNI);
  });
});

describe('idea per il pasto con i due modi e i segni', () => {
  const ctx: ContestoProposte = { persone, vincoli: [], gusti: [], inCasa: ['ing:spaghetti', 'ing:guanciale', 'ing:uova', 'ing:pecorino'], urgenti: [], recenti: [] };
  it('«casa» tiene solo ciò a cui manca poco; «ricettario» tutto; ⭐ e 💫 filtrano', () => {
    const casa = candidate(indice, 'pranzo', ctx, { modo: 'casa' });
    const tutte = candidate(indice, 'pranzo', ctx, { modo: 'ricettario' });
    expect(casa.length).toBeGreaterThan(0);
    expect(casa.length).toBeLessThan(tutte.length);
    expect(casa[0].motivi[0]).toBe('tutto in casa');
    const segni = { preferite: new Set([carbonara.id]), perOspiti: new Set([carbonara.id]) };
    expect(candidate(indice, 'pranzo', { ...ctx, segni }, { segno: 'preferita' }).map((x) => x.ricetta.id)).toEqual([carbonara.id]);
    const [prima] = candidate(indice, 'pranzo', { ...ctx, segni, conOspiti: true }, { modo: 'ricettario' });
    expect(prima.ricetta.id).toBe(carbonara.id);
    expect(prima.motivi).toEqual(expect.arrayContaining(['⭐ preferita', '💫 da ospiti']));
  });
});
