import { describe, expect, it } from 'vitest';
import catalogoJson from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { controllaFile } from './esportazione';
import { fileVecchio } from '../../tests/vecchio-esempio';
import { convertiVecchio, type FileVecchio, leggiVecchio, personeVecchie } from './migrazione';

const catalogo = catalogoJson as Catalogo;
const adesso = new Date('2026-10-27T10:00:00Z');
function converti(io: string | null = 'm1') {
  const l = leggiVecchio(fileVecchio());
  if (!l.valido) throw new Error(l.motivo);
  return convertiVecchio(l.file, catalogo, { io, utente_id: '11111111-1111-4111-8111-111111111111', oggi: '2026-10-27', adesso });
}

describe('importazione dal vecchio Mastercook', () => {
  it('riconosce il file del vecchio e rifiuta il resto', () => {
    expect(leggiVecchio(fileVecchio()).valido).toBe(true);
    expect(leggiVecchio({ formato: 'mastercook-2' }).valido).toBe(false);
    expect(personeVecchie((leggiVecchio(fileVecchio()) as { file: FileVecchio }).file)).toEqual([
      { id: 'm1', nome: 'Luca', con_account: true },
      { id: 'm2', nome: 'Sara', con_account: false },
    ]);
  });

  it('produce un file che il ripristino accetta, con conteggi coerenti', () => {
    const { file } = converti();
    const c = controllaFile(JSON.stringify(file));
    expect(c.valido).toBe(true);
    expect(file.tabelle.famiglia[0].nome).toBe('Casa Topsidakis');
  });

  it('persone e vincoli: allergie con le tracce, intolleranze note o a testo, esigenze', () => {
    const { file } = converti();
    expect(file.tabelle.membro.map((m) => [m.nome, m.porzione, m.utente_id])).toEqual([
      ['Luca', 1, '11111111-1111-4111-8111-111111111111'],
      ['Sara', 0.6, null],
    ]);
    const sara = file.tabelle.vincolo_alimentare.filter((v) => v.membro_id === 'm2').map((v) => [v.tipo, v.oggetto, v.severita, v.testo]);
    expect(sara).toEqual([
      ['allergia', 'all:arachidi', 'evitare_anche_tracce', null],
      ['allergia', 'all:latte', 'evitare_anche_tracce', null],
      ['intolleranza', 'ing:lattosio', 'evitare', null],
      ['intolleranza', 'txt:nichel_di_troppo', 'evitare', 'Nichel di troppo'],
      ['esigenza', 'cls:vegetariano', 'evitare', null],
    ]);
  });

  it('senza «tu chi sei» nessuna persona è collegata', () => {
    expect(converti(null).file.tabelle.membro.every((m) => m.utente_id === null)).toBe(true);
  });

  it('ricette: niente quantità inventate, ingredienti sconosciuti creati con allergeni da verificare', () => {
    const { file, rapporto } = converti();
    expect(file.tabelle.ricetta.map((r) => r.titolo)).toEqual(['Torta della nonna']);
    expect(rapporto.scarti).toContainEqual({ cosa: 'Ricetta «Senza righe»', motivo: 'non ha ingredienti' });
    const righe = file.tabelle.ricetta_ingrediente.map((r) => [r.ingrediente_id, r.quantita, r.unita, r.qb, r.testo]);
    expect(righe[0]).toEqual(['ing:farina', 300, 'g', false, 'Farina']);
    // Uova in grammi: nel nuovo si contano in pezzi, la quantità resta scritta accanto.
    expect(righe[1]).toEqual(['ing:uova', null, 'pz', true, 'Uova (era 200 g)']);
    expect(righe[2][0]).toMatch(/^nuovo:/);
    expect(righe[3]).toEqual(['ing:sale', null, 'g', true, 'Sale']);
    const pinoli = file.tabelle.ingrediente.find((i) => i.nome === 'Pinoli della nonna');
    expect(pinoli).toMatchObject({ dimensione: 'massa', allergeni_noti: false });
    expect(file.tabelle.ricetta_passo.map((p) => p.testo)).toEqual(['Impasta.', 'Cuoci 40 minuti.']);
  });

  it('casa: quantità attuale, data che vale davvero, finiti esclusi, unità incompatibili nel rapporto', () => {
    const { file, rapporto } = converti();
    const lotti = Object.fromEntries(file.tabelle.lotto.map((l) => [l.id, l]));
    expect(Object.keys(lotti).sort()).toEqual(['a1', 'a2', 'a4', 'a5']);
    // Latte aperto: vale il limite dopo l'apertura, che arriva prima della scadenza.
    expect(lotti.a1).toMatchObject({ ingrediente_id: 'ing:latte', tipo_data: 'stimata', data_limite: '2026-10-29', fonte_data: 'app', data_acquisto: '2026-10-20' });
    expect(lotti.a2).toMatchObject({ tipo_data: 'tmc', data_limite: '2027-05-01', fonte_data: 'utente' });
    expect(lotti.a4).toMatchObject({ ingrediente_id: 'ing:avanzo', unita: 'pz', nome: 'Lasagne avanzate' });
    expect(file.tabelle.ingrediente.find((i) => i.id === lotti.a5.ingrediente_id)).toMatchObject({ nome: 'Salsa segreta Bio', reparto: 'condimenti', allergeni: ['senape'] });
    expect(file.tabelle.movimento.find((m) => m.lotto_id === 'a1')).toMatchObject({ variazione: 750, causale: 'carico' });
    expect(rapporto.scarti.some((s) => s.cosa.startsWith('Uova in casa'))).toBe(true);
  });

  it('menu: solo da oggi, ricette di sistema e della famiglia, testo per le voci libere, merenda accesa', () => {
    const { file, rapporto } = converti();
    expect(file.tabelle.portata.map((p) => [p.data, p.categoria, p.ricetta_id, p.testo, p.porzioni])).toEqual([
      ['2026-10-28', 'pranzo', 'sys:carbonara', null, 3],
      ['2026-10-28', 'pranzo', null, 'Frutta 150 g', null],
      ['2026-10-29', 'merenda', '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', null, null],
    ]);
    expect(file.tabelle.categoria_pasto.map((c) => c.chiave)).toEqual(['merenda']);
    expect(rapporto.non_importato.join(' ')).toMatch(/1 pasti passati/);
  });

  it('gusti per persona; il rapporto dice cosa resta fuori', () => {
    const { file, rapporto } = converti();
    expect(file.tabelle.gusto.map((g) => [g.membro_id, g.ingrediente_id, g.valore])).toEqual([
      ['m1', 'ing:zucchina', 'piace'],
      ['m2', 'ing:funghi', 'non_piace'],
    ]);
    expect(rapporto.scarti.some((s) => s.cosa.includes('ing:fegato_inesistente'))).toBe(true);
    expect(rapporto.entra).toEqual({ persone: 2, vincoli: 5, gusti: 2, ricette: 1, ingredienti_nuovi: 2, lotti: 4, portate: 3 });
    const fuori = rapporto.non_importato.join(' ');
    expect(fuori).toMatch(/Anno di nascita/);
    expect(fuori).toMatch(/Diete del dietista/);
    expect(fuori).toMatch(/preferite/);
  });

  it('stesso file, stesso risultato', () => {
    expect(converti()).toEqual(converti());
  });
});
