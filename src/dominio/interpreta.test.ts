import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { valutaPerVincoli } from './compatibilita';
import { classiDi, interpreta } from './interpreta';
import { Indice, ingredienteDellaFamiglia, type Ricetta } from './ricette';

const indice = new Indice(catalogo as Catalogo);
const ricetta = (id: string) => indice.perId.get(id)!;
const scritto = (testo: string, tipo = 'esigenza') => ({ membro_id: 'm', tipo, oggetto: `txt:${testo.toLowerCase().replace(/[^a-z]+/g, '_')}`, testo });

describe('vincoli scritti a parole', () => {
  it('«Niente funghi» diventa l’ingrediente funghi, con le varietà', () => {
    const { capiti, nonCapiti } = interpreta(indice, 'Niente funghi');
    expect(nonCapiti).toEqual([]);
    expect(capiti[0]?.ingredienti).toEqual(['ing:funghi']);
    expect(interpreta(indice, 'no fungo').capiti[0]?.ingredienti).toEqual(['ing:funghi']);
  });

  it('più cose insieme, gruppi e allergeni', () => {
    const { capiti, nonCapiti } = interpreta(indice, 'Allergia ai frutti di mare, sedano e uova crude');
    expect(nonCapiti).toEqual([]);
    expect(capiti.map((c) => c.nome)).toEqual(['Frutti di mare', 'Sedano', 'Uova crude']);
    expect(capiti[0]!.ingredienti!.length).toBeGreaterThan(10);
    expect(capiti[1]!.oggetto).toBe('all:sedano');
    expect(capiti[2]!.oggetto).toBe('cls:no_uova_crude');
  });

  it('quello che non riconosce lo dice', () => {
    expect(interpreta(indice, 'niente cose strane').nonCapiti).toEqual(['cose strane']);
  });

  it('«Niente funghi» non mette più il punto di domanda dove i funghi non ci sono', () => {
    expect(valutaPerVincoli(indice, ricetta('sys:spaghetti_aglio_olio'), [scritto('Niente funghi')]).esito).toBe('adatta');
    const e = valutaPerVincoli(indice, ricetta('sys:risotto_funghi'), [scritto('Niente funghi')]);
    expect(e.esito).toBe('non_adatta');
    expect(e.motivi[0]).toContain('funghi');
  });

  it('un ingrediente della famiglia si riconosce anche dal nome', () => {
    const porcini = ingredienteDellaFamiglia({ id: 'f1', nome: 'Funghi porcini secchi della nonna', dimensione: 'massa', allergeni_noti: false });
    const conPorcini = new Indice(catalogo as Catalogo, [porcini]);
    const base = ricetta('sys:spaghetti_aglio_olio');
    const r: Ricetta = { ...base, ingredienti: [...base.ingredienti, { id: 'r', ingrediente_id: 'f1', quantita: 20, unita: 'g', qb: false, opzionale: false, testo: null, ordine: 9 }] };
    expect(valutaPerVincoli(conPorcini, r, [scritto('Niente funghi')]).esito).toBe('non_adatta');
  });
});

describe('che cos’è un ingrediente della famiglia', () => {
  const vinoRiso = ingredienteDellaFamiglia({ id: 'v1', nome: 'Vino di riso', dimensione: 'volume', allergeni_noti: false });
  const conVino = new Indice(catalogo as Catalogo, [vinoRiso]);

  it('dal nome: il vino di riso è un alcolico, il latte di cocco non è un latticino', () => {
    expect(classiDi(conVino, vinoRiso)).toEqual({ classi: ['alcol'], note: true });
    const cocco = ingredienteDellaFamiglia({ id: 'c1', nome: 'Latte di cocco', dimensione: 'volume', allergeni_noti: false });
    expect(classiDi(conVino, cocco).classi).not.toContain('latticini');
  });

  it('per i crudi non serve sapere gli allergeni del vino di riso', () => {
    const base = ricetta('sys:spaghetti_aglio_olio');
    const r: Ricetta = { ...base, ingredienti: [...base.ingredienti, { id: 'r', ingrediente_id: 'v1', quantita: 20, unita: 'ml', qb: false, opzionale: false, testo: null, ordine: 9 }] };
    expect(valutaPerVincoli(conVino, r, [{ membro_id: 'm', tipo: 'esigenza', oggetto: 'cls:no_uova_crude' }]).esito).toBe('adatta');
    expect(valutaPerVincoli(conVino, r, [{ membro_id: 'm', tipo: 'esigenza', oggetto: 'cls:senza_alcol' }]).esito).toBe('non_adatta');
    // Per un'allergia invece sì.
    expect(valutaPerVincoli(conVino, r, [{ membro_id: 'm', tipo: 'allergia', oggetto: 'all:sesamo' }]).esito).toBe('da_verificare');
  });

  it('una ricetta copiata da Mastercook sa quali ingredienti si cuociono', () => {
    const base = ricetta('sys:riso_cantonese');
    const copia: Ricetta = { ...base, id: 'fam1', di_sistema: false, derivata_da: base.id };
    expect(valutaPerVincoli(indice, copia, [{ membro_id: 'm', tipo: 'esigenza', oggetto: 'cls:no_uova_crude' }]).esito).toBe('adatta');
    const nuova: Ricetta = { ...copia, derivata_da: null };
    expect(valutaPerVincoli(indice, nuova, [{ membro_id: 'm', tipo: 'esigenza', oggetto: 'cls:no_uova_crude' }]).esito).toBe('da_verificare');
  });
});
