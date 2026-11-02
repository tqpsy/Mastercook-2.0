import { describe, expect, it } from 'vitest';
import type { RigaInVista } from '../dati/anteprima';
import { avanziInCasa } from './avanzi';
import { categorieDellaFamiglia, type PortataMenu } from './menu';
import type { Indice, Ricetta } from './ricette';

const lasagne = { id: 'sys:lasagne', titolo: 'Lasagne' } as Ricetta;
const indice = { perId: new Map([[lasagne.id, lasagne]]) } as unknown as Indice;
const portata = (id: string, data: string, categoria: string, campi: Partial<PortataMenu> = {}): PortataMenu => ({
  id,
  data,
  categoria,
  ricetta_id: 'sys:lasagne',
  testo: null,
  porzioni: 4,
  origine: 'manuale',
  bloccata: false,
  ordine: 0,
  note: null,
  ...campi,
});
const lotto = (id: string, campi: Record<string, unknown>) => ({ id, famiglia_id: 'f', seq: 1, ingrediente_id: 'ing:avanzo', quantita: 2, luogo: 'frigo', nome: 'Lasagne', ...campi }) as RigaInVista;
const dati = (portate: PortataMenu[]) => ({ portate, categorie: categorieDellaFamiglia([]) });

describe('avanzi in casa da mettere in un pasto', () => {
  it('l’avanzo di ieri si lega al piatto, col luogo e le porzioni', () => {
    const r = avanziInCasa(indice, dati([portata('p1', '2026-11-01', 'cena')]), [], [lotto('l1', { portata_id: 'p1', luogo: 'freezer' })], '2026-11-02', 'pranzo');
    expect(r).toMatchObject([{ titolo: 'Lasagne', origine: { id: 'p1' }, porzioni: 2, luogo: 'freezer' }]);
  });

  it('il pranzo avanzato va a cena dello stesso giorno, non a colazione né allo stesso pranzo', () => {
    const d = dati([portata('p1', '2026-11-02', 'pranzo')]);
    const l = [lotto('l1', { conferma_id: 'c1' })];
    const c = [{ id: 'c1', portata_id: 'p1' }];
    expect(avanziInCasa(indice, d, c, l, '2026-11-02', 'cena')).toHaveLength(1);
    expect(avanziInCasa(indice, d, c, l, '2026-11-02', 'pranzo')).toHaveLength(0);
    expect(avanziInCasa(indice, d, c, l, '2026-11-02', 'colazione')).toHaveLength(0);
  });

  it('un piatto cucinato in anticipo per un giorno dopo resta nel suo pasto', () => {
    expect(avanziInCasa(indice, dati([portata('p1', '2026-11-04', 'cena')]), [], [lotto('l1', { portata_id: 'p1' })], '2026-11-02', 'cena')).toEqual([]);
  });

  it('senza il piatto d’origine (scritto a mano, tolto dal menu, dalla vecchia app) compare col suo nome', () => {
    const r = avanziInCasa(
      indice,
      dati([portata('p2', '2026-11-01', 'cena', { ricetta_id: null, testo: 'Polpette della nonna' })]),
      [],
      [lotto('l1', { portata_id: 'sparita', nome: 'Arrosto' }), lotto('l2', { portata_id: 'p2', luogo: 'dispensa' })],
      '2026-11-02',
      'pranzo',
    );
    expect(r.map((a) => [a.titolo, a.origine, a.luogo])).toEqual([
      ['Arrosto', null, 'frigo'],
      ['Polpette della nonna', null, 'dispensa'],
    ]);
  });

  it('finiti, chiusi o tolti non compaiono', () => {
    const d = dati([portata('p1', '2026-11-01', 'cena')]);
    const l = [lotto('a', { portata_id: 'p1', quantita: 0 }), lotto('b', { portata_id: 'p1', chiuso_il: 'x' }), lotto('c', { portata_id: 'p1', eliminato_il: 'x' })];
    expect(avanziInCasa(indice, d, [], l, '2026-11-02', 'pranzo')).toEqual([]);
  });
});
