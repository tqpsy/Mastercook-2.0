import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { abbinaAlimenti, giaInCasa } from './fotoFrigo';
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

describe('foto del frigo: cosa c’è già in casa', () => {
  const lotti = [
    { ingrediente_id: 'ing:latte', luogo: 'frigo', unita: 'ml', quantita: 1000 },
    { ingrediente_id: 'ing:latte', luogo: 'frigo', unita: 'ml', quantita: 500 },
    { ingrediente_id: 'ing:latte', luogo: 'dispensa', unita: 'ml', quantita: 1000 },
    { ingrediente_id: 'ing:olio', luogo: 'frigo', unita: 'pz', quantita: 2, livello: 'meta' },
    { ingrediente_id: 'ing:uova', luogo: 'frigo', unita: 'pz', quantita: 0 },
  ];
  it('somma i lotti dello stesso ingrediente nello stesso posto', () => {
    expect(giaInCasa(lotti, 'ing:latte', 'frigo')).toEqual({ lotti: 2, quantita: 1500, unita: 'ml', aOcchio: false });
  });
  it('un prodotto a occhio non ha una quantità da sommare', () => {
    expect(giaInCasa(lotti, 'ing:olio', 'frigo')).toEqual({ lotti: 1, quantita: 0, unita: 'pz', aOcchio: true });
  });
  it('niente se non c’è o se è finito', () => {
    expect(giaInCasa(lotti, 'ing:uova', 'frigo')).toBeNull();
    expect(giaInCasa(lotti, 'ing:pane', 'frigo')).toBeNull();
  });
});
