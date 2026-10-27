/**
 * Spesa: prezzi osservati, stima del costo della lista e proposta di conferma dal carrello.
 * Il fabbisogno lo calcola il database (comando `ricalcola_spesa`); qui solo ciò che serve a mostrare.
 *
 * Prezzi (R-PRE): ogni riga d'acquisto con un prezzo è un'osservazione. Per una voce si usa la mediana
 * dei prezzi per unità degli ultimi 6 mesi di quell'ingrediente, dichiarata come stima con la data
 * dell'ultima osservazione. Un ingrediente mai comprato con un prezzo non ha prezzo: lo si dice.
 */
import type { Ingrediente } from './ricette';
import { giorniTra, type Luogo, REPARTI_SFUSI, stima } from './scadenze';
import type { UnitaBase } from './unita';

export interface VoceSpesa {
  id: string;
  tipo: 'derivata' | 'manuale';
  ingrediente_id: string | null;
  testo: string | null;
  unita: UnitaBase | null;
  quantita_richiesta: number | null;
  quantita_scelta: number | null;
  stato: 'da_acquistare' | 'nel_carrello' | 'acquistata' | 'rimossa';
  non_piu_necessaria: boolean;
  nota: string | null;
  versione?: number;
  in_attesa?: boolean;
}

export interface Acquisto {
  id: string;
  fonte: string;
  data: string;
  negozio: string | null;
  stato: 'confermato' | 'annullato';
  in_attesa?: boolean;
}

export interface RigaAcquisto {
  id: string;
  acquisto_id: string;
  voce_id: string | null;
  ingrediente_id: string | null;
  nome: string | null;
  quantita: number | null;
  unita: UnitaBase | null;
  prezzo: number | null;
  lotto_id: string | null;
  in_attesa?: boolean;
}

export const quantitaVoce = (v: Pick<VoceSpesa, 'quantita_scelta' | 'quantita_richiesta'>) => v.quantita_scelta ?? v.quantita_richiesta;

export interface Osservazione {
  data: string;
  /** Euro per unità base (g, ml, pz). */
  perUnita: number;
  negozio: string | null;
}

/** Le osservazioni di prezzo per ingrediente, dalla più recente; gli acquisti annullati non contano. */
export function prezziOsservati(acquisti: Acquisto[], righe: RigaAcquisto[]): Map<string, Osservazione[]> {
  const validi = new Map(acquisti.filter((a) => a.stato === 'confermato').map((a) => [a.id, a]));
  const mappa = new Map<string, Osservazione[]>();
  for (const r of righe) {
    const a = validi.get(r.acquisto_id);
    if (!a || !r.ingrediente_id || r.prezzo == null || !r.quantita) continue;
    const elenco = mappa.get(r.ingrediente_id) ?? [];
    elenco.push({ data: a.data, perUnita: r.prezzo / r.quantita, negozio: a.negozio });
    mappa.set(r.ingrediente_id, elenco);
  }
  for (const elenco of mappa.values()) elenco.sort((x, y) => y.data.localeCompare(x.data));
  return mappa;
}

export interface PrezzoStimato {
  euro: number;
  /** Data dell'osservazione più recente usata. */
  dal: string;
  osservazioni: number;
}

function mediana(n: number[]): number {
  const s = [...n].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Quanto costerebbe la quantità indicata, o null se non c'è nessun prezzo noto. */
export function stimaPrezzo(osservate: Osservazione[] | undefined, quantita: number | null): PrezzoStimato | null {
  if (!osservate?.length || !quantita) return null;
  const ultima = osservate[0].data;
  const recenti = osservate.filter((o) => giorniTra(o.data, ultima) <= 183);
  return { euro: Math.round(mediana(recenti.map((o) => o.perUnita)) * quantita * 100) / 100, dal: ultima, osservazioni: recenti.length };
}

export interface TotaleStimato {
  euro: number;
  voci: number;
  senzaPrezzo: number;
}

/** Il costo stimato delle voci, contando solo quelle con un prezzo e dicendo quante mancano. */
export function totaleStimato(voci: VoceSpesa[], prezzi: Map<string, Osservazione[]>): TotaleStimato {
  let euro = 0;
  let senza = 0;
  for (const v of voci) {
    const p = v.ingrediente_id ? stimaPrezzo(prezzi.get(v.ingrediente_id), quantitaVoce(v)) : null;
    if (p) euro += p.euro;
    else senza++;
  }
  return { euro: Math.round(euro * 100) / 100, voci: voci.length, senzaPrezzo: senza };
}

export interface RigaDaConfermare {
  id: string;
  voce_id: string | null;
  ingrediente_id: string | null;
  nome: string | null;
  quantita: number | null;
  unita: UnitaBase | null;
  prezzo: number | null;
  lotto_id: string;
  luogo: Luogo;
  data_limite?: string;
  tipo_data: 'stimata' | 'sconosciuta';
  fonte_data?: 'app';
  calcolata_il?: string;
}

/**
 * Le righe proposte per confermare ciò che è nel carrello: ogni voce diventa una riga, in casa nel
 * luogo abituale dell'ingrediente. Per lo sfuso (frutta, verdura, pane) la data è stimata e marcata;
 * per il resto resta sconosciuta: la si scrive dopo, dalla confezione.
 */
export function righeDaConfermare(
  voci: VoceSpesa[],
  ingrediente: (id: string) => Ingrediente | undefined,
  oggi: string,
  nuovoId: () => string,
  adesso = new Date(),
): RigaDaConfermare[] {
  return voci.map((v) => {
    const ing = v.ingrediente_id ? ingrediente(v.ingrediente_id) : undefined;
    const luogo: Luogo = ing?.luogo ?? 'dispensa';
    const s = ing && REPARTI_SFUSI.has(ing.reparto) ? stima(ing, luogo, oggi, adesso) : null;
    return {
      id: nuovoId(),
      voce_id: v.id,
      ingrediente_id: v.ingrediente_id,
      nome: v.ingrediente_id ? null : v.testo,
      quantita: quantitaVoce(v),
      unita: v.unita,
      prezzo: null,
      lotto_id: nuovoId(),
      luogo,
      ...(s ? { data_limite: s.data_limite, tipo_data: 'stimata' as const, fonte_data: 'app' as const, calcolata_il: s.calcolata_il } : { tipo_data: 'sconosciuta' as const }),
    };
  });
}
