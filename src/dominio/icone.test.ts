import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { iconaRicetta, Indice } from './ricette';

const indice = new Indice(catalogo as Catalogo);
const icona = (id: string, scelta?: string) => iconaRicetta(indice, indice.perId.get(id)!, scelta);

describe('icona di una ricetta', () => {
  it('viene dall’ingrediente principale, non dalla categoria', () => {
    expect(icona('sys:riso_basmati_spezie')).toBe('🍚');
    expect(icona('sys:carbonara')).toBe('🍝');
  });
  it('dolci e colazioni tengono l’icona della categoria; la farina non rappresenta un piatto', () => {
    expect(icona('sys:torta_mele')).toBe('🍰');
    expect(icona('sys:focaccia')).not.toBe('🌾');
  });
  it('quella scelta dalla famiglia vince', () => {
    expect(icona('sys:riso_basmati_spezie', '🍛')).toBe('🍛');
  });
});
