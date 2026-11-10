/**
 * Prepara la foto di uno scontrino prima di leggerla con Tesseract, tutto sul telefono.
 *
 * Una foto vera ha il tavolo intorno, un'ombra da una parte, la carta termica sbiadita e lettere minuscole
 * su 12 milioni di punti: Tesseract da solo ci legge poco. Qui, in ordine:
 * 1. si ritaglia lo scontrino (la parte chiara più grande della foto), così il tavolo non diventa testo;
 * 2. si porta lo scontrino a una larghezza in cui le lettere hanno la misura che Tesseract legge meglio;
 * 3. si toglie lo sfondo (ombre, luce non uniforme) dividendo per la luce media dei dintorni;
 * 4. si separa l'inchiostro dalla carta con una soglia locale (Sauvola), che regge anche la stampa sbiadita.
 *
 * Le funzioni lavorano su pixel RGBA come quelli di un canvas, senza DOM: i test le provano direttamente.
 */

export interface Pixel {
  width: number;
  height: number;
  /** RGBA, 4 byte per punto, come ImageData. */
  data: Uint8ClampedArray;
}

/** Larghezza a cui portare lo scontrino: circa 40 caratteri per riga diventano lettere alte 30–40 punti. */
export const LARGHEZZA = 1400;
/** Oltre questi punti la lettura sul telefono diventa lenta senza leggere meglio. */
const PUNTI_MASSIMI = 7_000_000;

/** Luminosità (0–255) di ogni punto. */
export function grigi(img: Pixel): Uint8ClampedArray {
  const g = new Uint8ClampedArray(img.width * img.height);
  const d = img.data;
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
  return g;
}

/** Soglia di Otsu: il grigio che separa meglio due gruppi (carta e resto). */
export function sogliaOtsu(g: Uint8ClampedArray): number {
  const istogramma = new Float64Array(256);
  for (const v of g) istogramma[v]++;
  const totale = g.length;
  let somma = 0;
  for (let i = 0; i < 256; i++) somma += i * istogramma[i];
  let sommaB = 0;
  let pesoB = 0;
  let migliore = 0;
  let soglia = 127;
  for (let i = 0; i < 256; i++) {
    pesoB += istogramma[i];
    if (!pesoB) continue;
    const pesoF = totale - pesoB;
    if (!pesoF) break;
    sommaB += i * istogramma[i];
    const mB = sommaB / pesoB;
    const mF = (somma - sommaB) / pesoF;
    const varianza = pesoB * pesoF * (mB - mF) ** 2;
    if (varianza > migliore) {
      migliore = varianza;
      soglia = i;
    }
  }
  return soglia;
}

/** Rimpicciolisce i grigi con la media dei punti (per cercare la carta senza guardare tutta la foto). */
function piccola(g: Uint8ClampedArray, w: number, h: number, passo: number): { g: Uint8ClampedArray; w: number; h: number } {
  const pw = Math.max(1, Math.floor(w / passo));
  const ph = Math.max(1, Math.floor(h / passo));
  const out = new Uint8ClampedArray(pw * ph);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      let s = 0;
      for (let dy = 0; dy < passo; dy++) {
        const riga = (y * passo + dy) * w + x * passo;
        for (let dx = 0; dx < passo; dx++) s += g[riga + dx];
      }
      out[y * pw + x] = s / (passo * passo);
    }
  }
  return { g: out, w: pw, h: ph };
}

export interface Ritaglio {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Dove sta lo scontrino nella foto: la zona chiara più grande. Se la carta riempie già la foto, o non c'è
 * una zona chiara chiara (foto tutta bianca, tutta scura), si tiene la foto intera.
 */
export function trovaScontrino(g: Uint8ClampedArray, w: number, h: number): Ritaglio {
  const intera = { x: 0, y: 0, width: w, height: h };
  const passo = Math.max(1, Math.round(Math.max(w, h) / 300));
  const p = piccola(g, w, h, passo);
  const soglia = sogliaOtsu(p.g);
  // Una foto senza contrasto tra carta e sfondo: niente da ritagliare.
  let chiari = 0;
  let somma = 0;
  for (const v of p.g) {
    somma += v;
    if (v > soglia) chiari++;
  }
  const media = somma / p.g.length;
  if (chiari < p.g.length * 0.08 || Math.abs(media - soglia) < 4) return intera;

  // Le parti chiare collegate: la più grande è lo scontrino (le lettere sono buchi dentro, non la spezzano
  // perché a questa misura il testo si confonde con la carta).
  const gruppo = new Int32Array(p.w * p.h).fill(-1);
  const coda = new Int32Array(p.w * p.h);
  let miglior = { area: 0, x0: 0, y0: 0, x1: 0, y1: 0 };
  let n = 0;
  for (let start = 0; start < p.g.length; start++) {
    if (p.g[start] <= soglia || gruppo[start] >= 0) continue;
    let testa = 0;
    let fine = 0;
    coda[fine++] = start;
    gruppo[start] = n;
    let area = 0;
    let x0 = p.w;
    let y0 = p.h;
    let x1 = 0;
    let y1 = 0;
    while (testa < fine) {
      const i = coda[testa++];
      const x = i % p.w;
      const y = (i - x) / p.w;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const vicini = [x > 0 ? i - 1 : -1, x < p.w - 1 ? i + 1 : -1, y > 0 ? i - p.w : -1, y < p.h - 1 ? i + p.w : -1];
      for (const v of vicini) {
        if (v >= 0 && gruppo[v] < 0 && p.g[v] > soglia) {
          gruppo[v] = n;
          coda[fine++] = v;
        }
      }
    }
    if (area > miglior.area) miglior = { area, x0, y0, x1, y1 };
    n++;
  }
  const larghezza = miglior.x1 - miglior.x0 + 1;
  const altezza = miglior.y1 - miglior.y0 + 1;
  // Troppo piccola per essere lo scontrino, o quasi tutta la foto: si tiene la foto intera.
  if (miglior.area < p.g.length * 0.06 || (larghezza >= p.w * 0.94 && altezza >= p.h * 0.94)) return intera;
  // Un bordo vero della carta è un salto netto di luce. Se fuori dal bordo c'è quasi la stessa luce (carta in
  // ombra che Otsu ha preso per tavolo) quel lato non si taglia: meglio un po' di tavolo che righe perse.
  const mediaZona = (x0: number, y0: number, x1: number, y1: number) => {
    let s = 0;
    let n = 0;
    for (let y = Math.max(0, y0); y <= Math.min(p.h - 1, y1); y++)
      for (let x = Math.max(0, x0); x <= Math.min(p.w - 1, x1); x++) {
        s += p.g[y * p.w + x];
        n++;
      }
    return n ? s / n : 0;
  };
  const netto = (dentro: number, fuori: number) => fuori < dentro * 0.75;
  const { x0, y0, x1, y1 } = miglior;
  const sx = x0 > 0 && netto(mediaZona(x0, y0, x0 + 2, y1), mediaZona(x0 - 3, y0, x0 - 1, y1)) ? x0 : 0;
  const dx = x1 < p.w - 1 && netto(mediaZona(x1 - 2, y0, x1, y1), mediaZona(x1 + 1, y0, x1 + 3, y1)) ? x1 : p.w - 1;
  const su = y0 > 0 && netto(mediaZona(x0, y0, x1, y0 + 2), mediaZona(x0, y0 - 3, x1, y0 - 1)) ? y0 : 0;
  const giu = y1 < p.h - 1 && netto(mediaZona(x0, y1 - 2, x1, y1), mediaZona(x0, y1 + 1, x1, y1 + 3)) ? y1 : p.h - 1;
  if (sx === 0 && su === 0 && dx === p.w - 1 && giu === p.h - 1) return intera;
  // Un margine, per non tagliare le lettere sul bordo della carta.
  const margine = Math.round(Math.max(larghezza, altezza) * 0.02) + 1;
  const x = Math.max(0, (sx - margine) * passo);
  const y = Math.max(0, (su - margine) * passo);
  return {
    x,
    y,
    width: Math.min(w, (dx + 1 + margine) * passo) - x,
    height: Math.min(h, (giu + 1 + margine) * passo) - y,
  };
}

/** La scala per portare lo scontrino ritagliato alla larghezza giusta, senza superare i punti massimi. */
export function scalaPer(r: Ritaglio): number {
  // Lo scontrino è alto e stretto: si guarda il lato corto (se la foto è girata, è l'altezza).
  const corto = Math.min(r.width, r.height);
  let scala = LARGHEZZA / corto;
  if (r.width * r.height * scala * scala > PUNTI_MASSIMI) scala = Math.sqrt(PUNTI_MASSIMI / (r.width * r.height));
  return Math.min(scala, 3);
}

/** Somme cumulative per calcolare medie (e varianze) di un riquadro in un colpo solo. */
function integrale(g: Uint8ClampedArray, w: number, h: number, quadrati: boolean): Float64Array {
  const s = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let riga = 0;
    for (let x = 0; x < w; x++) {
      const v = g[y * w + x];
      riga += quadrati ? v * v : v;
      s[(y + 1) * (w + 1) + x + 1] = s[y * (w + 1) + x + 1] + riga;
    }
  }
  return s;
}

/**
 * Inchiostro nero su carta bianca. Prima si divide ogni punto per la luce media dei dintorni (le ombre spariscono),
 * poi soglia di Sauvola: un punto è inchiostro se è più scuro della media locale di una parte che cresce con il
 * contrasto locale. `raggio` è la metà del riquadro di dintorni, in punti.
 */
export function binarizza(g: Uint8ClampedArray, w: number, h: number, raggio = Math.max(8, Math.round(Math.min(w, h) / 40)), k = 0.2): Uint8ClampedArray {
  // 1. Sfondo: media su un riquadro grande (circa cinque righe di testo), che le ombre seguono e le lettere no.
  const grande = raggio * 3;
  const S = integrale(g, w, h, false);
  const norm = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - grande);
    const yb = Math.min(h, y + grande + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - grande);
      const xb = Math.min(w, x + grande + 1);
      const area = (yb - ya) * (xb - xa);
      const media = (S[yb * (w + 1) + xb] - S[ya * (w + 1) + xb] - S[yb * (w + 1) + xa] + S[ya * (w + 1) + xa]) / area;
      // Le lettere abbassano un po' la media: si alza del 15% perché la carta torni bianca.
      norm[y * w + x] = Math.min(255, (g[y * w + x] / Math.max(1, media * 1.15)) * 255);
    }
  }
  // 2. Sauvola sull'immagine senza ombre.
  const M = integrale(norm, w, h, false);
  const Q = integrale(norm, w, h, true);
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - raggio);
    const yb = Math.min(h, y + raggio + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - raggio);
      const xb = Math.min(w, x + raggio + 1);
      const area = (yb - ya) * (xb - xa);
      const a = yb * (w + 1) + xb;
      const b = ya * (w + 1) + xb;
      const c = yb * (w + 1) + xa;
      const d = ya * (w + 1) + xa;
      const media = (M[a] - M[b] - M[c] + M[d]) / area;
      const varianza = Math.max(0, (Q[a] - Q[b] - Q[c] + Q[d]) / area - media * media);
      const soglia = media * (1 + k * (Math.sqrt(varianza) / 128 - 1));
      const v = norm[y * w + x];
      // La carta quasi bianca resta bianca anche dove la soglia sarebbe alta (niente puntini nel vuoto).
      out[y * w + x] = v < soglia && v < 235 ? 0 : 255;
    }
  }
  return out;
}

/** Grigi → pixel RGBA. */
export function daGrigi(g: Uint8ClampedArray, w: number, h: number): Pixel {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    data[j] = data[j + 1] = data[j + 2] = g[i];
    data[j + 3] = 255;
  }
  return { width: w, height: h, data };
}

/** Nel browser: dalla foto a un canvas in bianco e nero pronto per Tesseract. */
/** Con `soloRitaglio` lo scontrino resta a colori (per PaddleOCR, che legge meglio la foto vera); altrimenti diventa bianco e nero (per Tesseract). */
export async function preparaFoto(foto: Blob, soloRitaglio = false): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(foto);
  // Prima una copia ridotta (al più 2000 punti di lato) solo per trovare lo scontrino.
  const ridotta = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const t0 = document.createElement('canvas');
  t0.width = Math.round(bitmap.width * ridotta);
  t0.height = Math.round(bitmap.height * ridotta);
  const c0 = t0.getContext('2d', { willReadFrequently: true })!;
  c0.drawImage(bitmap, 0, 0, t0.width, t0.height);
  const r = trovaScontrino(grigi(c0.getImageData(0, 0, t0.width, t0.height)), t0.width, t0.height);
  // Il ritaglio nella foto originale, poi alla larghezza giusta.
  const sorgente = { x: r.x / ridotta, y: r.y / ridotta, width: r.width / ridotta, height: r.height / ridotta };
  const scala = scalaPer(sorgente);
  const tela = document.createElement('canvas');
  tela.width = Math.max(1, Math.round(sorgente.width * scala));
  tela.height = Math.max(1, Math.round(sorgente.height * scala));
  const ctx = tela.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sorgente.x, sorgente.y, sorgente.width, sorgente.height, 0, 0, tela.width, tela.height);
  bitmap.close();
  if (soloRitaglio) return tela;
  const g = grigi(ctx.getImageData(0, 0, tela.width, tela.height));
  const bn = daGrigi(binarizza(g, tela.width, tela.height), tela.width, tela.height);
  const dati = ctx.createImageData(bn.width, bn.height);
  dati.data.set(bn.data);
  ctx.putImageData(dati, 0, 0);
  return tela;
}
