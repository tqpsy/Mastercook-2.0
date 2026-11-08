import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { FRIGO_BASE, posto } from './frigo';
import { Indice } from './ricette';
import {
  confronta,
  controllaPosto,
  contestoPerGemini,
  daGuardare,
  distribuisci,
  idNuovaZona,
  ingredientiDelMenu,
  lottiAttesi,
  type LottoInCasa,
  MEMORIA_VUOTA,
  memoriaDa,
  preparaVerifica,
  prodottiNoti,
  type Visto,
  zoneBase,
  zoneDa,
  vistiDaGemini,
} from './verifica';

const indice = new Indice(catalogo as Catalogo);
const zone = zoneBase(null);

let n = 0;
const lotto = (ingrediente_id: string, quantita: number, unita: 'g' | 'ml' | 'pz', posto: string | null, extra: Partial<LottoInCasa> = {}): LottoInCasa => ({
  id: `l${++n}`,
  ingrediente_id,
  quantita,
  unita,
  luogo: 'frigo',
  posto,
  data_limite: null,
  ...extra,
});
const visto = (nome: string, zona: string, quantita: number | null, unita: Visto['unita'], certezza: Visto['certezza'] = 'sicuro'): Visto => ({ nome, zona, quantita, unita, certezza });

describe('zone', () => {
  it('senza frigo configurato: 4 ripiani, cassetto verdure e porta', () => {
    expect(zone.map((z) => z.nome)).toEqual(['Ripiano 1', 'Ripiano 2', 'Ripiano 3', 'Ripiano 4', 'Cassetto verdure', 'Porta del frigo']);
  });

  it('dal frigo configurato: ogni ripiano e cassetto, lo sportello in una zona sola', () => {
    const z = zoneBase(FRIGO_BASE);
    expect(z.at(-1)).toMatchObject({ id: 'porta', posti: expect.arrayContaining(['s1']) });
    expect(z.every((x) => x.luogo === 'frigo')).toBe(true);
    expect(new Set(z.map((x) => x.id)).size).toBe(z.length);
  });

  it('quelle salvate valgono se sono sensate; le rotte si saltano', () => {
    const salvate = { verifica: { zone: [{ id: 'z-1', nome: ' Cantina ', luogo: 'dispensa' }, { id: 'X!', nome: 'no', luogo: 'frigo' }, { id: 'r1', nome: 'Su', luogo: 'frigo', posti: ['r1', 'x'] }] } };
    expect(zoneDa(salvate, null)).toEqual([
      { id: 'z-1', nome: 'Cantina', luogo: 'dispensa' },
      { id: 'r1', nome: 'Su', luogo: 'frigo', posti: ['r1'] },
    ]);
    expect(zoneDa({ verifica: { zone: [] } }, null)).toEqual(zone);
    expect(idNuovaZona(zone, () => 0.5)).toMatch(/^z-[a-z0-9]{5}$/);
  });

  it('la memoria si legge anche se rovinata', () => {
    expect(memoriaDa(null)).toEqual(MEMORIA_VUOTA);
    expect(memoriaDa({ verifica: { memoria: { alias: { zucchine: { i: 'ing:zucchina', d: 'x' }, rotto: 3 }, posizioni: { 'ing:latte': { z: 'porta', n: 2 } } } } })).toEqual({
      alias: { zucchine: 'ing:zucchina' },
      errori: {},
      posizioni: { 'ing:latte': { zona: 'porta', volte: 2 } },
    });
  });
});

describe('cosa ci si aspetta di trovare', () => {
  it('i lotti delle zone fotografate; quelli senza posto solo se si è fotografato tutto il luogo', () => {
    const uova = lotto('ing:uova', 6, 'pz', 'r2');
    const latte = lotto('ing:latte', 1000, 'ml', 's1');
    const burro = lotto('ing:burro', 250, 'g', null);
    const memoria = { ...MEMORIA_VUOTA, posizioni: { 'ing:burro': { zona: 'r2', volte: 1 } } };
    expect([...lottiAttesi([uova, latte, burro], zone, ['r2'], MEMORIA_VUOTA).keys()]).toEqual(['ing:uova']);
    // Il burro sta di solito sul ripiano 2: ci si aspetta di vederlo lì.
    expect([...lottiAttesi([uova, latte, burro], zone, ['r2'], memoria).keys()]).toEqual(['ing:uova', 'ing:burro']);
    expect([...lottiAttesi([uova, latte, burro], zone, zone.map((z) => z.id), MEMORIA_VUOTA).keys()]).toEqual(['ing:uova', 'ing:latte', 'ing:burro']);
  });
});

describe('confronto', () => {
  const uova = lotto('ing:uova', 6, 'pz', 'r2');
  const latte = lotto('ing:latte', 1000, 'ml', 's1');
  const burro = lotto('ing:burro', 250, 'g', 'r2');
  const yogurt = lotto('ing:yogurt', 2, 'pz', 'r3');

  it('coerenti nascosti in rapida; diversi, non visti, nuovi e incerti in vista', () => {
    const righe = confronta({
      indice,
      lotti: [uova, latte, burro, yogurt],
      zone,
      fotografate: ['r2', 'porta'],
      visti: [visto('uova', 'r2', 2, 'pz'), visto('latte', 'porta', 1, 'l' as never), visto('zucchina', 'r2', 3, 'pz', 'probabile'), visto('oggetto misterioso', 'r2', null, null)],
      memoria: MEMORIA_VUOTA,
    });
    const tipo = Object.fromEntries(righe.map((r) => [r.chiave, r.tipo]));
    // Il latte nello sportello è al posto sbagliato (igiene), anche se la quantità torna.
    expect(tipo).toEqual({ 'ing:uova': 'quantita', 'ing:latte': 'posto', 'ing:burro': 'non_visto', 'ing:zucchina': 'nuovo', '?oggetto misterioso': 'incerto' });
    // Lo yogurt è su un ripiano non fotografato: nessuno lo dà per finito.
    expect(righe.some((r) => r.chiave === 'ing:yogurt')).toBe(false);
    expect(daGuardare(righe).map((r) => r.tipo)).toEqual(['posto', 'non_visto', 'quantita', 'nuovo', 'incerto']);
    const z = righe.find((r) => r.chiave === 'ing:zucchina')!;
    expect(z.visto).toBe(3 * (indice.ingrediente('ing:zucchina')!.peso_pz ?? 0));
  });

  it('visto in un’altra zona dello stesso luogo: in casa c’è, è solo spostato', () => {
    const righe = confronta({ indice, lotti: [yogurt], zone, fotografate: ['r2'], visti: [visto('yogurt', 'r2', 2, 'pz')], memoria: MEMORIA_VUOTA });
    expect(righe[0]).toMatchObject({ tipo: 'coerente', altrove: 'Ripiano 3' });
  });

  it('incerto resta incerto; un nome già segnato due volte come errore scende di certezza', () => {
    const memoria = { ...MEMORIA_VUOTA, errori: { mozzarella: 2 } };
    const righe = confronta({ indice, lotti: [], zone, fotografate: ['r1'], visti: [visto('mozzarella', 'r1', 1, 'pz', 'probabile'), visto('uova', 'r1', 6, 'pz', 'incerto')], memoria });
    expect(righe.map((r) => r.tipo)).toEqual(['incerto', 'incerto']);
  });

  it('la correzione della famiglia vale più del catalogo; il menu mette davanti ciò che serve', () => {
    const righe = confronta({
      indice,
      lotti: [burro],
      zone,
      fotografate: ['r2'],
      visti: [visto('panetto giallo', 'r2', 250, 'g')],
      memoria: MEMORIA_VUOTA,
      correzioni: { 'panetto giallo': 'ing:burro' },
      menu: new Map([['ing:burro', '2026-11-09']]),
    });
    expect(righe).toHaveLength(1);
    expect(righe[0]).toMatchObject({ chiave: 'ing:burro', tipo: 'coerente', menu: '2026-11-09' });
  });

  it('il contesto per Gemini dice cosa c’è, che il menu non è una prova e quali errori evitare', () => {
    const noti = prodottiNoti(indice, [uova, latte], zone, MEMORIA_VUOTA, 'frigo');
    expect(noti.map((p) => p.codice)).toEqual(['p1', 'p2']);
    const t = contestoPerGemini(zone[1], 2, noti, ['burro'], { ...MEMORIA_VUOTA, errori: { ricotta: 3 } });
    expect(t).toContain('stessa zona da angolazioni diverse');
    expect(t).toContain('p1: uova, 6 pz, di solito in «Ripiano 2»');
    expect(t).toContain('NON vuol dire che ci siano');
    expect(t).toContain('ricotta');
  });
});

describe('dalle decisioni al comando', () => {
  it('si toglie prima da ciò che scade prima, si aggiunge all’ultimo', () => {
    const a = lotto('ing:uova', 4, 'pz', 'r2', { data_limite: '2026-11-10' });
    const b = lotto('ing:uova', 6, 'pz', 'r2', { data_limite: '2026-11-20' });
    expect(distribuisci([b, a], 3)).toEqual([
      { lotto_id: a.id, quantita: 0 },
      { lotto_id: b.id, quantita: 3 },
    ]);
    expect(distribuisci([a, b], 12)).toEqual([{ lotto_id: b.id, quantita: 8 }]);
    expect(distribuisci([a, b], 10)).toEqual([]);
  });

  it('solo le righe decise cambiano la casa; riepilogo, posizioni, errori e correzioni', () => {
    const uova = lotto('ing:uova', 6, 'pz', 'r2');
    const burro = lotto('ing:burro', 250, 'g', 'r2');
    const latte = lotto('ing:latte', 1000, 'ml', 's1');
    const righe = confronta({
      indice,
      lotti: [uova, burro, latte],
      zone,
      fotografate: ['r2', 'porta'],
      visti: [visto('uova', 'r2', 2, 'pz'), visto('zucchina', 'r2', 3, 'pz'), visto('mozzarella', 'r2', 1, 'pz'), visto('latte', 'porta', 1000, 'ml')],
      memoria: MEMORIA_VUOTA,
    });
    let id = 0;
    const { dati, modifiche } = preparaVerifica({
      righe,
      decisioni: {
        'ing:uova': { azione: 'quantita', valore: 2 },
        'ing:burro': { azione: 'terminato' },
        'ing:zucchina': { azione: 'aggiungi', valore: 600 },
        'ing:mozzarella': { azione: 'non_c_e' },
      },
      zone,
      fotografate: ['r2', 'porta'],
      correzioni: { 'zucchine verdi': 'ing:zucchina' },
      nuovoId: () => `nuovo-${++id}`,
      stima: () => ({ data_limite: '2026-11-12', calcolata_il: '2026-11-07T10:00:00Z' }),
    });
    expect(dati.operazioni).toEqual([
      { azione: 'quantita', lotto_id: burro.id, quantita: 0 },
      { azione: 'quantita', lotto_id: uova.id, quantita: 2 },
      expect.objectContaining({ azione: 'aggiungi', id: 'nuovo-1', ingrediente_id: 'ing:zucchina', quantita: 600, unita: 'g', luogo: 'frigo', posto: 'r2', tipo_data: 'stimata' }),
    ]);
    expect(modifiche.map((m) => `${m.nome}: ${m.prima} → ${m.dopo}`)).toEqual(['Burro: 250 g → finito', 'Uova: 6 pz → 2 pz', 'Zucchine: non in casa → 600 g']);
    expect(dati.impara).toEqual({
      alias: { 'zucchine verdi': 'ing:zucchina' },
      errori: ['mozzarella'],
      // Il latte nello sportello non diventa il suo posto abituale: è al posto sbagliato.
      posizioni: { 'ing:uova': 'r2', 'ing:zucchina': 'r2' },
    });
    expect(dati.zone).toEqual(['r2', 'porta']);
  });
});

describe('menu', () => {
  it('il primo giorno che serve, da oggi in poi', () => {
    const ricetta = indice.ricette.find((r) => r.ingredienti.some((i) => i.ingrediente_id === 'ing:uova'))!;
    const m = ingredientiDelMenu(
      indice,
      [
        { data: '2026-11-05', ricetta_id: ricetta.id },
        { data: '2026-11-09', ricetta_id: ricetta.id },
        { data: '2026-11-08', ricetta_id: ricetta.id },
      ],
      '2026-11-07',
      '2026-11-14',
    );
    expect(m.get('ing:uova')).toBe('2026-11-08');
  });
});

describe('risposta di Gemini', () => {
  it('il codice del prodotto registrato diventa il suo ingrediente; un codice sconosciuto no', () => {
    const noti = prodottiNoti(indice, [lotto('ing:burro', 250, 'g', 'r1')], zone, MEMORIA_VUOTA, 'frigo');
    const v = vistiDaGemini('r1', [
      { nome: 'panetto', codice: 'p1', quantita: null, unita: null, certezza: 'probabile' },
      { nome: 'uova', codice: 'p9', quantita: 2, unita: 'pz', certezza: 'sicuro' },
    ], noti);
    expect(v.map((x) => x.ingrediente_id)).toEqual(['ing:burro', null]);
    const righe = confronta({ indice, lotti: [lotto('ing:burro', 250, 'g', 'r1')], zone, fotografate: ['r1'], visti: v.slice(0, 1), memoria: MEMORIA_VUOTA });
    expect(righe[0]).toMatchObject({ chiave: 'ing:burro', tipo: 'coerente' });
  });
});

describe('posto sbagliato (igiene del frigo)', () => {
  it('carne cruda non sul ripiano basso e latte nello sportello sono gravi; frutta fuori dal cassetto è un consiglio', () => {
    const p = (id: string) => posto(FRIGO_BASE, id)!;
    const ing = (id: string) => indice.ingrediente(id)!;
    expect(controllaPosto(FRIGO_BASE, ing('ing:petto_pollo'), p('r1'))).toMatchObject({ grave: true, dove: { id: 'r4' } });
    expect(controllaPosto(FRIGO_BASE, ing('ing:petto_pollo'), p('c1'))?.perche).toContain('frutta e verdura');
    expect(controllaPosto(FRIGO_BASE, ing('ing:petto_pollo'), p('r4'))).toBeNull();
    expect(controllaPosto(FRIGO_BASE, ing('ing:latte'), p('s2'))).toMatchObject({ grave: true });
    expect(controllaPosto(FRIGO_BASE, ing('ing:latte'), p('r1'))).toBeNull();
    expect(controllaPosto(FRIGO_BASE, ing('ing:burro'), p('r2'))).toMatchObject({ grave: false });
    expect(controllaPosto(FRIGO_BASE, ing('ing:zucchina'), p('r2'))).toMatchObject({ grave: false, dove: { id: 'c1' } });
  });

  it('nel confronto: il pollo sul ripiano alto è «al posto sbagliato» anche in rapida; spostandolo cambia il posto del lotto', () => {
    const pollo = lotto('ing:petto_pollo', 500, 'g', 'r1');
    const righe = confronta({ indice, lotti: [pollo], zone, fotografate: ['r1'], visti: [visto('petto di pollo', 'r1', 500, 'g')], memoria: MEMORIA_VUOTA });
    expect(righe[0]).toMatchObject({ tipo: 'posto', avvisoPosto: { grave: true, dove: { id: 'r4' } } });
    expect(daGuardare(righe)).toHaveLength(1);
    const { dati, modifiche } = preparaVerifica({
      righe,
      decisioni: {},
      zone,
      fotografate: ['r1'],
      correzioni: {},
      nuovoId: () => 'x',
      stima: () => null,
      spostati: { 'ing:petto_pollo': 'r4' },
    });
    expect(dati.operazioni).toEqual([{ azione: 'presente', lotto_id: pollo.id, posto: 'r4' }]);
    expect(dati.impara.posizioni['ing:petto_pollo']).toBe('r4');
    expect(modifiche).toEqual([expect.objectContaining({ nome: 'Petto di pollo', prima: 'Ripiano 1', dopo: expect.stringContaining('Ripiano 4') })]);
  });
});
