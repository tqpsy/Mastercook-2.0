/**
 * Lettura del testo di uno scontrino, sul telefono, con Tesseract (italiano). La libreria si carica solo
 * alla prima foto e scarica una volta il suo motore e il vocabolario italiano: la foto non esce mai
 * dal dispositivo.
 *
 * Prima si prepara la foto (ritaglio, misura, ombre tolte, bianco e nero: preparaScontrino.ts), poi si legge
 * riga per riga in una sola colonna: con la lettura automatica delle colonne Tesseract metteva le descrizioni
 * da una parte e i prezzi dall'altra, e le righe non si ricomponevano più.
 * Se il conto non torna si rileggono a parte la colonna dei prezzi (solo cifre e virgola, molto più
 * precisa) e quella dei nomi, e si abbinano per ordine (colonne.ts): nella foto la carta si piega e il
 * prezzo finisce accanto al nome sbagliato. Se ancora non torna si rilegge la foto così com'è.
 * Si tiene sempre la lettura migliore.
 */
import { inizioColonnaPrezzi, type ParolaLetta, prezziDaColonna, unisciColonne } from '../dominio/colonne';
import { leggiScontrino } from '../dominio/scontrini';
import { preparaFoto } from './preparaScontrino';

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

export async function leggiTestoDaFoto(foto: Blob, avanzamento: (frazione: number) => void): Promise<string> {
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
