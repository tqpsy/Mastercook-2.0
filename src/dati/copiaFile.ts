import { esporta, nomeFileEsportazione } from './esportazione';
import type { Trasporto } from './tipi';

/** Com'è andata: salvata dove la persona ha scelto, scaricata come file, oppure lasciata perdere. */
export type EsitoCopia = { tipo: 'salvata' | 'scaricata'; riassunto: string } | { tipo: 'annullata' };

/**
 * Prepara la copia completa dei dati e la consegna: sul telefono si apre la scelta di dove metterla (su iPhone
 * «Salva in File», anche iCloud Drive), altrimenti si scarica il file. Lancia un errore se non riesce a prepararla.
 */
export async function salvaCopiaFile(trasporto: Trasporto, famiglia: string, nomeFamiglia: string, giorno: string): Promise<EsitoCopia> {
  const file = await esporta(trasporto, famiglia);
  const nomeFile = nomeFileEsportazione(nomeFamiglia, giorno);
  const blob = new File([JSON.stringify(file, null, 2)], nomeFile, { type: 'application/json' });
  const riassunto = `${file.conteggi.membro} persone, ${file.conteggi.vincolo_alimentare} tra allergie ed esigenze.`;
  if (navigator.canShare?.({ files: [blob] })) {
    try {
      await navigator.share({ files: [blob], title: `Mastercook: ${nomeFamiglia}` });
      return { tipo: 'salvata', riassunto };
    } catch (e) {
      if ((e as Error).name === 'AbortError') return { tipo: 'annullata' };
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nomeFile;
  a.click();
  URL.revokeObjectURL(a.href);
  return { tipo: 'scaricata', riassunto };
}
