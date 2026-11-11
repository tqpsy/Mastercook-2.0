/**
 * Lettura del testo di uno scontrino, sul telefono, con Tesseract (italiano). La libreria si carica solo
 * alla prima foto e scarica una volta il suo motore e il vocabolario italiano: la foto non esce mai
 * dal dispositivo.
 *
 * Prima si prova con PaddleOCR (paddle.ts), che legge la foto vera molto meglio; se non si carica (niente rete
 * la prima volta, poca memoria) o il conto non torna, si passa a Tesseract. Si tiene sempre la lettura migliore.
 *
 * Con Tesseract: prima si prepara la foto (ritaglio, misura, ombre tolte, bianco e nero: preparaScontrino.ts), poi si legge
 * riga per riga in una sola colonna: con la lettura automatica delle colonne Tesseract metteva le descrizioni
 * da una parte e i prezzi dall'altra, e le righe non si ricomponevano più.
 * Se il conto non torna si rileggono a parte la colonna dei prezzi (solo cifre e virgola, molto più
 * precisa) e quella dei nomi, e si abbinano per ordine (colonne.ts): nella foto la carta si piega e il
 * prezzo finisce accanto al nome sbagliato. Se ancora non torna si rilegge la foto così com'è.
 * Si tiene sempre la lettura migliore.
 */
import { dateNelTesto } from '../dominio/dataDaTesto';
import { inizioColonnaPrezzi, type ParolaLetta, prezziDaColonna, unisciColonne } from '../dominio/colonne';
import { impagina, inclinazione, inizioPrezzi, type Scatola } from '../dominio/paddle';
import { leggiScontrino } from '../dominio/scontrini';
import { leggiScatole, liberaPaddle, ruotaFoto } from './paddle';
import { binarizza, daGrigi, grigi, preparaFoto } from './preparaScontrino';

/** Quanto è buona una lettura: il conto che torna vale più di tutto, poi le righe trovate. */
function punteggio(testo: string): number {
  const s = leggiScontrino(testo);
  const senza = s.righe.filter((r) => r.senzaPrezzo).length;
  return (s.quadra ? 1000 : 0) + (s.totale !== null ? 100 : 0) + s.righe.length - senza - s.corretti * 0.1;
}

/** Ritaglia una fascia verticale (da x0 a x1) della foto preparata. */
function fascia(tela: HTMLCanvasElement, x0: number, x1: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = Math.max(1, x1 - x0);
  out.height = tela.height;
  out.getContext('2d')!.drawImage(tela, x0, 0, out.width, tela.height, 0, 0, out.width, tela.height);
  return out;
}

type Lettore = Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>>;

/**
 * Le letture alternative con la colonna dei prezzi e quella dei nomi riletti a parte. `parole` sono le
 * parole della prima lettura con la loro posizione: dicono dove iniziano i prezzi.
 */
async function leggiAColonne(lettore: Lettore, PSM: typeof import('tesseract.js').PSM, tela: HTMLCanvasElement, prima: string, parole: ParolaLetta[], passo: () => void): Promise<string[]> {
  const x = inizioColonnaPrezzi(parole, tela.width);
  const destra = fascia(tela, x, tela.width);
  const leggi = async (img: HTMLCanvasElement, modo: (typeof PSM)[keyof typeof PSM], cifre: boolean) => {
    await lettore.setParameters({ tessedit_pageseg_mode: modo, tessedit_char_whitelist: cifre ? '0123456789,.-ABC ' : '' });
    passo();
    return (await lettore.recognize(img)).data.text;
  };
  const prezzi = [await leggi(destra, PSM.SINGLE_BLOCK, true), await leggi(destra, PSM.SINGLE_COLUMN, true)].map(prezziDaColonna);
  const nomi = await leggi(fascia(tela, 0, x), PSM.SINGLE_BLOCK, false);
  await lettore.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN, tessedit_char_whitelist: '' });
  return prezzi.flatMap((p) => [unisciColonne(prima, p, nomi), unisciColonne(prima, p)]).filter((t): t is string => t !== null);
}

/**
 * Le letture possibili con PaddleOCR: la pagina riga per riga, e nomi e prezzi abbinati per ordine. Se il conto non
 * torna: se la foto è inclinata si raddrizza e si rilegge; se un prezzo non è stato rilevato si rilegge la sola
 * colonna dei prezzi con soglie più basse.
 */
export async function leggiConPaddle(foto: Blob, avanzamento: (frazione: number) => void): Promise<string[]> {
  let tela = await preparaFoto(foto, true);
  const larghezzaScontrino = tela.width;
  let lettura = await leggiScatole(tela, (f) => avanzamento(f * 0.5));
  const testi = (scatole: Scatola[]) => {
    const { pagina, prezzi, nomi } = impagina(scatole, tela.width);
    const abbinata = unisciColonne(pagina, prezziDaColonna(prezzi), nomi);
    return abbinata ? [abbinata, pagina] : [pagina];
  };
  const out = testi(lettura.scatole);
  const quadra = () => out.some((t) => leggiScontrino(t).quadra);
  if (quadra()) return out;
  // Foto inclinata (più di un grado): si raddrizza e si rilegge tutto.
  const angolo = inclinazione(lettura.scatole, tela.width);
  if (angolo !== null && Math.abs(angolo) > Math.PI / 180) {
    tela = ruotaFoto(tela, angolo);
    lettura = await leggiScatole(tela, (f) => avanzamento(0.5 + f * 0.3), larghezzaScontrino);
    out.push(...testi(lettura.scatole));
    if (quadra()) return out;
  }
  const x = inizioPrezzi(lettura.scatole, tela.width);
  const colonna = await lettura.rileggiColonna(x, (f) => avanzamento(0.8 + f * 0.2));
  out.push(...testi([...lettura.scatole.filter((s) => s.x0 < x), ...colonna]));
  return out;
}

export async function leggiTestoDaFoto(foto: Blob, avanzamento: (frazione: number) => void): Promise<string> {
  let migliore = '';
  try {
    for (const testo of await leggiConPaddle(foto, (f) => avanzamento(f * 0.8))) {
      if (!migliore || punteggio(testo) > punteggio(migliore)) migliore = testo;
    }
    if (migliore && leggiScontrino(migliore).quadra) return migliore;
  } catch {
    // Modelli non scaricabili o memoria finita: si legge con Tesseract.
  } finally {
    await liberaPaddle().catch(() => undefined);
  }
  const tesseract = await leggiConTesseract(foto, (f) => avanzamento(migliore ? 0.8 + f * 0.2 : f));
  return !migliore || punteggio(tesseract) > punteggio(migliore) ? tesseract : migliore;
}

async function leggiConTesseract(foto: Blob, avanzamento: (frazione: number) => void): Promise<string> {
  const { createWorker, PSM } = await import('tesseract.js');
  let passo = 0;
  let passi = 1;
  const lettore = await createWorker('ita', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') avanzamento(Math.min(1, (passo + m.progress) / passi));
    },
  });
  try {
    // Una colonna di testo, righe di misure diverse; gli spazi tra descrizione e prezzo restano.
    await lettore.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN, preserve_interword_spaces: '1' });
    let preparata: HTMLCanvasElement | null = null;
    try {
      preparata = await preparaFoto(foto);
    } catch {
      // Foto che il browser non sa disegnare: si legge com'è.
    }
    const letta = (await lettore.recognize(preparata ?? foto, { rotateAuto: true }, { text: true, blocks: true })).data;
    let migliore = letta.text;
    if (!preparata || leggiScontrino(migliore).quadra) return migliore;
    // Le parole con la loro x: dicono dove inizia la colonna dei prezzi.
    const parole: ParolaLetta[] = (letta.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words.map((w) => ({ testo: w.text, x0: w.bbox.x0 })))));
    passo = 1;
    passi = 5;
    for (const testo of await leggiAColonne(lettore, PSM, preparata, migliore, parole, () => (passo += 1))) {
      if (punteggio(testo) > punteggio(migliore)) migliore = testo;
    }
    if (leggiScontrino(migliore).quadra) return migliore;
    passo = 4;
    const seconda = (await lettore.recognize(foto, { rotateAuto: true })).data.text;
    return punteggio(seconda) > punteggio(migliore) ? seconda : migliore;
  } finally {
    await lettore.terminate();
  }
}

/** La foto su un canvas (al più `lato` punti), a colori o in bianco e nero senza ombre. */
async function telaDaFoto(foto: Blob, lato: number, biancoNero: boolean): Promise<HTMLCanvasElement> {
  const img = await createImageBitmap(foto);
  const scala = Math.min(1, lato / Math.max(img.width, img.height));
  const tela = document.createElement('canvas');
  tela.width = Math.max(1, Math.round(img.width * scala));
  tela.height = Math.max(1, Math.round(img.height * scala));
  const ctx = tela.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, tela.width, tela.height);
  img.close();
  if (biancoNero) {
    const g = grigi(ctx.getImageData(0, 0, tela.width, tela.height));
    const bn = daGrigi(binarizza(g, tela.width, tela.height, 12, 0.25), tela.width, tela.height);
    const dati = ctx.createImageData(bn.width, bn.height);
    dati.data.set(bn.data);
    ctx.putImageData(dati, 0, 0);
  }
  return tela;
}

/**
 * Legge il testo di una foto della data stampata su una confezione. Si prova in ordine PaddleOCR (legge bene
 * anche i caratteri a puntini e il testo piccolo), poi Tesseract sulla foto com'è e in bianco e nero senza ombre;
 * ci si ferma alla prima lettura che contiene una data, altrimenti si restituisce tutto il testo trovato.
 * Lancia un errore solo se nessun lettore ha funzionato.
 */
export async function leggiTestoData(foto: Blob): Promise<string> {
  const trovato: string[] = [];
  let funzionato = false;
  const buona = (t: string) => dateNelTesto(t).length > 0;
  try {
    const lettura = await leggiScatole(await telaDaFoto(foto, 1600, false), () => undefined);
    const t = lettura.scatole.map((x) => x.testo).join('\n');
    funzionato = true;
    trovato.push(t);
    if (buona(t)) return t;
  } catch {
    // Modelli non scaricabili o memoria finita: si passa a Tesseract.
  } finally {
    await liberaPaddle().catch(() => undefined);
  }
  const { createWorker, PSM } = await import('tesseract.js');
  const lettore = await createWorker('ita', 1);
  try {
    for (const bn of [false, true]) {
      await lettore.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      const t = (await lettore.recognize(await telaDaFoto(foto, 2000, bn), { rotateAuto: true })).data.text;
      funzionato = true;
      trovato.push(t);
      if (buona(t)) return t;
    }
  } finally {
    await lettore.terminate();
  }
  if (!funzionato) throw new Error('nessun lettore disponibile');
  return trovato.join('\n');
}
