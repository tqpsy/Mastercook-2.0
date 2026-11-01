import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { portateDaSpostare } from './modificate';
import { Indice } from './ricette';

describe('piatti che passano alla ricetta modificata', () => {
  it('solo da oggi in poi, con quella ricetta, non confermati e non cucinati', () => {
    const portate = [
      { id: 'ieri', data: '2026-10-31', categoria: 'pranzo', ricetta_id: 'sys:carbonara', versione: 1 },
      { id: 'oggi', data: '2026-11-01', categoria: 'cena', ricetta_id: 'sys:carbonara', versione: 3 },
      { id: 'confermato', data: '2026-11-01', categoria: 'pranzo', ricetta_id: 'sys:carbonara' },
      { id: 'cucinato', data: '2026-11-03', categoria: 'cena', ricetta_id: 'sys:carbonara' },
      { id: 'altra', data: '2026-11-02', categoria: 'cena', ricetta_id: 'sys:amatriciana' },
      { id: 'domani', data: '2026-11-02', categoria: 'pranzo', ricetta_id: 'sys:carbonara' },
    ];
    const conferme = [{ id: 'c', data: '2026-11-01', categoria: 'pranzo' }];
    const lotti = [{ id: 'l', portata_id: 'cucinato' }];
    expect(portateDaSpostare(portate, conferme, lotti, 'sys:carbonara', '2026-11-01')).toEqual([
      { id: 'oggi', versione: 3 },
      { id: 'domani', versione: 1 },
    ]);
  });
});

describe('la versione modificata prende il posto dell’originale', () => {
  const sistema = new Indice(catalogo as Catalogo);
  const originale = sistema.perId.get('sys:carbonara')!;
  const mia = { ...originale, id: 'mia', di_sistema: false, derivata_da: 'sys:carbonara', titolo: 'Carbonara' };
  const copia = { ...mia, id: 'copia', titolo: 'Carbonara (mia versione)' };

  it('solo se segnata come modificata: l’originale esce dall’elenco ma resta per i menu passati', () => {
    const indice = new Indice(catalogo as Catalogo, [], [mia, copia], new Set(['mia']));
    expect(indice.ricette.some((r) => r.id === 'sys:carbonara')).toBe(false);
    expect(indice.ricette.map((r) => r.id)).toEqual(expect.arrayContaining(['mia', 'copia']));
    expect(indice.perId.get('sys:carbonara')?.titolo).toBe(originale.titolo);
    expect(indice.sostituite.get('sys:carbonara')?.id).toBe('mia');
    expect(indice.ricette).toHaveLength(sistema.ricette.length + 1);
  });

  it('una copia qualsiasi o una versione archiviata non tolgono l’originale', () => {
    expect(new Indice(catalogo as Catalogo, [], [copia]).ricette.some((r) => r.id === 'sys:carbonara')).toBe(true);
    const archiviata = new Indice(catalogo as Catalogo, [], [{ ...mia, archiviata: true }], new Set(['mia']));
    expect(archiviata.ricette.some((r) => r.id === 'sys:carbonara')).toBe(true);
    expect(archiviata.sostituite.size).toBe(0);
  });
});
