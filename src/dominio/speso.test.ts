import { describe, expect, it } from 'vitest';
import { type AcquistoConScontrino, DIFFERENZA, nomeMese, resocontoSpesa, type RigaScontrino, type Scontrino, ultimiMesi } from './speso';
import type { RigaAcquisto } from './spesa';

const acquisto = (id: string, data: string, extra: Partial<AcquistoConScontrino> = {}): AcquistoConScontrino => ({
  id,
  fonte: 'carrello',
  data,
  negozio: null,
  stato: 'confermato',
  ...extra,
});
const riga = (id: string, acquisto_id: string, ingrediente_id: string | null, prezzo: number | null): RigaAcquisto => ({
  id,
  acquisto_id,
  voce_id: null,
  ingrediente_id,
  nome: ingrediente_id ? null : 'Detersivo',
  quantita: 1,
  unita: 'pz',
  prezzo,
  lotto_id: null,
});
const reparti: Record<string, string> = { 'ing:pollo': 'carne', 'ing:mela': 'frutta_verdura' };
const repartoDi = (id: string) => reparti[id];
const resoconto = (acquisti: AcquistoConScontrino[], righe: RigaAcquisto[], scontrini: Scontrino[] = [], righeScontrino: RigaScontrino[] = []) =>
  resocontoSpesa({ acquisti, righe, scontrini, righeScontrino, repartoDi, oggi: '2026-11-05' });

describe('ultimiMesi', () => {
  it('passa da un anno all’altro', () => {
    expect(ultimiMesi('2026-02-10', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('resocontoSpesa', () => {
  it('somma gli acquisti del mese per reparto e conta le righe senza prezzo', () => {
    const r = resoconto(
      [acquisto('a1', '2026-11-02'), acquisto('a2', '2026-10-20')],
      [riga('r1', 'a1', 'ing:pollo', 6.5), riga('r2', 'a1', 'ing:mela', 2.1), riga('r3', 'a1', null, 3), riga('r4', 'a1', 'ing:mela', null), riga('r5', 'a2', 'ing:pollo', 4)],
    );
    expect(r.mesi.map((m) => m.mese)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(r.mesi[5]).toEqual({ mese: '2026-11', euro: 11.6, spese: 1 });
    expect(r.mesi[4].euro).toBe(4);
    expect(Object.fromEntries(r.reparti.get('2026-11')!)).toEqual({ carne: 6.5, frutta_verdura: 2.1, altro: 3 });
    expect(r.senzaPrezzo.get('2026-11')).toBe(1);
  });

  it('non conta gli acquisti annullati né quelli fuori dai mesi', () => {
    const r = resoconto([acquisto('a1', '2026-11-02', { stato: 'annullato' }), acquisto('a2', '2025-01-01')], [riga('r1', 'a1', 'ing:pollo', 6), riga('r2', 'a2', 'ing:pollo', 9)]);
    expect(r.mesi.every((m) => m.euro === 0 && m.spese === 0)).toBe(true);
  });

  it('uno scontrino vale il suo totale, con la differenza a parte, e non si somma al carrello abbinato', () => {
    const acquisti = [acquisto('carrello', '2026-11-01', { scontrino_id: 's1' }), acquisto('nuovo', '2026-11-01', { fonte: 'scontrino', scontrino_id: 's1' })];
    const righe = [riga('c1', 'carrello', 'ing:pollo', 7), riga('n1', 'nuovo', 'ing:mela', 2)];
    const scontrini: Scontrino[] = [{ id: 's1', data: '2026-11-01', totale: 10, acquisto_id: 'nuovo' }];
    const righeScontrino: RigaScontrino[] = [
      { id: 'x1', scontrino_id: 's1', prezzo: 7, acquisto_riga_id: 'c1' },
      { id: 'x2', scontrino_id: 's1', prezzo: 2, acquisto_riga_id: 'n1' },
      { id: 'x3', scontrino_id: 's1', prezzo: 0.2, acquisto_riga_id: null },
    ];
    const r = resoconto(acquisti, righe, scontrini, righeScontrino);
    expect(r.mesi[5]).toEqual({ mese: '2026-11', euro: 10, spese: 1 });
    expect(Object.fromEntries(r.reparti.get('2026-11')!)).toEqual({ carne: 7, frutta_verdura: 2, altro: 0.2, [DIFFERENZA]: 0.8 });
    expect(r.senzaPrezzo.get('2026-11')).toBe(0);
  });

  it('uno scontrino senza totale vale la somma delle righe; annullato non conta', () => {
    const scontrini: Scontrino[] = [
      { id: 's1', data: '2026-10-03', totale: null, acquisto_id: null },
      { id: 's2', data: '2026-10-04', totale: 50, acquisto_id: 'a2' },
    ];
    const righeScontrino: RigaScontrino[] = [
      { id: 'x1', scontrino_id: 's1', prezzo: 1.5, acquisto_riga_id: null },
      { id: 'x2', scontrino_id: 's1', prezzo: null, acquisto_riga_id: null },
    ];
    const r = resoconto([acquisto('a2', '2026-10-04', { fonte: 'scontrino', stato: 'annullato', scontrino_id: 's2' })], [], scontrini, righeScontrino);
    expect(r.mesi[4]).toEqual({ mese: '2026-10', euro: 1.5, spese: 1 });
    expect(r.senzaPrezzo.get('2026-10')).toBe(1);
  });
});

describe('nomeMese', () => {
  it('scrive il mese in italiano', () => {
    expect(nomeMese('2026-11')).toBe('novembre 2026');
    expect(nomeMese('2026-11', true)).toBe('nov');
  });
});
