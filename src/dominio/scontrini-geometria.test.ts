import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { caricaCorpus } from '../../tests/scontrini/carica';
import type { Scatola } from './paddle';
import type { PaginaPdf } from './pdf';
import { leggiLettura, leggiScontrino } from './scontrini';
import { daPagine, daScatole, daTesto, testoDa } from './scontrini-geometria';

const corpus = caricaCorpus();
const scatola = (testo: string, x0: number, y0: number, x1: number, y1: number, fiducia = 0.9): Scatola => ({ testo, x0, y0, x1, y1, fiducia });

describe('dal testo alle righe', () => {
  it('una riga per linea non vuota, i pezzi separati da più di uno spazio, con la colonna e la linea', () => {
    const l = daTesto('LATTE INTERO 1L   1,29 A\n\n  PANE   0,99');
    expect(l).toMatchObject({ origine: 'testo', carattere: 1, larghezza: 24 });
    expect(l.righe.map((r) => r.pezzi.map((p) => [p.testo, p.x0, p.y0]))).toEqual([
      [['LATTE INTERO 1L', 0, 0], ['1,29 A', 18, 0]],
      [['PANE', 2, 2], ['0,99', 9, 2]],
    ]);
    expect(l.righe[0]).toMatchObject({ x0: 0, x1: 24, y0: 0, y1: 1, fiducia: 1 });
  });

  it('ricomposto, il testo torna com’era (senza linee vuote e spazi in coda)', () => {
    expect(testoDa(daTesto('LATTE   1,29 A  \n\nPANE 0,99'))).toBe('LATTE   1,29 A\nPANE 0,99');
  });

  it('ogni lettura del corpus, passata per le righe, si legge come prima: stesso testo e stesso scontrino', () => {
    const testi = corpus.flatMap((c) => c.letture.flatMap((l) => [l.testo, ...(l.controllo ? [l.controllo] : [])]));
    expect(testi.length).toBeGreaterThan(100);
    for (const t of testi) {
      const pulito = t.split(/\r?\n/).map((r) => r.trimEnd()).filter((r) => r.trim());
      const margine = Math.min(...pulito.map((r) => r.length - r.trimStart().length));
      expect(testoDa(daTesto(t))).toBe(pulito.map((r) => r.slice(margine).replace(/\t/g, ' ')).join('\n'));
      expect(leggiLettura(daTesto(t))).toEqual(leggiScontrino(t));
    }
  });
});

describe('dai riquadri di PaddleOCR alle righe', () => {
  it('i pezzi alla stessa altezza fanno una riga, da sinistra a destra, con la fiducia del pezzo peggiore', () => {
    const l = daScatole([scatola('1,29 A', 600, 102, 700, 132, 0.6), scatola('LATTE', 20, 100, 140, 130), scatola('PANE', 20, 150, 120, 180), scatola('0,99', 600, 152, 680, 182), scatola('  ', 300, 100, 310, 130)], 800);
    expect(l).toMatchObject({ origine: 'foto', larghezza: 800 });
    expect(l.righe.map((r) => r.pezzi.map((p) => p.testo))).toEqual([['LATTE', '1,29 A'], ['PANE', '0,99']]);
    expect(l.righe[0]).toMatchObject({ x0: 20, x1: 700, y0: 100, y1: 132, fiducia: 0.6 });
  });

  it('su una foto storta la riga non scivola in quella sotto: si confronta con il primo pezzo, non con la riga che cresce', () => {
    // Ogni pezzo scende di 12 punti rispetto al precedente: con la riga che cresce, il terzo finirebbe ancora nella prima.
    const l = daScatole([scatola('A', 0, 100, 50, 130), scatola('B', 100, 112, 150, 142), scatola('C', 200, 124, 250, 154)], 300);
    expect(l.righe.map((r) => r.pezzi.map((p) => p.testo))).toEqual([['A', 'B'], ['C']]);
  });

  it('ogni riquadro del corpus finisce in una e una sola riga, con le sue coordinate', () => {
    const cartella = new URL('../../tests/scontrini/casi/', import.meta.url);
    for (const id of ['lidl-pagani', 'iperal-san-paolo-d-argon', 'iper-seriate-screenshot']) {
      const file = JSON.parse(readFileSync(new URL(`${id}/letture/paddle-originale-scatole.json`, cartella), 'utf8')) as { larghezza: number; scatole: [string, number, number, number, number][] };
      const scatole = file.scatole.map(([testo, x0, y0, y1, x1]) => scatola(testo, x0, y0, x1, y1));
      const l = daScatole(scatole, file.larghezza);
      const pezzi = l.righe.flatMap((r) => r.pezzi);
      expect(pezzi.length, id).toBe(scatole.filter((s) => s.testo.trim()).length);
      for (const s of scatole.filter((x) => x.testo.trim())) expect(pezzi.some((p) => p.testo === s.testo.trim() && p.x0 === s.x0 && p.y0 === s.y0), `${id}: ${s.testo}`).toBe(true);
      // Le righe vanno dall'alto in basso.
      for (const [i, r] of l.righe.entries()) if (i) expect(r.y0 + r.y1, id).toBeGreaterThanOrEqual(l.righe[i - 1].y0 + l.righe[i - 1].y1 - (r.y1 - r.y0));
    }
  });
});

describe('dalle voci del PDF alle righe', () => {
  const IPER = JSON.parse(readFileSync(new URL('./pdf-esempi/iper-seriate.voci.json', import.meta.url), 'utf8')) as PaginaPdf[];

  it('la y va verso il basso, pagina dopo pagina; gli spazi soli si tolgono', () => {
    const l = daPagine([{ voci: [{ t: 'SECONDA', x: 10, y: 600, w: 42 }, { t: 'PRIMA', x: 10, y: 700, w: 30 }, { t: ' ', x: 50, y: 700, w: 6 }] }, { voci: [{ t: 'TERZA', x: 10, y: 700, w: 30 }] }]);
    expect(l).toMatchObject({ origine: 'pdf', carattere: 6 });
    expect(l.righe.map((r) => r.pezzi.map((p) => p.testo).join())).toEqual(['PRIMA', 'SECONDA', 'TERZA']);
    expect(l.righe[0].y0).toBeLessThan(l.righe[1].y0);
    expect(l.righe[1].y0).toBeLessThan(l.righe[2].y0);
  });

  it('lo scontrino digitale Iper dà lo stesso testo congelato nel corpus', () => {
    const congelato = readFileSync(new URL('../../tests/scontrini/casi/iper-seriate-pdf/letture/pdf.txt', import.meta.url), 'utf8');
    expect(testoDa(daPagine(IPER))).toBe(congelato.replace(/\n$/, ''));
    expect(leggiLettura(daPagine(IPER))).toEqual(leggiScontrino(congelato));
  });
});

describe('la fiducia arriva alle righe lette', () => {
  const pezzo = (testo: string, x0: number, y0: number, fiducia: number) => ({ testo, x0, y0, x1: x0 + 200, y1: y0 + 30, fiducia });
  const foto = daScatole(
    [
      pezzo('DESCRIZIONE', 20, 0, 1), pezzo('LATTE', 20, 50, 0.5), pezzo('1,29 A', 600, 50, 0.51), pezzo('PANE', 20, 100, 0.97), pezzo('2,00 A', 600, 100, 0.99),
      pezzo('SCONTO', 20, 150, 0.3), pezzo('-0,50', 600, 150, 0.6), pezzo('MELE', 20, 200, 0.4), pezzo('1,10 A', 20, 250, 0.9), pezzo('TOTALE', 20, 300, 1), pezzo('3,89', 600, 300, 1),
    ],
    800,
  );

  it('ogni riga prende la fiducia del suo prezzo (e dello sconto sotto), non quella del nome', () => {
    const s = leggiLettura(foto);
    expect(s.righe.map((r) => [r.descrizione, r.prezzo, r.fiducia])).toEqual([['LATTE', 1.29, 0.51], ['PANE', 1.5, 0.6], ['MELE', 1.1, 0.9]]);
  });

  it('le letture delle foto nel corpus: le righe si leggono come il loro testo, in più con la fiducia', () => {
    const conRighe = corpus.flatMap((c) => c.letture.filter((l) => l.righe));
    expect(conRighe.length).toBeGreaterThanOrEqual(17);
    for (const l of conRighe) {
      const s = leggiLettura(l.righe!);
      expect(s.righe.some((r) => r.fiducia !== undefined && r.fiducia < 1), l.nome).toBe(true);
      expect({ ...s, righe: s.righe.map((r) => ({ ...r, fiducia: undefined })) }).toEqual(leggiScontrino(l.testo));
    }
  });

  it('il testo e il PDF non hanno fiducia: le righe non la portano', () => {
    expect(leggiScontrino(testoDa(foto)).righe.every((r) => r.fiducia === undefined)).toBe(true);
    expect(leggiScontrino(testoDa(foto)).righe[0]).toEqual({ ...leggiLettura(foto).righe[0], fiducia: undefined });
  });
});
