import { describe, expect, it } from 'vitest';
import { eCirca, formatta, formattaEuro, formattaGiorno, inBase, leggiNumero, type PerNegozio, quantitaDaNegozio, scala, somma, unitaPer, leggiQuante, riepilogoScritta, scrittaVuota, totaleScritta } from './unita';

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
    expect(inBase(1, 'pz', 'volume')).toEqual({ ok: false, motivo: 'unita_incompatibile' });
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
    expect(leggiNumero('0.250')).toBe(0.25);
    expect(leggiNumero('0.500')).toBe(0.5);
    expect(totaleScritta({ numero: '0.250', unita: 'kg', quante: '1' }, 'massa')).toEqual({ ok: true, quantita: { valore: 250, unita: 'g' } });
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

describe('pezzi per ciò che si pesa', () => {
  it('offre g, kg, ml e l a ciò che si pesa o si versa, i pezzi solo se si sa quanto pesa un pezzo', () => {
    expect(unitaPer('massa')).toEqual(['g', 'kg', 'ml', 'l']);
    expect(unitaPer('volume')).toEqual(['ml', 'l', 'g', 'kg']);
    expect(unitaPer('massa', 200)).toEqual(['g', 'kg', 'ml', 'l', 'pz']);
    expect(unitaPer('pezzi', 50)).toEqual(['pz']);
  });

  it('3 zucchine da 200 g diventano 600 g', () => {
    expect(inBase(3, 'pz', 'massa', 200)).toEqual({ ok: true, quantita: { valore: 600, unita: 'g' } });
    expect(inBase(1.5, 'pz', 'massa', 150)).toEqual({ ok: true, quantita: { valore: 225, unita: 'g' } });
    expect(inBase(3, 'pz', 'massa')).toEqual({ ok: false, motivo: 'unita_incompatibile' });
    expect(inBase(0, 'pz', 'massa', 200)).toEqual({ ok: false, motivo: 'quantita_non_valida' });
    expect(inBase(6, 'pz', 'pezzi', 60)).toEqual({ ok: true, quantita: { valore: 6, unita: 'pz' } });
  });

  it('accanto ai pezzi dice quanto pesano', () => {
    expect(riepilogoScritta(scrittaVuota('pz', '3'), 'massa', 200)).toBe('≈ 600 g');
    expect(riepilogoScritta(scrittaVuota('pz', '8'), 'massa', 150)).toBe('≈ 1,2 kg');
    expect(riepilogoScritta(scrittaVuota('pz', ''), 'massa', 200)).toBeNull();
    expect(riepilogoScritta(scrittaVuota('g', '3'), 'massa', 200)).toBeNull();
    expect(riepilogoScritta(scrittaVuota('pz', '6'), 'pezzi', 60)).toBeNull();
  });
});

describe('ml per ciò che si pesa e g per ciò che si versa (1 ml ≈ 1 g)', () => {
  it('500 ml di yogurt sono circa 500 g, 1 kg di latte circa 1 l', () => {
    expect(inBase(500, 'ml', 'massa')).toEqual({ ok: true, quantita: { valore: 500, unita: 'g' } });
    expect(inBase(1, 'l', 'massa')).toEqual({ ok: true, quantita: { valore: 1000, unita: 'g' } });
    expect(inBase(1, 'kg', 'volume')).toEqual({ ok: true, quantita: { valore: 1000, unita: 'ml' } });
    expect(eCirca('ml', 'massa')).toBe(true);
    expect(eCirca('kg', 'massa')).toBe(false);
    expect(riepilogoScritta(scrittaVuota('ml', '500'), 'massa')).toBe('≈ 500 g');
  });

  it('le uova restano in pezzi: quanto pesa un uovo non si inventa', () => {
    expect(inBase(100, 'ml', 'pezzi')).toEqual({ ok: false, motivo: 'unita_incompatibile' });
  });
});

describe('quante confezioni', () => {
  it('3 vasetti di yogurt da 125 ml fanno 375 g', () => {
    const yogurt = { numero: '125', unita: 'ml' as const, quante: '3' };
    expect(totaleScritta(yogurt, 'massa')).toEqual({ ok: true, quantita: { valore: 375, unita: 'g' } });
    expect(riepilogoScritta(yogurt, 'massa')).toBe('≈ 375 g');
  });

  it('2 bottiglie di latte da 1 l fanno 2 l; 2 confezioni da 6 uova fanno 12 uova', () => {
    expect(totaleScritta({ numero: '1', unita: 'l', quante: '2' }, 'volume')).toEqual({ ok: true, quantita: { valore: 2000, unita: 'ml' } });
    expect(riepilogoScritta({ numero: '1', unita: 'l', quante: '2' }, 'volume')).toBe('= 2 l');
    expect(totaleScritta({ numero: '6', unita: 'pz', quante: '2' }, 'pezzi')).toEqual({ ok: true, quantita: { valore: 12, unita: 'pz' } });
  });

  it('una confezione sola (o il campo vuoto) non cambia niente e non serve dirlo', () => {
    expect(totaleScritta(scrittaVuota('g', '500'), 'massa')).toEqual({ ok: true, quantita: { valore: 500, unita: 'g' } });
    expect(totaleScritta({ numero: '500', unita: 'g', quante: '' }, 'massa')).toEqual({ ok: true, quantita: { valore: 500, unita: 'g' } });
    expect(riepilogoScritta(scrittaVuota('g', '500'), 'massa')).toBeNull();
  });

  it('confezioni zero o scritte male: si chiede di correggerle', () => {
    expect(leggiQuante('0')).toBeNull();
    expect(leggiQuante('tre')).toBeNull();
    expect(totaleScritta({ numero: '125', unita: 'g', quante: '0' }, 'massa')).toEqual({ ok: false, motivo: 'confezioni_non_valide' });
    expect(totaleScritta({ numero: '', unita: 'g', quante: '3' }, 'massa')).toEqual({ ok: false, motivo: 'quantita_non_valida' });
  });
});
