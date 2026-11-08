/**
 * Quantità e unità. Si salva sempre in unità base (g, ml, pz); kg e l esistono solo all'ingresso
 * e alla lettura. Un ingrediente ha una dimensione (massa, volume, pezzi) e accetta solo le unità
 * di quella dimensione: senza una conversione esplicita, «10 g di uova» non ha senso e si rifiuta.
 * Una quantità che nessuno ha indicato resta `null`: non si inventa mai un numero.
 */

export type Dimensione = 'massa' | 'volume' | 'pezzi';
export type UnitaBase = 'g' | 'ml' | 'pz';
export type Unita = UnitaBase | 'kg' | 'l';

export const UNITA: Record<Unita, { base: UnitaBase; fattore: number; dimensione: Dimensione; nome: string }> = {
  g: { base: 'g', fattore: 1, dimensione: 'massa', nome: 'g' },
  kg: { base: 'g', fattore: 1000, dimensione: 'massa', nome: 'kg' },
  ml: { base: 'ml', fattore: 1, dimensione: 'volume', nome: 'ml' },
  l: { base: 'ml', fattore: 1000, dimensione: 'volume', nome: 'l' },
  pz: { base: 'pz', fattore: 1, dimensione: 'pezzi', nome: 'pz' },
};

export const UNITA_BASE: Record<Dimensione, UnitaBase> = { massa: 'g', volume: 'ml', pezzi: 'pz' };

/**
 * Le unità che si possono scegliere per un ingrediente. Ciò che si pesa si può scrivere anche in ml e l, e
 * ciò che si versa anche in g e kg (1 ml ≈ 1 g: lo yogurt in vasetti da 125 ml, il latte da 1 kg). Se si sa
 * quanto pesa un pezzo (una zucchina, una mela) si può scrivere anche in pezzi. Tutto diventa unità base con
 * `inBase`. Gli ingredienti che si contano (uova) restano in pezzi: quanto pesa un uovo non si inventa.
 */
export function unitaPer(dimensione: Dimensione, pesoPz?: number | null): Unita[] {
  if (dimensione === 'pezzi') return ['pz'];
  const prima: Unita[] = dimensione === 'massa' ? ['g', 'kg', 'ml', 'l'] : ['ml', 'l', 'g', 'kg'];
  return pesoPz ? [...prima, 'pz'] : prima;
}

/** Vero se l'unità scritta non è della dimensione dell'ingrediente e la conversione è circa (ml di yogurt, g di latte). */
export function eCirca(unita: Unita, dimensione: Dimensione): boolean {
  return dimensione !== 'pezzi' && unita !== 'pz' && UNITA[unita].dimensione !== dimensione;
}

export function eUnita(x: unknown): x is Unita {
  return typeof x === 'string' && x in UNITA;
}

export interface Quantita {
  valore: number;
  unita: UnitaBase;
}

export type EsitoQuantita = { ok: true; quantita: Quantita } | { ok: false; motivo: 'quantita_non_valida' | 'unita_incompatibile' };

/**
 * Porta una quantità all'unità base, controllando che l'unità sia della dimensione dell'ingrediente.
 * I pezzi di un ingrediente che si pesa diventano grammi col suo peso di un pezzo (3 zucchine da 200 g → 600 g).
 * Arrotonda a tre decimali per evitare 1.4999999.
 */
export function inBase(valore: number, unita: Unita, dimensione: Dimensione, pesoPz?: number | null): EsitoQuantita {
  if (!UNITA[unita]) return { ok: false, motivo: 'unita_incompatibile' };
  const daPezzi = unita === 'pz' && dimensione !== 'pezzi' && !!pesoPz;
  const circa = eCirca(unita, dimensione);
  const u = daPezzi || circa ? { base: UNITA_BASE[dimensione], fattore: daPezzi ? pesoPz! : UNITA[unita].fattore } : UNITA[unita];
  if (!daPezzi && !circa && UNITA[unita].dimensione !== dimensione) return { ok: false, motivo: 'unita_incompatibile' };
  if (!Number.isFinite(valore) || valore <= 0) return { ok: false, motivo: 'quantita_non_valida' };
  return { ok: true, quantita: { valore: Math.round(valore * u.fattore * 1000) / 1000, unita: u.base } };
}

/**
 * Una quantità come la si scrive: quanto ne contiene una confezione (o quanto in tutto) e quante confezioni.
 * «3 vasetti da 125 ml» = { numero: '125', unita: 'ml', quante: '3' }. `quante` vuoto vale 1.
 */
export interface Scritta {
  numero: string;
  unita: Unita;
  quante: string;
}

export type EsitoScritta = EsitoQuantita | { ok: false; motivo: 'confezioni_non_valide' };

/** Una scritta da riempire, con una confezione sola. */
export const scrittaVuota = (unita: Unita, numero = ''): Scritta => ({ numero, unita, quante: '1' });

/** Quante confezioni: un numero intero o mezzo (1,5 confezioni), almeno uno; vuoto vale 1. */
export function leggiQuante(testo: string): number | null {
  if (!testo.trim()) return 1;
  const n = leggiNumero(testo);
  return n === null || n <= 0 ? null : n;
}

/** Il totale in unità base: quante × quanto ne contiene una (3 × 125 ml di yogurt → 375 g). */
export function totaleScritta(s: Scritta, dimensione: Dimensione, pesoPz?: number | null): EsitoScritta {
  const quante = leggiQuante(s.quante);
  if (quante === null) return { ok: false, motivo: 'confezioni_non_valide' };
  const n = leggiNumero(s.numero);
  if (n === null) return { ok: false, motivo: 'quantita_non_valida' };
  return inBase(n * quante, s.unita, dimensione, pesoPz);
}

/**
 * Cosa diventa quello che si è scritto, solo quando non si vede già: «= 375 ml» per 3 confezioni,
 * «≈ 600 g» per 3 pezzi di un ingrediente che si pesa o per 500 ml di yogurt. Null se non serve dirlo.
 */
export function riepilogoScritta(s: Scritta, dimensione: Dimensione, pesoPz?: number | null): string | null {
  const quante = leggiQuante(s.quante);
  const e = totaleScritta(s, dimensione, pesoPz);
  if (!e.ok || quante === null) return null;
  const converte = (s.unita === 'pz' && dimensione !== 'pezzi') || eCirca(s.unita, dimensione);
  if (quante === 1 && !converte) return null;
  return `${converte ? '≈' : '='} ${formatta(e.quantita)}`;
}

/** Somma per unità: g con g, ml con ml. Unità diverse restano voci separate. */
export function somma(quantita: Quantita[]): Quantita[] {
  const totali = new Map<UnitaBase, number>();
  for (const q of quantita) totali.set(q.unita, Math.round(((totali.get(q.unita) ?? 0) + q.valore) * 1000) / 1000);
  return [...totali].map(([unita, valore]) => ({ valore, unita }));
}

// Creare un formato Intl costa molto (decine di microsecondi, molto di più su un telefono lento): uno per tipo, riusato.
const NUMERI = new Map<number, Intl.NumberFormat>();
const numero = (cifre: number) => {
  let f = NUMERI.get(cifre);
  if (!f) NUMERI.set(cifre, (f = new Intl.NumberFormat('it-IT', { maximumFractionDigits: cifre })));
  return f;
};
const EURO = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const GIORNO = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });

/** Testo leggibile: 1500 g → «1,5 kg», 750 ml → «750 ml», 1250 g → «1,25 kg», 2 pz → «2 pz». */
export function formatta(q: Quantita | null | undefined): string {
  if (!q) return 'quantità da indicare';
  if (q.unita === 'g' && q.valore >= 1000) return `${numero(3).format(q.valore / 1000)} kg`;
  if (q.unita === 'ml' && q.valore >= 1000) return `${numero(3).format(q.valore / 1000)} l`;
  return `${numero(q.unita === 'pz' ? 2 : 1).format(q.valore)} ${q.unita}`;
}

/** Legge un numero scritto all'italiana: «1,5», «1.250», «1.250,5», «0.75». */
export function leggiNumero(testo: string): number | null {
  const t = testo.trim().replace(/\s/g, '');
  if (!t) return null;
  let normale: string;
  if (t.includes(',')) normale = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) normale = t.replace(/\./g, '');
  else normale = t;
  if (!/^\d+(\.\d+)?$/.test(normale)) return null;
  const n = Number(normale);
  return Number.isFinite(n) ? n : null;
}

/** Scala una quantità per le porzioni: 4 porzioni base, 6 richieste → × 1,5. I pezzi si arrotondano al mezzo. */
export function scala(q: Quantita, porzioniBase: number, porzioni: number): Quantita {
  const v = (q.valore * porzioni) / porzioniBase;
  return { unita: q.unita, valore: q.unita === 'pz' ? Math.max(0.5, Math.round(v * 2) / 2) : v >= 10 ? Math.round(v) : Math.round(v * 10) / 10 };
}

/** Prezzo all'italiana: 2.3 → «2,30 €». */
export function formattaEuro(valore: number): string {
  return EURO.format(valore);
}

/** Data breve all'italiana: «lun 27 ott». */
export function formattaGiorno(data: Date | string): string {
  const d = typeof data === 'string' ? new Date(`${data.slice(0, 10)}T12:00:00`) : data;
  return GIORNO.format(d).replace(/\./g, '');
}

/** Ciò che serve sapere di un ingrediente per dire quanto comprarne. */
export interface PerNegozio {
  id: string;
  dimensione: Dimensione;
  sottocategoria: string | null;
  peso_pz: number | null;
}

const suPerGiu = (valore: number, passo: number) => Math.ceil(valore / passo - 1e-9) * passo;
const pezzi = (n: number, uno: string, tanti: string) => `${n} ${n === 1 ? uno : tanti}`;

/**
 * Quanto comprare, come lo si dice in negozio: «1 testa» d'aglio invece di 1,9 g, «2 pz» di banane
 * invece di 193,8 g, «1 confezione» di cannella invece di 0,4 g, 330 g → «350 g». Sempre arrotondato
 * per eccesso; la quantità esatta resta salvata e si vede aprendo la voce.
 */
export function quantitaDaNegozio(q: Quantita, ing?: PerNegozio): string {
  const v = q.valore;
  if (q.unita === 'pz') return pezzi(Math.max(1, Math.ceil(v - 1e-9)), 'pz', 'pz');
  if (ing?.id === 'ing:aglio' && q.unita === 'g') return pezzi(Math.max(1, Math.ceil(v / 50 - 1e-9)), 'testa', 'teste');
  if (ing?.sottocategoria === 'Erbe aromatiche' && v <= 50) return '1 mazzetto';
  if (ing?.sottocategoria === 'Sale e spezie' && v <= 100) return '1 confezione';
  if (q.unita === 'g' && ing?.peso_pz) return pezzi(Math.max(1, Math.ceil(v / ing.peso_pz - 1e-9)), 'pz', 'pz');
  if (v <= 30) return '1 confezione';
  const passo = v <= 500 ? 50 : v <= 2000 ? 100 : 250;
  return formatta({ valore: suPerGiu(v, passo), unita: q.unita });
}
