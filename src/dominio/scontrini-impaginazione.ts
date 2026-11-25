/**
 * Dai pezzi letti con la loro posizione alle righe dello scontrino: a quale nome va ogni prezzo. È la parte del parser che lavora
 * sulla geometria (scontrini-geometria.ts); il significato di ogni riga (prezzo, pezzi, peso, sconto, totale) lo dice
 * scontrini-righe.ts, che qui si usa senza ripeterlo.
 *
 * Nella foto la carta si piega e la riga è storta: un prezzo può trovarsi più in basso del suo nome, anche di una riga. Per
 * questo una foto si legge in due modi (`impaginaFoto`), e la lettura migliore la sceglie chi chiama:
 * - riga per riga: ogni prezzo va alla riga di nomi più vicina in verticale (non il contrario: una riga senza prezzo, come il
 *   nome sopra la riga del peso, non deve prendere il prezzo di quella sotto, o si sfasa tutto lo scontrino da lì in poi);
 * - per ordine (`abbinaPerOrdine`): ogni riga ha un solo prezzo, nello stesso ordine, e si abbinano i nomi della colonna di
 *   sinistra ai prezzi della colonna di destra. Se i conti non tornano (nomi e prezzi in numero diverso, uno sconto con un
 *   prezzo positivo) non si abbina niente: meglio niente che sbagliato.
 * I pezzi tengono la loro posizione e la loro fiducia: il prezzo abbinato a un nome è il pezzo letto, non una copia del testo.
 */
import { creaRiga, type LetturaGeometrica, type Pezzo, type Riga, testoRiga } from './scontrini-geometria';
import { CAD, eIntestazione, ePrezzoDiColonna, eSconto, fineRighe, IMPORTO, limitiRighe, nomeDiRiga, numero, PEZZI, pulisciLinea, TESSERA } from './scontrini-righe';

const altezza = (p: { y0: number; y1: number }) => p.y1 - p.y0;
const centroY = (p: { y0: number; y1: number }) => (p.y0 + p.y1) / 2;
const mediana = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;

type Riquadro = { x0: number; y0: number; x1: number; y1: number };
/** Un pezzo nuovo con il testo dato, al posto di `come`: sicuro, o con la fiducia della riga da cui viene (il suo pezzo meno sicuro). */
const sintetico = (testo: string, come: Riquadro | Riga): Pezzo => ({ testo, x0: come.x0, y0: come.y0, x1: come.x1, y1: come.y1, fiducia: 'fiducia' in come ? come.fiducia : 1 });
/** Una riga di un solo pezzo. */
const rigaDi = (testo: string, come: Riquadro | Riga): Riga => creaRiga([sintetico(testo, come)]);
const riquadro = ({ x0, y0, x1, y1 }: Riquadro): Riquadro => ({ x0, y0, x1, y1 });
const testo = (r: Riga, l: LetturaGeometrica) => testoRiga(r, l.carattere);

/**
 * Da dove inizia la colonna dei prezzi: poco prima dei numeri con i decimali, alla destra della pagina (un peso o una
 * quantità nel nome non contano: si ignora il 20% più a sinistra; il margine tiene dentro «PREZZO IVA»).
 */
export function inizioPrezzi(pezzi: { testo: string; x0: number }[], larghezza: number): number {
  const x = pezzi
    .filter((s) => ePrezzoDiColonna(s.testo) && s.x0 > larghezza * 0.4)
    .map((s) => s.x0)
    .sort((a, b) => a - b);
  return x.length < 5 ? larghezza * 0.66 : x[Math.floor(x.length * 0.2)] - larghezza * 0.05;
}

/**
 * Da quale x inizia la colonna dei prezzi nella lettura di Tesseract (le parole con il bordo sinistro): poco a sinistra dei numeri
 * col decimale (si ignora il 20% più a sinistra, che può essere un peso o un pezzo nel nome). Senza abbastanza numeri, un terzo
 * della larghezza dal bordo destro. Più stretta di `inizioPrezzi`: Tesseract non perde la virgola come PaddleOCR.
 */
export function inizioColonnaPrezzi(parole: { testo: string; x0: number }[], larghezza: number): number {
  const x = parole
    .filter((p) => /^-?\d{1,4}\s?[.,:]\s?\d{2}$/.test(p.testo.trim()))
    .map((p) => p.x0)
    .sort((a, b) => a - b);
  if (x.length < 5) return Math.round(larghezza * 0.66);
  return Math.max(0, Math.round(x[Math.floor(x.length * 0.2)] - larghezza * 0.03));
}

/**
 * I pezzi di prezzi divisi per colonna (prezzo unitario, totale di riga…): numeri i cui bordi sinistri distano più di `vuoto`
 * volte la larghezza della pagina stanno in colonne diverse. Ordinate da sinistra a destra.
 */
function colonnePrezzi(prezzi: Pezzo[], larghezza: number, vuoto = 0.08): Pezzo[][] {
  const ordinati = [...prezzi].sort((a, b) => a.x0 - b.x0);
  const colonne: Pezzo[][] = [];
  for (const s of ordinati) {
    const ultima = colonne.at(-1);
    if (ultima && s.x0 - ultima[ultima.length - 1].x0 < larghezza * vuoto) ultima.push(s);
    else colonne.push([s]);
  }
  return colonne;
}

/** Ciò che si ricava dalla geometria di una foto: la pagina riga per riga, la colonna dei prezzi e quella dei nomi. */
export interface Impaginata {
  /** Tutta la pagina: ogni riga di nomi con i pezzi di destra più vicini in verticale. */
  pagina: LetturaGeometrica;
  /** I pezzi della colonna dei prezzi nelle righe dello scontrino (fino al totale), dall'alto in basso. */
  prezzi: Pezzo[];
  /** Le righe della colonna dei nomi (e di tutto quello che non è la colonna dei prezzi). */
  nomi: LetturaGeometrica;
}

/**
 * Divide i pezzi di una foto in nomi e prezzi e li rimette in righe. Più colonne di prezzi (unitario e totale di riga): i
 * prezzi delle righe sono quelli della colonna più a destra, se è piena abbastanza; le altre restano solo accanto ai nomi,
 * nella pagina riga per riga.
 */
export function impagina(lettura: LetturaGeometrica): Impaginata {
  const { larghezza } = lettura;
  const tutti = lettura.righe.flatMap((r) => r.pezzi);
  const x = inizioPrezzi(tutti, larghezza);
  const ordine = [...tutti].sort((a, b) => centroY(a) - centroY(b));
  const corto = (p: Pezzo) => p.testo.replace(/[^A-Za-z0-9]/g, '').length < 4;
  const destra = ordine.filter((s) => s.x0 >= x && (ePrezzoDiColonna(s.testo) || corto(s)));
  const colonne = colonnePrezzi(destra.filter((s) => ePrezzoDiColonna(s.testo)), larghezza);
  const piena = Math.max(0, ...colonne.map((c) => c.length));
  const ultima = [...colonne].reverse().find((c) => c.length >= piena * 0.5);
  const daScartare = new Set(colonne.filter((c) => c !== ultima).flat());
  const prezziColonna = destra.filter((s) => !daScartare.has(s));
  // A sinistra anche i pezzi di destra che non sono prezzi («Ora: 12:47», «PREZZO IVA»): non fanno parte della colonna.
  // (La colonna dell'aliquota IVA in percentuale, tra i nomi e i prezzi — «4%», «10%» — non è un nome: si salta.)
  const eAliquota = (b: Pezzo) => b.x0 > larghezza * 0.45 && /^\d{1,3}\s?%?$|^\d{1,2}\s?[^\dA-Za-z\s]$/.test(b.testo.trim());
  const aSinistra = ordine.filter((b) => !eAliquota(b) && (b.x0 < x || (!ePrezzoDiColonna(b.testo) && !corto(b))));
  // Più pezzi di sinistra sulla stessa riga («IPERAL SUPERMERCATI» e «SPA», la data e l'ora) formano una riga sola. Il centro
  // del primo pezzo di ogni riga: i pezzi dopo si confrontano con quello, non con la riga che cresce.
  const centri: number[] = [];
  const gruppi: Pezzo[][] = [];
  for (const s of aSinistra.sort((a, b) => centroY(a) - centroY(b) || a.x0 - b.x0)) {
    const k = gruppi.length - 1;
    if (k >= 0 && Math.abs(centroY(s) - centri[k]) < altezza(s) * 0.5) gruppi[k].push(s);
    else {
      gruppi.push([s]);
      centri.push(centroY(s));
    }
  }
  // Da sinistra a destra («2   PANE»), senza ripetere lo stesso testo letto due volte da riquadri sovrapposti.
  const sinistra = gruppi.map((g) => creaRiga(g.sort((a, b) => a.x0 - b.x0).filter((b, i, v) => v.findIndex((q) => q.testo === b.testo) === i), false));
  const passo = mediana(sinistra.map(altezza)) * 2.2 || 40;
  // Ogni pezzo di destra va alla riga di sinistra più vicina a lui, e non il contrario.
  const perRiga: Pezzo[][] = sinistra.map(() => []);
  for (const d of destra) {
    let k = -1;
    let vicina = Infinity;
    for (const [i, s] of sinistra.entries()) {
      const distanza = Math.abs(centroY(d) - centroY(s));
      if (distanza < vicina) {
        vicina = distanza;
        k = i;
      }
    }
    if (k >= 0 && vicina < passo * 0.75) perRiga[k].push(d);
  }
  const righe = sinistra.map((s, i) => {
    // Tutti i pezzi di destra su questa riga (colonna dei prezzi, dei totali…), uno per colonna, da sinistra a destra.
    const vicine = perRiga[i].sort((a, b) => Math.abs(centroY(a) - centroY(s)) - Math.abs(centroY(b) - centroY(s)));
    const perColonna: Pezzo[] = [];
    for (const d of vicine) if (!perColonna.some((q) => Math.abs(q.x0 - d.x0) < larghezza * 0.04) || /^[A-Z%]{1,2}$/.test(d.testo)) perColonna.push(d);
    perColonna.sort((a, b) => a.x0 - b.x0);
    return creaRiga([...s.pezzi, ...perColonna], false);
  });
  // Le righe dello scontrino finiscono dove comincia il totale: dopo, i prezzi non sono righe.
  const totale = sinistra[limitiRighe(sinistra.map((r) => pulisciLinea(testoRiga(r, null)))).fine];
  const prezzi = prezziColonna.filter((s) => !totale || centroY(s) < centroY(totale) - altezza(totale) * 0.3);
  const comeFoto = (r: Riga[]): LetturaGeometrica => ({ origine: lettura.origine, larghezza, carattere: null, righe: r });
  return { pagina: comeFoto(righe), prezzi, nomi: comeFoto(sinistra) };
}

/**
 * Le letture possibili di una foto: nomi e prezzi abbinati per ordine (se si può) e la pagina riga per riga. La prima
 * è di solito la migliore; chi chiama le confronta con il conto (`punteggio`).
 */
export function impaginaFoto(lettura: LetturaGeometrica): LetturaGeometrica[] {
  const { pagina, prezzi, nomi } = impagina(lettura);
  const abbinata = abbinaPerOrdine(pagina, prezziDaColonna(prezzi), nomi);
  return abbinata ? [abbinata, pagina] : [pagina];
}

/**
 * I prezzi della colonna, nell'ordine, ripuliti («1,99 B», «-0,44»): i pezzi che non sono un prezzo (rumore) si scartano.
 * Ogni prezzo resta il pezzo letto (posizione e fiducia), con il testo rimesso in ordine.
 */
export function prezziDaColonna(colonna: Pezzo[] | LetturaGeometrica): Pezzo[] {
  const pezzi = Array.isArray(colonna) ? colonna.map((p) => ({ p, t: p.testo })) : colonna.righe.map((r) => ({ p: sintetico('', r), t: testo(r, colonna) }));
  const out: Pezzo[] = [];
  for (const { p, t } of pezzi) {
    const linea = pulisciLinea(t);
    if (!linea) continue;
    const prezzo = (testo: string) => out.push({ ...p, testo });
    const m = linea.match(IMPORTO);
    if (m && !(linea.slice(0, m.index).match(/[A-Z0-9]/g) ?? []).length) {
      prezzo(`${m[1].replace(/\s/g, '').replace(':', ',')}${/^[A-Z]$/.test(m[2] ?? '') ? ` ${m[2]}` : ''}`);
      continue;
    }
    // Lo zero davanti perso («.56», «-.45»).
    const senzaZero = linea.match(/^(-?)[.,](\d{2})\s?([A-Z])?$/);
    if (senzaZero) {
      prezzo(`${senzaZero[1]}0,${senzaZero[2]}${senzaZero[3] ? ` ${senzaZero[3]}` : ''}`);
      continue;
    }
    // Nella colonna dei prezzi la virgola si perde spesso («135 A», «595B», «000C»): tre o più cifre sole sono euro e centesimi.
    const senzaVirgola = linea.match(/^(-?)(\d{1,3})(\d{2})\s?([A-Z])?$/);
    if (senzaVirgola) prezzo(`${senzaVirgola[1]}${senzaVirgola[2]},${senzaVirgola[3]}${senzaVirgola[4] ? ` ${senzaVirgola[4]}` : ''}`);
  }
  return out;
}

/** «3 X1,49», «Cad 0,99 Pz. 3»: quanti pezzi e a quanto l'uno, con la posizione (quanti nomi stanno sopra). */
interface RigaPezzi {
  pos: number;
  n: number;
  unitario: number;
}

interface NomeScelto {
  riga: Riga;
  nome: string;
  qta?: number;
}

/**
 * Le righe di nomi: tutte quelle tra l'intestazione e la fine; senza intestazione, i `quanti` nomi che precedono il totale (si
 * conta all'indietro dal totale, o dal numero di articoli: l'inizio si legge peggio della fine). Prima di loro l'intestazione
 * del negozio. Null se non ce ne sono abbastanza.
 */
function prendiNomi(nomi: LetturaGeometrica, quanti: number, taglia: boolean): { testa: Riga[]; scelti: NomeScelto[]; pezzi: RigaPezzi[] } | null {
  const righe = nomi.righe.filter((r) => testo(r, nomi).trim());
  const grezze = righe.map((r) => testo(r, nomi));
  const linee = grezze.map(pulisciLinea);
  const { intestazione, fine: trovata } = limitiRighe(linee);
  const fine = trovata < 0 ? linee.length : trovata;
  /** Una riga che è solo l'intestazione («DESCRIZIONE», «PREZZO IVA»): se accanto c'è un nome («CARTAMICA   PREZZO IVA») è una riga. */
  const soloIntestazione = (linea: string) => eIntestazione(linea) && (linea.replace(/\bPREZ\w*\b.*$/, '').replace(/\b\w*DESCR\w*\b/, '').match(/[A-Z]/g) ?? []).length < 3;
  const scelte: (NomeScelto & { i: number })[] = [];
  for (let i = fine - 1; i > intestazione && (intestazione >= 0 || scelte.length < quanti); i--) {
    const r = soloIntestazione(linee[i]) ? null : nomeDiRiga(grezze[i], taglia);
    if (r) scelte.unshift({ i, riga: righe[i], ...r });
  }
  if (!scelte.length || (intestazione < 0 && scelte.length < quanti)) return null;
  // Le righe dei pezzi («3 X1,49») non sono nomi ma dicono quanti pezzi ha la riga vicina: si ricordano con la loro posizione.
  const pezzi: RigaPezzi[] = [];
  for (let i = Math.max(0, intestazione + 1); i < fine; i++) {
    const m = linee[i].match(PEZZI);
    const c = linee[i].match(CAD);
    if (m) pezzi.push({ pos: scelte.filter((x) => x.i < i).length, n: Number(m[1]), unitario: numero(m[2]) });
    else if (c) pezzi.push({ pos: scelte.filter((x) => x.i < i).length, n: Number(c[2]), unitario: numero(c[1]) });
  }
  // Prima dei nomi: l'intestazione del negozio (senza la riga «DESCRIZIONE»: la rimettiamo noi, una sola).
  const testa = righe.slice(0, scelte[0].i).flatMap((r, i) => (eIntestazione(linee[i]) ? [] : [rigaDi(linee[i], r)]));
  const primo = scelte[0].riga;
  return { testa: [...testa, rigaDi('DESCRIZIONE', { ...riquadro(primo), y1: primo.y0 })], scelti: scelte, pezzi };
}

/** Toglie fino a `extra` righe di tessera tra le prime sei: se non bastano, resta com'era (non si sa quale nome manca). */
function senzaTessera<T extends { scelti: NomeScelto[]; pezzi: RigaPezzi[] }>(letti: T, extra: number): T {
  const via = new Set<number>();
  for (const [i, n] of letti.scelti.slice(0, 6).entries()) if (via.size < extra && TESSERA.test(n.nome)) via.add(i);
  if (via.size < extra) return letti;
  // Le righe tolte stavano tra i primi nomi: i pezzi più in basso restano sul loro nome (la posizione scende di quante ne sono state tolte sopra).
  const sopra = (pos: number) => [...via].filter((i) => i < pos).length;
  return { ...letti, scelti: letti.scelti.filter((_, i) => !via.has(i)), pezzi: letti.pezzi.map((p) => ({ ...p, pos: p.pos - sopra(p.pos) })) };
}

/**
 * Le righe con i nomi (da `nomiDa`, di solito la colonna di sinistra; se manca, dalla pagina) e i prezzi della colonna di destra,
 * abbinati per ordine; dopo, il resto della pagina (totale, IVA, pagamento). Null se nomi e prezzi non si abbinano (meno nomi che
 * prezzi, o uno sconto con un prezzo positivo). Le righe sono tante quanti sono i prezzi; sul totale si mette un segno, perché
 * letto male non sia scambiato per una riga.
 */
export function abbinaPerOrdine(pagina: LetturaGeometrica, prezzi: Pezzo[], nomiDa = pagina): LetturaGeometrica | null {
  if (!prezzi.length) return null;
  let letti = prendiNomi(nomiDa, prezzi.length, nomiDa === pagina);
  // Più nomi che prezzi: ne manca uno, non si sa quale. Ma le righe della tessera fedeltà all'inizio («BENNET CLUB», «CARTA NUM.
  // 0420***») non hanno prezzo e non sono prodotti: si tolgono, e se poi i conti tornano si abbina. Più prezzi che nomi: i prezzi
  // di troppo in fondo sono quelli del totale, dell'IVA e del pagamento, e si tolgono.
  if (letti && letti.scelti.length > prezzi.length) letti = senzaTessera(letti, letti.scelti.length - prezzi.length);
  if (!letti || letti.scelti.length > prezzi.length) return null;
  const { scelti } = letti;
  // Uno sconto è negativo: se al prezzo è caduto il segno meno, lo si rimette (il nome dice che è uno sconto).
  // Il contrario non vale: un prezzo negativo può essere uno sconto che non si chiama così («Too Good To Go»).
  const conSegno = prezzi.slice(0, scelti.length).map((p, i) => (eSconto(scelti[i].nome) && !p.testo.startsWith('-') ? { ...p, testo: `-${p.testo}` } : p));
  if (scelti.some((n, i) => eSconto(n.nome) && !conSegno[i].testo.startsWith('-'))) return null;
  const totaleDi = (p: Pezzo) => Math.abs(numero(p.testo.replace(/\s?[A-Z]$/, '')));
  // I pezzi di una riga stanno a volte su una riga a parte («3 X1,49»): vanno al nome sopra o sotto il cui prezzo vale pezzi × unitario.
  const qta = scelti.map((s) => s.qta);
  for (const p of letti.pezzi) {
    for (const j of [p.pos - 1, p.pos]) {
      if (j < 0 || j >= scelti.length || qta[j] !== undefined) continue;
      if (Math.abs(p.n * p.unitario - totaleDi(conSegno[j])) < 0.011) {
        qta[j] = p.n;
        break;
      }
    }
  }
  const linee = pagina.righe.map((r) => ({ r, l: pulisciLinea(testo(r, pagina)) })).filter((x) => x.l);
  // Dopo le righe (il totale, dopo un'intestazione) il resto della pagina: totale, IVA, pagamento, data.
  const limiti = limitiRighe(linee.map((x) => x.l));
  const resto = limiti.intestazione >= 0 && limiti.fine >= 0 ? linee.slice(limiti.fine) : [];
  const righe = scelti.flatMap((s, i) => {
    const nome = sintetico(s.nome, s.riga);
    // Colonna delle quantità («2   PANE   0,49   0,98»): il prezzo è quello di riga; il pezzo costa totale ÷ quantità.
    const q = qta[i];
    const tot = totaleDi(conSegno[i]);
    const unitario = q && q > 1 ? Math.round((tot / q) * 100) / 100 : null;
    if (unitario !== null && Math.abs(unitario * q! - tot) < 0.011) return [creaRiga([nome]), creaRiga([sintetico(`${q} x ${unitario.toFixed(2).replace('.', ',')}`, s.riga), conSegno[i]], false)];
    return [creaRiga([nome, conSegno[i]], false)];
  });
  const segnoTotale = resto.length && !fineRighe(resto[0].l) ? [rigaDi('TOTALE', riquadro(resto[0].r))] : [];
  return { origine: pagina.origine, larghezza: pagina.larghezza, carattere: null, righe: [...letti.testa, ...righe, ...segnoTotale, ...resto.map((x) => rigaDi(x.l, x.r))] };
}
