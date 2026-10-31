import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { basiDisponibili, righeEBasi, testoDosi } from './basi';
import { Indice, ricetteDellaFamiglia } from './ricette';

const indice = new Indice(catalogo as Catalogo, [], []);

describe('ricette collegate', () => {
  it('la besciamella fatta in casa è tra le basi; le ricette normali no', () => {
    const ids = basiDisponibili(indice).map((r) => r.id);
    expect(ids).toContain('sys:besciamella');
    expect(ids).not.toContain('sys:carbonara');
  });

  it('le righe della base si raggruppano, le altre restano proprie', () => {
    const [lasagna] = ricetteDellaFamiglia(
      [{ id: 'l', titolo: 'Lasagna', categoria: 'piatto_unico', porzioni: 4 }],
      [
        { id: 'a', ricetta_id: 'l', ingrediente_id: 'ing:carne_macinata', quantita: 500, unita: 'g', ordine: 1 },
        { id: 'b', ricetta_id: 'l', ingrediente_id: 'ing:latte', quantita: 500, unita: 'ml', ordine: 2, da_ricetta_id: 'sys:besciamella', dosi: '0.5' },
        { id: 'c', ricetta_id: 'l', ingrediente_id: 'ing:burro', quantita: 50, unita: 'g', ordine: 3, da_ricetta_id: 'sys:besciamella', dosi: '0.5' },
      ],
      [],
    );
    const { proprie, basi } = righeEBasi(lasagna);
    expect(proprie.map((g) => g.ingrediente_id)).toEqual(['ing:carne_macinata']);
    expect(basi).toHaveLength(1);
    expect(basi[0]).toMatchObject({ ricetta_id: 'sys:besciamella', dosi: 0.5 });
    expect(basi[0].righe.map((g) => g.ingrediente_id)).toEqual(['ing:latte', 'ing:burro']);
  });

  it('le dosi si leggono bene', () => {
    expect([0.5, 1, 1.5, 2].map(testoDosi)).toEqual(['mezza dose', '1 dose', '1,5 dosi', '2 dosi']);
  });
});
