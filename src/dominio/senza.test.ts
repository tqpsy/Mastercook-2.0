import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { previstoPortata } from './consumi';
import { type PortataMenu, valutaPortata } from './menu';
import { quotaSenza, ricettaSenza, rimedio, senzaDaScegliere, senzaPer, testoRimedio } from './senza';
import { Indice } from './ricette';

const indice = new Indice(catalogo as Catalogo);
const ricetta = (id: string) => indice.perId.get(id)!;
const persone = [
  { id: 'luca', nome: 'Luca', porzione: 1 },
  { id: 'sara', nome: 'Sara', porzione: 1 },
  { id: 'marco', nome: 'Marco', porzione: 0.5 },
];
const di = (membro_id: string, oggetto: string, tipo = 'intolleranza') => ({ membro_id, tipo, oggetto });

describe('togliere un ingrediente da un piatto ⛔', () => {
  it('lattosio nella pasta con le zucchine: si toglie il parmigiano e il piatto va bene a Sara', () => {
    const x = rimedio(indice, ricetta('sys:pasta_zucchine'), persone, [di('sara', 'ing:lattosio')])!;
    expect(x.possibile).toBe(true);
    expect(x.adattaDopo).toBe(true);
    expect(x.togli).toEqual(['ing:parmigiano']);
    expect(x.perMembro.map((m) => m.nome)).toEqual(['Sara']);
    expect(testoRimedio(indice, x)).toBe('Si fa senza parmigiano reggiano per Sara');
  });

  it('nel nome del piatto, nell’impasto o a reggere il piatto non si toglie', () => {
    const lattosio = [di('sara', 'ing:lattosio')];
    expect(rimedio(indice, ricetta('sys:penne_salmone'), persone, lattosio)!.perMembro[0].bloccato).toContain('nel nome del piatto');
    expect(rimedio(indice, ricetta('sys:pollo_mandorle'), persone, [di('sara', 'all:frutta_a_guscio', 'allergia')])!.possibile).toBe(false);
    const glutine = [di('sara', 'all:glutine', 'allergia')];
    expect(rimedio(indice, ricetta('sys:torta_mele'), persone, glutine)!.perMembro[0].bloccato).toContain('impasto');
    expect(rimedio(indice, ricetta('sys:ribollita'), persone, glutine)!.perMembro[0].bloccato).toContain('regge il piatto');
    // La farina per infarinare le scaloppine invece si toglie.
    expect(rimedio(indice, ricetta('sys:scaloppine_limone'), persone, glutine)!.possibile).toBe(true);
  });

  it('una verdura tra tante (le zucchine nel minestrone) si toglie; l’ingrediente che regge il piatto no', () => {
    expect(rimedio(indice, ricetta('sys:minestrone'), persone, [di('sara', 'ing:zucchina')])!.possibile).toBe(true);
    const gorgonzola = rimedio(indice, ricetta('sys:gnocchi_gorgonzola'), persone, [di('sara', 'ing:gorgonzola')])!;
    expect(gorgonzola.possibile).toBe(false);
    expect(gorgonzola.perMembro[0].bloccato).toContain('ingrediente principale');
    // La pasta della carbonara per chi non mangia glutine, il guanciale per chi non mangia maiale.
    expect(rimedio(indice, ricetta('sys:carbonara'), persone, [di('sara', 'all:glutine', 'allergia')])!.possibile).toBe(false);
    expect(rimedio(indice, ricetta('sys:carbonara'), persone, [di('sara', 'cls:senza_maiale', 'esigenza')])!.possibile).toBe(false);
  });

  it('la parte più grande del piatto non si toglie: la panna della panna cotta', () => {
    const x = rimedio(indice, ricetta('sys:panna_cotta'), persone, [di('sara', 'ing:lattosio')])!;
    expect(x.possibile).toBe(false);
    expect(x.perMembro[0].bloccato).toMatch(/nel nome del piatto|parte più grande/);
  });

  it('le uova crude non si tolgono, e un piatto adatto a tutti non ha niente da togliere', () => {
    const tiramisu = rimedio(indice, ricetta('sys:tiramisu'), persone, [di('marco', 'cls:no_uova_crude', 'esigenza')])!;
    expect(tiramisu.possibile).toBe(false);
    expect(tiramisu.perMembro[0].bloccato).toContain('non basta togliere');
    expect(rimedio(indice, ricetta('sys:minestrone'), persone, [di('sara', 'ing:lattosio')])).toBeNull();
  });

  it('per tutti una voce sola per ingrediente; solo per lei una voce per persona; gli ospiti sempre per tutti', () => {
    const x = rimedio(indice, ricetta('sys:minestrone'), [...persone, { id: 'ospiti', nome: 'Ospiti' }], [di('sara', 'ing:zucchina'), di('ospiti', 'ing:fagioli')])!;
    const famiglia = new Set(persone.map((p) => p.id));
    expect(senzaDaScegliere(x, true, famiglia)).toEqual([
      { ingrediente_id: 'ing:zucchina', membro_id: null },
      { ingrediente_id: 'ing:fagioli', membro_id: null },
    ]);
    expect(senzaDaScegliere(x, false, famiglia)).toEqual([
      { ingrediente_id: 'ing:fagioli', membro_id: null },
      { ingrediente_id: 'ing:zucchina', membro_id: 'sara' },
    ]);
  });

  it('nel menu il piatto senza panna per Sara è adatto a lei, e la panna si conta solo per gli altri', () => {
    const senza = [
      { ingrediente_id: 'ing:panna', membro_id: 'sara' },
      { ingrediente_id: 'ing:burro', membro_id: 'sara' },
    ];
    const r = ricetta('sys:penne_salmone');
    const v = valutaPortata(indice, r, persone, [di('sara', 'ing:lattosio')], [], undefined, senza);
    expect(v.esito).toBe('adatta');
    expect(v.perMembro.find((m) => m.membro_id === 'sara')!.senza).toEqual(['ing:panna', 'ing:burro']);
    expect(senzaPer(senza, 'luca')).toEqual([]);
    expect(ricettaSenza(r, ['ing:panna']).ingredienti.some((g) => g.ingrediente_id === 'ing:panna')).toBe(false);

    const portata: PortataMenu = { id: 'p', data: '2026-11-03', categoria: 'cena', ricetta_id: r.id, testo: null, porzioni: null, origine: 'manuale', bloccata: false, ordine: 0, note: null, senza };
    const previsto = previstoPortata(indice, portata, persone, []);
    // 2,5 porzioni, Sara esclusa dalla panna: 1,5 porzioni su 4 → 75 ml (come nel database).
    expect(previsto.find((c) => c.ingrediente_id === 'ing:panna')!.quantita).toBe(75);
    expect(previsto.find((c) => c.ingrediente_id === 'ing:penne')!.quantita).toBe(200);
    expect(quotaSenza([{ ingrediente_id: 'ing:panna', membro_id: null }], 'ing:panna', persone, new Set(), 2.5)).toBe(0);
    // Sara non mangia: per gli altri la panna c'è tutta.
    expect(quotaSenza(senza, 'ing:panna', persone, new Set(['sara']), 1.5)).toBe(1);
  });
});
