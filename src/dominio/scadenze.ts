/**
 * Date dei lotti: tipo di data, stime e cosa usare presto.
 *
 * Regole di stima (INDICATIVE, DA VALIDARE con un professionista, come deciso in Fase 0, D8):
 * - si stima solo un alimento sfuso o fresco senza data sulla confezione, e solo se il catalogo ha
 *   una durata per quell'ingrediente; un prodotto confezionato senza data resta «sconosciuta»;
 * - nel luogo abituale vale la durata del catalogo (dal vecchio Mastercook);
 * - un alimento da frigo tenuto fuori frigo: 1 giorno; uno da freezer fuori dal freezer: 1 giorno
 *   (scongelato); uno da dispensa messo in frigo: stessa durata;
 * - in freezer un alimento fresco non ha una regola: data sconosciuta, da inserire.
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

export function giorniStimati(ing: Pick<Ingrediente, 'luogo' | 'giorni'>, luogo: Luogo): number | null {
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

export function giorniTra(da: string, a: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${da}T00:00:00Z`)) / 86_400_000);
}

/** La stima per un alimento sfuso, oppure `null` se non c'è una regola: la data resta sconosciuta. */
export function stima(ing: Pick<Ingrediente, 'luogo' | 'giorni'>, luogo: Luogo, dal: string, adesso = new Date()): Stima | null {
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
