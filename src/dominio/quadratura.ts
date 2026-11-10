/**
 * Quadratura di uno scontrino letto dalla foto. La lettura confonde certe cifre (8 con 3, 5 con 9 o 6…):
 * se la somma delle righe non fa il totale, si cerca il minor numero di cifre che, cambiate con una
 * cifra «confondibile», fanno tornare il totale. Quando le righe hanno la lettera dell'IVA e lo
 * scontrino scrive l'IVA totale, anche quella deve tornare: due conti che tornano insieme sono una
 * prova molto più forte di uno solo. Se più soluzioni restano possibili non si indovina: si lascia com'è.
 */
import { normalizza } from './ricette';

export interface RigaConto {
  /** Prezzo in centesimi, sconti già tolti. */
  cent: number;
  nome: string;
  iva?: string;
  /** Le cifre si possono correggere (non lo sono quelle con uno sconto, o senza prezzo letto). */
  modificabile: boolean;
}

export interface DatiConto {
  /** Il totale scritto sullo scontrino, in centesimi. */
  totale: number;
  /** «DI CUI IVA», in centesimi. */
  ivaTotale?: number;
  /** Lettera → aliquota (0,22), dalla legenda in fondo: «C: IVA 22,00%». */
  aliquote?: Record<string, number>;
}

/** Cosa può essere stato letto al posto di cosa: ogni cifra → le cifre che potrebbe essere in realtà. */
const CONFUSIONI: Record<string, string> = {
  '0': '86',
  '1': '7',
  '3': '85',
  '4': '9',
  '5': '936',
  '6': '580',
  '7': '1',
  '8': '3605',
  '9': '54',
};

interface Opzione {
  riga: number;
  /** Il nuovo prezzo in centesimi. */
  cent: number;
  delta: number;
}

/** Tutte le righe con una sola cifra cambiata (una cifra non diventa mai lo zero iniziale). */
function opzioni(righe: RigaConto[]): Opzione[] {
  const out: Opzione[] = [];
  for (const [riga, r] of righe.entries()) {
    if (!r.modificabile || r.cent <= 0) continue;
    const cifre = String(r.cent);
    for (let i = 0; i < cifre.length; i++) {
      const peso = 10 ** (cifre.length - 1 - i);
      for (const nuova of CONFUSIONI[cifre[i]] ?? '') {
        if (i === 0 && nuova === '0') continue;
        const delta = (Number(nuova) - Number(cifre[i])) * peso;
        out.push({ riga, cent: r.cent + delta, delta });
      }
    }
  }
  return out;
}

/** L'IVA contenuta nei prezzi, riga per riga, o null se manca una lettera o un'aliquota. */
function ivaDelleRighe(cent: number[], righe: RigaConto[], aliquote: Record<string, number>): number | null {
  let tot = 0;
  for (const [i, r] of righe.entries()) {
    const a = r.iva ? aliquote[r.iva] : undefined;
    if (a === undefined) return null;
    tot += Math.round(cent[i] - cent[i] / (1 + a));
  }
  return tot;
}

/**
 * I nuovi prezzi in centesimi (uno per riga) se, tra le correzioni con al più tre cifre, ce n'è una sola
 * che spicca (IVA che torna, coppie uguali, poche cifre), altrimenti null. Le righe già giuste restano uguali.
 */
export function correggiPrezzi(righe: RigaConto[], dati: DatiConto, massimo = 3): number[] | null {
  const somma = righe.reduce((s, r) => s + r.cent, 0);
  const manca = dati.totale - somma;
  if (manca === 0) return null;
  const opz = opzioni(righe);
  const perDelta = new Map<number, number[]>();
  for (const [i, o] of opz.entries()) perDelta.set(o.delta, [...(perDelta.get(o.delta) ?? []), i]);

  const soluzioni: number[][] = [];
  for (let n = 1; n <= massimo; n++) {
    const cerca = (da: number, scelte: number[], resto: number) => {
      if (scelte.length === n - 1) {
        for (const k of perDelta.get(resto) ?? []) if (k >= da && !scelte.some((s) => opz[s].riga === opz[k].riga)) soluzioni.push([...scelte, k]);
        return;
      }
      for (let i = da; i < opz.length; i++) {
        if (scelte.some((s) => opz[s].riga === opz[i].riga)) continue;
        cerca(i + 1, [...scelte, i], resto - opz[i].delta);
      }
    };
    cerca(0, [], manca);
  }
  if (!soluzioni.length) return null;
  let candidati = soluzioni.map((sol) => {
    const cent = righe.map((r) => r.cent);
    for (const i of sol) cent[opz[i].riga] = opz[i].cent;
    return { cent, cifre: sol.length };
  });
  // L'IVA scritta sullo scontrino deve tornare anche lei (se non torna con nessuna, le lettere sono lette male: si ignora).
  if (dati.ivaTotale !== undefined && dati.aliquote) {
    const aliquote = dati.aliquote;
    const conIva = candidati.filter((c) => {
      const iva = ivaDelleRighe(c.cent, righe, aliquote);
      return iva !== null && Math.abs(iva - dati.ivaTotale!) <= 1;
    });
    if (conIva.length) candidati = conIva;
  }
  // Due righe con la stessa descrizione, una dopo l'altra, di solito costano uguale: è il segno più forte di una cifra letta male.
  const uguali = (c: number[]) => righe.filter((r, i) => i > 0 && normalizza(r.nome) === normalizza(righe[i - 1].nome) && c[i] === c[i - 1]).length;
  const punti = candidati.map((c) => ({ ...c, uguali: uguali(c.cent) }));
  const piu = Math.max(...punti.map((c) => c.uguali));
  const tra = punti.filter((c) => c.uguali === piu);
  const meno = Math.min(...tra.map((c) => c.cifre));
  const finali = tra.filter((c) => c.cifre === meno);
  return new Set(finali.map((c) => c.cent.join(','))).size === 1 ? finali[0].cent : null;
}
