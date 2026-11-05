/**
 * Scontrini: lettura del testo (dalla foto, sul telefono, o incollato), abbinamento alle righe già
 * confermate dal carrello e proposta dell'ingrediente. Tutto è una proposta: una persona rivede
 * ogni riga prima di importare, e il database riconosce lo stesso scontrino importato due volte.
 *
 * Il formato è quello del «documento commerciale» italiano: intestazione del negozio, righe con
 * descrizione, aliquota IVA e prezzo, eventuali sconti sotto la riga, poi totale, pagamento, data e ora.
 * La lettura dalla foto sbaglia: qui si accettano virgole o punti, simboli dell'euro, lettere dell'IVA
 * dopo il prezzo e righe spezzate su due linee.
 */
import { type Indice, type Ingrediente, normalizza } from './ricette';
import type { UnitaBase } from './unita';

export interface RigaLetta {
  descrizione: string;
  /** Prezzo pagato per la riga, sconti già tolti. */
  prezzo: number;
  /** «2 x 0,99»: quanti pezzi. */
  pezzi?: number;
  /** «0,856 kg x 1,99 €/kg»: il peso in grammi. */
  grammi?: number;
  /** Il formato scritto nella descrizione: «1L» → 1000 ml, «2X125G» → 250 g. */
  formato?: { quantita: number; unita: UnitaBase };
}

export interface ScontrinoLetto {
  negozio: string | null;
  data: string | null;
  ora: string | null;
  totale: number | null;
  righe: RigaLetta[];
  /** La somma delle righe coincide con il totale: la lettura è probabilmente completa. */
  quadra: boolean;
}

/** Il prezzo in fondo alla riga, con quello che può seguirlo: «€», la lettera o la percentuale dell'IVA, un segno sporco. */
const IMPORTO = /(-?\s?\d{1,4}\s?[.,:]\s?\d{2})(?![\d%])\s*(?:€|EUR|EURO)?\s*(?:[^\s\d]{1,2}|\d{1,2}\s?%)?\s*$/;
const FINE_RIGHE = /\b(SUB\s?TOTALE|TOTALE|TOTAL)\b|^SUBTOT/;

/** Le due parole differiscono al più di una lettera (sostituita, in più o in meno). */
function quasiUguali(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i);
}

/** «TOTALE» anche letto male («TOTALF», «T0TALE», «TOTAIE»). */
const eTotale = (linea: string) => linea.split(/[^A-Z0-9]+/).some((p) => p === 'TOTALE' || (p.length >= 5 && quasiUguali(p, 'TOTALE')));
const fineRighe = (linea: string) => FINE_RIGHE.test(linea) || eTotale(linea);
const DA_SALTARE =
  /\b(IVA|CONTANTE|CONTANTI|RESTO|PAGAMENTO|PAGATO|BANCOMAT|ELETTRONICO|RESO|ARROTONDAMENTO|IMPORTO|NUMERO|DOCUMENTO|SCONTRINO|BUONO|BUONI|PUNTI|SALDO|CASSA|CASSIERE|OPERATORE|TEL|TESSERA|ARTICOLI|VISA|MASTERCARD|MAESTRO|P\.?\s?IVA|C\.?F\.?)\b|CARTA (DI )?(CREDITO|DEBITO)/;
const SCONTO = /\b(SCONTO|SC\.|SCONT|PROMO|OFFERTA|RIBASSO|RIDUZIONE|STORNO)\b/;
const INTESTAZIONE_RIGHE = /\bDESCRIZIONE\b|\bPREZZO\s*\(?€?\)?\s*$/;
/** «2 x 0,99» (la lettura sbaglia la x: «xXx», «×», «*»). */
const PEZZI = /^(\d{1,3})\s*(?:PZ|N\.?)?\s*[X*×]{1,3}\s*(\d{1,4}[.,]\d{2})\b/;
/** «0,856 kg x 1,99 €/kg» oppure, alla Iper, «0,386 * 4,90Kg»: peso, poi prezzo al chilo. */
const PESO = /(\d{1,3}[.,]\d{1,3})\s*KG\s*[X*×]\s*(\d{1,4}[.,]\d{2})|^(\d{1,3}[.,]\d{3})\s*[X*×]\s*(\d{1,4}[.,]\d{2})\s*(?:€\s*\/?\s*)?[^\s\d]{0,4}/;
/** Ragione sociale nell'intestazione: il nome del negozio più affidabile. */
const SOCIETA = /\b(S\.?\s?P\.?\s?A|S\.?\s?R\.?\s?L|S\.?\s?N\.?\s?C|S\.?\s?A\.?\s?S|SOC\.?\s?COOP|COOP)\b\.?/;

/**
 * Corregge gli errori tipici della lettura nei numeri: la O al posto dello zero («1,2O»), spazi attorno
 * alla virgola («1 ,29»), i due punti al posto della virgola nei prezzi («3:01 A»).
 */
export function pulisciLinea(linea: string): string {
  return linea
    .toUpperCase()
    .replace(/€/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(^|[\s*X])([\dO]{1,4}) ?([.,]) ?([\dO]{2})(?=$|[\s%A-Z])/g, (_, a: string, i: string, sep: string, d: string) =>
      /\d/.test(i + d) ? `${a}${i.replace(/O/g, '0')}${sep}${d.replace(/O/g, '0')}` : `${a}${i}${sep}${d}`,
    )
    .replace(/(\s)(\d{1,4}):(\d{2})(\s?[A-Z]{0,2})$/, (x, s: string, i: string, d: string, coda: string) => (Number(d) < 60 && Number(i) < 24 && !coda.trim() ? x : `${s}${i},${d}${coda}`))
    .trim();
}

const numero = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));
const centesimi = (n: number) => Math.round(n * 100) / 100;

/** Il formato della confezione scritto nella descrizione, in unità base. */
export function formatoDaDescrizione(descrizione: string): RigaLetta['formato'] {
  const d = descrizione.toUpperCase();
  const m = d.match(/(?:(\d{1,2})\s*X\s*)?(\d{1,4}(?:[.,]\d{1,3})?)\s*(KG|GR|G|LT|L|ML|CL)\b/);
  if (!m) {
    // «UOVA X6», «6 PZ»: una confezione di pezzi.
    const pz = d.match(/(?:\bX\s?(\d{1,2})\b|\b(\d{1,2})\s?PZ\b)/);
    return pz ? { quantita: Number(pz[1] ?? pz[2]), unita: 'pz' } : undefined;
  }
  const confezioni = m[1] ? Number(m[1]) : 1;
  const valore = numero(m[2]);
  const [fattore, unita]: [number, UnitaBase] =
    m[3] === 'KG' ? [1000, 'g'] : m[3] === 'G' || m[3] === 'GR' ? [1, 'g'] : m[3] === 'L' || m[3] === 'LT' ? [1000, 'ml'] : m[3] === 'CL' ? [10, 'ml'] : [1, 'ml'];
  const quantita = Math.round(valore * fattore * confezioni * 1000) / 1000;
  return quantita > 0 ? { quantita, unita } : undefined;
}

const DATA = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g;

function giornoValido(m: RegExpMatchArray): string | null {
  const g = Number(m[1]);
  const mese = Number(m[2]);
  const anno = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (g < 1 || g > 31 || mese < 1 || mese > 12 || anno < 2000 || anno > 2099) return null;
  const d = new Date(Date.UTC(anno, mese - 1, g));
  if (d.getUTCDate() !== g) return null;
  return `${anno}-${String(mese).padStart(2, '0')}-${String(g).padStart(2, '0')}`;
}

/**
 * Data e ora dello scontrino. Prima si cerca una data con l'ora accanto («02-11-2026 18:41»): un'ora da sola
 * può essere altro (l'orologio del telefono in uno screenshot, gli orari del negozio).
 */
function dataOraDa(testo: string): { data: string | null; ora: string | null } {
  for (const m of testo.matchAll(new RegExp(`${DATA.source}\\s+([01]?\\d|2[0-3])[:.]([0-5]\\d)\\b`, 'g'))) {
    const data = giornoValido(m);
    if (data) return { data, ora: `${m[4].padStart(2, '0')}:${m[5]}` };
  }
  let data: string | null = null;
  for (const m of testo.matchAll(DATA)) {
    data = giornoValido(m);
    if (data) break;
  }
  const ora = testo.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return { data, ora: ora ? `${ora[1].padStart(2, '0')}:${ora[2]}` : null };
}

const nomeProprio = (l: string) =>
  l
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|[\s'.-])\p{L}/gu, (x) => x.toUpperCase())
    .slice(0, 80);

function negozioDa(linee: string[]): string | null {
  const intestazione = linee.slice(0, 15);
  // La ragione sociale («IPER MONTEBELLO S.P.A.») è quasi sempre il nome giusto.
  const societa = intestazione.find((l) => SOCIETA.test(l) && !/^(VIA|CORSO|PIAZZA|V\.LE)\b/.test(l) && !/\d{5,}/.test(l));
  if (societa) return nomeProprio(societa);
  for (const l of linee.slice(0, 6)) {
    // Niente indirizzi, indirizzi web, orari (lo screenshot ha in alto l'ora del telefono).
    if ((l.match(/[A-Z]/g) ?? []).length < 3 || DA_SALTARE.test(l) || /^VIA\b|^CORSO\b|^PIAZZA\b|^V\.LE\b|HTTP|WWW|\.(IT|COM)\b|\d{1,2}:\d{2}/.test(l)) continue;
    return nomeProprio(l);
  }
  return null;
}

/** Legge il testo di uno scontrino. Non inventa: quello che non trova resta null o fuori dalle righe. */
export function leggiScontrino(testo: string): ScontrinoLetto {
  const linee = testo.split(/\r?\n/).map(pulisciLinea).filter(Boolean);
  const inizio = linee.findIndex((l) => INTESTAZIONE_RIGHE.test(l));
  const righe: RigaLetta[] = [];
  let totale: number | null = null;
  let inRighe = true;
  let descrizioneSospesa: string | null = null;
  let pezziSospesi: number | null = null;
  /** Gli altri importi che dovrebbero valere quanto il totale (subtotale, pagato): servono se il totale è letto male. */
  const altriTotali: number[] = [];

  const aggiungi = (descrizione: string, prezzo: number, extra: Partial<RigaLetta> = {}) => {
    const riga: RigaLetta = { descrizione: descrizione.slice(0, 120), prezzo, ...extra };
    if (pezziSospesi && riga.pezzi === undefined) riga.pezzi = pezziSospesi;
    pezziSospesi = null;
    descrizioneSospesa = null;
    const formato = formatoDaDescrizione(descrizione);
    if (formato) riga.formato = formato;
    righe.push(riga);
  };

  for (const [i, linea] of linee.entries()) {
    if (inizio >= 0 && i <= inizio) continue;
    if (fineRighe(linea) || (!inRighe && /\b(PAGAMENTO|PAGATO|ELETTRONICO)\b/.test(linea))) {
      inRighe = false;
      const importo = linea.match(IMPORTO);
      if (importo && !/\bIVA\b|RESTO|CONTANT/.test(linea)) altriTotali.push(numero(importo[1]));
      if (totale === null && eTotale(linea) && !/SUB\s?TOT/.test(linea) && !/\bIVA\b/.test(linea)) {
        const m = linea.match(IMPORTO);
        if (m) totale = numero(m[1]);
      }
      continue;
    }
    if (!inRighe || DA_SALTARE.test(linea)) continue;
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
        aggiungi(descrizioneSospesa, numero(importo[1]), { pezzi: n });
        continue;
      }
      // «YOGURT 1,98» poi «2 x 0,99»: i pezzi vanno alla riga sopra; altrimenti a quella sotto.
      if (precedente && precedente.pezzi === undefined && Math.abs(precedente.prezzo - n * numero(pezzi[2])) < 0.011) precedente.pezzi = n;
      else pezziSospesi = n;
      continue;
    }
    if (!importo) {
      // Una descrizione senza prezzo: il prezzo è sulla linea sotto (peso o solo importo).
      if (!peso && (linea.match(/[A-Z]/g) ?? []).length >= 3) descrizioneSospesa = linea;
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

    if (SCONTO.test(linea) || valore < 0) {
      const precedente = righe.at(-1);
      if (precedente) precedente.prezzo = centesimi(Math.max(0, precedente.prezzo - Math.abs(valore)));
      continue;
    }
    if ((descrizione.match(/[A-Z]/g) ?? []).length < 2) {
      if (!descrizioneSospesa) continue;
      descrizione = descrizioneSospesa;
    } else if (peso && descrizioneSospesa) {
      descrizione = descrizioneSospesa;
    }
    const grammi = peso ? Math.round(numero(peso[1] ?? peso[3]) * 1000) : 0;
    aggiungi(descrizione, valore, grammi > 0 ? { grammi } : {});
  }

  const somma = centesimi(righe.reduce((s, r) => s + r.prezzo, 0));
  // Il totale letto non torna ma il subtotale o l'importo pagato sì: era il totale a essere letto male.
  if (righe.length && (totale === null || Math.abs(somma - totale) >= 0.011) && altriTotali.some((x) => Math.abs(x - somma) < 0.011)) totale = somma;
  const { data, ora } = dataOraDa(linee.join('\n'));
  return {
    negozio: negozioDa(linee),
    data,
    ora,
    totale,
    righe,
    quadra: totale !== null && righe.length > 0 && Math.abs(somma - totale) < 0.011,
  };
}

const PAROLE_VUOTE = new Set(['gr', 'kg', 'ml', 'cl', 'lt', 'pz', 'conf', 'bio', 'gr', 'x', 'al', 'di', 'da', 'con', 'in', 'e', 'il', 'la', 'le', 'per', 'tipo']);

function parole(descrizione: string): string[] {
  return normalizza(descrizione)
    .split(' ')
    .filter((p) => p.length >= 3 && !/\d/.test(p) && !PAROLE_VUOTE.has(p));
}

/** L'ingrediente più probabile per una descrizione dello scontrino, o undefined se non c'è un buon candidato. */
export function suggerisciIngrediente(descrizione: string, indice: Indice): Ingrediente | undefined {
  const p = parole(descrizione);
  const tentativi = [p.join(' '), ...p.slice(0, -1).map((x, i) => `${x} ${p[i + 1]}`), ...p, ...p.filter((x) => x.length >= 5).map((x) => x.slice(0, -1))];
  // Quante parole della descrizione ha il nome (o sinonimo) che ne ha di più: «macinato tacchino pollo»
  // è il macinato di pollo o tacchino, non la carne macinata, anche se «macinato» da solo è quella.
  const comuni = (i: Ingrediente) => Math.max(...[i.nome, ...i.sinonimi].map((n) => normalizza(n).split(' ')).map((w) => p.filter((x) => w.includes(x)).length));
  for (const t of tentativi) {
    if (!t) continue;
    // Solo se una parola del nome inizia con il testo cercato: «latte» sì, «atte» no.
    const buoni = indice
      .cercaIngredienti(t)
      .filter((i) => [i.nome, ...i.sinonimi].map(normalizza).some((n) => n.split(' ').some((w) => w.startsWith(t.split(' ')[0]))));
    if (!buoni.length) continue;
    // A parità di parole in comune resta il primo della ricerca (nome uguale prima di nome che inizia così).
    return buoni.reduce((meglio, i) => (comuni(i) > comuni(meglio) ? i : meglio));
  }
  return undefined;
}

/** Una riga già confermata dal carrello, ancora senza prezzo, a cui uno scontrino può darlo. */
export interface RigaDaAbbinare {
  id: string;
  ingrediente_id: string | null;
  nome: string;
}

/** Due parole si somigliano se iniziano uguali: «mozz» è mozzarella, «yog» è yogurt, «pane» non è «panna». */
function parolaSimile(dalloScontrino: string, nota: string): boolean {
  if (dalloScontrino.length === 3) return nota.startsWith(dalloScontrino);
  return dalloScontrino.slice(0, 4) === nota.slice(0, 4);
}

/** Descrizione senza spazi e punteggiatura, per riconoscere la stessa riga ripetuta sullo scontrino. */
const chiaveRiga = (descrizione: string) => normalizza(descrizione).replace(/[^a-z0-9]/g, '');

/**
 * Abbina ogni riga letta a una riga già confermata (dal carrello o a mano), così non entra in casa due volte:
 * 1. per ingrediente suggerito, in tutte e due le direzioni (spaghetti ↔ pasta, mozzarella ↔ mozzarella di bufala);
 * 2. per parole in comune con il nome o i sinonimi;
 * 3. la stessa riga ripetuta (due confezioni passate una alla volta) va sulla stessa riga confermata della prima.
 * Ogni riga confermata prende al più una riga diversa; quelle senza abbinamento sono nuove.
 */
export function abbinaRighe(lette: RigaLetta[], candidate: RigaDaAbbinare[], indice: Indice): (string | null)[] {
  const usate = new Set<string>();
  const risultato: (string | null)[] = lette.map(() => null);
  const chiavi = lette.map((r) => chiaveRiga(r.descrizione));
  const suggeriti = lette.map((r) => suggerisciIngrediente(r.descrizione, indice));
  /** Una riga uguale a una già abbinata la segue, invece di prendere un'altra riga confermata. */
  const ripetuta = (i: number) => chiavi.slice(0, i).includes(chiavi[i]);
  const prendi = (i: number, c: RigaDaAbbinare | undefined) => {
    if (!c) return;
    usate.add(c.id);
    risultato[i] = c.id;
  };
  const libere = () => candidate.filter((x) => !usate.has(x.id));
  for (const [i] of lette.entries()) {
    const ing = suggeriti[i];
    if (!ing || ripetuta(i)) continue;
    const suoi = indice.antenati(ing.id);
    const conIngrediente = libere().filter((x) => x.ingrediente_id);
    prendi(i, conIngrediente.find((x) => suoi.includes(x.ingrediente_id!)) ?? conIngrediente.find((x) => indice.antenati(x.ingrediente_id!).includes(ing.id)));
  }
  for (const [i, r] of lette.entries()) {
    if (risultato[i] || ripetuta(i)) continue;
    const mie = parole(r.descrizione);
    if (!mie.length) continue;
    prendi(
      i,
      libere().find((x) => {
        const ing = x.ingrediente_id ? indice.ingrediente(x.ingrediente_id) : undefined;
        const note = [x.nome, ...(ing ? [ing.nome, ...ing.sinonimi] : [])].flatMap(parole);
        return note.some((w) => mie.some((m) => parolaSimile(m, w)));
      }),
    );
  }
  for (const [i] of lette.entries()) {
    if (risultato[i]) continue;
    const prima = chiavi.findIndex((k, j) => j < i && k === chiavi[i] && risultato[j]);
    if (prima >= 0) risultato[i] = risultato[prima];
  }
  return risultato;
}

/** «PETTO POLLO» + «PETTO POLLO» = «PETTO POLLO ×2»; righe diverse si mettono una dopo l'altra. */
export function unisciDescrizioni(prima: string, altra: string): string {
  const m = /^(.*) ×(\d+)$/.exec(prima);
  const [testo, volte] = m ? [m[1], Number(m[2])] : [prima, 1];
  return (testo === altra ? `${testo} ×${volte + 1}` : `${prima} + ${altra}`).slice(0, 120);
}

/** La quantità da caricare in casa per una riga, nell'unità base dell'ingrediente, o null se non si sa. */
export function quantitaProposta(riga: RigaLetta, ingrediente: Pick<Ingrediente, 'dimensione'>): { quantita: number; unita: UnitaBase } | null {
  if (ingrediente.dimensione === 'massa' && riga.grammi) return { quantita: riga.grammi, unita: 'g' };
  const base: UnitaBase = ingrediente.dimensione === 'massa' ? 'g' : ingrediente.dimensione === 'volume' ? 'ml' : 'pz';
  if (riga.formato && riga.formato.unita === base) return { quantita: riga.formato.quantita * (riga.pezzi ?? 1), unita: base };
  if (base === 'pz') return { quantita: riga.pezzi ?? 1, unita: 'pz' };
  return null;
}

/** Ciò che Open Food Facts dice di un codice a barre: solo nome e formato, da confermare. */
export interface ProdottoEsterno {
  nome: string;
  formato?: { quantita: number; unita: UnitaBase };
}

/** Legge la risposta di Open Food Facts (api/v3/product, accetta anche la v2); undefined se il prodotto non c'è. */
export function daOpenFoodFacts(risposta: unknown): ProdottoEsterno | undefined {
  const r = risposta as { status?: unknown; product?: Record<string, unknown> } | null;
  const p = r?.product;
  if (!p || r?.status === 0 || r?.status === 'failure') return undefined;
  const nome = [p.product_name_it, p.product_name, p.generic_name_it].find((x): x is string => typeof x === 'string' && x.trim() !== '')?.trim();
  if (!nome) return undefined;
  const marca = typeof p.brands === 'string' ? p.brands.split(',')[0].trim() : '';
  const tutto = marca && !nome.toLowerCase().includes(marca.toLowerCase()) ? `${nome} ${marca}` : nome;
  const q = Number(p.product_quantity);
  const u = String(p.product_quantity_unit ?? '').toLowerCase();
  let formato: ProdottoEsterno['formato'];
  if (q > 0 && (u === 'g' || u === 'ml')) formato = { quantita: q, unita: u };
  else if (typeof p.quantity === 'string') formato = formatoDaDescrizione(p.quantity);
  return { nome: tutto.slice(0, 120), ...(formato ? { formato } : {}) };
}
