import { describe, expect, it } from 'vitest';
import { mancantiDi } from './mancanti';

describe('mancantiDi', () => {
  it('legge le righe valide e scarta il resto', () => {
    expect(
      mancantiDi({
        mancanti: [
          { ingrediente_id: 'ing:pasta', unita: 'g', quantita: 120 },
          { ingrediente_id: 'ing:uova', unita: 'kg', quantita: 2 },
          { ingrediente_id: 'ing:sale', unita: 'g', quantita: 0 },
          null,
        ],
      }),
    ).toEqual([{ ingrediente_id: 'ing:pasta', unita: 'g', quantita: 120 }]);
  });
  it('senza mancanti dà un elenco vuoto', () => {
    expect(mancantiDi({})).toEqual([]);
    expect(mancantiDi(undefined)).toEqual([]);
    expect(mancantiDi({ mancanti: 'x' })).toEqual([]);
  });
});
