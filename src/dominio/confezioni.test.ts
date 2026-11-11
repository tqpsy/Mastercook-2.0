import { describe, expect, it } from 'vitest';
import { confezioneDa, daPrendere, descriviGruppo, elencoConfezioni, riassuntoConfezioni, gruppoDi, type LottoContato, quanteConfezioni, raggruppa } from './confezioni';

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

  it('un lotto con la confezione: intere uguali «× 2», con una aperta solo il totale', () => {
    expect(descriviGruppo(raggruppa([lotto('a', 1000, { confezione: 500 })])[0])).toBe('500 g × 2');
    // Farfalle: 2 da 500 g, usati 400 g da una: in Casa 600 g, nella scheda 1 da 500 g e 1 aperta con 100 g.
    const g = raggruppa([lotto('a', 600, { confezione: 500 })])[0];
    expect(descriviGruppo(g)).toBe('600 g');
    expect(riassuntoConfezioni(g)).toBe('2 confezioni: 1 da 500 g, 1 aperta con 100 g');
    expect(elencoConfezioni(g)).toEqual([
      { lotto_id: 'a', quantita: 500, da: 500, aperta: false },
      { lotto_id: 'a', quantita: 100, da: 500, aperta: true },
    ]);
    expect(descriviGruppo(raggruppa([lotto('a', 300, { confezione: 500 })])[0])).toBe('300 g');
    expect(riassuntoConfezioni(raggruppa([lotto('a', 300)])[0])).toBe('1 confezione: 1 da 300 g');
  });

  it('un lotto con la confezione e uno senza della stessa misura stanno insieme; la riga si apre sulla confezione aperta', () => {
    const lotti = [lotto('a', 500), lotto('b', 700, { confezione: 500 })];
    const [g] = raggruppa(lotti);
    expect(descriviGruppo(g)).toBe('1,2 kg');
    expect(riassuntoConfezioni(g)).toBe('3 confezioni: 2 da 500 g, 1 aperta con 200 g');
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
});
