/**
 * Legge il testo di un PDF sul telefono (lo scontrino digitale salvato come PDF): pdf.js si carica solo alla prima volta, e il
 * file non esce dal dispositivo. Il PDF ha già il testo: niente lettura ottica, quindi niente errori di lettura. Le righe si
 * ricompongono in `dominio/pdf.ts`.
 */
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { type PaginaPdf, testoDaPagine } from '../dominio/pdf';

/** Il testo dello scontrino nel PDF; lancia un errore se il file non è un PDF leggibile. Vuoto se non ha testo (una scansione). */
export async function leggiTestoDaPdf(file: Blob): Promise<string> {
  // La versione «legacy» di pdf.js: quella normale usa funzioni troppo nuove per i browser dei telefoni (Promise.try,
  // Map.getOrInsertComputed, Math.sumPrecise) e su un telefono non aggiornatissimo non legge nessun PDF.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  const caricamento = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const documento = await caricamento.promise;
    const pagine: PaginaPdf[] = [];
    for (let n = 1; n <= documento.numPages; n++) {
      const contenuto = await (await documento.getPage(n)).getTextContent();
      pagine.push({ voci: contenuto.items.filter((i): i is TextItem => 'str' in i).map((i) => ({ t: i.str, x: i.transform[4], y: i.transform[5], w: i.width })) });
    }
    return testoDaPagine(pagine);
  } finally {
    await caricamento.destroy();
  }
}
