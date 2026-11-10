/**
 * PaddleOCR (modelli PP-OCR in ONNX) sul telefono: la parte che non tocca il browser.
 * Il riconoscimento ha due reti. La prima (rilevazione, «DB») dice dove c'è testo: una mappa di probabilità,
 * da cui qui si ricavano i riquadri. La seconda (lettura) trasforma ogni riquadro in testo: qui si prepara
 * l'immagine e si decodifica la risposta (CTC). Poi si compone il testo dello scontrino (`impagina`).
 * Le immagini sono pixel RGBA come quelli di un canvas, così i test li provano senza browser.
 */
import { eFineRighe, eIntestazione, pulisciLinea } from './scontrini';

export interface Pixel {
  width: number;
  height: number;
  /** RGBA, 4 byte per punto, come ImageData. */
  data: Uint8ClampedArray;
}

/** Un pezzo di testo letto, con il suo riquadro nella foto. */
export interface Scatola {
  testo: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Quanto è sicura la lettura (0–1). */
  fiducia: number;
}

/** Larghezza e altezza di un'immagine per la rete di rilevazione: multipli di 32. */
export const MULTIPLO = 32;
export const altezzaLettura = 48;
/** Una lettura molto larga si rimpicciolisce a questa larghezza (come nel modello). */
export const larghezzaMassimaLettura = 960;

/**
 * Il tensore [1, 3, h, w] per la rilevazione. I canali sono in ordine BGR e normalizzati con media e
 * deviazione di ImageNet, come ha visto la rete addestrandosi. Fuori dall'immagine (se `w`×`h` è più
 * grande) il fondo è bianco.
 */
export function tensoreRilevazione(img: Pixel, w: number, h: number): Float32Array {
  const mezzi = [0.485, 0.456, 0.406];
  const dev = [0.229, 0.224, 0.225];
  const out = new Float32Array(3 * w * h);
  const piano = w * h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dentro = x < img.width && y < img.height;
      const i = (y * img.width + x) * 4;
      const [r, g, b] = dentro ? [img.data[i], img.data[i + 1], img.data[i + 2]] : [255, 255, 255];
      const k = y * w + x;
      out[k] = (b / 255 - mezzi[0]) / dev[0];
      out[piano + k] = (g / 255 - mezzi[1]) / dev[1];
      out[2 * piano + k] = (r / 255 - mezzi[2]) / dev[2];
    }
  }
  return out;
}

/** Quanto deve essere larga (in punti) una lettura la cui scatola è larga `larghezza` e alta `altezza`. */
export const larghezzaPerLettura = (larghezza: number, altezza: number) => Math.min(larghezzaMassimaLettura, Math.max(altezzaLettura / 2, Math.ceil((altezzaLettura * larghezza) / Math.max(1, altezza))));

/**
 * Il tensore [n, 3, 48, wMax] per la lettura di più riquadri già ritagliati. Ognuno è portato ad altezza 48
 * (stessa proporzione), BGR, valori da -1 a 1; il resto fino a `wMax` è a zero.
 */
export function tensoreLettura(ritagli: Pixel[], wMax: number): Float32Array {
  const H = altezzaLettura;
  const out = new Float32Array(ritagli.length * 3 * H * wMax);
  for (const [n, r] of ritagli.entries()) {
    const w = Math.min(wMax, larghezzaPerLettura(r.width, r.height));
    const base = n * 3 * H * wMax;
    for (let y = 0; y < H; y++) {
      const sy = Math.min(r.height - 1, Math.floor(((y + 0.5) * r.height) / H));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(r.width - 1, Math.floor(((x + 0.5) * r.width) / w));
        const i = (sy * r.width + sx) * 4;
        const k = y * wMax + x;
        out[base + k] = (r.data[i + 2] / 255 - 0.5) / 0.5;
        out[base + H * wMax + k] = (r.data[i + 1] / 255 - 0.5) / 0.5;
        out[base + 2 * H * wMax + k] = (r.data[i] / 255 - 0.5) / 0.5;
      }
    }
  }
  return out;
}

export interface Riquadro {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Probabilità media della mappa dentro il riquadro. */
  punteggio: number;
}

/**
 * Dalla mappa di probabilità (h×w) ai pezzi di testo, come PaddleOCR: i punti sopra `soglia` collegati tra loro
 * formano un pezzo; si scartano i troppo piccoli o poco sicuri. Sono ancora i «nuclei» del testo, più stretti del
 * testo vero: `allargaRiquadro` li porta alla misura giusta, dopo che `unisciRiquadri` ha unito i pezzi di una
 * stessa riga. (Senza la dilatazione che usa PaddleOCR: sulle righe fitte di uno scontrino unisce righe vicine.)
 */
export function riquadriDaMappa(mappa: Float32Array, w: number, h: number, soglia = 0.3, minPunteggio = 0.5): Riquadro[] {
  const bit = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) bit[i] = mappa[i] > soglia ? 1 : 0;
  const visto = new Uint8Array(w * h);
  const pila = new Int32Array(w * h);
  const out: Riquadro[] = [];
  for (let start = 0; start < w * h; start++) {
    if (visto[start] || !bit[start]) continue;
    let cima = 0;
    pila[cima++] = start;
    visto[start] = 1;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    while (cima) {
      const p = pila[--cima];
      const x = p % w;
      const y = (p - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q < 0 || visto[q] || !bit[q]) continue;
        visto[q] = 1;
        pila[cima++] = q;
      }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (Math.min(bw, bh) < 3) continue;
    // La sicurezza è la probabilità media dei punti del pezzo (quelli sopra soglia), non del rettangolo intero.
    let somma = 0;
    let n = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (bit[y * w + x] && mappa[y * w + x] > soglia) {
          somma += mappa[y * w + x];
          n++;
        }
      }
    }
    const punteggio = n ? somma / n : 0;
    if (punteggio < minPunteggio) continue;
    out.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, punteggio });
  }
  return out;
}

/**
 * Unisce i pezzi sulla stessa riga e quasi attaccati (un prezzo come «1,99» può uscire in due pezzi: «1,9» e
 * «99»). Si lavora sui nuclei (prima di allargarli): due pezzi si uniscono se si sovrappongono in verticale per
 * più di metà della loro altezza e il vuoto tra loro è meno di `vuoto` volte l'altezza maggiore. Un prezzo e il suo
 * nome, molto distanti, restano separati; righe diverse non si sovrappongono.
 */
export function unisciRiquadri<T extends { x0: number; y0: number; x1: number; y1: number }>(riquadri: T[], vuoto = 1): { x0: number; y0: number; x1: number; y1: number }[] {
  let r = riquadri.map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 }));
  for (let cambiato = true; cambiato; ) {
    cambiato = false;
    for (let i = 0; i < r.length && !cambiato; i++) {
      for (let j = i + 1; j < r.length && !cambiato; j++) {
        const a = r[i];
        const b = r[j];
        const h = Math.min(a.y1 - a.y0, b.y1 - b.y0);
        const hMax = Math.max(a.y1 - a.y0, b.y1 - b.y0);
        const sopra = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        const distanza = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
        if (sopra > h * 0.5 && distanza < hMax * vuoto) {
          r = r.filter((_, k) => k !== i && k !== j);
          r.push({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
          cambiato = true;
        }
      }
    }
  }
  return r;
}

/**
 * Allarga un nucleo di testo: `area × allarga / perimetro` per lato, come PaddleOCR, ma in verticale (`allargaY`) meno:
 * lì il nucleo è già alto quanto il testo e le righe di uno scontrino sono fitte (si sovrapporrebbero).
 * In orizzontale serve contesto attorno alle cifre (la virgola, lo spazio tra le parole).
 */
export function allargaRiquadro(
  r: { x0: number; y0: number; x1: number; y1: number },
  larghezza: number,
  altezza: number,
  allarga = 1.6,
  allargaY = 1,
): { x0: number; y0: number; x1: number; y1: number } {
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  const dx = (w * h * allarga) / (2 * (w + h));
  const dy = (w * h * allargaY) / (2 * (w + h));
  return { x0: Math.max(0, r.x0 - dx), y0: Math.max(0, r.y0 - dy), x1: Math.min(larghezza, r.x1 + dx), y1: Math.min(altezza, r.y1 + dy) };
}

/**
 * Il testo di una lettura: `probabilita` è [t × classi] (già softmax). La classe 0 è «niente», poi i
 * caratteri nell'ordine del dizionario, e per ultimo lo spazio. Si prende la più probabile ad ogni passo,
 * si uniscono i ripetuti e si tolgono i «niente» (CTC).
 */
export function decodificaCtc(probabilita: Float32Array, t: number, classi: number, caratteri: string[]): { testo: string; fiducia: number } {
  let testo = '';
  let ultimo = 0;
  let somma = 0;
  let n = 0;
  for (let i = 0; i < t; i++) {
    let migliore = 0;
    let p = -1;
    for (let c = 0; c < classi; c++) {
      const v = probabilita[i * classi + c];
      if (v > p) {
        p = v;
        migliore = c;
      }
    }
    if (migliore !== 0 && migliore !== ultimo) {
      testo += migliore - 1 < caratteri.length ? caratteri[migliore - 1] : ' ';
      somma += p;
      n++;
    }
    ultimo = migliore;
  }
  return { testo, fiducia: n ? somma / n : 0 };
}

const altezza = (s: Scatola) => s.y1 - s.y0;
const centroY = (s: Scatola) => (s.y0 + s.y1) / 2;
const mediana = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;
/** Un prezzo, anche senza la virgola («135A»: si perde spesso) o con la lettera dell'IVA letta come cifra («0,20 0»). */
const ePrezzo = (t: string) => /^-?\s?(\d{0,4}\s?[.,:]\s?\d{2}|\d{3,5})(\s?[A-Z0-9])?$/.test(t.trim().toUpperCase());

/**
 * Da dove inizia la colonna dei prezzi: poco prima dei numeri con i decimali, alla destra della pagina
 * (un peso o una quantità nel nome non contano: si ignora il 20% più a sinistra; il margine tiene dentro «PREZZO IVA»).
 */
export function inizioPrezzi(scatole: Scatola[], larghezza: number): number {
  const x = scatole
    .filter((s) => ePrezzo(s.testo) && s.x0 > larghezza * 0.4)
    .map((s) => s.x0)
    .sort((a, b) => a - b);
  return x.length < 5 ? larghezza * 0.66 : x[Math.floor(x.length * 0.2)] - larghezza * 0.05;
}

/**
 * Di quanto è inclinata la foto, in radianti (positivo = ruotata in senso orario): i prezzi sono allineati a destra,
 * quindi il loro bordo destro dovrebbe stare su una verticale. Si prende la pendenza mediana tra coppie di prezzi
 * lontane (Theil–Sen: non la sporcano le letture sbagliate). Null se i prezzi sono pochi o troppo vicini.
 */
export function inclinazione(scatole: Scatola[], larghezza: number): number | null {
  const punti = scatole.filter((s) => ePrezzo(s.testo) && s.x0 > larghezza * 0.5).map((s) => ({ x: s.x1, y: centroY(s) }));
  const pendenze: number[] = [];
  for (const [i, a] of punti.entries()) for (const b of punti.slice(i + 1)) if (Math.abs(b.y - a.y) > 200) pendenze.push((b.x - a.x) / (b.y - a.y));
  if (punti.length < 6 || pendenze.length < 10) return null;
  return Math.atan(mediana(pendenze));
}

export interface Pagina {
  /** Tutta la pagina, una riga per ogni scatola di sinistra con la scatola di destra più vicina in verticale. */
  pagina: string;
  /** Le scatole della colonna dei prezzi nelle righe dello scontrino, dall'alto in basso, una per riga. */
  prezzi: string;
  /** Le scatole della colonna dei nomi (e di tutto quello che non è la colonna dei prezzi). */
  nomi: string;
}

/**
 * Ricompone il testo dello scontrino dalle scatole. Nella foto la carta si piega e un prezzo può trovarsi
 * più in basso del suo nome: per questo oltre alla pagina «riga per riga» si dà anche la colonna dei prezzi
 * da sola e quella dei nomi, che colonne.ts abbina per ordine.
 */
/**
 * Le scatole di prezzi divise per colonna (prezzo unitario, totale di riga…): numeri i cui bordi sinistri distano più di
 * `vuoto` volte la larghezza della pagina stanno in colonne diverse. Ordinate da sinistra a destra.
 */
function colonnePrezzi(prezzi: Scatola[], larghezza: number, vuoto = 0.08): Scatola[][] {
  const ordinate = [...prezzi].sort((a, b) => a.x0 - b.x0);
  const colonne: Scatola[][] = [];
  for (const s of ordinate) {
    const ultima = colonne.at(-1);
    if (ultima && s.x0 - ultima[ultima.length - 1].x0 < larghezza * vuoto) ultima.push(s);
    else colonne.push([s]);
  }
  return colonne;
}

export function impagina(scatole: Scatola[], larghezza: number): Pagina {
  const x = inizioPrezzi(scatole, larghezza);
  const ordine = [...scatole].sort((a, b) => centroY(a) - centroY(b));
  const destra = ordine.filter((s) => s.x0 >= x && (ePrezzo(s.testo) || s.testo.replace(/[^A-Za-z0-9]/g, '').length < 4));
  // Più colonne di prezzi (unitario e totale di riga): le righe valgono quanto la colonna più a destra, se è piena
  // abbastanza; le altre colonne restano solo accanto ai nomi, nella pagina riga per riga.
  const colonne = colonnePrezzi(destra.filter((s) => ePrezzo(s.testo)), larghezza);
  const piena = Math.max(0, ...colonne.map((c) => c.length));
  const ultima = [...colonne].reverse().find((c) => c.length >= piena * 0.5);
  const daScartare = new Set(colonne.filter((c) => c !== ultima).flat());
  const prezziColonna = destra.filter((s) => !daScartare.has(s));
  // Più pezzi di sinistra sulla stessa riga («IPERAL SUPERMERCATI» e «SPA», la data e l'ora) formano una riga sola.
  const sinistra: Scatola[] = [];
  /** Il centro del primo pezzo di ogni riga: i pezzi dopo si confrontano con quello, non con la riga che cresce. */
  const centri: number[] = [];
  const gruppi: Scatola[][] = [];
  // A sinistra anche i pezzi di destra che non sono prezzi («Ora: 12:47», «PREZZO IVA»): non fanno parte della colonna.
  // (La colonna dell'aliquota IVA in percentuale, tra i nomi e i prezzi — «4%», «10%» — non è un nome: si salta.)
  const eAliquota = (b: Scatola) => b.x0 > larghezza * 0.45 && /^\d{1,3}\s?%?$|^\d{1,2}\s?[^\dA-Za-z\s]$/.test(b.testo.trim());
  const aSinistra = ordine.filter((b) => !eAliquota(b) && (b.x0 < x || (!ePrezzo(b.testo) && b.testo.replace(/[^A-Za-z0-9]/g, '').length >= 4)));
  for (const s of aSinistra.sort((a, b) => centroY(a) - centroY(b) || a.x0 - b.x0)) {
    const k = gruppi.length - 1;
    if (k >= 0 && Math.abs(centroY(s) - centri[k]) < altezza(s) * 0.5) gruppi[k].push(s);
    else {
      gruppi.push([s]);
      centri.push(centroY(s));
    }
  }
  for (const g of gruppi) {
    // Da sinistra a destra («2   PANE»), senza ripetere lo stesso testo letto due volte da riquadri sovrapposti.
    const pezzi = g.sort((a, b) => a.x0 - b.x0).filter((b, i, v) => v.findIndex((q) => q.testo === b.testo) === i);
    sinistra.push({ ...pezzi[0], testo: pezzi.map((b) => b.testo).join('   '), x1: Math.max(...pezzi.map((b) => b.x1)), y0: Math.min(...pezzi.map((b) => b.y0)), y1: Math.max(...pezzi.map((b) => b.y1)) });
  }
  const passo = mediana(sinistra.map(altezza)) * 2.2 || 40;
  const usate = new Set<Scatola>();
  const righe = sinistra.map((s) => {
    // Tutti i pezzi di destra su questa riga (colonna dei prezzi, dei totali…), da sinistra a destra.
    const vicine = destra.filter((d) => !usate.has(d) && Math.abs(centroY(d) - centroY(s)) < passo * 0.75).sort((a, b) => Math.abs(centroY(a) - centroY(s)) - Math.abs(centroY(b) - centroY(s)));
    const perColonna: Scatola[] = [];
    for (const d of vicine) if (!perColonna.some((q) => Math.abs(q.x0 - d.x0) < larghezza * 0.04) || /^[A-Z%]{1,2}$/.test(d.testo)) perColonna.push(d);
    for (const d of perColonna) usate.add(d);
    perColonna.sort((a, b) => a.x0 - b.x0);
    return [s.testo, ...perColonna.map((d) => d.testo)].join('   ');
  });
  // Le righe dello scontrino finiscono dove comincia il totale: dopo, i prezzi non sono righe.
  // (Dopo l'intestazione: «QTA DESCRIZIONE PREZZO TOTALE» contiene la parola «totale».)
  const intestazione = sinistra.findIndex((s) => eIntestazione(pulisciLinea(s.testo)));
  const totale = sinistra.find((s, i) => i > intestazione && eFineRighe(pulisciLinea(s.testo)));
  const prezzi = prezziColonna.filter((s) => !totale || centroY(s) < centroY(totale) - altezza(totale) * 0.3);
  return { pagina: righe.join('\n'), prezzi: prezzi.map((s) => s.testo).join('\n'), nomi: sinistra.map((s) => s.testo).join('\n') };
}
