import { describe, expect, it } from 'vitest';
import { cosaCiVa, descriviPerFoto, FRIGO_BASE, frigoDa, posti, postoDelLotto, postoIngrediente, postoPiatto, postoValido, riassunto } from './frigo';

describe('il mio frigorifero', () => {
  it('senza configurazione: null; valori strani tornano quelli di base', () => {
    expect(frigoDa({})).toBeNull();
    expect(frigoDa({ frigo: { ripiani: 40, cassetti: -1, sportello: 'su', freezer: { posizione: 'in cantina', parti: 2.5 } } })).toEqual(FRIGO_BASE);
    expect(frigoDa({ frigo: { ...FRIGO_BASE, ripiani: 6, litri: 300.4 } })).toMatchObject({ ripiani: 6, litri: 300 });
  });

  it('le parti hanno id stabili e nomi chiari', () => {
    const p = posti(FRIGO_BASE);
    expect(p.map((x) => x.id)).toEqual(['r1', 'r2', 'r3', 'r4', 'c1', 's1', 's2', 's3', 's4', 'f1', 'f2', 'f3']);
    expect(p[0].nome).toBe('Ripiano 1, in alto');
    expect(p[3].nome).toBe('Ripiano 4, in basso');
    expect(p[4].nome).toBe('Cassetto delle verdure');
    expect(p.at(-1)!.nome).toBe('Freezer, cassetto 3');
    expect(posti({ ...FRIGO_BASE, freezer: { ...FRIGO_BASE.freezer, posizione: 'nessuno' } }).some((x) => x.zona === 'freezer')).toBe(false);
  });

  it('piatti cotti in alto, delicati sul ripiano centrale in fondo, in freezer il primo', () => {
    expect(postoPiatto(FRIGO_BASE, false)).toMatchObject({ posto: { id: 'r1' }, inFondo: false });
    expect(postoPiatto(FRIGO_BASE, true)).toMatchObject({ posto: { id: 'r2' }, inFondo: true });
    expect(postoPiatto({ ...FRIGO_BASE, ripiani: 5 }, true).posto.id).toBe('r3');
    expect(postoPiatto(FRIGO_BASE, false, true).posto.id).toBe('f1');
  });

  it('ingredienti: crudi in basso, verdura nel cassetto, latte nello sportello, uova mai', () => {
    expect(postoIngrediente(FRIGO_BASE, { reparto: 'carne' }, 'frigo')!.posto.id).toBe('r4');
    expect(postoIngrediente(FRIGO_BASE, { reparto: 'frutta_verdura', sottocategoria: 'Ortaggi' }, 'frigo')!.posto.id).toBe('c1');
    expect(postoIngrediente({ ...FRIGO_BASE, cassetti: 0 }, { reparto: 'frutta_verdura' }, 'frigo')!.posto.id).toBe('r4');
    expect(postoIngrediente(FRIGO_BASE, { reparto: 'latticini', sottocategoria: 'Latte' }, 'frigo')!.posto.zona).toBe('sportello');
    expect(postoIngrediente(FRIGO_BASE, { reparto: 'latticini', sottocategoria: 'Uova' }, 'frigo')!.posto.zona).toBe('ripiano');
    expect(postoIngrediente(FRIGO_BASE, { reparto: 'pesce' }, 'freezer')!.posto.id).toBe('f3');
    expect(postoIngrediente({ ...FRIGO_BASE, freezer: { ...FRIGO_BASE.freezer, posizione: 'nessuno' } }, { reparto: 'pesce' }, 'freezer')).toBeNull();
  });

  it('cosa ci va: la legenda del configuratore', () => {
    expect(cosaCiVa(FRIGO_BASE, 'r1')).toContain('Piatti cotti e avanzi');
    expect(cosaCiVa(FRIGO_BASE, 'r4')).toEqual(['Carne e pesce crudi']);
  });

  it('foto: descrizione per Gemini e posti accettati solo se esistono', () => {
    const d = descriviPerFoto(FRIGO_BASE, 's2');
    expect(d).toContain('- r1: Ripiano 1, in alto');
    expect(d).toContain('Nella foto c\'è solo questa parte: s2');
    expect(postoValido(FRIGO_BASE, 'r4')).toBe('r4');
    expect(postoValido(FRIGO_BASE, 'r9')).toBeNull();
    expect(postoValido(null, 'r1')).toBeNull();
  });

  it('il posto di un lotto vale solo nel suo luogo e se il ripiano c\'è ancora', () => {
    expect(postoDelLotto(FRIGO_BASE, { posto: 'r2', luogo: 'frigo' })?.nome).toBe('Ripiano 2');
    expect(postoDelLotto(FRIGO_BASE, { posto: 'r2', luogo: 'freezer' })).toBeNull();
    expect(postoDelLotto({ ...FRIGO_BASE, ripiani: 1 }, { posto: 'r2', luogo: 'frigo' })).toBeNull();
  });

  it('riassunto per la voce delle Impostazioni', () => {
    expect(riassunto(FRIGO_BASE)).toBe('freezer sotto · 4 ripiani · 1 cassetto · sportello a destra');
    expect(riassunto(null)).toMatch(/Non ancora configurato/);
  });
});
