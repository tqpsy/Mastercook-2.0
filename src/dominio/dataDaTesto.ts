/** Cerca la data di scadenza nel testo letto da una foto della confezione. */

export interface DataLetta {
  /** AAAA-MM-GG */
  data: string;
  /** «scadenza» se il testo dice «da consumarsi entro» / «scad.», «tmc» se dice «preferibilmente entro» / «TMC»; altrimenti non si sa. */
  tipo?: 'scadenza' | 'tmc';
}

const MESI: Record<string, number> = { gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6, lug: 7, ago: 8, set: 9, ott: 10, nov: 11, dic: 12 };

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
  let t = testo.toLowerCase().replace(/[oO](?=\d)|(?<=\d)[oO]/g, '0');
  const trovate: string[] = [];
  const aggiungi = (g: number | null, m: number, a: number) => {
    if (m < 1 || m > 12 || a < 2000 || a > 2100) return;
    const giorno = g ?? ultimoGiorno(a, m);
    if (giorno < 1 || giorno > ultimoGiorno(a, m)) return;
    trovate.push(`${a}-${due(m)}-${due(giorno)}`);
  };
  for (const x of t.matchAll(/(?<!\d)(\d{1,2})\s*[./\-\s]\s*(\d{1,2})\s*[./\-\s]\s*(\d{4}|\d{2})(?!\d)/g)) aggiungi(Number(x[1]), Number(x[2]), anno4(x[3]!));
  for (const x of t.matchAll(/(?<!\d)(\d{1,2})\s*([a-zì]{3})[a-z]*\.?\s*[./\-\s]?\s*(\d{4}|\d{2})(?!\d)/g)) {
    const m = MESI[x[2]!];
    if (m) aggiungi(Number(x[1]), m, anno4(x[3]!));
  }
  // Le date complete già lette non si rileggono come «mese e anno».
  t = t.replace(/(\d{1,2})\s*[./\-\s]\s*(\d{1,2})\s*[./\-\s]\s*(\d{4}|\d{2})(?!\d)/g, ' ').replace(/(\d{1,2})\s*([a-zì]{3})[a-z]*\.?\s*[./\-\s]?\s*(\d{4}|\d{2})(?!\d)/g, ' ');
  for (const x of t.matchAll(/(?<![\d./-])(\d{1,2})\s*[./\-]\s*(\d{4})(?!\d)/g)) aggiungi(null, Number(x[1]), Number(x[2]));
  for (const x of t.matchAll(/(?<!\d)([a-zì]{3})[a-z]*\.?\s*[./\-\s]?\s*(\d{4})(?!\d)/g)) {
    const m = MESI[x[1]!];
    if (m) aggiungi(null, m, Number(x[2]));
  }
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
