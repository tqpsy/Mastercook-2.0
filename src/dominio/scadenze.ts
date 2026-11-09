/**
 * Date dei lotti: tipo di data, stime e cosa usare presto.
 *
 * Regole di stima (INDICATIVE, DA VALIDARE con un professionista, come deciso in Fase 0, D8):
 * - si stima solo un alimento sfuso o fresco senza data sulla confezione, e solo se il catalogo ha
 *   una durata per quell'ingrediente; un prodotto confezionato senza data resta «sconosciuta»;
 * - nel luogo abituale vale la durata del catalogo (dal vecchio Mastercook);
 * - un alimento da frigo tenuto fuori frigo: 1 giorno; uno da freezer fuori dal freezer: 1 giorno
 *   (scongelato); uno da dispensa messo in frigo: stessa durata;
 * - carne, pesce e piatti cucinati hanno una tabella propria (DURATE_FRESCHI, da USDA/FoodSafety.gov,
 *   sempre il valore più prudente): in frigo il più breve fra catalogo e tabella, in freezer i mesi della tabella;
 * - in freezer un altro alimento fresco non ha una regola: data sconosciuta, da inserire.
 * Una stima è sempre marcata come tale, con la data del calcolo, e si può cambiare.
 * L'app non dice mai che un alimento è sicuro oltre la data.
 */
import type { Ingrediente } from './ricette';

export type Luogo = 'frigo' | 'freezer' | 'dispensa';
export type TipoData = 'scadenza' | 'tmc' | 'stimata' | 'sconosciuta';

export interface Stima {
  data_limite: string;
  tipo_data: 'stimata';
  fonte_data: 'app';
  calcolata_il: string;
  /** Giorni usati, per spiegare la stima. */
  giorni: number;
}

/** I reparti che di solito si comprano sfusi: per questi la stima è proposta senza chiedere. */
export const REPARTI_SFUSI = new Set(['frutta_verdura', 'pane_forno']);

export type TipoFresco = 'carne_pezzi' | 'carne_macinata' | 'pollame' | 'pesce_magro' | 'pesce_grasso' | 'frutti_di_mare' | 'cucinato';

export interface DurataFresco {
  nome: string;
  /** Giorni al massimo in frigo (0–4 °C). */
  frigo: number;
  /** Giorni al massimo in freezer (−18 °C): oltre resta sicuro ma perde qualità. */
  freezer: number;
}

/**
 * Durate di carne, pesce e piatti cucinati (USDA/FoodSafety.gov «Cold food storage chart»),
 * sempre il valore più prudente dell'intervallo.
 */
export const DURATE_FRESCHI: Record<TipoFresco, DurataFresco> = {
  carne_pezzi: { nome: 'Carne cruda a pezzi', frigo: 3, freezer: 180 },
  carne_macinata: { nome: 'Carne macinata, salsicce e frattaglie', frigo: 1, freezer: 90 },
  pollame: { nome: 'Pollo e tacchino crudi', frigo: 1, freezer: 270 },
  pesce_magro: { nome: 'Pesce magro crudo', frigo: 1, freezer: 180 },
  pesce_grasso: { nome: 'Pesce grasso crudo', frigo: 1, freezer: 90 },
  frutti_di_mare: { nome: 'Molluschi e crostacei crudi', frigo: 1, freezer: 90 },
  cucinato: { nome: 'Piatti cucinati e avanzi', frigo: 3, freezer: 90 },
};

const MACINATI = new Set(['ing:carne_macinata', 'ing:hamburger', 'ing:macinato_pollo', 'ing:salsiccia', 'ing:fegato']);
const PESCI_GRASSI = new Set(['ing:salmone', 'ing:tonno_fresco', 'ing:trota', 'ing:sgombro', 'ing:acciughe', 'ing:sardine', 'ing:aguglia']);

/** Che tipo di carne, pesce o piatto cucinato è, oppure `null` (affettati, affumicati, surgelati, tutto il resto). */
export function tipoFresco(ing: Pick<Ingrediente, 'id' | 'reparto' | 'sottocategoria'>): TipoFresco | null {
  if (ing.id === 'ing:avanzo') return 'cucinato';
  if (MACINATI.has(ing.id)) return 'carne_macinata';
  if (PESCI_GRASSI.has(ing.id)) return 'pesce_grasso';
  if (ing.reparto === 'carne') return ing.sottocategoria === 'Pollo e tacchino' ? 'pollame' : 'carne_pezzi';
  if (ing.reparto === 'pesce') {
    if (ing.sottocategoria === 'Pesce fresco') return 'pesce_magro';
    if (ing.sottocategoria === 'Pesce azzurro') return 'pesce_grasso';
    if (ing.sottocategoria === 'Molluschi' || ing.sottocategoria === 'Crostacei' || ing.sottocategoria === 'Polpi, calamari e seppie') return 'frutti_di_mare';
  }
  return null;
}

/** Fresco o sfuso, senza una data sulla confezione: frutta, verdura, pane, carne e pesce del banco, avanzi. */
export function eFresco(ing: Pick<Ingrediente, 'id' | 'reparto' | 'sottocategoria'>): boolean {
  return REPARTI_SFUSI.has(ing.reparto) || tipoFresco(ing) !== null;
}

type PerStima = Pick<Ingrediente, 'luogo' | 'giorni'> & Partial<Pick<Ingrediente, 'id' | 'reparto' | 'sottocategoria'>>;

export function giorniStimati(ing: PerStima, luogo: Luogo): number | null {
  const tipo = ing.id && ing.reparto ? tipoFresco({ id: ing.id, reparto: ing.reparto, sottocategoria: ing.sottocategoria }) : null;
  if (tipo && ing.luogo === 'frigo') {
    const d = DURATE_FRESCHI[tipo];
    if (luogo === 'frigo') return Math.min(d.frigo, ing.giorni ?? d.frigo);
    if (luogo === 'freezer') return d.freezer;
  }
  if (!ing.giorni) return null;
  if (luogo === ing.luogo) return ing.giorni;
  if (ing.luogo === 'frigo' && luogo === 'dispensa') return 1;
  if (ing.luogo === 'freezer') return 1;
  if (ing.luogo === 'dispensa' && luogo === 'frigo') return ing.giorni;
  return null;
}

/** Aggiunge giorni a una data «AAAA-MM-GG» senza passare dai fusi orari. */
export function piuGiorni(data: string, giorni: number): string {
  const [a, m, g] = data.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, g + giorni));
  return d.toISOString().slice(0, 10);
}

/** Oggi come «AAAA-MM-GG» nel fuso del dispositivo. */
export function oggi(adesso = new Date()): string {
  const d = new Date(adesso.getTime() - adesso.getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 10);
}

/** «1 giorno», «3 giorni», «3 mesi»: oltre i 60 giorni si conta in mesi. */
export function descriviDurata(giorni: number): string {
  if (giorni > 60) return `${Math.round(giorni / 30)} mesi`;
  return `${giorni} ${giorni === 1 ? 'giorno' : 'giorni'}`;
}

export function giorniTra(da: string, a: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${da}T00:00:00Z`)) / 86_400_000);
}

/** La stima per un alimento sfuso, oppure `null` se non c'è una regola: la data resta sconosciuta. */
export function stima(ing: PerStima, luogo: Luogo, dal: string, adesso = new Date()): Stima | null {
  const giorni = giorniStimati(ing, luogo);
  if (giorni === null) return null;
  return { data_limite: piuGiorni(dal, giorni), tipo_data: 'stimata', fonte_data: 'app', calcolata_il: adesso.toISOString(), giorni };
}

export type StatoData = 'scaduto' | 'oltre_tmc' | 'oggi' | 'presto' | 'ok' | 'sconosciuta';

export interface LottoData {
  data_limite: string | null;
  tipo_data: TipoData;
}

/** Quanti giorni mancano prima di considerarlo «da usare presto». */
export const GIORNI_PRESTO = 3;

export function statoData(l: LottoData, oggiData: string): StatoData {
  if (l.tipo_data === 'sconosciuta' || !l.data_limite) return 'sconosciuta';
  const mancano = giorniTra(oggiData, l.data_limite);
  if (mancano < 0) return l.tipo_data === 'tmc' ? 'oltre_tmc' : 'scaduto';
  if (mancano === 0) return 'oggi';
  if (mancano <= GIORNI_PRESTO) return 'presto';
  return 'ok';
}

/**
 * Scadenza vera (non «preferibilmente entro», non una stima) già passata: il lotto non conta più come disponibile
 * per la spesa, per lo scarico e per le ricette finché non lo si scarica. Come `interno.lotto_scaduto` nel database.
 */
export function scadutoVero(l: LottoData, oggiData: string): boolean {
  return l.tipo_data === 'scadenza' && !!l.data_limite && l.data_limite < oggiData;
}

/** Testo breve per l'etichetta della data. */
export function descriviData(l: LottoData, oggiData: string): string {
  const s = statoData(l, oggiData);
  if (s === 'sconosciuta') return 'Data sconosciuta';
  const mancano = giorniTra(oggiData, l.data_limite!);
  const stimata = l.tipo_data === 'stimata' ? ' (stima)' : '';
  switch (s) {
    case 'scaduto':
      return `Scaduto da ${-mancano} ${-mancano === 1 ? 'giorno' : 'giorni'}${stimata}`;
    case 'oltre_tmc':
      return `Oltre il «preferibilmente entro» da ${-mancano} ${-mancano === 1 ? 'giorno' : 'giorni'}`;
    case 'oggi':
      return l.tipo_data === 'tmc' ? 'Preferibilmente entro oggi' : `Da usare oggi${stimata}`;
    default:
      return `${l.tipo_data === 'tmc' ? 'Preferibilmente entro' : 'Entro'} ${mancano} ${mancano === 1 ? 'giorno' : 'giorni'}${stimata}`;
  }
}

const PRIORITA: Record<StatoData, number> = { scaduto: 0, oggi: 1, presto: 2, oltre_tmc: 3, sconosciuta: 4, ok: 5 };

/**
 * «Da usare presto»: scaduti secondo la data registrata, poi in scadenza oggi, poi nei prossimi giorni,
 * poi oltre il TMC, poi quelli senza data verificata (stimata o sconosciuta) che vanno controllati.
 * A parità, prima la data più vicina; le stime dopo le date della confezione.
 */
export function daUsarePresto<T extends LottoData & { chiuso_il?: unknown }>(lotti: T[], oggiData: string): T[] {
  return lotti
    .filter((l) => !l.chiuso_il)
    .map((l) => ({ l, s: statoData(l, oggiData) }))
    .filter(({ l, s }) => s !== 'ok' || l.tipo_data === 'stimata')
    .sort(
      (a, b) =>
        PRIORITA[a.s] - PRIORITA[b.s] ||
        (a.l.data_limite ?? '9999').localeCompare(b.l.data_limite ?? '9999') ||
        Number(a.l.tipo_data === 'stimata') - Number(b.l.tipo_data === 'stimata'),
    )
    .map(({ l }) => l);
}

export interface Movimento {
  lotto_id: string;
  variazione: number;
  causale: string;
  creato_il: string;
}

export interface VoceSpreco {
  ingrediente_id: string;
  unita: string;
  quantita: number;
  volte: number;
}

/** Quanto è stato buttato (spreco o scaduto) dal giorno indicato, per ingrediente e unità. */
export function spreco(movimenti: Movimento[], lotti: Map<string, { ingrediente_id: string; unita: string }>, dal: string): VoceSpreco[] {
  const voci = new Map<string, VoceSpreco>();
  for (const m of movimenti) {
    if (m.causale !== 'spreco' && m.causale !== 'scaduto') continue;
    if (m.creato_il.slice(0, 10) < dal) continue;
    const l = lotti.get(m.lotto_id);
    if (!l) continue;
    const k = `${l.ingrediente_id}|${l.unita}`;
    const v = voci.get(k) ?? { ingrediente_id: l.ingrediente_id, unita: l.unita, quantita: 0, volte: 0 };
    v.quantita += -m.variazione;
    v.volte += 1;
    voci.set(k, v);
  }
  return [...voci.values()].sort((a, b) => b.volte - a.volte || b.quantita - a.quantita);
}
