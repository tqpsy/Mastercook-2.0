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
    // Lo zero davanti perso («.56», «-.45»).
    const senzaZero = linea.match(/^(-?)[.,](\d{2})\s?([A-Z])?$/);
    if (senzaZero) {
      out.push({ testo: `${senzaZero[1]}0,${senzaZero[2]}${senzaZero[3] ? ` ${senzaZero[3]}` : ''}`, negativo: senzaZero[1] === '-' });
      continue;
    }
    // Nella colonna dei prezzi la virgola si perde spesso («135 A», «595B», «000C»): tre o più cifre sole sono euro e centesimi.
    const senzaVirgola = linea.match(/^(-?)(\d{1,3})(\d{2})\s?([A-Z])?$/);
    if (senzaVirgola) out.push({ testo: `${senzaVirgola[1]}${senzaVirgola[2]},${senzaVirgola[3]}${senzaVirgola[4] ? ` ${senzaVirgola[4]}` : ''}`, negativo: senzaVirgola[1] === '-' });
  }
  return out;
}

/**
 * Il nome di una riga dello scontrino (anche senza prezzo, anche con l'intestazione «PREZZO IVA» accanto), o null.
 * `taglia`: il testo è la pagina intera, con i prezzi accanto ai nomi, spesso rovinati: si taglia dove inizia lo spazio
 * largo che li separa. Altrimenti (colonna dei nomi letta a parte) si tolgono solo un prezzo o un'aliquota in coda
 * («4%»). Una quantità prima del nome («2   PANE», colonna «QTA») viene data a parte.
 */
function nomeRiga(riga: string, taglia: boolean): { nome: string; qta?: number } | null {
  const linea = pulisciLinea(riga);
  const m = linea.match(IMPORTO);
  const qta = riga.trim().match(/^(\d{1,3})\s{2,}(\D.*)$/);
  const corpo = qta ? qta[2] : riga.trim();
  const lineaCorpo = pulisciLinea(corpo);
  const mc = lineaCorpo.match(IMPORTO);
  const nome = pulisciLinea(taglia && /\s{3,}/.test(corpo) ? corpo.split(/\s{3,}/)[0] : mc ? lineaCorpo.slice(0, mc.index) : lineaCorpo)
    .replace(/\bPREZZO\b.*$/, '')
    .replace(/(\s+\d{1,2}\s?%)+$/, '')
    .replace(/[^A-Z0-9.)]+$/, '')
    .trim();
  // Righe di dettaglio di quella sopra: «Cad 0,99 Pz. 3», «0,96 kg x 1,79 EUR/kg», «VALORE SCONTI» (un riepilogo).
  if (/^CAD\.?\s*\d|KG\s?[X*]|EUR\s?\/?\s?KG|\bPZ\.?\s?\d|VALORE\s+SCON/.test(nome)) return null;
  // Una riga di peso («1,000 * 3,70kg», letta «1.0003,70Hg»): tante cifre e quasi niente lettere.
  if ((nome.match(/\d/g) ?? []).length >= 4 && (nome.match(/[A-Z]/g) ?? []).length <= 2) return null;
  if ((nome.match(/[A-Z]/g) ?? []).length < 2 || fineRighe(nome) || DA_SALTARE.test(nome) || PEZZI.test(linea)) return null;
  // «3 x 0.10» letto «DX 0.10»: una x, un prezzo e quasi niente altro non è una riga.
  if (m && /[X*×]\s*\d{1,3}[.,]\d{2}\s*$/.test(linea) && (nome.replace(/[X*×]/g, '').match(/[A-Z]/g) ?? []).length < 3) return null;
  return { nome, ...(qta && Number(qta[1]) > 0 ? { qta: Number(qta[1]) } : {}) };
}

/** Una riga di sconto: il prezzo è negativo (e se il segno si è perso lo si rimette). */
const eSconto = (nome: string) => /\b(SCONTO|SC\.|PROMO|OFFERTA|RIBASSO|RIDUZIONE|STORNO|COUPON)\b|OFFERT|SCONT[O0]|TOO\s?GOO?D|TO\s?GO$|P[IL]US$|^\d{2,3}\s?%/.test(nome);

/** Una riga che è solo l'intestazione («DESCRIZIONE», «PREZZO IVA»): se accanto c'è un nome («CARTAMICA   PREZZO IVA») è una riga. */
const soloIntestazione = (linea: string) => eIntestazione(linea) && (linea.replace(/\bPREZ\w*\b.*$/, '').replace(/\b\w*DESCR\w*\b/, '').match(/[A-Z]/g) ?? []).length < 3;

/**
 * Le righe della lettura: i `quanti` nomi che precedono il totale (si conta all'indietro dal totale, o dal numero
 * di articoli: l'inizio si legge peggio della fine) e l'intestazione del negozio prima di loro. Null se non ce ne sono
 * abbastanza.
 */
function prendiNomi(testo: string, quanti: number, taglia: boolean): { testa: string[]; nomi: string[]; qta: (number | undefined)[] } | null {
  const grezze = testo.split(/\r?\n/).filter((l) => l.trim());
  const linee = grezze.map(pulisciLinea);
  const intestazione = linee.findIndex(eIntestazione);
  let fine = linee.findIndex((l, i) => i > intestazione && eFineRighe(l));
  if (fine < 0) fine = linee.length;
  const scelte: { i: number; nome: string; qta?: number }[] = [];
  // Con l'intestazione letta le righe sono tutte quelle tra lei e la fine (chi chiama controlla che siano tante quanti
  // i prezzi: un nome o un prezzo perso sposterebbe tutto di una riga). Senza, si contano `quanti` nomi all'indietro dalla fine.
  for (let i = fine - 1; i > intestazione && (intestazione >= 0 || scelte.length < quanti); i--) {
    const r = soloIntestazione(linee[i]) ? null : nomeRiga(grezze[i], taglia);
    if (r) scelte.unshift({ i, ...r });
  }
  if (!scelte.length || (intestazione < 0 && scelte.length < quanti)) return null;
  // Prima dei nomi: l'intestazione del negozio (senza la riga «DESCRIZIONE»: la rimettiamo noi, una sola).
  return { testa: [...linee.slice(0, scelte[0].i).filter((l) => !eIntestazione(l)), 'DESCRIZIONE'], nomi: scelte.map((x) => x.nome), qta: scelte.map((x) => x.qta) };
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
  const letti = prendiNomi(nomiDa, prezzi.length, nomiDa === primo);
  // Più nomi che prezzi: ne manca uno, non si sa quale. Più prezzi che nomi: i prezzi di troppo in fondo sono quelli del
  // totale, dell'IVA e del pagamento, e si tolgono.
  if (!letti || letti.nomi.length > prezzi.length) return null;
  prezzi = prezzi.slice(0, letti.nomi.length);
  // Uno sconto è negativo: se al prezzo è caduto il segno meno, lo si rimette (il nome dice che è uno sconto).
  // Il contrario non vale: un prezzo negativo può essere uno sconto che non si chiama così («Too Good To Go»).
  const conSegno = prezzi.map((p, i) => (eSconto(letti.nomi[i]) && !p.negativo ? { testo: `-${p.testo}`, negativo: true } : p));
  if (letti.nomi.some((n, i) => eSconto(n) && !conSegno[i].negativo)) return null;
  const linee = primo.split(/\r?\n/).map(pulisciLinea).filter(Boolean);
  const t = linee.findIndex((l, i) => eFineRighe(l) && linee.slice(0, i).some(eIntestazione));
  const resto = t >= 0 ? linee.slice(t) : [];
  const righe = letti.nomi.flatMap((n, i) => {
    // Colonna delle quantità («2   PANE   0,49   0,98»): il prezzo è quello di riga; il pezzo costa totale ÷ quantità.
    const q = letti.qta[i];
    const tot = Number(conSegno[i].testo.replace(/[^\d,]/g, '').replace(',', '.'));
    const unitario = q && q > 1 ? Math.round((tot / q) * 100) / 100 : null;
    if (unitario !== null && Math.abs(unitario * q! - tot) < 0.011) return [n, `${q} x ${unitario.toFixed(2).replace('.', ',')}   ${conSegno[i].testo}`];
    return [`${n}   ${conSegno[i].testo}`];
  });
  return [...letti.testa, ...righe, ...(resto.length && !fineRighe(resto[0]) ? ['TOTALE'] : []), ...resto].join('\n');
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
