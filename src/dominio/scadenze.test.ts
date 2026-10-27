import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { Indice } from './ricette';
import { daUsarePresto, descriviData, piuGiorni, spreco, statoData, stima } from './scadenze';

const indice = new Indice(catalogo as Catalogo);
const insalata = indice.ingrediente('ing:insalata')!;
const OGGI = '2026-10-27';

describe('scadenze e stime (T-SCA)', () => {
  it('T-SCA-3 la stessa insalata: stima più breve in dispensa che in frigo, marcata come stima con la data del calcolo', () => {
    const adesso = new Date('2026-10-27T09:00:00Z');
    const frigo = stima(insalata, 'frigo', OGGI, adesso)!;
    const dispensa = stima(insalata, 'dispensa', OGGI, adesso)!;
    expect(frigo).toMatchObject({ tipo_data: 'stimata', fonte_data: 'app', calcolata_il: adesso.toISOString() });
    expect(dispensa.giorni).toBeLessThan(frigo.giorni);
    expect(frigo.data_limite).toBe(piuGiorni(OGGI, insalata.giorni!));
  });

  it('senza regola non c’è stima: resta sconosciuta (T-SCA-2 per i confezionati la decide chi inserisce)', () => {
    expect(stima({ luogo: 'frigo', giorni: null }, 'frigo', OGGI)).toBeNull();
    expect(stima(insalata, 'freezer', OGGI)).toBeNull();
  });

  it('T-SCA-4 TMC superato e scadenza superata hanno etichette diverse', () => {
    expect(statoData({ data_limite: '2026-10-25', tipo_data: 'scadenza' }, OGGI)).toBe('scaduto');
    expect(statoData({ data_limite: '2026-10-25', tipo_data: 'tmc' }, OGGI)).toBe('oltre_tmc');
    expect(descriviData({ data_limite: '2026-10-25', tipo_data: 'scadenza' }, OGGI)).toBe('Scaduto da 2 giorni');
    expect(descriviData({ data_limite: '2026-10-25', tipo_data: 'tmc' }, OGGI)).toBe('Oltre il «preferibilmente entro» da 2 giorni');
    expect(descriviData({ data_limite: null, tipo_data: 'sconosciuta' }, OGGI)).toBe('Data sconosciuta');
    expect(descriviData({ data_limite: '2026-10-29', tipo_data: 'stimata' }, OGGI)).toBe('Entro 2 giorni (stima)');
  });

  it('T-SCA-6 «da usare presto»: prima gli scaduti, poi oggi, poi i prossimi giorni, poi da controllare', () => {
    const lotti = [
      { id: 'lontano', data_limite: '2026-12-01', tipo_data: 'scadenza' as const },
      { id: 'sconosciuto', data_limite: null, tipo_data: 'sconosciuta' as const },
      { id: 'presto', data_limite: '2026-10-29', tipo_data: 'scadenza' as const },
      { id: 'scaduto', data_limite: '2026-10-26', tipo_data: 'scadenza' as const },
      { id: 'oggi', data_limite: OGGI, tipo_data: 'scadenza' as const },
      { id: 'tmc', data_limite: '2026-10-20', tipo_data: 'tmc' as const },
      { id: 'chiuso', data_limite: '2026-10-20', tipo_data: 'scadenza' as const, chiuso_il: '2026-10-21' },
      { id: 'stima_lontana', data_limite: '2026-11-20', tipo_data: 'stimata' as const },
    ];
    expect(daUsarePresto(lotti, OGGI).map((l) => l.id)).toEqual(['scaduto', 'oggi', 'presto', 'tmc', 'sconosciuto', 'stima_lontana']);
  });

  it('T-CAS-3 statistiche di spreco: solo spreco e scaduto, per ingrediente e unità', () => {
    const lotti = new Map([
      ['a', { ingrediente_id: 'ing:insalata', unita: 'g' }],
      ['b', { ingrediente_id: 'ing:yogurt', unita: 'g' }],
    ]);
    const mov = [
      { lotto_id: 'a', variazione: 250, causale: 'carico', creato_il: '2026-10-20T10:00:00Z' },
      { lotto_id: 'a', variazione: -100, causale: 'spreco', creato_il: '2026-10-22T10:00:00Z' },
      { lotto_id: 'a', variazione: -150, causale: 'scaduto', creato_il: '2026-10-25T10:00:00Z' },
      { lotto_id: 'b', variazione: -125, causale: 'consumo', creato_il: '2026-10-25T10:00:00Z' },
      { lotto_id: 'b', variazione: -125, causale: 'spreco', creato_il: '2026-09-01T10:00:00Z' },
    ];
    expect(spreco(mov, lotti, '2026-10-01')).toEqual([{ ingrediente_id: 'ing:insalata', unita: 'g', quantita: 250, volte: 2 }]);
  });
});
