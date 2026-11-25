/**
 * Le righe di uno scontrino: come si riconosce una linea (importo, fine delle righe, intestazione, sconto, pezzi e peso),
 * come si ripuliscono gli errori tipici della lettura nei numeri, il formato scritto nella descrizione («500G», «2X125G»)
 * e la lettura delle righe vere e proprie con il totale che le chiude (`leggiRighe`).
 */
import type { RigaLetta } from './scontrini-tipi';
import type { UnitaBase } from './unita';

/** Il prezzo in fondo alla riga, con quello che può seguirlo: «€», la lettera o la percentuale dell'IVA, un segno sporco. */
export const IMPORTO = /(-?\s?\d{1,4}\s?[.,:]\s?\d{2})(?![\d%])\s*(?:€|EUR|EURO)?\s*(?:([^\s\d]{1,2})|\d{1,2}\s?%)?\s*$/;
export const FINE_RIGHE = /\b(SUB\s?TOTALE|TOTALE|TOTAL)\b|^SUBTOT/;

/** Le due parole differiscono al più di una lettera (sostituita, in più o in meno). */
function quasiUguali(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i);
}

/** «TOTALE» anche letto male («TOTALF», «T0TALE», «TOTAIE»). */
const eTotale = (linea: string) => /^T?OTALE(COMPLESS|\b|$)/.test(linea.replace(/[^A-Z]/g, '')) || /^[A-Z]?[A-Z]?TALE?COMPLESSIV|^[A-Z]{0,3}COMPLESSIV/.test(linea.replace(/[^A-Z]/g, '')) || linea.split(/[^A-Z0-9]+/).some((p) => p === 'TOTALE' || (p.length >= 5 && quasiUguali(p, 'TOTALE')) || (p.length >= 8 && p.length <= 11 && /TOTALE$/.test(p)));
/** «SUBTOTALE» letto male («SLBTOTALE»): chiude le righe ma non è il totale. */
const eSubtotaleGuasto = (linea: string) => linea.split(/[^A-Z0-9]+/).some((p) => p.length >= 8 && p.length <= 11 && /TOTALE$/.test(p) && p !== 'SUBTOTALE');
export const fineRighe = (linea: string) => FINE_RIGHE.test(linea) || eTotale(linea);
export const DA_SALTARE =
  /\b(IVA|CONTANTE|CONTANTI|RESTO|PAGAMENTO|PAGATO|BANCOMAT|ELETTRONICO|RESO|ARROTONDAMENTO|IMPORTO|NUMERO|DOCUMENTO|SCONTRINO|BUONO|BUONI|PUNTI|SALDO|CASSA|CASSIERE|OPERATORE|TEL|TESSERA|ARTICOLI|VISA|MASTERCARD|MAESTRO|P\.?\s?IVA|C\.?F\.?|VALIDA|VALIDO|VALIDE|CAMSCANNER|SCANSIONATO)\b|CARTA (DI )?(CREDITO|DEBITO)/;
export const SCONTO = /\b(SCONTO|SC\.|SCONT|PROMO|OFFERTA|RIBASSO|RIDUZIONE|STORNO|COUPON)\b|TOO\s?GOO?D|TO\s?GO\b/;
const SCONTO_IN_TESTA = /^[^A-Z0-9]*(?:\d{1,3}\s?%\s*)?(?:SCONTO|SC\.|SCONT|PROMO|OFFERTA|RIBASSO|RIDUZIONE|STORNO|COUPON)\b|TOO\s?GOO?D|TO\s?GO\b/;
/** Righe senza prezzo che non sono un prodotto, lette senza spazi e con gli zeri come O. */
const NON_PRODOTTO = /^CARTA(NUM|$)|CLUB$|AGGIUNTIV|ESPLOSION|VALID[AEIO]|SCADEN|TESSERA|SALDOPUNTI|PUNTIFEDELT|CAMSCANNER|SCANSIONATO|TOOGOOD|TOGO|^(SCONTO|OFFERT|COUPON)/;
export const INTESTAZIONE_RIGHE = /\bDESCRIZIONE\b|\bPREZZO\s*\(?€?\)?\s*$/;

/** Quante lettere diverse (sostituite, in più o in meno) ci sono tra due parole. */
function distanza(a: string, b: string): number {
  let prec = Array.from({ length: b.length + 1 }, (_, k) => k);
  for (let x = 1; x <= a.length; x++) {
    const riga = [x];
    for (let y = 1; y <= b.length; y++) riga[y] = Math.min(prec[y] + 1, riga[y - 1] + 1, prec[y - 1] + (a[x - 1] === b[y - 1] ? 0 : 1));
    prec = riga;
  }
  return prec[b.length];
}

/** L'intestazione delle righe, anche letta male («DESCRIZTONE»). */
export const eIntestazione = (linea: string) => {
  if (INTESTAZIONE_RIGHE.test(linea)) return true;
  const parole = linea.split(/[^A-Z]+/);
  if (parole.some((p) => p.length >= 9 && p.length <= 12 && distanza(p, 'DESCRIZIONE') <= 2)) return true;
  // «PREZZO IVA» letto «PREZZD TVA»: la parola e, accanto, l'IVA o il totale.
  return parole.some((p) => p.length >= 5 && p.length <= 7 && distanza(p, 'PREZZO') <= 1) && parole.some((p) => /^[IT1L]VA$/.test(p) || p === 'TOTALE' || p === 'EUR');
};


/** Dove finiscono le righe: il totale (anche letto male) o il numero di articoli che lo precede. */
export const eFineRighe = (linea: string) => fineRighe(linea) || /\bARTICOLI\b|COMPLESSIV/.test(linea);

/**
 * Dove stanno le righe dei prodotti tra le linee (già ripulite): l'intestazione («DESCRIZIONE», -1 se non c'è) e la prima fine
 * delle righe dopo di lei (`eFineRighe`, -1 se non c'è). «QTA DESCRIZIONE PREZZO TOTALE» contiene la parola «totale»: per
 * questo la fine si cerca dopo l'intestazione.
 */
export function limitiRighe(linee: string[]): { intestazione: number; fine: number } {
  const intestazione = linee.findIndex(eIntestazione);
  return { intestazione, fine: linee.findIndex((l, i) => i > intestazione && eFineRighe(l)) };
}
/** «2 x 0,99» (la lettura sbaglia la x: «xXx», «×», «*»). */
export const PEZZI = /^(\d{1,3})\s*(?:PZ|N\.?)?\s*[X*×]{1,3}\s*(\d{1,4}[.,]\d{2})\b/;
/** «Cad 0,99 Pz. 3»: tre pezzi a 0,99 l'uno. */
export const CAD = /^CAD\.?\s*(\d{1,4}[.,]\d{2})\s*PZ\.?\s*(\d{1,3})\b/;
/** «0,856 kg x 1,99 €/kg» oppure, alla Iper, «0,386 * 4,90Kg»: peso, poi prezzo al chilo. */
const PESO = /(\d{1,3}[.,]\d{1,3})\s*KG\s*[X*×]\s*(\d{1,4}[.,]\d{2})|^(\d{1,3}[.,]\d{3})\s*[X*×]\s*(\d{1,4}[.,]\d{2})\s*(?:€\s*\/?\s*)?[^\s\d]{0,4}/;

/**
 * Corregge gli errori tipici della lettura nei numeri: la O al posto dello zero («1,2O»), spazi attorno
 * alla virgola («1 ,29»), i due punti al posto della virgola nei prezzi («3:01 A»).
 */
export function pulisciLinea(linea: string): string {
  return linea
    // La lettura prende il segno per (*) per un carattere cinese («0,218 大 29,91Kg»): per i prezzi è sempre un'asterisco.
    .replace(/[\u3400-\u9FFF]/g, '*')
    .toUpperCase()
    .replace(/€/g, ' ')
    .replace(/\s+/g, ' ')
    // Il prezzo letto con una barra o un apice al posto della virgola («1/35 A»), o con la barra letta 7 prima della lettera dell'IVA («1720 A»).
    .replace(/(\s\d{1,3})[/'’`´](\d{2})(?=\s?[A-Z]?$)/, '$1,$2')
    .replace(/(\s\d)7(\d{2})(?=\s[ABC]$)/, '$1,$2')
    // Il prezzo senza la virgola, attaccato alla lettera dell'IVA («366C» per «3,66 C»): se dopo c'è solo quella lettera, in fondo alla riga.
    .replace(/(\s)(\d{1,3})(\d{2})\s?([A-D])$/, '$1$2,$3 $4')
    // Dopo il prezzo, una cifra sola al posto della lettera dell'IVA («0,20 0» per «0,20 D»).
    .replace(/(^|\s)(-?\d{1,4}[.,]\d{2}) [0468]$/, '$1$2')
    // La lettera dell'IVA attaccata al prezzo e letta come cifra («0,994» per «0,99 A», «4,990» per «4,99 C»).
    // Lo 0 solo se il numero è almeno 1: «0,850» è un peso, non un prezzo.
    .replace(/(^|\s)(\d{1,4}[.,]\d{2})(\d)$/, (x, prima: string, prezzo: string, cifra: string) => ('468'.includes(cifra) || (cifra === '0' && !/^0/.test(prezzo)) ? `${prima}${prezzo}` : x))
    .replace(/(^|[\s*X])([\dO]{1,4}) ?([.,]) ?([\dO]{2})(?=$|[\s%A-Z])/g, (_, a: string, i: string, sep: string, d: string) =>
      /\d/.test(i + d) ? `${a}${i.replace(/O/g, '0')}${sep}${d.replace(/O/g, '0')}` : `${a}${i}${sep}${d}`,
    )
    .replace(/(\s)(\d{1,4}):(\d{2})(\s?[A-Z]{0,2})$/, (x, s: string, i: string, d: string, coda: string) => (Number(d) < 60 && Number(i) < 24 && !coda.trim() ? x : `${s}${i},${d}${coda}`))
    .trim();
}

export const numero = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));
export const centesimi = (n: number) => Math.round(n * 100) / 100;

/** Misura in unità base da un numero, un'unità e un moltiplicatore («2X125G» → 250 g). Null se non è una misura credibile. */
function misura(valore: string, unita: string, confezioni = 1): RigaLetta['formato'] {
  const n = numero(valore);
  const U = unita.toUpperCase();
  // Un «G 2» è un pezzo di scritta tagliato, non due grammi: sotto questi valori non è una confezione.
  const minimo = U === 'G' || U === 'GR' || U === 'ML' || U === 'CL' ? 10 : 0;
  const massimo = U === 'KG' ? 50 : U === 'L' || U === 'LT' ? 20 : 5000;
  if (!(n > 0) || n < minimo || n > massimo) return undefined;
  const [fattore, base]: [number, UnitaBase] = U === 'KG' ? [1000, 'g'] : U === 'G' || U === 'GR' ? [1, 'g'] : U === 'L' || U === 'LT' ? [1000, 'ml'] : U === 'CL' ? [10, 'ml'] : [1, 'ml'];
  const quantita = Math.round(n * fattore * confezioni * 1000) / 1000;
  return quantita > 0 ? { quantita, unita: base } : undefined;
}

const UNITA = 'KG|GR|G|LT|L|ML|CL';
/** La lettura scrive la O al posto dello zero nei numeri di un formato («5OOG», «BAULETTO4OOG»). */
const conZeri = (d: string) =>
  d
    .replace(new RegExp(`(\\d[\\dO]{0,3})(?=\\s?(?:${UNITA})\\b)`, 'g'), (x) => x.replace(/O/g, '0'))
    // Con l'unità prima del numero («G 2OO», «G4CO»): la O e la C dentro un numero sono zeri.
    .replace(new RegExp(`(?<=\\b(?:${UNITA})\\.?\\s?)(\\d[\\dOC]{1,3})\\b`, 'g'), (x) => x.replace(/[OC]/g, '0'));

/**
 * Il formato della confezione scritto nella descrizione, in unità base: «500G», «1,5L», «2X125G», «250GX2» (due da 250 g),
 * ma anche con l'unità prima del numero («LT.1», «GR 290», «G400», «CL66») e «UOVA X6» (pezzi).
 */
export function formatoDaDescrizione(descrizione: string): RigaLetta['formato'] {
  const d = conZeri(descrizione.toUpperCase());
  const dopo = d.match(new RegExp(`(\\d{1,4}(?:[.,]\\d{1,3})?)\\s*(${UNITA})\\s*X\\s*(\\d{1,2})\\b`));
  if (dopo) return misura(dopo[1], dopo[2], Number(dopo[3]));
  const m = d.match(new RegExp(`(?:(\\d{1,2})\\s*X\\s*)?(\\d{1,4}(?:[.,]\\d{1,3})?)\\s*(${UNITA})\\b`));
  if (m) return misura(m[2], m[3], m[1] ? Number(m[1]) : 1);
  // «LT.1» anche attaccato al nome («GRANAROLOLT.1»): con il punto l'unità non è parte di una parola.
  const prima = d.match(new RegExp(`(?:\\b(${UNITA})\\.?\\s?|(LT|GR|KG|ML|CL)\\.\\s?)(\\d{1,4}(?:[.,]\\d{1,3})?)\\b(?!\\s?[A-Z%])`));
  const daUnita = prima ? misura(prima[3], prima[1] ?? prima[2]) : undefined;
  if (daUnita) return daUnita;
  // «UOVA X6», «6 PZ»: una confezione di pezzi.
  const pz = d.match(/(?:\bX\s?(\d{1,2})\b|\b(\d{1,2})\s?PZ\b)/);
  return pz ? { quantita: Number(pz[1] ?? pz[2]), unita: 'pz' } : undefined;
}

/** La lettera dell'IVA dopo il prezzo (una sola lettera maiuscola). */
const letteraIva = (importo: RegExpMatchArray): { iva?: string } => (/^[A-Z]$/.test(importo[2] ?? '') ? { iva: importo[2] } : {});


/** Ciò che si legge dalle linee di uno scontrino: le righe e gli importi che servono a controllare che il conto torni. */
export interface RigheLette {
  righe: RigaLetta[];
  /** Il totale letto dopo le righe, o `null`. */
  totale: number | null;
  /** L'importo della riga del pagamento con carta («Isp Masterca 60,07»): vale il totale se il totale è letto male. */
  pagato: number | null;
  /** Gli altri importi che dovrebbero valere quanto il totale (subtotale, pagato): servono se il totale è letto male. */
  altriTotali: number[];
  /** La legenda in fondo («A: IVA 4,00%»). */
  aliquote: Record<string, number>;
  /** L'IVA totale («DI CUI IVA»). */
  ivaTotale: number | null;
}

/** «2 PANE 0,49 0,98»: quantità, nome, prezzo unitario e totale di riga (colonne QTA, PREZZO, TOTALE); i due prezzi anche attaccati. */
const COLONNE_QTA = /^(\d{1,3})\s+(\D.*?)\s+(\d{1,4}[.,]\d{2})\s*(\d{1,4}[.,]\d{2})\s*([A-Z])?$/;
/** Una linea con i soli due prezzi (unitario e totale), anche attaccati. */
const SOLO_DUE_PREZZI = /^\d{1,4}[.,]\d{2}\s*\d{1,4}[.,]\d{2}\s*[A-Z]?$/;
/** Le colonne QTA, PREZZO, TOTALE se il conto torna (quantità × unitario = totale), altrimenti null: due numeri qualsiasi non si dividono. */
function leggiColonne(linea: string): RegExpMatchArray | null {
  const m = linea.match(COLONNE_QTA);
  return m && !/^[X*×\s]+$/.test(m[2]) && Math.abs(Number(m[1]) * numero(m[3]) - numero(m[4])) < 0.011 ? m : null;
}

/**
 * Legge le righe (già ripulite con `pulisciLinea`) con il totale che le chiude. Non inventa: quello che non trova resta fuori.
 * `fiducie` (una per linea, se il lettore la dà): ogni riga letta prende la fiducia più bassa tra le linee da cui viene (il nome,
 * il prezzo, lo sconto sotto).
 */
export function leggiRighe(linee: string[], fiducie?: number[]): RigheLette {
  const inizio = limitiRighe(linee).intestazione;
  const righe: RigaLetta[] = [];
  let totale: number | null = null;
  let inRighe = true;
  let descrizioneSospesa: string | null = null;
  let fiduciaSospesa = 1;
  /** La fiducia della linea che si sta leggendo. */
  let fiduciaLinea = 1;
  let pezziSospesi: number | null = null;
  /** Gli altri importi che dovrebbero valere quanto il totale (subtotale, pagato): servono se il totale è letto male. */
  const altriTotali: number[] = [];
  /** La legenda in fondo («A: IVA 4,00%») e l'IVA totale («DI CUI IVA»): servono a controllare i prezzi letti male. */
  const aliquote: Record<string, number> = {};
  let ivaTotale: number | null = null;
  /** L'importo della riga del pagamento con carta («Isp Masterca 60,07»): vale il totale se il totale è letto male. */
  let pagato: number | null = null;

  /** Una descrizione rimasta senza prezzo (la lettura l'ha rovinato): la riga resta, vuota, da completare. */
  const chiudiSospesa = () => {
    // Senza intestazione («DESCRIZIONE») il testo prima del primo prezzo è l'intestazione del negozio, non una riga.
    if (descrizioneSospesa && (inizio >= 0 || righe.length > 0)) {
      // Del prezzo rovinato resta spesso un residuo in coda («5’ SOB», «IP: |»): via le parti finali corte o con segni strani.
      const parole = descrizioneSospesa.split(' ');
      while (parole.length > 1 && (parole.at(-1)!.replace(/[^A-Z0-9]/g, '').length <= 2 || /[^A-Z0-9.)]/.test(parole.at(-1)!)) && parole.slice(0, -1).some((x) => x.replace(/[^A-Z0-9]/g, '').length >= 4)) parole.pop();
      righe.push({ descrizione: parole.join(' ').replace(/[^A-Z0-9.)]+$/, '').slice(0, 120), prezzo: 0, senzaPrezzo: true, ...(fiducie ? { fiducia: fiduciaSospesa } : {}) });
    }
    descrizioneSospesa = null;
  };

  const aggiungi = (descrizione: string, prezzo: number, extra: Partial<RigaLetta> = {}) => {
    const riga: RigaLetta = { descrizione: descrizione.slice(0, 120), prezzo, ...extra };
    if (fiducie) riga.fiducia = Math.min(fiduciaLinea, descrizione === descrizioneSospesa ? fiduciaSospesa : 1);
    if (pezziSospesi && riga.pezzi === undefined) riga.pezzi = pezziSospesi;
    pezziSospesi = null;
    descrizioneSospesa = null;
    // «4 PASTA DI SEMOLA 500G»: il numero in testa è la quantità (colonna QTA letta attaccata al nome), non parte del nome.
    const qta = riga.descrizione.match(/^(\d{1,2})\s+([A-Z].*)$/);
    if (qta && riga.pezzi === undefined && Number(qta[1]) > 0 && (qta[2].match(/[A-Z]/g) ?? []).length >= 4) {
      riga.pezzi = Number(qta[1]);
      riga.descrizione = qta[2];
    }
    const formato = formatoDaDescrizione(riga.descrizione);
    if (formato) riga.formato = formato;
    righe.push(riga);
  };

  for (const [i, linea] of linee.entries()) {
    if (inizio >= 0 && i <= inizio) continue;
    fiduciaLinea = fiducie?.[i] ?? 1;
    if (fineRighe(linea) || (!inRighe && /\b(PAGAMENTO|PAGATO|ELETTRONICO)\b/.test(linea))) {
      if (inRighe) chiudiSospesa();
      inRighe = false;
      const importo = linea.match(IMPORTO);
      if (importo && !/\bIVA\b|RESTO|CONTANT/.test(linea)) altriTotali.push(numero(importo[1]));
      if (totale === null && eTotale(linea) && !/SUB\s?TOT/.test(linea) && !eSubtotaleGuasto(linea) && !/\bIVA\b/.test(linea)) {
        const m = linea.match(IMPORTO);
        if (m) totale = numero(m[1]);
      }
      continue;
    }
    if (!inRighe) {
      const legenda = linea.match(/\b([A-Z])\s*[:.;]?\s*IVA\s*(\d{1,2})(?:[.,]\d+)?\s*%/);
      if (legenda) aliquote[legenda[1]] = Number(legenda[2]) / 100;
      const diCui = /\bDI CUI\b/.test(linea) ? linea.match(IMPORTO) : null;
      if (diCui && ivaTotale === null) ivaTotale = numero(diCui[1]);
      const importoPagato = linea.match(IMPORTO);
      if (importoPagato && pagato === null && !legenda && !/\bIVA\b|\bDI CUI\b|RESTO|CONTANT|ARROTOND|\bDOC/.test(linea) && (linea.slice(0, importoPagato.index).match(/[A-Z]/g) ?? []).length >= 3) pagato = numero(importoPagato[1]);
    }
    if (!inRighe || DA_SALTARE.test(linea)) continue;
    // «2 PANE 0,49 0,98»: quantità, prezzo unitario e totale di riga (colonne QTA, PREZZO, TOTALE).
    // I due prezzi possono essere attaccati («0,490,98»: la foto storta li legge in un solo pezzo) e stare sulla linea sotto il nome
    // («4 PASTA DI SEMOLA» e poi «0,190,76»): si dividono solo se quantità × unitario fa il totale.
    let colonne = leggiColonne(linea);
    const daSopra = !colonne && descrizioneSospesa !== null && SOLO_DUE_PREZZI.test(linea);
    if (daSopra) colonne = leggiColonne(`${descrizioneSospesa} ${linea}`);
    if (colonne) {
      const fiduciaSopra = fiduciaSospesa;
      aggiungi(colonne[2], numero(colonne[4]), { pezzi: Number(colonne[1]), ...(colonne[5] ? { iva: colonne[5] } : {}) });
      const riga = righe.at(-1)!;
      if (daSopra && riga.fiducia !== undefined) riga.fiducia = Math.min(riga.fiducia, fiduciaSopra);
      continue;
    }
    // «Cad 0,99 Pz. 3»: tre pezzi a 0,99 sulla riga di sopra (o su quella che segue, se il prezzo non è ancora uscito).
    const cad = linea.match(CAD);
    if (cad) {
      const n = Number(cad[2]);
      const sopra = righe.at(-1);
      if (sopra && sopra.pezzi === undefined && Math.abs(sopra.prezzo - n * numero(cad[1])) < 0.011) sopra.pezzi = n;
      else pezziSospesi = n;
      continue;
    }
    const peso = linea.match(PESO);
    const pezzi = peso ? null : linea.match(PEZZI);
    let importo = linea.match(IMPORTO);
    // Il prezzo al chilo o al pezzo non è il prezzo della riga: deve venire dopo.
    const fineMisura = (peso ?? pezzi) ? (peso ?? pezzi)!.index! + (peso ?? pezzi)![0].length : 0;
    if (importo && importo.index! < fineMisura - 1) importo = null;

    if (pezzi) {
      const n = Number(pezzi[1]);
      const precedente = righe.at(-1);
      if (importo && descrizioneSospesa) {
        // «YOGURT» poi «2 x 0,99   1,98»: descrizione sopra, pezzi e prezzo sotto.
        aggiungi(descrizioneSospesa, numero(importo[1]), { pezzi: n, ...letteraIva(importo) });
        continue;
      }
      // «YOGURT 1,98» poi «2 x 0,99»: i pezzi vanno alla riga sopra; altrimenti a quella sotto.
      if (precedente && precedente.pezzi === undefined && Math.abs(precedente.prezzo - n * numero(pezzi[2])) < 0.011) precedente.pezzi = n;
      else pezziSospesi = n;
      continue;
    }
    if (!importo) {
      // Una descrizione senza prezzo: il prezzo è sulla linea sotto (peso o solo importo). Non lo è una riga di validità,
      // di tessera o di punti, anche con gli spazi persi e gli zeri letti O («SALD0PUNTI1250»).
      if (!peso && (linea.match(/[A-Z]/g) ?? []).length >= 3 && !NON_PRODOTTO.test(linea.replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O'))) {
        chiudiSospesa();
        descrizioneSospesa = linea;
        fiduciaSospesa = fiduciaLinea;
      }
      continue;
    }
    const valore = numero(importo[1]);
    let descrizione = linea
      .slice(0, importo.index)
      .replace(PESO, '')
      .replace(/\b\d{1,2}([.,]\d{1,2})?\s?%/g, '')
      .replace(/€\s*\/\s*KG|\/KG/g, '')
      .replace(/^[^A-Z0-9]+|[^A-Z0-9.)]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Il riepilogo «***TOO GOOD TO GO 3.» a 0,00 dopo l'ultima riga, anche letto male («1OO GOCOTOGO3»): non è un prodotto. Solo a 0,00:
    // una riga vera può costare zero («CARTAMICA 0,00»).
    if (valore === 0 && /TOGO/.test(descrizione.replace(/[^A-Z]/g, ''))) continue;
    // Uno sconto ha il prezzo negativo, o comincia con la parola («SCONTO FEDELTA»): «PROMO» o «OFFERTA» in mezzo al nome di un prodotto no.
    if (valore < 0 || (SCONTO.test(linea) && SCONTO_IN_TESTA.test(linea))) {
      const precedente = righe.at(-1);
      if (precedente) {
        precedente.prezzo = centesimi(Math.max(0, precedente.prezzo - Math.abs(valore)));
        precedente.sconto = centesimi((precedente.sconto ?? 0) + Math.abs(valore));
        if (precedente.fiducia !== undefined) precedente.fiducia = Math.min(precedente.fiducia, fiduciaLinea);
      }
      continue;
    }
    if ((descrizione.match(/[A-Z]/g) ?? []).length < 2) {
      if (!descrizioneSospesa) continue;
      descrizione = descrizioneSospesa;
    } else if (peso && descrizioneSospesa) {
      descrizione = descrizioneSospesa;
    } else {
      // La riga di sopra aveva il nome ma non il prezzo: questa è un'altra riga.
      chiudiSospesa();
    }
    const grammi = peso ? Math.round(numero(peso[1] ?? peso[3]) * 1000) : 0;
    aggiungi(descrizione, valore, { ...(grammi > 0 ? { grammi } : {}), ...letteraIva(importo) });
  }

  chiudiSospesa();
  // Senza totale (scontrino ritagliato) le righe di testo in fondo senza prezzo sono piè di pagina o filigrane, non prodotti.
  if (totale === null && pagato === null) while (righe.length && righe.at(-1)!.senzaPrezzo) righe.pop();
  // Un testo in cui nessuna riga ha un prezzo non è uno scontrino: niente righe inventate.
  if (righe.every((r) => r.senzaPrezzo)) righe.length = 0;
  return { righe, totale, pagato, altriTotali, aliquote, ivaTotale };
}

/**
 * Un pezzo che è solo un prezzo, come sta nella colonna dei prezzi di una foto: anche senza la virgola («135A»: si perde spesso)
 * o con la lettera dell'IVA letta come cifra («0,20 0»).
 */
export const ePrezzoDiColonna = (t: string) => /^-?\s?(\d{0,4}\s?[.,:]\s?\d{2}|\d{3,5})(\s?[A-Z0-9])?$/.test(t.trim().toUpperCase());

/**
 * Una riga di sconto riconosciuta dal solo nome (letto da una colonna, senza il prezzo): più larga di `SCONTO`, perché qui il
 * nome è da solo sulla riga («OFFERT», «SCONT0» con lo zero, «-30%», «... PLUS» della tessera).
 */
export const eSconto = (nome: string) => /\b(SCONTO|SC\.|PROMO|OFFERTA|RIBASSO|RIDUZIONE|STORNO|COUPON)\b|OFFERT|SCONT[O0]|TOO\s?GOO?D|TO\s?GO$|P[IL]US$|^\d{2,3}\s?%/.test(nome);

/** Le righe della tessera fedeltà e simili, che stanno prima dei prodotti e non hanno prezzo. */
export const TESSERA = /(CARTA\s?NUM\w*|CLUB\b|\bTESSERA|\bFEDELT\w*|\bCARD\b)/;

/**
 * Il nome di una riga dello scontrino (anche senza prezzo, anche con l'intestazione «PREZZO IVA» accanto), o null se la riga
 * non è un prodotto: dettaglio della riga sopra (pezzi, peso, «Cad»), totale, pagamento, IVA. `taglia`: il testo è la pagina
 * intera, con i prezzi accanto ai nomi, spesso rovinati: si taglia dove inizia lo spazio largo che li separa. Altrimenti (colonna
 * dei nomi) si tolgono solo un prezzo o un'aliquota in coda («4%»). Una quantità prima del nome («2   PANE», colonna «QTA»)
 * viene data a parte.
 */
export function nomeDiRiga(riga: string, taglia: boolean): { nome: string; qta?: number } | null {
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
