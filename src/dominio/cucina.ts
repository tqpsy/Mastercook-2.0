/** Modalità cucina: cosa leggere in un passaggio della ricetta (minuti per il timer, ingredienti nominati). */

export interface DaServire {
  nome: string;
  /** Parole con cui l'ingrediente può comparire nel testo del passaggio (nome e sinonimi). */
  parole: string[];
  quantita: string;
}

/** I minuti scritti nel passaggio («cuoci per 8 minuti», «10-12 min»): il primo numero, per il timer. */
export function minutiNelTesto(testo: string): number | null {
  const m = testo.match(/(\d+)(?:\s*[-–]\s*\d+)?\s*(?:minut|min\b)/i);
  const n = m ? Number(m[1]) : NaN;
  return n > 0 && n <= 600 ? n : null;
}

const LETTERA = 'a-zàèéìíòóù';
const escapa = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Gli ingredienti nominati nel passaggio, nell'ordine della ricetta. Si cerca l'inizio di una parola,
 * togliendo l'ultima lettera alle parole lunghe: «pomodoro» trova anche «pomodori», ma «sale» non trova «salata».
 */
export function ingredientiNelTesto(testo: string, ingredienti: DaServire[]): DaServire[] {
  const t = testo.toLowerCase();
  return ingredienti.filter((i) =>
    i.parole.some((p) => {
      const parola = p.toLowerCase().trim();
      if (parola.length < 3) return false;
      const radice = parola.length >= 5 ? parola.slice(0, -1) : parola;
      const fine = parola.length >= 5 ? `[${LETTERA}]?` : '';
      return new RegExp(`(^|[^${LETTERA}])${escapa(radice)}${fine}(?![${LETTERA}])`).test(t);
    }),
  );
}
