import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { valutaPerFamiglia, valutaPerVincoli } from './compatibilita';
import { CRUDI_NELLE_RICETTE } from './crudi';
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
    expect(medico).toEqual({ esito: 'da_verificare', motivi: ['da controllare: Poco sale'], verificabile: true });
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

describe('esigenze sui crudi', () => {
  const e = (oggetto: string) => [v(oggetto, { tipo: 'esigenza' })];
  it('conta come la ricetta usa l’ingrediente: cotto va bene, crudo no', () => {
    expect(valutaPerVincoli(indice, ricetta('sys:carbonara'), e('cls:no_salumi_crudi')).esito).toBe('adatta');
    expect(valutaPerVincoli(indice, ricetta('sys:saltimbocca'), e('cls:no_salumi_crudi')).esito).toBe('adatta');
    expect(valutaPerVincoli(indice, ricetta('sys:bresaola_rucola'), e('cls:no_salumi_crudi')).esito).toBe('non_adatta');
    expect(valutaPerVincoli(indice, ricetta('sys:salmone_forno'), e('cls:no_pesce_crudo')).esito).toBe('adatta');
    expect(valutaPerVincoli(indice, ricetta('sys:sushi_maki'), e('cls:no_pesce_crudo')).esito).toBe('non_adatta');
    expect(valutaPerVincoli(indice, ricetta('sys:pollo_cacciatora'), e('cls:no_carne_cruda')).esito).toBe('adatta');
    expect(valutaPerVincoli(indice, ricetta('sys:tiramisu'), e('cls:no_uova_crude')).esito).toBe('non_adatta');
  });

  it('latte crudo: il parmigiano cotto in forno va bene, sopra la pasta no; facoltativo o «dipende» è da verificare', () => {
    expect(valutaPerVincoli(indice, ricetta('sys:lasagne'), e('cls:no_latte_crudo')).esito).toBe('adatta');
    expect(valutaPerVincoli(indice, ricetta('sys:cacio_pepe'), e('cls:no_latte_crudo')).esito).toBe('non_adatta');
    expect(valutaPerVincoli(indice, ricetta('sys:pasta_pomodoro'), e('cls:no_latte_crudo')).esito).toBe('da_verificare');
    expect(valutaPerVincoli(indice, ricetta('sys:insalata_greca'), e('cls:no_latte_crudo')).esito).toBe('da_verificare');
  });

  it('in una ricetta della famiglia non si sa se si cuoce: da verificare', () => {
    const r = { ...ricetta('sys:salmone_forno'), id: crypto.randomUUID(), di_sistema: false };
    expect(valutaPerVincoli(indice, r, e('cls:no_pesce_crudo')).esito).toBe('da_verificare');
    expect(valutaPerVincoli(indice, r, e('cls:no_salumi_crudi')).esito).toBe('adatta');
  });

  it('ogni ricetta segnata esiste e usa davvero quegli ingredienti', () => {
    for (const [id, crudi] of Object.entries(CRUDI_NELLE_RICETTE)) {
      const r = ricetta(id);
      expect(r, id).toBeDefined();
      for (const c of crudi) expect(r.ingredienti.map((g) => g.ingrediente_id), id).toContain(c);
    }
  });
});

describe('«va bene» della famiglia', () => {
  const ver = (ricetta_id: string, versione_ricetta = 1) => [{ membro_id: 'm', ricetta_id, versione_ricetta }];
  it('toglie il dubbio e scavalca un’esigenza, per la versione segnata', () => {
    const crudo = [v('cls:no_latte_crudo', { tipo: 'esigenza' })];
    const r = ricetta('sys:cacio_pepe');
    expect(valutaPerVincoli(indice, r, crudo)).toMatchObject({ esito: 'non_adatta', verificabile: true });
    expect(valutaPerFamiglia(indice, r, [{ id: 'm', nome: 'Anna' }], crudo, ver(r.id)).esito).toBe('adatta');
    expect(valutaPerFamiglia(indice, r, [{ id: 'm', nome: 'Anna' }], crudo, ver(r.id, 2)).esito).toBe('non_adatta');
  });
  it('non vale mai contro un’allergia che esclude la ricetta', () => {
    const r = ricetta('sys:carbonara');
    const uova = [v('all:uova')];
    expect(valutaPerVincoli(indice, r, uova)).toMatchObject({ esito: 'non_adatta', verificabile: false });
    expect(valutaPerFamiglia(indice, r, [{ id: 'm', nome: 'Anna' }], uova, ver(r.id)).esito).toBe('non_adatta');
  });
});
