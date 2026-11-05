/**
 * Quanto ha speso la famiglia: per mese e per reparto, dagli acquisti e dagli scontrini già registrati.
 *
 * Ogni spesa si conta una volta sola:
 * - uno scontrino vale il suo totale (quello stampato); senza totale, la somma delle sue righe;
 * - un acquisto senza scontrino (carrello o a mano) vale la somma dei prezzi delle sue righe.
 * Un acquisto annullato non conta, e nemmeno lo scontrino che ha portato solo acquisti annullati.
 * Per i reparti si usano le righe; la differenza col totale dello scontrino (sconti, sacchetti,
 * righe lasciate fuori) va in una voce a parte.
 */
import type { Acquisto, RigaAcquisto } from './spesa';

export interface Scontrino {
  id: string;
  data: string;
  totale: number | null;
  acquisto_id: string | null;
}

export interface RigaScontrino {
  id: string;
  scontrino_id: string;
  prezzo: number | null;
  acquisto_riga_id: string | null;
}

export type AcquistoConScontrino = Acquisto & { scontrino_id?: string | null };

/** Il reparto «altro» e la voce per la differenza col totale dello scontrino. */
export const ALTRO = 'altro';
export const DIFFERENZA = 'differenza';

export interface Mese {
  /** «2026-11» */
  mese: string;
  euro: number;
  spese: number;
}

export interface Resoconto {
  /** Ultimi mesi, dal più vecchio al mese di oggi. */
  mesi: Mese[];
  /** Per ogni mese, euro per reparto (id del reparto, ALTRO o DIFFERENZA). */
  reparti: Map<string, Map<string, number>>;
  /** Per ogni mese, quante righe comprate non hanno un prezzo (il totale è più basso del vero). */
  senzaPrezzo: Map<string, number>;
}

const centesimi = (x: number) => Math.round(x * 100) / 100;

/** I mesi da `quanti - 1` mesi fa al mese di `oggi` (AAAA-MM-GG). */
export function ultimiMesi(oggi: string, quanti: number): string[] {
  const anno = Number(oggi.slice(0, 4));
  const mese = Number(oggi.slice(5, 7)) - 1;
  return Array.from({ length: quanti }, (_, i) => {
    const d = new Date(Date.UTC(anno, mese - (quanti - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

export function resocontoSpesa({
  acquisti,
  righe,
  scontrini,
  righeScontrino,
  repartoDi,
  oggi,
  quantiMesi = 6,
}: {
  acquisti: AcquistoConScontrino[];
  righe: RigaAcquisto[];
  scontrini: Scontrino[];
  righeScontrino: RigaScontrino[];
  repartoDi: (ingredienteId: string) => string | undefined;
  oggi: string;
  quantiMesi?: number;
}): Resoconto {
  const elenco = ultimiMesi(oggi, quantiMesi);
  const mesi = new Map(elenco.map((m) => [m, { mese: m, euro: 0, spese: 0 }]));
  const reparti = new Map(elenco.map((m) => [m, new Map<string, number>()]));
  const senzaPrezzo = new Map(elenco.map((m) => [m, 0]));

  const rigaDa = new Map(righe.map((r) => [r.id, r]));
  const repartoRiga = (r: RigaAcquisto | undefined) => (r?.ingrediente_id && repartoDi(r.ingrediente_id)) || ALTRO;

  function conta(mese: string, euro: number, perReparto: Map<string, number>, mancanti: number) {
    const m = mesi.get(mese);
    if (!m) return;
    m.euro += euro;
    m.spese += 1;
    const r = reparti.get(mese)!;
    for (const [k, v] of perReparto) if (v) r.set(k, (r.get(k) ?? 0) + v);
    senzaPrezzo.set(mese, (senzaPrezzo.get(mese) ?? 0) + mancanti);
  }

  // Scontrini: valgono per quello che è stato pagato.
  const conScontrino = new Set<string>();
  for (const s of scontrini) {
    const collegati = acquisti.filter((a) => a.id === s.acquisto_id || a.scontrino_id === s.id);
    for (const a of collegati) conScontrino.add(a.id);
    if (collegati.length && collegati.every((a) => a.stato === 'annullato')) continue;
    const sue = righeScontrino.filter((r) => r.scontrino_id === s.id);
    const perReparto = new Map<string, number>();
    let somma = 0;
    let mancanti = 0;
    for (const rs of sue) {
      const ra = rs.acquisto_riga_id ? rigaDa.get(rs.acquisto_riga_id) : undefined;
      const prezzo = ra?.prezzo ?? rs.prezzo;
      if (prezzo == null) {
        mancanti += 1;
        continue;
      }
      const k = repartoRiga(ra);
      perReparto.set(k, (perReparto.get(k) ?? 0) + prezzo);
      somma += prezzo;
    }
    let euro = somma;
    if (s.totale != null) {
      euro = s.totale;
      const resto = centesimi(s.totale - somma);
      if (resto) perReparto.set(DIFFERENZA, resto);
      mancanti = 0; // il totale stampato è già quello vero
    }
    conta(s.data.slice(0, 7), euro, perReparto, mancanti);
  }

  // Acquisti senza scontrino.
  const perAcquisto = new Map<string, RigaAcquisto[]>();
  for (const r of righe) perAcquisto.set(r.acquisto_id, [...(perAcquisto.get(r.acquisto_id) ?? []), r]);
  for (const a of acquisti) {
    if (a.stato === 'annullato' || conScontrino.has(a.id) || a.scontrino_id) continue;
    const perReparto = new Map<string, number>();
    let euro = 0;
    let mancanti = 0;
    for (const r of perAcquisto.get(a.id) ?? []) {
      if (r.prezzo == null) {
        mancanti += 1;
        continue;
      }
      const k = repartoRiga(r);
      perReparto.set(k, (perReparto.get(k) ?? 0) + r.prezzo);
      euro += r.prezzo;
    }
    conta(a.data.slice(0, 7), euro, perReparto, mancanti);
  }

  for (const m of mesi.values()) m.euro = centesimi(m.euro);
  for (const r of reparti.values()) for (const [k, v] of r) r.set(k, centesimi(v));
  return { mesi: elenco.map((m) => mesi.get(m)!), reparti, senzaPrezzo };
}

/** «novembre 2026» o, con `breve`, «nov». */
export function nomeMese(mese: string, breve = false): string {
  const d = new Date(`${mese}-15T12:00:00`);
  return new Intl.DateTimeFormat('it-IT', breve ? { month: 'short' } : { month: 'long', year: 'numeric' }).format(d).replace(/\./g, '');
}
