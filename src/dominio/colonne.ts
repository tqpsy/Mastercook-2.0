/**
 * Scontrino letto in due tempi. Nella foto la carta si piega e la riga è storta: a sinistra Tesseract legge
 * bene i nomi ma, a destra, i prezzi finiscono accanto al nome sbagliato (anche di una riga) e le cifre si
 * confondono. Allora si rilegge a parte la sola colonna dei prezzi, con solo cifre e virgola (molto più
 * precisa), e si abbinano nomi e prezzi per ORDINE: ogni riga ha un solo prezzo, nello stesso ordine.
 * Se i conti non tornano (nomi e prezzi in numero diverso, uno sconto fuori posto) non si abbina niente.
 */
import { DA_SALTARE, fineRighe, IMPORTO, INTESTAZIONE_RIGHE, PEZZI, pulisciLinea } from './scontrini';

/** Un prezzo letto dalla colonna, con la lettera dell'IVA se c'è: «1,99 B», «-0,44». */
export interface PrezzoColonna {
  testo: string;
  negativo: boolean;
}

/** I prezzi, nell'ordine, dal testo della colonna: le righe che non sono un prezzo (rumore) si scartano. */
export function prezziDaColonna(testo: string): PrezzoColonna[] {
  const out: PrezzoColonna[] = [];
  for (const linea of testo.split(/\r?\n/).map(pulisciLinea).filter(Boolean)) {
    const m = linea.match(IMPORTO);
    if (!m || (linea.slice(0, m.index).match(/[A-Z0-9]/g) ?? []).length) continue;
    const numero = m[1].replace(/\s/g, '').replace(':', ',');
    out.push({ testo: `${numero}${/^[A-Z]$/.test(m[2] ?? '') ? ` ${m[2]}` : ''}`, negativo: numero.startsWith('-') });
  }
  return out;
}

/**
 * Il nome di una riga dello scontrino (anche senza prezzo, anche con l'intestazione «PREZZO IVA» accanto), o
 * null. Il prezzo letto accanto al nome è spesso rovinato: si taglia dove inizia lo spazio largo che lo separa.
 */
function nomeRiga(riga: string): string | null {
  const linea = pulisciLinea(riga);
  const m = linea.match(IMPORTO);
  const nome = pulisciLinea(/\s{3,}/.test(riga.trim()) ? riga.trim().split(/\s{3,}/)[0] : m ? linea.slice(0, m.index) : linea)
    .replace(/\bPREZZO\b.*$/, '')
    .replace(/[^A-Z0-9.)]+$/, '')
    .trim();
  if ((nome.match(/[A-Z]/g) ?? []).length < 2 || fineRighe(nome) || DA_SALTARE.test(nome) || PEZZI.test(linea)) return null;
  // «3 x 0.10» letto «DX 0.10»: una x, un prezzo e quasi niente altro non è una riga.
  if (/[X*×]\s*\d{1,3}[.,]\d{2}\s*$/.test(linea) && (nome.replace(/[X*×]/g, '').match(/[A-Z]/g) ?? []).length < 3) return null;
  return nome;
}

const eSconto = (nome: string) => /\b(SCONTO|SC\.|PROMO|OFFERTA|RIBASSO|RIDUZIONE|STORNO)\b/.test(nome);

/** Le righe della lettura: l'intestazione fino a «DESCRIZIONE», i primi `quanti` nomi e tutto quello che segue. */
function prendiNomi(testo: string, quanti: number): { testa: string[]; nomi: string[]; resto: string[] } | null {
  const grezze = testo.split(/\r?\n/).filter((l) => l.trim());
  const linee = grezze.map(pulisciLinea);
  const inizio = linee.findIndex((l) => INTESTAZIONE_RIGHE.test(l));
  if (inizio < 0) return null;
  const nomi: string[] = [];
  let fine = inizio + 1;
  for (; fine < grezze.length && nomi.length < quanti; fine++) {
    const nome = nomeRiga(grezze[fine]);
    if (nome) nomi.push(nome);
  }
  return { testa: linee.slice(0, inizio + 1), nomi, resto: linee.slice(fine) };
}

/**
 * Il testo con i nomi (da `nomiDa`, di solito la colonna di sinistra riletta a parte; se manca, dalla prima
 * lettura) e i prezzi della colonna di destra, abbinati per ordine; dopo, il resto della prima lettura
 * (totale, IVA, pagamento). Null se nomi e prezzi non si abbinano (meno nomi che prezzi, o uno sconto con
 * un prezzo positivo e viceversa). Le righe sono tante quanti sono i prezzi; sul totale si mette un segno,
 * perché letto male non sia scambiato per una riga.
 */
export function unisciColonne(primo: string, prezzi: PrezzoColonna[], nomiDa = primo): string | null {
  if (!prezzi.length) return null;
  const nomi = prendiNomi(nomiDa, prezzi.length);
  if (!nomi || nomi.nomi.length !== prezzi.length) return null;
  if (nomi.nomi.some((n, i) => eSconto(n) !== prezzi[i].negativo)) return null;
  // Il resto (totale, IVA, pagamento) viene dalla prima lettura, dopo le sue righe; se lì mancano dei nomi, dal totale.
  const daPrimo = prendiNomi(primo, prezzi.length);
  let resto: string[];
  if (daPrimo && daPrimo.nomi.length === prezzi.length) resto = daPrimo.resto;
  else {
    const linee = primo.split(/\r?\n/).map(pulisciLinea).filter(Boolean);
    const t = linee.findIndex((l) => fineRighe(l));
    resto = t >= 0 ? linee.slice(t) : [];
  }
  return [...nomi.testa, ...nomi.nomi.map((n, i) => `${n}   ${prezzi[i].testo}`), ...(resto.length && !fineRighe(resto[0]) ? ['TOTALE'] : []), ...resto].join('\n');
}

/** Una parola letta con la sua posizione (x del bordo sinistro) nella foto. */
export interface ParolaLetta {
  testo: string;
  x0: number;
}

/**
 * Da quale x inizia la colonna dei prezzi: poco a sinistra dei numeri col decimale che la prima lettura ha
 * visto (si ignora il 20% più a sinistra, che può essere un peso o un pezzo nel nome). Senza abbastanza
 * numeri, un terzo della larghezza dal bordo destro.
 */
export function inizioColonnaPrezzi(parole: ParolaLetta[], larghezza: number): number {
  const x = parole
    .filter((p) => /^-?\d{1,4}\s?[.,:]\s?\d{2}$/.test(p.testo.trim()))
    .map((p) => p.x0)
    .sort((a, b) => a - b);
  if (x.length < 5) return Math.round(larghezza * 0.66);
  return Math.max(0, Math.round(x[Math.floor(x.length * 0.2)] - larghezza * 0.03));
}
