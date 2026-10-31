import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { tipiPrincipali } from './principale';
import { candidate, type ContestoProposte } from './proposte';
import { Indice } from './ricette';

const indice = new Indice(catalogo as Catalogo);
const ricetta = (titolo: string) => {
  const r = indice.ricette.find((x) => x.titolo === titolo);
  if (!r) throw new Error(`manca ${titolo}`);
  return r;
};
const base: ContestoProposte = {
  persone: [{ id: 'luca', nome: 'Luca', porzione: 1 }],
  vincoli: [],
  gusti: [],
  inCasa: [],
  urgenti: [],
  recenti: [],
};

describe('ingrediente principale', () => {
  it('la carbonara è pasta e uova (il pecorino grattugiato e l’aglio non contano)', () => {
    const t = tipiPrincipali(indice, ricetta('Spaghetti alla carbonara'));
    expect(t.has('pasta')).toBe(true);
    expect(t.has('uova')).toBe(true);
    expect(t.has('formaggi')).toBe(false);
    expect(t.has('verdure')).toBe(false);
  });

  it('ogni ricetta da pasto ha almeno un tipo, e ogni tipo ha qualche ricetta', () => {
    const conteggi = new Map<string, number>();
    for (const r of indice.ricette) for (const t of tipiPrincipali(indice, r)) conteggi.set(t, (conteggi.get(t) ?? 0) + 1);
    for (const t of ['pasta', 'riso', 'carne', 'pesce', 'uova', 'legumi', 'formaggi', 'verdure']) expect(conteggi.get(t) ?? 0).toBeGreaterThan(2);
  });

  it('le idee seguono categoria e ingrediente principale scelti', () => {
    const pesce = candidate(indice, 'cena', base, {
      categoria: 'primo',
      principale: 'pesce',
    });
    expect(pesce.length).toBeGreaterThan(0);
    for (const x of pesce) {
      expect(x.ricetta.categoria).toBe('primo');
      expect(tipiPrincipali(indice, x.ricetta).has('pesce')).toBe(true);
    }
    // Una categoria scelta vale anche se di solito non si propone a quel pasto.
    expect(candidate(indice, 'cena', base, { categoria: 'contorno' }).every((x) => x.ricetta.categoria === 'contorno')).toBe(true);
    expect(candidate(indice, 'cena', base, { categoria: 'contorno' }).length).toBeGreaterThan(0);
  });
});
