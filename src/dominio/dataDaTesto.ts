/** Cerca la data di scadenza nel testo letto da una foto della confezione. */

export interface DataLetta {
  /** AAAA-MM-GG */
  data: string;
  /** «scadenza» se il testo dice «da consumarsi entro» / «scad.», «tmc» se dice «preferibilmente entro» / «TMC»; altrimenti non si sa. */
  tipo?: 'scadenza' | 'tmc';
}

/** Mesi abbreviati in italiano e inglese (le confezioni sono spesso bilingue). */
const MESI: Record<string, number> = {
  gen: 1, jan: 1, feb: 2, mar: 3, apr: 4, mag: 5, may: 5, giu: 6, jun: 6, lug: 7, jul: 7,
  ago: 8, aug: 8, set: 9, sep: 9, ott: 10, oct: 10, nov: 11, dic: 12, dec: 12,
};
// Solo i mesi veri: una parola qualsiasi di tre lettere (es. «scad») non deve «mangiare» il numero che la segue.
const NOME_MESE = `(${Object.keys(MESI).join('|')})`;
const GIORNO_MESE_ANNO = new RegExp(`(?<!\\d)(\\d{1,2})\\s*${NOME_MESE}[a-z]*\\.?\\s*[./\\-\\s]?\\s*(\\d{4}|\\d{2})(?!\\d)`, 'g');
const MESE_ANNO = new RegExp(`(?<![a-z])${NOME_MESE}[a-z]*\\.?\\s*[./\\-\\s]?\\s*(\\d{4})(?!\\d)`, 'g');

const due = (n: number) => String(n).padStart(2, '0');

function ultimoGiorno(anno: number, mese: number): number {
  return new Date(Date.UTC(anno, mese, 0)).getUTCDate();
}

function anno4(a: string): number {
  const n = Number(a);
  return a.length === 2 ? 2000 + n : n;
}

/** Tutte le date valide che compaiono nel testo (con solo mese e anno vale l'ultimo giorno del mese). */
export function dateNelTesto(testo: string): string[] {
  // «O» letta al posto di «0», ma solo dentro i numeri: «12OTT2027» e «AGO2027» restano mesi.
  let t = testo.toLowerCase().replace(/(?<=[\d./\-\s]|^)o(?=\d)|(?<=\d)o(?![a-z])/g, '0');
  const trovate: string[] = [];
  const aggiungi = (g: number | null, m: number, a: number) => {
    if (m < 1 || m > 12 || a < 2000 || a > 2100) return;
    const giorno = g ?? ultimoGiorno(a, m);
    if (giorno < 1 || giorno > ultimoGiorno(a, m)) return;
    trovate.push(`${a}-${due(m)}-${due(giorno)}`);
  };
  // Anno per primo (2026-03-15), tolto dal testo prima delle altre forme.
  const ISO = /(?<!\d)(20\d{2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})(?!\d)/g;
  for (const x of t.matchAll(ISO)) aggiungi(Number(x[3]), Number(x[2]), Number(x[1]));
  t = t.replace(ISO, ' ');
  for (const x of t.matchAll(/(?<!\d)(\d{1,2})\s*[./\-\s]\s*(\d{1,2})\s*[./\-\s]\s*(\d{4}|\d{2})(?!\d)/g)) aggiungi(Number(x[1]), Number(x[2]), anno4(x[3]!));
  for (const x of t.matchAll(GIORNO_MESE_ANNO)) aggiungi(Number(x[1]), MESI[x[2]!]!, anno4(x[3]!));
  // Le date complete già lette non si rileggono come «mese e anno».
  t = t.replace(/(\d{1,2})\s*[./\-\s]\s*(\d{1,2})\s*[./\-\s]\s*(\d{4}|\d{2})(?!\d)/g, ' ').replace(GIORNO_MESE_ANNO, ' ');
  for (const x of t.matchAll(/(?<![\d./-])(\d{1,2})\s*[./-]\s*(\d{4})(?!\d)/g)) aggiungi(null, Number(x[1]), Number(x[2]));
  for (const x of t.matchAll(MESE_ANNO)) aggiungi(null, MESI[x[1]!]!, Number(x[2]));
  return [...new Set(trovate)];
}

/** La data più probabile di scadenza: sulle confezioni c'è spesso anche quella di produzione, quindi vale la più lontana. */
export function dataDiScadenza(testo: string): DataLetta | null {
  const date = dateNelTesto(testo).sort();
  const ultima = date[date.length - 1];
  if (!ultima) return null;
  const t = testo.toLowerCase();
  if (/preferibilmente|\btmc\b|best\s*before|da consumarsi preferibilmente/.test(t)) return { data: ultima, tipo: 'tmc' };
  if (/da consumarsi entro|\bscad|\bexp\b|use\s*by/.test(t)) return { data: ultima, tipo: 'scadenza' };
  return { data: ultima };
}
