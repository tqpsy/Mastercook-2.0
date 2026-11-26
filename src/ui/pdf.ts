/**
 * Legge il testo di un PDF sul telefono (lo scontrino digitale salvato come PDF): pdf.js si carica solo alla prima volta, e il
 * file non esce dal dispositivo. Il PDF ha già il testo: niente lettura ottica, quindi niente errori di lettura. Le righe si
 * ricompongono in `dominio/pdf.ts`.
 */
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { type PaginaPdf, testoDaPagine } from '../dominio/pdf';

/** Un errore di lettura del PDF, con la fase in cui è successo: sul telefono è l'unico modo per capire cosa è andato storto. */
export class ErrorePdf extends Error {
  constructor(
    public readonly fase: 'file' | 'libreria' | 'lettura',
    messaggio: string,
  ) {
    super(messaggio);
    this.name = 'ErrorePdf';
  }
}

/**
 * I byte del file scelto, letti SUBITO: prima di pulire il campo del file e prima di caricare pdf.js dalla rete. Su Android il file
 * scelto con il selettore può non essere più leggibile poco dopo (il telefono ne tiene una copia temporanea) e dà zero byte: letto
 * a distanza di qualche secondo, dopo il caricamento della libreria, risultava vuoto («The PDF file is empty»).
 */
export async function byteDelFile(file: Blob): Promise<Uint8Array> {
  let dati = new Uint8Array(await file.arrayBuffer());
  // Secondo modo di leggere: su alcuni telefoni FileReader riesce dove arrayBuffer() dà zero byte.
  if (dati.byteLength === 0 && typeof FileReader !== 'undefined') dati = new Uint8Array(await new Promise<ArrayBuffer>((ok) => {
    const lettore = new FileReader();
    lettore.onload = () => ok(lettore.result instanceof ArrayBuffer ? lettore.result : new ArrayBuffer(0));
    lettore.onerror = () => ok(new ArrayBuffer(0));
    lettore.readAsArrayBuffer(file);
  }));
  if (dati.byteLength === 0) {
    const nome = file instanceof File ? `, «${file.name}», tipo «${file.type || 'sconosciuto'}»` : '';
    throw new ErrorePdf('file', `il telefono ha dato un file vuoto (dichiarati ${file.size} byte${nome})`);
  }
  return dati;
}

/** Il testo dello scontrino nei byte di un PDF; lancia un `ErrorePdf` se non è un PDF leggibile. Vuoto se non ha testo (una scansione). */
export async function leggiTestoDaPdf(dati: Uint8Array): Promise<string> {
  // La versione «legacy» di pdf.js: quella normale usa funzioni troppo nuove per i browser dei telefoni (Promise.try,
  // Map.getOrInsertComputed, Math.sumPrecise) e su un telefono non aggiornatissimo non legge nessun PDF.
  let pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs');
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  } catch (e) {
    throw new ErrorePdf('libreria', `non si carica il motore del PDF (${e instanceof Error ? e.message : String(e)})`);
  }
  // pdf.js passa i byte al suo worker «cedendoli»: gliene si dà una copia, così `dati` resta valido se si riprova.
  const caricamento = pdfjs.getDocument({ data: dati.slice() });
  try {
    const documento = await caricamento.promise;
    const pagine: PaginaPdf[] = [];
    for (let n = 1; n <= documento.numPages; n++) {
      const contenuto = await (await documento.getPage(n)).getTextContent();
      pagine.push({ voci: contenuto.items.filter((i): i is TextItem => 'str' in i).map((i) => ({ t: i.str, x: i.transform[4], y: i.transform[5], w: i.width })) });
    }
    return testoDaPagine(pagine);
  } catch (e) {
    throw e instanceof ErrorePdf ? e : new ErrorePdf('lettura', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  } finally {
    await caricamento.destroy();
  }
}
