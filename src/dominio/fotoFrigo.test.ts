import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { abbinaAlimenti } from './fotoFrigo';
import { Indice } from './ricette';

const indice = new Indice(catalogo as Catalogo);

describe('foto del frigo: abbinare al catalogo', () => {
  it('nomi generici diventano ingredienti; quantità solo nell’unità giusta; lo sconosciuto resta fuori, in fondo', () => {
    const p = abbinaAlimenti(indice, [
      { nome: 'oggetto misterioso', quantita: 1, unita: 'pz' },
      { nome: 'latte', quantita: 1000, unita: 'ml' },
      { nome: 'uova', quantita: 6, unita: 'pz' },
      { nome: 'zucchina', quantita: 2, unita: 'pz' },
      { nome: 'latte intero', quantita: 500, unita: 'ml' },
    ]);
    expect(p.map((x) => [x.ingrediente?.id ?? null, x.quantita, x.unita])).toEqual([
      ['ing:latte', 1000, 'ml'],
      ['ing:uova', 6, 'pz'],
      ['ing:zucchina', null, 'g'],
      [null, null, null],
    ]);
    expect(p[3].nome).toBe('oggetto misterioso');
  });
});
