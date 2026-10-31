import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { iconaRicetta, Indice } from './ricette';
import { disegnoDalTitolo, iconaIngrediente, ID_DISEGNI_USATI, ID_INGREDIENTI_DISEGNATI } from './iconeCibo';
import { DISEGNI_CIBO, DISEGNO_PER_ID } from '../ui/disegniCibo';

const indice = new Indice(catalogo as Catalogo);
const icona = (id: string, scelta?: string) => iconaRicetta(indice, indice.perId.get(id)!, scelta);

describe('icona di una ricetta', () => {
  it('viene dall’ingrediente principale, non dalla categoria', () => {
    expect(icona('sys:riso_basmati_spezie')).toBe('🍚');
    expect(icona('sys:carbonara')).toBe('mc:spaghetti');
    expect(icona('sys:bresaola_rucola')).toBe('mc:bresaola');
  });
  it('dolci e colazioni tengono l’icona della categoria; la farina non rappresenta un piatto', () => {
    expect(icona('sys:torta_mele')).toBe('🍰');
    expect(icona('sys:focaccia')).toBe('mc:focaccia');
  });
  it('le pizze hanno la pizza, qualunque sia il condimento', () => {
    expect(icona('sys:pizza_margherita')).toBe('🍕');
    expect(icona('sys:pizza_wurstel_patatine')).toBe('🍕');
    expect(icona('sys:pizzaiola')).not.toBe('🍕');
  });
  it('quella scelta dalla famiglia vince', () => {
    expect(icona('sys:riso_basmati_spezie', '🍛')).toBe('🍛');
  });

  it('i piatti senza un’emoji adatta hanno il loro disegno, riconosciuto dal titolo', () => {
    expect(icona('sys:lasagne')).toBe('mc:lasagna');
    expect(icona('sys:lasagne_pesto')).toBe('mc:lasagna');
    expect(icona('sys:risotto_parmigiano')).toBe('mc:risotto');
    expect(icona('sys:parmigiana')).toBe('mc:parmigiana');
    expect(icona('sys:tiramisu')).toBe('mc:tiramisu');
    expect(icona('sys:tortellini_brodo')).toBe('mc:tortellini');
    expect(disegnoDalTitolo('Lasagne della nonna')).toBe('mc:lasagna');
    expect(disegnoDalTitolo('Risotto alla milanese')).toBe('mc:risotto');
    expect(disegnoDalTitolo('Insalata verde')).toBeNull();
  });
  it('ogni disegno usato esiste e ogni ingrediente con un disegno è nel catalogo', () => {
    for (const id of ID_DISEGNI_USATI) expect(DISEGNO_PER_ID.has(id), id).toBe(true);
    for (const id of ID_INGREDIENTI_DISEGNATI) expect(indice.ingrediente(id), id).toBeTruthy();
    expect(iconaIngrediente(indice.ingrediente('ing:prosciutto_crudo'))).toBe('mc:prosciutto_crudo');
    expect(iconaIngrediente(indice.ingrediente('ing:pomodoro'))).toBe('🍅');
  });
  it('i nomi dei disegni vanno bene per il database (lettere minuscole e trattini bassi)', () => {
    for (const d of DISEGNI_CIBO) expect(d.id).toMatch(/^[a-z_]{1,40}$/);
    expect(new Set(DISEGNI_CIBO.map((d) => d.id)).size).toBe(DISEGNI_CIBO.length);
  });
});
