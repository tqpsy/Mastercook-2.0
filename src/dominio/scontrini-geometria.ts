/**
 * Il formato intermedio della lettura di uno scontrino: le righe come stanno sulla carta, ognuna con i suoi pezzi di testo,
 * la loro posizione e quanto è sicura la lettura. Tutte le sorgenti lo producono:
 * - la foto (`daScatole`): i riquadri di PaddleOCR, in punti della foto, con la fiducia della lettura;
 * - il PDF dello scontrino digitale (`daPagine`): le voci di pdf.js, in punti della pagina, sempre sicure;
 * - il testo incollato o congelato (`daTesto`): coordinate sintetiche, una riga per linea e una colonna per carattere.
 * Il parser lavora su questo formato (`leggiLettura` in scontrini.ts); il testo (`testoDa`) è quello che si mostra, che si
 * salva con lo scontrino e che si può incollare di nuovo, e si rilegge allo stesso modo.
 * Funzioni pure: le librerie che leggono la foto e il PDF stanno in `ui/`.
 */
import type { Scatola } from './paddle';
import type { PaginaPdf } from './pdf';

/** Un pezzo di testo letto, con il suo riquadro (x verso destra, y verso il basso) e la fiducia della lettura (0–1). */
export interface Pezzo {
  testo: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  fiducia: number;
}

/** Una riga dello scontrino: i pezzi alla stessa altezza, da sinistra a destra. */
export interface Riga {
  pezzi: Pezzo[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** La fiducia del pezzo meno sicuro: una riga vale quanto la sua parte letta peggio. */
  fiducia: number;
}

export type Origine = 'foto' | 'pdf' | 'testo';

export interface LetturaGeometrica {
  origine: Origine;
  /** Larghezza della pagina (della foto, del PDF, o la linea più lunga del testo), nelle stesse unità delle coordinate. */
  larghezza: number;
  /**
   * Larghezza di un carattere, per rimettere i pezzi nella loro colonna quando si ricompone il testo (`testoDa`): il PDF e il
   * testo sono a colonne. `null` per la foto, dove le colonne di caratteri non ci sono: i pezzi si separano con tre spazi.
   */
  carattere: number | null;
  /** Le righe dall'alto in basso. */
  righe: Riga[];
}

const centroY = (p: { y0: number; y1: number }) => (p.y0 + p.y1) / 2;
const mediana = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;

/** Un pezzo che contiene un prezzo («1,99 B», «0.90A», «135A»): cifre con due decimali e quasi niente lettere. */
const haUnPrezzo = (p: Pezzo) => /\d[.,:]?\d{2}/.test(p.testo) && (p.testo.match(/[A-Za-z]/g) ?? []).length <= 2;

/**
 * La fiducia di una riga per il parser: quella del suo prezzo (il pezzo meno sicuro tra quelli con un prezzo), 1 se la riga non ne
 * ha. Il nome conta poco: un nome letto un po' male si riconosce lo stesso, un prezzo no. Ed è il segnale che funziona: misurata
 * sulle foto, la fiducia dei nomi (o del carattere meno sicuro) segnala molte righe giuste per ogni riga sbagliata che scopre.
 */
export const fiduciaRiga = (r: Riga): number => Math.min(1, ...r.pezzi.filter(haUnPrezzo).map((p) => p.fiducia));

/** La riga che contiene questi pezzi, riordinati da sinistra a destra (o nell'ordine dato, con `ordina` falso). */
export function creaRiga(pezzi: Pezzo[], ordina = true): Riga {
  const ordinati = ordina ? [...pezzi].sort((a, b) => a.x0 - b.x0) : pezzi;
  return {
    pezzi: ordinati,
    x0: Math.min(...ordinati.map((p) => p.x0)),
    y0: Math.min(...ordinati.map((p) => p.y0)),
    x1: Math.max(...ordinati.map((p) => p.x1)),
    y1: Math.max(...ordinati.map((p) => p.y1)),
    fiducia: Math.min(...ordinati.map((p) => p.fiducia)),
  };
}

/**
 * Dai riquadri di PaddleOCR alle righe. Un pezzo sta nella riga del primo pezzo (dall'alto) il cui centro dista meno di metà
 * della sua altezza dal suo: i pezzi di una riga stampata hanno quasi lo stesso centro, quelli di righe vicine no. Si
 * confronta con il primo pezzo della riga e non con la riga che cresce, che su una foto storta scivolerebbe in quella sotto.
 * Non si decide qui a quale nome va un prezzo: lo fa il parser, che ha le coordinate.
 */
export function daScatole(scatole: Scatola[], larghezza: number): LetturaGeometrica {
  const ordinate = scatole.filter((s) => s.testo.trim()).sort((a, b) => centroY(a) - centroY(b) || a.x0 - b.x0);
  const gruppi: { centro: number; pezzi: Pezzo[] }[] = [];
  for (const s of ordinate) {
    const ultimo = gruppi.at(-1);
    const pezzo: Pezzo = { testo: s.testo.trim(), x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1, fiducia: s.fiducia };
    if (ultimo && Math.abs(centroY(s) - ultimo.centro) < (s.y1 - s.y0) * 0.5) ultimo.pezzi.push(pezzo);
    else gruppi.push({ centro: centroY(s), pezzi: [pezzo] });
  }
  return { origine: 'foto', larghezza, carattere: null, righe: gruppi.map((g) => creaRiga(g.pezzi)) };
}

/** Due voci del PDF con la `y` più vicina di così (in punti) stanno sulla stessa riga. */
const TOLLERANZA_Y = 2;

/**
 * Dalle voci del PDF alle righe. pdf.js dà la `y` dal basso della pagina e non l'altezza del testo: qui la `y` va verso il basso
 * (le pagine una sotto l'altra) e ogni voce è alta quanto due caratteri. Gli spazi soli (portano solo la posizione) si tolgono.
 */
export function daPagine(pagine: PaginaPdf[]): LetturaGeometrica {
  // I PDF degli scontrini sono a spaziatura fissa: la larghezza di un carattere è la mediana tra le voci di almeno tre lettere.
  const misure = pagine.flatMap((p) => p.voci.filter((v) => v.t.trim().length >= 3 && v.w > 0).map((v) => v.w / v.t.length));
  const carattere = mediana(misure) || 6;
  const altezza = carattere * 2;
  const righe: Riga[] = [];
  let inizio = 0;
  let larghezza = 0;
  for (const pagina of pagine) {
    const voci = pagina.voci.filter((v) => v.t.trim() !== '').sort((a, b) => b.y - a.y || a.x - b.x);
    const cima = Math.max(0, ...voci.map((v) => v.y));
    const gruppi: (typeof voci)[] = [];
    for (const v of voci) {
      const ultimo = gruppi.at(-1);
      if (ultimo && Math.abs(ultimo[0].y - v.y) <= TOLLERANZA_Y) ultimo.push(v);
      else gruppi.push([v]);
    }
    for (const g of gruppi) {
      const y = inizio + cima - g[0].y;
      righe.push(creaRiga(g.map((v) => ({ testo: v.t.replace(/\s+$/, ''), x0: v.x, y0: y, x1: v.x + v.w, y1: y + altezza, fiducia: 1 }))));
      larghezza = Math.max(larghezza, ...g.map((v) => v.x + v.w));
    }
    inizio += cima + altezza * 2;
  }
  return { origine: 'pdf', larghezza, carattere, righe };
}

/**
 * Dal testo (incollato, congelato, o di un lettore che dà solo testo) alle righe, con coordinate sintetiche: la linea `i` va
 * da `y = i` a `i + 1`, un carattere è largo 1. I pezzi sono le parti separate da più di uno spazio (le colonne dello
 * scontrino: nome, prezzo, lettera dell'IVA). Le linee vuote non sono righe, ma lasciano il loro posto vuoto.
 */
export function daTesto(testo: string): LetturaGeometrica {
  const righe: Riga[] = [];
  let larghezza = 0;
  for (const [i, linea] of testo.split(/\r?\n/).entries()) {
    const pezzi: Pezzo[] = [...linea.matchAll(/\S+(?: \S+)*/g)].map((m) => ({ testo: m[0], x0: m.index, y0: i, x1: m.index + m[0].length, y1: i + 1, fiducia: 1 }));
    if (!pezzi.length) continue;
    righe.push(creaRiga(pezzi));
    larghezza = Math.max(larghezza, linea.length);
  }
  return { origine: 'testo', larghezza, carattere: 1, righe };
}

/**
 * Il testo di una riga: ogni pezzo nella sua colonna (x ÷ larghezza di un carattere), con almeno uno spazio dal pezzo prima;
 * senza colonne (la foto) i pezzi separati da tre spazi.
 */
export function testoRiga(riga: Riga, carattere: number | null): string {
  if (carattere === null) return riga.pezzi.map((p) => p.testo).join('   ');
  let t = '';
  for (const p of riga.pezzi) t = t.padEnd(Math.max(Math.round(p.x0 / carattere), t.length + (t ? 1 : 0)), ' ') + p.testo;
  return t.trimEnd();
}

/**
 * Il testo della lettura, una linea per riga, con i pezzi nelle loro colonne: per il testo incollato è il testo di partenza
 * (senza linee vuote e spazi in coda), per il PDF lo scontrino com'è stampato. Il margine comune a sinistra si toglie.
 */
export function testoDa(lettura: LetturaGeometrica): string {
  const linee = lettura.righe.map((r) => testoRiga(r, lettura.carattere));
  const margine = Math.min(...linee.filter(Boolean).map((r) => r.length - r.trimStart().length));
  return linee.map((r) => r.slice(Number.isFinite(margine) ? margine : 0)).join('\n');
}
