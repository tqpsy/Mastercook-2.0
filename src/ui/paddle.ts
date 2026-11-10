/**
 * PaddleOCR sul telefono: i modelli PP-OCR (rilevazione e lettura, Apache-2.0) girano con onnxruntime-web,
 * in WebAssembly, senza che la foto esca dal dispositivo. Il codice che non tocca il browser (riquadri,
 * decodifica, impaginazione) sta in `dominio/paddle.ts`.
 *
 * I modelli (circa 13 MB) stanno in `public/modelli-ocr/` e si scaricano alla prima foto; il motore
 * (onnxruntime, circa 11 MB) è un file a parte. Non sono nella cache iniziale dell'app: dopo la prima
 * volta restano in cache (vite.config.ts) e funzionano anche senza rete.
 *
 * La rilevazione lavora sulla foto rimpicciolita a 960 punti di larghezza, a fasce alte 1280 con un po'
 * di sovrapposizione (uno scontrino lungo non finisce tutto in memoria insieme); la lettura dei caratteri
 * riparte dalla foto più grande, dove le cifre sono più nitide.
 */
import moduloUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';
import wasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
import { allargaRiquadro, altezzaLettura, decodificaCtc, larghezzaPerLettura, MULTIPLO, type Pixel, riquadriDaMappa, type Scatola, tensoreLettura, tensoreRilevazione, unisciRiquadri } from '../dominio/paddle';

type Ort = typeof import('onnxruntime-web/wasm');
interface Motore {
  ort: Ort;
  rilevazione: import('onnxruntime-web/wasm').InferenceSession;
  lettura: import('onnxruntime-web/wasm').InferenceSession;
  caratteri: string[];
}

const LARGHEZZA_RILEVAZIONE = 960;
const FASCIA = 1280;
const SOVRAPPOSIZIONE = 96;
const LETTURE_PER_VOLTA = 8;

let motore: Promise<Motore> | null = null;

const url = (nome: string) => `${import.meta.env.BASE_URL}modelli-ocr/${nome}`;

/** Carica il motore e i modelli una volta sola (se fallisce, la volta dopo riprova). */
function caricaMotore(): Promise<Motore> {
  motore ??= (async () => {
    const ort = await import('onnxruntime-web/wasm');
    // Senza intestazioni «cross-origin isolated» (GitHub Pages) i thread non ci sono: un thread solo.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = { mjs: moduloUrl, wasm: wasmUrl };
    const opzioni = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' } as const;
    const [rilevazione, lettura, caratteri] = await Promise.all([
      ort.InferenceSession.create(url('det.onnx'), opzioni),
      ort.InferenceSession.create(url('rec.onnx'), opzioni),
      fetch(url('caratteri.txt')).then((r) => (r.ok ? r.text() : Promise.reject(new Error('dizionario mancante')))),
    ]);
    return { ort, rilevazione, lettura, caratteri: [...caratteri.split('\n'), ' '] };
  })().catch((e) => {
    motore = null;
    throw e;
  });
  return motore;
}

/** Libera la memoria dei modelli (si ricaricano alla prossima foto). */
export async function liberaPaddle(): Promise<void> {
  const m = await motore?.catch(() => null);
  motore = null;
  await Promise.all([m?.rilevazione.release(), m?.lettura.release()]);
}

const leggiPunti = (tela: HTMLCanvasElement, x: number, y: number, w: number, h: number): Pixel => {
  const d = tela.getContext('2d', { willReadFrequently: true })!.getImageData(x, y, w, h);
  return { width: d.width, height: d.height, data: d.data };
};

interface Fascia {
  inizio: number;
  hp: number;
  mappa: Float32Array;
  /** Dove comincia e finisce la parte di questa fascia che le appartiene (le fasce si sovrappongono un po'). */
  da: number;
  a: number;
}

interface Rilevazione {
  fasce: Fascia[];
  /** Larghezza della foto rimpicciolita, e la stessa portata a un multiplo di 32 per la rete. */
  W: number;
  Wp: number;
  /** Altezza della foto rimpicciolita e rapporto tra foto rimpicciolita e foto. */
  H: number;
  f: number;
}

/** Fa girare la rilevazione su tutta la foto, a fasce, e tiene le mappe di probabilità (si possono rileggere con altre soglie). */
async function rileva(m: Motore, tela: HTMLCanvasElement, riferimento: number, avanzamento: (f: number) => void): Promise<Rilevazione> {
  // La scala dipende dalla larghezza dello scontrino (`riferimento`), non da quella della tela: ruotata, la tela è più larga.
  const f = LARGHEZZA_RILEVAZIONE / riferimento;
  const piccola = document.createElement('canvas');
  piccola.width = Math.max(1, Math.round(tela.width * f));
  const Wp = Math.ceil(piccola.width / MULTIPLO) * MULTIPLO;
  piccola.height = Math.max(1, Math.round(tela.height * f));
  const c = piccola.getContext('2d', { willReadFrequently: true })!;
  c.imageSmoothingQuality = 'high';
  c.drawImage(tela, 0, 0, piccola.width, piccola.height);
  const fasce: Fascia[] = [];
  const H = piccola.height;
  for (let inizio = 0; ; inizio += FASCIA - SOVRAPPOSIZIONE) {
    const h = Math.min(FASCIA, H - inizio);
    const ultima = inizio + h >= H;
    const hp = Math.ceil(h / MULTIPLO) * MULTIPLO;
    const img = leggiPunti(piccola, 0, inizio, piccola.width, h);
    const risposta = await m.rilevazione.run({ [m.rilevazione.inputNames[0]]: new m.ort.Tensor('float32', tensoreRilevazione(img, Wp, hp), [1, 3, hp, Wp]) });
    // Ogni fascia tiene i riquadri il cui centro sta nella sua parte (la sovrapposizione è solo un margine).
    fasce.push({
      inizio,
      hp,
      mappa: Float32Array.from(risposta[m.rilevazione.outputNames[0]].data as Float32Array),
      da: inizio === 0 ? 0 : inizio + SOVRAPPOSIZIONE / 2,
      a: ultima ? H : inizio + h - SOVRAPPOSIZIONE / 2,
    });
    avanzamento(Math.min(1, (inizio + h) / H));
    if (ultima) break;
  }
  return { fasce, W: piccola.width, Wp, H, f };
}

type Rettangolo = { x0: number; y0: number; x1: number; y1: number };

/**
 * I riquadri della rilevazione, in coordinate della foto: i pezzi sopra `soglia`, uniti se stanno sulla stessa riga
 * (`vuoto`: quanto possono essere distanti, in altezze di riga) e poi allargati. `colonna` restringe a una parte
 * della foto (da `x` in poi, in coordinate della foto).
 */
function riquadri(r: Rilevazione, soglia: number, minPunteggio: number, vuoto: number, colonna?: number): Rettangolo[] {
  const nuclei: Rettangolo[] = [];
  for (const fascia of r.fasce) {
    for (const q of riquadriDaMappa(fascia.mappa, r.Wp, fascia.hp, soglia, minPunteggio)) {
      const centro = fascia.inizio + (q.y0 + q.y1) / 2;
      if (centro >= fascia.da && centro < fascia.a && (colonna === undefined || q.x1 / r.f > colonna)) nuclei.push({ x0: q.x0, y0: fascia.inizio + q.y0, x1: q.x1, y1: fascia.inizio + q.y1 });
    }
  }
  return unisciRiquadri(nuclei, vuoto).map((q) => {
    const g = allargaRiquadro(q, r.W, r.H);
    return { x0: g.x0 / r.f, y0: g.y0 / r.f, x1: g.x1 / r.f, y1: g.y1 / r.f };
  });
}

/** Legge il testo dei riquadri (a gruppi, dal più stretto al più largo: meno spazio sprecato). */
async function leggi(m: Motore, tela: HTMLCanvasElement, rett: Rettangolo[], avanzamento: (f: number) => void): Promise<Scatola[]> {
  const ordinati = rett.filter((r) => r.x1 - r.x0 > 4 && r.y1 - r.y0 > 4).sort((a, b) => (a.x1 - a.x0) / (a.y1 - a.y0) - (b.x1 - b.x0) / (b.y1 - b.y0));
  const scatole: Scatola[] = [];
  for (let i = 0; i < ordinati.length; i += LETTURE_PER_VOLTA) {
    const gruppo = ordinati.slice(i, i + LETTURE_PER_VOLTA);
    const ritagli = gruppo.map((r) => {
      const x0 = Math.max(0, Math.floor(r.x0));
      const y0 = Math.max(0, Math.floor(r.y0));
      return leggiPunti(tela, x0, y0, Math.max(1, Math.min(tela.width, Math.ceil(r.x1)) - x0), Math.max(1, Math.min(tela.height, Math.ceil(r.y1)) - y0));
    });
    const wMax = Math.max(...ritagli.map((r) => larghezzaPerLettura(r.width, r.height)));
    const risposta = await m.lettura.run({ [m.lettura.inputNames[0]]: new m.ort.Tensor('float32', tensoreLettura(ritagli, wMax), [ritagli.length, 3, altezzaLettura, wMax]) });
    const uscita = risposta[m.lettura.outputNames[0]];
    const [, t, classi] = uscita.dims;
    const dati = uscita.data as Float32Array;
    for (const [j, r] of gruppo.entries()) {
      const { testo, fiducia } = decodificaCtc(dati.subarray(j * t * classi, (j + 1) * t * classi), t, classi, m.caratteri);
      if (testo.trim()) scatole.push({ testo: testo.trim(), x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, fiducia });
    }
    avanzamento(Math.min(1, (i + gruppo.length) / ordinati.length));
  }
  return scatole;
}

export interface Lettura {
  /** Tutto il testo trovato, con la posizione nella foto. */
  scatole: Scatola[];
  /**
   * Rilegge solo la colonna dei prezzi (da `x` in poi) con soglie più basse e legge ogni riga intera («1,99 A»):
   * serve quando un prezzo non è stato rilevato. Restituisce le sole scatole della colonna.
   */
  rileggiColonna: (x: number, avanzamento: (frazione: number) => void) => Promise<Scatola[]>;
}

/**
 * Legge lo scontrino con PaddleOCR: i pezzi di testo con la loro posizione (coordinate di `tela`).
 * `larghezzaScontrino` è la larghezza dello scontrino nella foto (se la tela è stata ruotata e allargata, quella di prima).
 * Lancia un errore se i modelli non si caricano (niente rete la prima volta, poca memoria…).
 */
export async function leggiScatole(tela: HTMLCanvasElement, avanzamento: (frazione: number) => void, larghezzaScontrino = tela.width): Promise<Lettura> {
  const m = await caricaMotore();
  avanzamento(0.05);
  const r = await rileva(m, tela, larghezzaScontrino, (f) => avanzamento(0.05 + f * 0.35));
  const scatole = await leggi(m, tela, riquadri(r, 0.3, 0.5, 1), (f) => avanzamento(0.4 + f * 0.6));
  return {
    scatole,
    // Soglie più basse: si vedono anche le cifre sbiadite. Le righe della colonna si uniscono da un lato all'altro.
    rileggiColonna: (x, av) => leggi(m, tela, riquadri(r, 0.15, 0.3, 12, x - tela.width * 0.02), av),
  };
}

/** La foto ruotata di `angolo` radianti (positivo = in senso orario), su fondo bianco, grande quanto serve. */
export function ruotaFoto(tela: HTMLCanvasElement, angolo: number): HTMLCanvasElement {
  const c = Math.abs(Math.cos(angolo));
  const s = Math.abs(Math.sin(angolo));
  const out = document.createElement('canvas');
  out.width = Math.ceil(tela.width * c + tela.height * s);
  out.height = Math.ceil(tela.width * s + tela.height * c);
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(angolo);
  ctx.drawImage(tela, -tela.width / 2, -tela.height / 2);
  return out;
}
