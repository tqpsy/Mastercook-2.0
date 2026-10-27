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

/** Le unità che si possono scegliere per un ingrediente di quella dimensione. */
export function unitaPer(dimensione: Dimensione): Unita[] {
  return (Object.keys(UNITA) as Unita[]).filter((u) => UNITA[u].dimensione === dimensione);
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
 * Arrotonda a tre decimali per evitare 1.4999999.
 */
export function inBase(valore: number, unita: Unita, dimensione: Dimensione): EsitoQuantita {
  const u = UNITA[unita];
  if (!u || u.dimensione !== dimensione) return { ok: false, motivo: 'unita_incompatibile' };
  if (!Number.isFinite(valore) || valore <= 0) return { ok: false, motivo: 'quantita_non_valida' };
  return { ok: true, quantita: { valore: Math.round(valore * u.fattore * 1000) / 1000, unita: u.base } };
}

/** Somma per unità: g con g, ml con ml. Unità diverse restano voci separate. */
export function somma(quantita: Quantita[]): Quantita[] {
  const totali = new Map<UnitaBase, number>();
  for (const q of quantita) totali.set(q.unita, Math.round(((totali.get(q.unita) ?? 0) + q.valore) * 1000) / 1000);
  return [...totali].map(([unita, valore]) => ({ valore, unita }));
}

const numero = (cifre: number) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: cifre });

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
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(valore);
}

/** Data breve all'italiana: «lun 27 ott». */
export function formattaGiorno(data: Date | string): string {
  const d = typeof data === 'string' ? new Date(`${data.slice(0, 10)}T12:00:00`) : data;
  return new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }).format(d).replace(/\./g, '');
}
