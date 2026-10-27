import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import {
  categorieDellaFamiglia,
  type Eccezione,
  gustiPerPiatto,
  lunedi,
  nomeSettimana,
  type PortataMenu,
  porzioniAutomatiche,
  ripetiSettimana,
  valutaPortata,
} from './menu';
import { Indice } from './ricette';

const indice = new Indice(catalogo as Catalogo);
const ricetta = (id: string) => indice.perId.get(id)!;
const persone = [
  { id: 'luca', nome: 'Luca', porzione: 1 },
  { id: 'anna', nome: 'Anna', porzione: 1 },
  { id: 'sara', nome: 'Sara', porzione: 0.6 },
];
const ecc = (membro_id: string, extra: Partial<Eccezione> = {}): Eccezione => ({
  id: `e-${membro_id}`,
  portata_id: 'p',
  membro_id,
  tipo: 'non_mangia',
  ricetta_id: null,
  testo: null,
  porzioni: null,
  ...extra,
});

describe('settimane', () => {
  it('il lunedì di qualunque giorno, anche a cavallo di mese', () => {
    expect(lunedi('2026-10-27')).toBe('2026-10-26');
    expect(lunedi('2026-11-01')).toBe('2026-10-26');
    expect(lunedi('2026-11-02')).toBe('2026-11-02');
    expect(nomeSettimana('2026-10-26')).toBe('26 ottobre – 1 novembre');
    expect(nomeSettimana('2026-11-02')).toBe('2–8 novembre');
  });
});

describe('categorie dei pasti', () => {
  it('di base colazione, pranzo e cena; spuntino e merenda si accendono; quelle della famiglia si aggiungono', () => {
    expect(categorieDellaFamiglia([]).filter((c) => c.attiva).map((c) => c.valore)).toEqual(['colazione', 'pranzo', 'cena']);
    const c = categorieDellaFamiglia([
      { id: 'x', chiave: 'merenda', attiva: true },
      { id: 'y', chiave: 'colazione', attiva: false },
      { id: 'brunch', chiave: null, nome: 'Brunch', emoji: '🥞', ordine: 99, attiva: true },
    ]);
    expect(c.filter((x) => x.attiva).map((x) => x.nome)).toEqual(['Pranzo', 'Merenda', 'Cena', 'Brunch']);
    expect(c.find((x) => x.nome === 'Brunch')?.valore).toBe('brunch');
  });
});

describe('porzioni automatiche', () => {
  it('sommano le porzioni di chi mangia il piatto principale', () => {
    expect(porzioniAutomatiche(persone, [])).toBe(2.5);
    expect(porzioniAutomatiche(persone, [ecc('anna')])).toBe(1.5);
    expect(porzioniAutomatiche(persone, [ecc('luca'), ecc('anna', { tipo: 'alternativa', testo: 'Riso' })])).toBe(0.5);
  });
});

describe('compatibilità di una portata', () => {
  const allergiaUova = [{ membro_id: 'sara', tipo: 'allergia', oggetto: 'all:uova' }];

  it('chi è allergico rende la portata non adatta, ma se non la mangia non conta più', () => {
    expect(valutaPortata(indice, ricetta('sys:carbonara'), persone, allergiaUova, []).esito).toBe('non_adatta');
    const v = valutaPortata(indice, ricetta('sys:carbonara'), persone, allergiaUova, [ecc('sara')]);
    expect(v.esito).toBe('adatta');
    expect(v.perMembro.find((m) => m.membro_id === 'sara')).toMatchObject({ mangia: 'niente', valutazione: null });
  });

  it('chi mangia un’alternativa si valuta sull’alternativa', () => {
    const buona = valutaPortata(indice, ricetta('sys:carbonara'), persone, allergiaUova, [ecc('sara', { tipo: 'alternativa', ricetta_id: 'sys:spaghetti_aglio_olio' })]);
    expect(buona.esito).toBe('adatta');
    const cattiva = valutaPortata(indice, ricetta('sys:spaghetti_aglio_olio'), persone, allergiaUova, [ecc('sara', { tipo: 'alternativa', ricetta_id: 'sys:carbonara' })]);
    expect(cattiva.esito).toBe('non_adatta');
  });

  it('un piatto scritto a mano è da verificare per chi ha vincoli, adatto per gli altri', () => {
    const v = valutaPortata(indice, null, persone, allergiaUova, []);
    expect(v.esito).toBe('da_verificare');
    expect(v.perMembro.find((m) => m.membro_id === 'luca')?.valutazione?.esito).toBe('adatta');
  });
});

describe('gusti', () => {
  it('segnala gusti sugli ingredienti (anche per famiglia di ingredienti) e sulla ricetta', () => {
    const gusti = [
      { id: '1', membro_id: 'sara', ingrediente_id: 'ing:zucchina', ricetta_id: null, valore: 'non_piace' as const },
      { id: '2', membro_id: 'luca', ingrediente_id: null, ricetta_id: 'sys:frittata_zucchine', valore: 'piace' as const },
      { id: '3', membro_id: 'anna', ingrediente_id: 'ing:guanciale', ricetta_id: null, valore: 'non_piace' as const },
    ];
    const s = gustiPerPiatto(indice, ricetta('sys:frittata_zucchine'), persone, gusti);
    expect(s).toEqual([
      { membro_id: 'luca', nome: 'Luca', valore: 'piace', cosa: 'Frittata di zucchine' },
      { membro_id: 'sara', nome: 'Sara', valore: 'non_piace', cosa: indice.nome('ing:zucchina') },
    ]);
  });
});

describe('ripetere una settimana', () => {
  it('copia le portate della settimana con lo stesso giorno e porta con sé le eccezioni', () => {
    const p = (id: string, data: string): PortataMenu => ({ id, data, categoria: 'cena', ricetta_id: 'sys:carbonara', testo: null, porzioni: null, origine: 'manuale', bloccata: false, ordine: 0, note: null });
    let n = 0;
    const r = ripetiSettimana([p('a', '2026-10-26'), p('b', '2026-11-01'), p('fuori', '2026-11-02')], [ecc('sara', { portata_id: 'b' })], '2026-10-26', '2026-11-02', () => `n${++n}`);
    expect(r).toEqual({
      portate: [
        { da: 'a', id: 'n1', data: '2026-11-02' },
        { da: 'b', id: 'n2', data: '2026-11-08' },
      ],
      eccezioni: [{ da: 'e-sara', id: 'n3', portata_id: 'n2' }],
    });
  });
});
