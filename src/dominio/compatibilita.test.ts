import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { valutaPerFamiglia, valutaPerVincoli } from './compatibilita';
import { Indice, ingredienteDellaFamiglia, type Ricetta } from './ricette';

const indice = new Indice(catalogo as Catalogo);
const ricetta = (id: string) => indice.perId.get(id)!;
const v = (oggetto: string, extra: Record<string, string> = {}) => ({ membro_id: 'm', tipo: 'allergia', oggetto, ...extra });

describe('compatibilità delle ricette con i vincoli', () => {
  it('un allergene contenuto rende la ricetta non adatta', () => {
    const e = valutaPerVincoli(indice, ricetta('sys:carbonara'), [v('all:uova')]);
    expect(e.esito).toBe('non_adatta');
    expect(e.motivi[0]).toContain('uova');
  });

  it('senza l’allergene e con tutte le informazioni è adatta; «anche tracce» resta da verificare', () => {
    expect(valutaPerVincoli(indice, ricetta('sys:spaghetti_aglio_olio'), [v('all:arachidi')]).esito).toBe('adatta');
    const tracce = valutaPerVincoli(indice, ricetta('sys:spaghetti_aglio_olio'), [v('all:arachidi', { severita: 'evitare_anche_tracce' })]);
    expect(tracce.esito).toBe('da_verificare');
  });

  it('un ingrediente facoltativo con l’allergene: da verificare, non adatta', () => {
    // pasta al pomodoro: parmigiano facoltativo
    const e = valutaPerVincoli(indice, ricetta('sys:pasta_pomodoro'), [v('all:latte')]);
    expect(e.esito).toBe('da_verificare');
  });

  it('un ingrediente della famiglia con allergeni non noti rende la ricetta da verificare, mai adatta', () => {
    const salsa = ingredienteDellaFamiglia({ id: 'x1', nome: 'Salsa misteriosa', dimensione: 'massa', allergeni_noti: false });
    const conSalsa = new Indice(catalogo as Catalogo, [salsa]);
    const base = ricetta('sys:spaghetti_aglio_olio');
    const r: Ricetta = { ...base, ingredienti: [...base.ingredienti, { id: 'r', ingrediente_id: 'x1', quantita: 50, unita: 'g', qb: false, opzionale: false, testo: null, ordine: 9 }] };
    expect(valutaPerVincoli(conSalsa, r, [v('all:arachidi')]).esito).toBe('da_verificare');
  });

  it('esigenze: vegetariano esclude carne e pesce, vegano anche latticini e uova', () => {
    expect(valutaPerVincoli(indice, ricetta('sys:carbonara'), [v('cls:vegetariano', { tipo: 'esigenza' })]).esito).toBe('non_adatta');
    expect(valutaPerVincoli(indice, ricetta('sys:frittata_zucchine'), [v('cls:vegetariano', { tipo: 'esigenza' })]).esito).toBe('adatta');
    expect(valutaPerVincoli(indice, ricetta('sys:frittata_zucchine'), [v('cls:vegano', { tipo: 'esigenza' })]).esito).toBe('non_adatta');
    expect(valutaPerVincoli(indice, ricetta('sys:carbonara'), [v('cls:senza_maiale', { tipo: 'esigenza' })]).esito).toBe('non_adatta');
  });

  it('un ingrediente vietato conta anche nei figli (pasta vieta gli spaghetti)', () => {
    expect(valutaPerVincoli(indice, ricetta('sys:carbonara'), [v('ing:pasta', { tipo: 'intolleranza' })]).esito).toBe('non_adatta');
  });

  it('lattosio si riconosce dai latticini; le intolleranze senza dati e le indicazioni a parole restano da verificare', () => {
    expect(valutaPerVincoli(indice, ricetta('sys:carbonara'), [v('ing:lattosio', { tipo: 'intolleranza' })]).esito).toBe('non_adatta');
    expect(valutaPerVincoli(indice, ricetta('sys:spaghetti_aglio_olio'), [v('ing:nichel', { tipo: 'intolleranza' })]).esito).toBe('da_verificare');
    const medico = valutaPerVincoli(indice, ricetta('sys:spaghetti_aglio_olio'), [v('txt:poco_sale', { tipo: 'indicazione_medica', testo: 'Poco sale' })]);
    expect(medico).toEqual({ esito: 'da_verificare', motivi: ['da controllare: Poco sale'] });
  });

  it('per la famiglia vale l’esito peggiore, con il dettaglio di ognuno', () => {
    const e = valutaPerFamiglia(
      indice,
      ricetta('sys:carbonara'),
      [
        { id: 'a', nome: 'Luca' },
        { id: 'b', nome: 'Sara' },
      ],
      [{ membro_id: 'b', tipo: 'allergia', oggetto: 'all:uova' }],
    );
    expect(e.esito).toBe('non_adatta');
    expect(e.perMembro.map((x) => [x.nome, x.valutazione.esito])).toEqual([
      ['Luca', 'adatta'],
      ['Sara', 'non_adatta'],
    ]);
  });
});
