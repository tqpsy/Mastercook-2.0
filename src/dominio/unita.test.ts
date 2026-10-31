import { describe, expect, it } from 'vitest';
import { formatta, formattaEuro, formattaGiorno, inBase, leggiNumero, type PerNegozio, quantitaDaNegozio, scala, somma } from './unita';

describe('unità e quantità (T-UNI)', () => {
  it('T-UNI-1 1,5 kg diventa 1.500 g; 0,75 l diventa 750 ml', () => {
    expect(inBase(1.5, 'kg', 'massa')).toEqual({ ok: true, quantita: { valore: 1500, unita: 'g' } });
    expect(inBase(0.75, 'l', 'volume')).toEqual({ ok: true, quantita: { valore: 750, unita: 'ml' } });
    expect(inBase(3, 'pz', 'pezzi')).toEqual({ ok: true, quantita: { valore: 3, unita: 'pz' } });
  });

  it('T-UNI-2 g e ml dello stesso ingrediente senza conversione restano separati', () => {
    expect(
      somma([
        { valore: 200, unita: 'g' },
        { valore: 300, unita: 'g' },
        { valore: 100, unita: 'ml' },
      ]),
    ).toEqual([
      { valore: 500, unita: 'g' },
      { valore: 100, unita: 'ml' },
    ]);
  });

  it('T-UNI-3 unità incompatibile con la dimensione: rifiutata', () => {
    expect(inBase(10, 'g', 'pezzi')).toEqual({ ok: false, motivo: 'unita_incompatibile' });
    expect(inBase(1, 'l', 'massa')).toEqual({ ok: false, motivo: 'unita_incompatibile' });
  });

  it('T-UNI-4 una quantità mancante resta mancante, mai un numero inventato', () => {
    expect(inBase(0, 'g', 'massa')).toEqual({ ok: false, motivo: 'quantita_non_valida' });
    expect(inBase(Number.NaN, 'g', 'massa')).toEqual({ ok: false, motivo: 'quantita_non_valida' });
    expect(formatta(null)).toBe('quantità da indicare');
  });

  it('T-UNI-5 formato italiano', () => {
    expect(formatta({ valore: 1500, unita: 'g' })).toBe('1,5 kg');
    expect(formatta({ valore: 1250, unita: 'g' })).toBe('1,25 kg');
    expect(formatta({ valore: 750, unita: 'ml' })).toBe('750 ml');
    expect(formatta({ valore: 2, unita: 'pz' })).toBe('2 pz');
    expect(formattaEuro(2.3).replace(/\s/g, ' ')).toBe('2,30 €');
    expect(formattaGiorno('2026-10-27')).toBe('mar 27 ott');
  });

  it('legge i numeri scritti all’italiana', () => {
    expect(leggiNumero('1,5')).toBe(1.5);
    expect(leggiNumero('1.250')).toBe(1250);
    expect(leggiNumero('1.250,5')).toBe(1250.5);
    expect(leggiNumero('0.75')).toBe(0.75);
    expect(leggiNumero('')).toBeNull();
    expect(leggiNumero('due')).toBeNull();
  });

  it('scala per le porzioni, con i pezzi al mezzo', () => {
    expect(scala({ valore: 320, unita: 'g' }, 4, 6)).toEqual({ valore: 480, unita: 'g' });
    expect(scala({ valore: 3, unita: 'pz' }, 4, 2)).toEqual({ valore: 1.5, unita: 'pz' });
    expect(scala({ valore: 1, unita: 'pz' }, 4, 1)).toEqual({ valore: 0.5, unita: 'pz' });
    expect(scala({ valore: 2, unita: 'g' }, 4, 1)).toEqual({ valore: 0.5, unita: 'g' });
  });
});

describe('quantitaDaNegozio', () => {
  const ing = (id: string, x: Partial<PerNegozio> = {}): PerNegozio => ({ id, dimensione: 'massa', sottocategoria: null, peso_pz: null, ...x });
  it('aglio a teste, frutta a pezzi, spezie ed erbe a confezioni', () => {
    expect(quantitaDaNegozio({ valore: 1.9, unita: 'g' }, ing('ing:aglio', { peso_pz: 5 }))).toBe('1 testa');
    expect(quantitaDaNegozio({ valore: 120, unita: 'g' }, ing('ing:aglio', { peso_pz: 5 }))).toBe('3 teste');
    expect(quantitaDaNegozio({ valore: 193.8, unita: 'g' }, ing('ing:banana', { peso_pz: 150 }))).toBe('2 pz');
    expect(quantitaDaNegozio({ valore: 0.4, unita: 'g' }, ing('ing:cannella', { sottocategoria: 'Sale e spezie' }))).toBe('1 confezione');
    expect(quantitaDaNegozio({ valore: 10, unita: 'g' }, ing('ing:basilico', { sottocategoria: 'Erbe aromatiche' }))).toBe('1 mazzetto');
  });
  it('il resto arrotondato per eccesso a passi da negozio', () => {
    expect(quantitaDaNegozio({ valore: 2.5, unita: 'pz' })).toBe('3 pz');
    expect(quantitaDaNegozio({ valore: 12, unita: 'g' }, ing('ing:parmigiano'))).toBe('1 confezione');
    expect(quantitaDaNegozio({ valore: 330, unita: 'g' }, ing('ing:pasta'))).toBe('350 g');
    expect(quantitaDaNegozio({ valore: 1250, unita: 'g' }, ing('ing:farina'))).toBe('1,3 kg');
    expect(quantitaDaNegozio({ valore: 500, unita: 'ml' })).toBe('500 ml');
    expect(quantitaDaNegozio({ valore: 2100, unita: 'ml' })).toBe('2,25 l');
  });
});
