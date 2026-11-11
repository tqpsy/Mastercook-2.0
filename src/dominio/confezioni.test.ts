import { describe, expect, it } from 'vitest';
import { confezioneDa, daPrendere, descriviGruppo, gruppoDi, type LottoContato, quellaAperta, quanteConfezioni, raggruppa, unaConfezione } from './confezioni';

const lotto = (id: string, quantita: number, x: Partial<LottoContato> = {}): LottoContato => ({
  id,
  ingrediente_id: 'ing:pasta',
  nome: null,
  quantita,
  unita: 'g',
  luogo: 'dispensa',
  data_limite: '2027-03-01',
  tipo_data: 'tmc',
  ...x,
});

describe('confezioni uguali', () => {
  it('salva la confezione solo con più confezioni intere', () => {
    expect(confezioneDa({ numero: '125', unita: 'g', quante: '3' }, 'massa')).toBe(125);
    expect(confezioneDa({ numero: '0,5', unita: 'kg', quante: '2' }, 'massa')).toBe(500);
    expect(confezioneDa({ numero: '6', unita: 'pz', quante: '2' }, 'pezzi')).toBe(6);
    expect(confezioneDa({ numero: '200', unita: 'g', quante: '1' }, 'massa')).toBeNull();
    expect(confezioneDa({ numero: '200', unita: 'g', quante: '1,5' }, 'massa')).toBeNull();
    // Tre zucchine a pezzi: si pesano, non sono confezioni.
    expect(confezioneDa({ numero: '3', unita: 'pz', quante: '2' }, 'massa', 200)).toBeNull();
  });

  it('due lotti uguali dallo scontrino stanno in una riga «500 g × 2»', () => {
    const [g, ...altri] = raggruppa([lotto('a', 500), lotto('b', 500)]);
    expect(altri).toEqual([]);
    expect(descriviGruppo(g)).toBe('500 g × 2');
    expect(quanteConfezioni(g)).toBe(2);
  });

  it('un lotto con la confezione: intere e quella aperta', () => {
    expect(descriviGruppo(raggruppa([lotto('a', 1000, { confezione: 500 })])[0])).toBe('500 g × 2');
    const g = raggruppa([lotto('a', 800, { confezione: 500 })])[0];
    expect(descriviGruppo(g)).toBe('500 g + 300 g aperta');
    expect(descriviGruppo(raggruppa([lotto('a', 300, { confezione: 500 })])[0])).toBe('300 g aperta (da 500 g)');
    expect(descriviGruppo(raggruppa([lotto('a', 300)])[0])).toBe('300 g');
  });

  it('un lotto con la confezione e uno senza della stessa misura stanno insieme; la riga si apre sulla confezione aperta', () => {
    const lotti = [lotto('a', 500), lotto('b', 700, { confezione: 500 })];
    const [g] = raggruppa(lotti);
    expect(descriviGruppo(g)).toBe('500 g × 2 + 200 g aperta');
    expect(g.primo.id).toBe('b');
    expect(gruppoDi(lotti, lotti[0]).lotti.map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('scadenze, luoghi, posti, nomi e misure diversi restano righe diverse; a occhio e piatti mai insieme', () => {
    const righe = raggruppa([
      lotto('a', 500),
      lotto('b', 500, { data_limite: '2027-04-01' }),
      lotto('c', 500, { luogo: 'frigo' }),
      lotto('d', 500, { nome: 'Barilla' }),
      lotto('e', 1000),
      lotto('f', 2, { unita: 'pz', livello: 'tanto' }),
      lotto('g', 2, { unita: 'pz', livello: 'tanto' }),
      lotto('h', 300, { portata_id: 'p' }),
      lotto('i', 300, { portata_id: 'p' }),
    ]);
    expect(righe).toHaveLength(9);
  });

  it('prendere una parte: prima la confezione aperta, poi le chiuse', () => {
    const g = raggruppa([lotto('a', 500), lotto('b', 200, { confezione: 500 })])[0];
    expect(daPrendere(g, 300)).toEqual([
      { lotto_id: 'b', quantita: 200 },
      { lotto_id: 'a', quantita: 100 },
    ]);
    expect(daPrendere(g, 2000).reduce((s, p) => s + p.quantita, 0)).toBe(700);
  });

  it('una confezione intera e quella aperta finita', () => {
    const g = raggruppa([lotto('a', 800, { confezione: 500 }), lotto('b', 500)])[0];
    expect(unaConfezione(g)).toEqual({ lotto_id: 'b', quantita: 500 });
    expect(quellaAperta(g)).toEqual({ lotto_id: 'a', quantita: 300 });
    const solo = raggruppa([lotto('a', 1500, { confezione: 500 })])[0];
    expect(unaConfezione(solo)).toEqual({ lotto_id: 'a', quantita: 500 });
    expect(quellaAperta(solo)).toBeNull();
    expect(unaConfezione(raggruppa([lotto('a', 300, { confezione: 500 })])[0])).toBeNull();
  });
});
