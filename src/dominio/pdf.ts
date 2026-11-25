/**
 * Il testo di uno scontrino da un PDF (lo «scontrino digitale» che i supermercati danno nell'app o in una pagina web, salvato
 * come PDF da Chrome). Un PDF ha già il testo, senza nessuna lettura ottica: ma lo dà a pezzi con le coordinate, e quello che
 * serve è lo scontrino com'è stampato, una riga per volta, con i nomi a sinistra e i prezzi a destra. Qui si ricompongono le righe
 * (stesso `y`) e si rimettono gli spazi in base alla larghezza dei caratteri, così il parser degli scontrini riceve lo stesso
 * testo che riceverebbe incollandolo. Le righe con le posizioni sono quelle di `daPagine` (scontrini-geometria.ts).
 * Funzione pura: la libreria che legge il PDF sta in `ui/pdf.ts`.
 */
import { daPagine, testoDa } from './scontrini-geometria';

/** Un pezzo di testo di una pagina: dove inizia (`x`, `y` dal basso, in punti) e quanto è largo. */
export interface VocePdf {
  t: string;
  x: number;
  y: number;
  w: number;
}

export interface PaginaPdf {
  voci: VocePdf[];
}

/** Il testo di tutte le pagine, una riga per ogni riga stampata, dall'alto in basso e pagina dopo pagina, con i pezzi nelle loro colonne. */
export const testoDaPagine = (pagine: PaginaPdf[]): string => testoDa(daPagine(pagine));
