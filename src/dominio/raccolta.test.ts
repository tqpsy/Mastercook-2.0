import { describe, expect, it } from 'vitest';
import { promemoriaRaccolta, raccoltaDa, raccoltaDaLettura } from './raccolta';

describe('raccolta differenziata', () => {
  it('senza impostazioni: niente; valori strani si scartano, giorni ordinati e senza doppioni', () => {
    expect(raccoltaDa(undefined)).toEqual({});
    expect(raccoltaDa({ raccolta: 'lunedì' })).toEqual({});
    expect(raccoltaDa({ raccolta: { organico: [3, 1, 3], carta: ['lunedì', 9, -1], sconosciuto: [1] } })).toEqual({ organico: [1, 3] });
  });

  it('promemoria: 2026-11-27 è venerdì (giorno 5), sabato è 6', () => {
    const giorni = { organico: [1, 4], carta: [5], plastica: [6], vetro: [0] };
    const p = promemoriaRaccolta(giorni, '2026-11-27');
    expect(p).toEqual([
      { tipo: 'carta', quando: 'oggi' },
      { tipo: 'plastica', quando: 'domani' },
    ]);
  });

  it('senza niente oggi o domani: elenco vuoto', () => {
    expect(promemoriaRaccolta({ organico: [1] }, '2026-11-27')).toEqual([]);
    expect(promemoriaRaccolta({}, '2026-11-27')).toEqual([]);
  });

  it('il risultato della lettura con Gemini si pulisce come le impostazioni salvate', () => {
    expect(
      raccoltaDaLettura([
        { tipo: 'organico', giorni: [1, 4] },
        { tipo: 'vetro', giorni: [] },
      ]),
    ).toEqual({ organico: [1, 4] });
    expect(raccoltaDaLettura([])).toEqual({});
  });
});
