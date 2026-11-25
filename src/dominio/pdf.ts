/**
 * Il testo di uno scontrino da un PDF (lo «scontrino digitale» che i supermercati danno nell'app o in una pagina web, salvato
 * come PDF da Chrome). Un PDF ha già il testo, senza nessuna lettura ottica: ma lo dà a pezzi con le coordinate, e quello che
 * serve è lo scontrino com'è stampato, una riga per volta, con i nomi a sinistra e i prezzi a destra. Qui si ricompongono le righe
 * (stesso `y`) e si rimettono gli spazi in base alla larghezza dei caratteri, così il parser degli scontrini riceve lo stesso
 * testo che riceverebbe incollandolo. Funzione pura: la libreria che legge il PDF sta in `ui/pdf.ts`.
 */

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

/** Due pezzi con la `y` più vicina di così (in punti) stanno sulla stessa riga. */
const TOLLERANZA_Y = 2;

const mediana = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;

/** La larghezza di un carattere (i PDF degli scontrini sono a spaziatura fissa): la mediana tra i pezzi di almeno tre lettere. */
function larghezzaCarattere(pagine: PaginaPdf[]): number {
  const misure = pagine.flatMap((p) => p.voci.filter((v) => v.t.trim().length >= 3 && v.w > 0).map((v) => v.w / v.t.length));
  return mediana(misure) || 6;
}

/** Il testo di tutte le pagine, una riga per ogni riga stampata, dall'alto in basso e pagina dopo pagina. */
export function testoDaPagine(pagine: PaginaPdf[]): string {
  const car = larghezzaCarattere(pagine);
  const righe: string[] = [];
  for (const pagina of pagine) {
    // Le righe: i pezzi (senza gli spazi soli, che portano solo la posizione) dall'alto verso il basso.
    const pezzi = pagina.voci.filter((v) => v.t.trim() !== '').sort((a, b) => b.y - a.y || a.x - b.x);
    const gruppi: VocePdf[][] = [];
    for (const v of pezzi) {
      const ultimo = gruppi.at(-1);
      if (ultimo && Math.abs(ultimo[0].y - v.y) <= TOLLERANZA_Y) ultimo.push(v);
      else gruppi.push([v]);
    }
    for (const g of gruppi) {
      let riga = '';
      for (const v of g.sort((a, b) => a.x - b.x)) {
        // Si mette il pezzo alla colonna dove sta; se il pezzo prima è arrivato più in là, resta uno spazio.
        const colonna = Math.round(v.x / car);
        riga = riga.padEnd(Math.max(colonna, riga.length + (riga ? 1 : 0)), ' ') + v.t.replace(/\s+$/, '');
      }
      righe.push(riga.trimEnd());
    }
  }
  // Il margine della pagina a sinistra non fa parte dello scontrino: si toglie quello comune a tutte le righe.
  const margine = Math.min(...righe.filter(Boolean).map((r) => r.length - r.trimStart().length));
  return righe.map((r) => r.slice(Number.isFinite(margine) ? margine : 0)).join('\n');
}
