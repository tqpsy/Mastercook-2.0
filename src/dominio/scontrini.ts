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

const IMPORTO = /(-?\s?\d{1,4}[.,]\d{2})\s*(?:€|EUR|EURO)?\s*(?:[A-Z]{1,2}|\*)?\s*$/;
const FINE_RIGHE = /\b(SUBTOTALE|SUB TOTALE|TOTALE|TOTAL)\b|^SUBTOT/;
const DA_SALTARE =
  /\b(IVA|CONTANTE|CONTANTI|RESTO|PAGAMENTO|PAGATO|CARTA|BANCOMAT|ELETTRONICO|RESO|ARROTONDAMENTO|IMPORTO|NUMERO|DOCUMENTO|SCONTRINO|BUONO|PUNTI|SALDO|CASSA|CASSIERE|OPERATORE|TEL|P\.?\s?IVA|C\.?F\.?)\b/;
const SCONTO = /\b(SCONTO|SC\.|SCONT|PROMO|OFFERTA|RIBASSO|RIDUZIONE|STORNO)\b/;
const INTESTAZIONE_RIGHE = /\bDESCRIZIONE\b|\bPREZZO\s*\(?€?\)?\s*$/;
const PEZZI = /^(\d{1,3})\s*(?:PZ|N\.?)?\s*[X*]\s*(\d{1,4}[.,]\d{2})\b/;
const PESO = /(\d{1,3}[.,]\d{1,3})\s*KG\s*[X*]\s*(\d{1,4}[.,]\d{2})/;

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

function dataDa(testo: string): string | null {
  for (const m of testo.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g)) {
    const g = Number(m[1]);
    const mese = Number(m[2]);
    const anno = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (g < 1 || g > 31 || mese < 1 || mese > 12 || anno < 2000 || anno > 2099) continue;
    const d = new Date(Date.UTC(anno, mese - 1, g));
    if (d.getUTCDate() !== g) continue;
    return `${anno}-${String(mese).padStart(2, '0')}-${String(g).padStart(2, '0')}`;
  }
  return null;
}

function negozioDa(linee: string[]): string | null {
  for (const l of linee.slice(0, 6)) {
    if ((l.match(/[A-Z]/g) ?? []).length < 3 || DA_SALTARE.test(l) || /^VIA\b|^CORSO\b|^PIAZZA\b|^V\.LE\b/.test(l)) continue;
    const nome = l
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/(^|[\s'.-])\p{L}/gu, (x) => x.toUpperCase());
    return nome.slice(0, 80);
  }
  return null;
}

/** Legge il testo di uno scontrino. Non inventa: quello che non trova resta null o fuori dalle righe. */
export function leggiScontrino(testo: string): ScontrinoLetto {
  const linee = testo
    .split(/\r?\n/)
    .map((l) => l.toUpperCase().replace(/€/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const inizio = linee.findIndex((l) => INTESTAZIONE_RIGHE.test(l));
  const righe: RigaLetta[] = [];
  let totale: number | null = null;
  let inRighe = true;
  let descrizioneSospesa: string | null = null;
  let pezziSospesi: number | null = null;

  for (const [i, linea] of linee.entries()) {
    if (inizio >= 0 && i <= inizio) continue;
    if (FINE_RIGHE.test(linea)) {
      inRighe = false;
      if (totale === null && /\bTOTALE\b/.test(linea) && !/\bIVA\b/.test(linea)) {
        const m = linea.match(IMPORTO);
        if (m) totale = numero(m[1]);
      }
      continue;
    }
    if (!inRighe || DA_SALTARE.test(linea)) continue;
    const importo = linea.match(IMPORTO);
    const peso = linea.match(PESO);
    const pezzi = linea.match(PEZZI);

    if (pezzi && !peso) {
      const n = Number(pezzi[1]);
      const precedente = righe.at(-1);
      // «YOGURT 1,98» poi «2 x 0,99»: i pezzi vanno alla riga sopra; altrimenti a quella sotto.
      if (precedente && precedente.pezzi === undefined && Math.abs(precedente.prezzo - n * numero(pezzi[2])) < 0.011) precedente.pezzi = n;
      else pezziSospesi = n;
      continue;
    }
    if (!importo) {
      // Una descrizione senza prezzo: il prezzo è sulla linea sotto (peso o solo importo).
      if ((linea.match(/[A-Z]/g) ?? []).length >= 3) descrizioneSospesa = linea;
      continue;
    }
    const valore = numero(importo[1]);
    let descrizione = linea
      .slice(0, importo.index)
      .replace(/\b\d{1,2}([.,]\d{1,2})?\s?%/g, '')
      .replace(PESO, '')
      .replace(/€\s*\/\s*KG|\/KG/g, '')
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
    descrizioneSospesa = null;
    const riga: RigaLetta = { descrizione: descrizione.slice(0, 120), prezzo: valore };
    if (peso) riga.grammi = Math.round(numero(peso[1]) * 1000);
    if (pezziSospesi) riga.pezzi = pezziSospesi;
    pezziSospesi = null;
    const formato = formatoDaDescrizione(descrizione);
    if (formato) riga.formato = formato;
    righe.push(riga);
  }

  const somma = centesimi(righe.reduce((s, r) => s + r.prezzo, 0));
  const ora = testo.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return {
    negozio: negozioDa(linee),
    data: dataDa(testo),
    ora: ora ? `${ora[1].padStart(2, '0')}:${ora[2]}` : null,
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
  for (const t of tentativi) {
    if (!t) continue;
    const [primo] = indice.cercaIngredienti(t, 1);
    if (!primo) continue;
    const nomi = [primo.nome, ...primo.sinonimi].map(normalizza);
    // Solo se una parola del nome inizia con il testo cercato: «latte» sì, «atte» no.
    if (nomi.some((n) => n.split(' ').some((w) => w.startsWith(t.split(' ')[0])))) return primo;
  }
  return undefined;
}

/** Una riga già confermata dal carrello, ancora senza prezzo, a cui uno scontrino può darlo. */
export interface RigaDaAbbinare {
  id: string;
  ingrediente_id: string | null;
  nome: string;
}

/**
 * Abbina ogni riga letta al più a una riga confermata (e ogni riga confermata al più a una letta):
 * prima per ingrediente suggerito, poi per parole in comune. Quelle senza abbinamento sono nuove.
 */
export function abbinaRighe(lette: RigaLetta[], candidate: RigaDaAbbinare[], indice: Indice): (string | null)[] {
  const usate = new Set<string>();
  const risultato: (string | null)[] = lette.map(() => null);
  const suggeriti = lette.map((r) => suggerisciIngrediente(r.descrizione, indice));
  for (const [i] of lette.entries()) {
    const ing = suggeriti[i];
    if (!ing) continue;
    const c = candidate.find((x) => !usate.has(x.id) && x.ingrediente_id && indice.antenati(ing.id).includes(x.ingrediente_id));
    if (c) {
      usate.add(c.id);
      risultato[i] = c.id;
    }
  }
  for (const [i, r] of lette.entries()) {
    if (risultato[i]) continue;
    const mie = parole(r.descrizione);
    const c = candidate.find((x) => !usate.has(x.id) && parole(x.nome).some((w) => mie.some((m) => m.slice(0, 4) === w.slice(0, 4))));
    if (c) {
      usate.add(c.id);
      risultato[i] = c.id;
    }
  }
  return risultato;
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
