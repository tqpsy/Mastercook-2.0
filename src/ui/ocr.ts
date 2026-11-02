/**
 * Lettura del testo di uno scontrino, sul telefono, con Tesseract (italiano). La libreria si carica solo
 * alla prima foto e scarica una volta il suo motore e il vocabolario italiano: la foto non esce mai
 * dal dispositivo.
 *
 * Prima si prepara la foto (ritaglio, misura, ombre tolte, bianco e nero: preparaScontrino.ts), poi si legge
 * riga per riga in una sola colonna: con la lettura automatica delle colonne Tesseract metteva le descrizioni
 * da una parte e i prezzi dall'altra, e le righe non si ricomponevano più.
 * Se il conto non torna si rilegge anche la foto così com'è e si tiene la lettura migliore.
 */
import { leggiScontrino } from '../dominio/scontrini';
import { preparaFoto } from './preparaScontrino';

/** Quanto è buona una lettura: il conto che torna vale più di tutto, poi le righe trovate. */
function punteggio(testo: string): number {
  const s = leggiScontrino(testo);
  return (s.quadra ? 1000 : 0) + (s.totale !== null ? 100 : 0) + s.righe.length;
}

export async function leggiTestoDaFoto(foto: Blob, avanzamento: (frazione: number) => void): Promise<string> {
  const { createWorker, PSM } = await import('tesseract.js');
  let passo = 0;
  let passi = 1;
  const lettore = await createWorker('ita', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') avanzamento((passo + m.progress) / passi);
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
    const prima = (await lettore.recognize(preparata ?? foto, { rotateAuto: true })).data.text;
    if (!preparata || leggiScontrino(prima).quadra) return prima;
    passo = 1;
    passi = 2;
    const seconda = (await lettore.recognize(foto, { rotateAuto: true })).data.text;
    return punteggio(seconda) > punteggio(prima) ? seconda : prima;
  } finally {
    await lettore.terminate();
  }
}
