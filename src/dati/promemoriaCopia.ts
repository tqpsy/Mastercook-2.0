import { type StatoCopia } from '../dominio/promemoriaCopia';

/** Le date del promemoria stanno su questo dispositivo, una per famiglia: non sono dati della famiglia. */
const chiave = (famiglia: string, campo: string) => `mc-promemoria-copia-${campo}-${famiglia}`;

function leggi(famiglia: string, campo: string): string | null {
  try {
    return localStorage.getItem(chiave(famiglia, campo));
  } catch {
    return null;
  }
}

function scrivi(famiglia: string, campo: string, valore: string) {
  try {
    localStorage.setItem(chiave(famiglia, campo), valore);
  } catch {
    // Senza archivio del browser il promemoria si ripresenta ad ogni apertura: meglio che mai.
  }
}

export function leggiStatoCopia(famiglia: string): Pick<StatoCopia, 'ultimaCopia' | 'primaVolta' | 'rinviataFino'> {
  return { ultimaCopia: leggi(famiglia, 'ultima'), primaVolta: leggi(famiglia, 'prima'), rinviataFino: leggi(famiglia, 'rinvio') };
}

/** La prima volta che si vede la famiglia si segna il giorno, e da lì si comincia a contare. */
export function segnaPrimaVolta(famiglia: string, giorno: string) {
  if (!leggi(famiglia, 'prima')) scrivi(famiglia, 'prima', giorno);
}

export function segnaCopiaSalvata(famiglia: string, giorno: string) {
  scrivi(famiglia, 'ultima', giorno);
}

export function rinviaPromemoria(famiglia: string, fino: string) {
  scrivi(famiglia, 'rinvio', fino);
}
