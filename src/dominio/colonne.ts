/**
 * Scontrino letto in due tempi. Nella foto la carta si piega e la riga è storta: a sinistra Tesseract legge
 * bene i nomi ma, a destra, i prezzi finiscono accanto al nome sbagliato (anche di una riga) e le cifre si
 * confondono. Allora si rilegge a parte la sola colonna dei prezzi, con solo cifre e virgola (molto più
 * precisa), e si abbinano nomi e prezzi per ORDINE: ogni riga ha un solo prezzo, nello stesso ordine.
 * Se i conti non tornano (nomi e prezzi in numero diverso, uno sconto fuori posto) non si abbina niente.
 */
import { DA_SALTARE, eFineRighe, eIntestazione, fineRighe, IMPORTO, PEZZI, pulisciLinea } from './scontrini';

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
    if (m && !(linea.slice(0, m.index).match(/[A-Z0-9]/g) ?? []).length) {
      const numero = m[1].replace(/\s/g, '').replace(':', ',');
      out.push({ testo: `${numero}${/^[A-Z]$/.test(m[2] ?? '') ? ` ${m[2]}` : ''}`, negativo: numero.startsWith('-') });
      continue;
    }
    // Nella colonna dei prezzi la virgola si perde spesso («135 A», «595B», «000C»): tre o più cifre sole sono euro e centesimi.
    const senzaVirgola = linea.match(/^(-?)(\d{1,3})(\d{2})\s?([A-Z])?$/);
    if (senzaVirgola) out.push({ testo: `${senzaVirgola[1]}${senzaVirgola[2]},${senzaVirgola[3]}${senzaVirgola[4] ? ` ${senzaVirgola[4]}` : ''}`, negativo: senzaVirgola[1] === '-' });
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

/**
 * Le righe della lettura: i `quanti` nomi che precedono il totale (si conta all'indietro dal totale, o dal numero
 * di articoli: l'inizio si legge peggio della fine) e l'intestazione del negozio prima di loro. Null se non ce ne sono
 * abbastanza.
 */
function prendiNomi(testo: string, quanti: number): { testa: string[]; nomi: string[] } | null {
  const grezze = testo.split(/\r?\n/).filter((l) => l.trim());
  const linee = grezze.map(pulisciLinea);
  const intestazione = linee.findIndex(eIntestazione);
  let fine = linee.findIndex((l, i) => i > intestazione && eFineRighe(l));
  if (fine < 0) fine = linee.length;
  const scelte: { i: number; nome: string }[] = [];
  // Con l'intestazione letta le righe sono tutte quelle tra lei e la fine (chi chiama controlla che siano tante quanti
  // i prezzi: un nome o un prezzo perso sposterebbe tutto di una riga). Senza, si contano `quanti` nomi all'indietro dalla fine.
  for (let i = fine - 1; i > intestazione && (intestazione >= 0 || scelte.length < quanti); i--) {
    const nome = eIntestazione(linee[i]) ? null : nomeRiga(grezze[i]);
    if (nome) scelte.unshift({ i, nome });
  }
  if (!scelte.length || (intestazione < 0 && scelte.length < quanti)) return null;
  // Prima dei nomi: l'intestazione del negozio (senza la riga «DESCRIZIONE»: la rimettiamo noi, una sola).
  return { testa: [...linee.slice(0, scelte[0].i).filter((l) => !eIntestazione(l)), 'DESCRIZIONE'], nomi: scelte.map((x) => x.nome) };
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
  const letti = prendiNomi(nomiDa, prezzi.length);
  // Più nomi che prezzi: ne manca uno, non si sa quale. Più prezzi che nomi: i prezzi di troppo in fondo sono quelli del
  // totale, dell'IVA e del pagamento, e si tolgono.
  if (!letti || letti.nomi.length > prezzi.length) return null;
  prezzi = prezzi.slice(0, letti.nomi.length);
  // Uno sconto è negativo: se al prezzo è caduto il segno meno, lo si rimette (il nome dice che è uno sconto).
  const conSegno = prezzi.map((p, i) => (eSconto(letti.nomi[i]) && !p.negativo ? { testo: `-${p.testo}`, negativo: true } : p));
  if (letti.nomi.some((n, i) => eSconto(n) !== conSegno[i].negativo)) return null;
  const linee = primo.split(/\r?\n/).map(pulisciLinea).filter(Boolean);
  const t = linee.findIndex((l, i) => eFineRighe(l) && linee.slice(0, i).some(eIntestazione));
  const resto = t >= 0 ? linee.slice(t) : [];
  return [...letti.testa, ...letti.nomi.map((n, i) => `${n}   ${conSegno[i].testo}`), ...(resto.length && !fineRighe(resto[0]) ? ['TOTALE'] : []), ...resto].join('\n');
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
