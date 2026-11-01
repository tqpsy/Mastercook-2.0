/**
 * Suggerimenti automatici, in due modi:
 * - «🏠 Con ciò che ho»: solo ricette che si fanno con quello che c'è in casa, o a cui mancano al massimo
 *   due ingredienti principali (sale, olio e facoltativi non contano) e almeno uno c'è; prima quelle complete.
 * - «📖 Dal ricettario»: tutto il ricettario, prima le ⭐ preferite, quelle che piacciono e quelle che non
 *   si fanno da tempo; la casa conta solo un poco.
 * In tutti e due i modi vale di più ciò che usa un ingrediente che scade presto.
 */
import { gustiPerPiatto, type Gusto, type Persona } from './menu';
import { mancanti, type Indice, principali, type Ricetta } from './ricette';
import { giorniTra, piuGiorni } from './scadenze';

export type ModoSuggerimento = 'casa' | 'ricettario';

/** Con ciò che ho: quanti ingredienti principali possono mancare al massimo. */
export const MASSIMO_MANCANTI = 2;

/** Con ciò che ho: manca al massimo qualche ingrediente e almeno uno c'è davvero (la casa vuota non basta). */
export function bastaLaCasa(totali: number, mancano: number): boolean {
  return totali > 0 && mancano <= MASSIMO_MANCANTI && mancano < totali;
}

/** Le ricette segnate dalla famiglia. */
export interface Segni {
  preferite: Set<string>;
  perOspiti: Set<string>;
  /** Ricette della famiglia che prendono il posto della ricetta di Mastercook da cui sono tratte. */
  modificate: Set<string>;
}
export const SENZA_SEGNI: Segni = { preferite: new Set(), perOspiti: new Set(), modificate: new Set() };

/** Gli elenchi ⭐ e 💫 dalle impostazioni della famiglia (id sconosciuti o righe strane si ignorano). */
export function segniDa(impostazioni: unknown): Segni {
  const i = (impostazioni ?? {}) as Record<string, unknown>;
  const elenco = (x: unknown) => new Set(Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);
  return { preferite: elenco(i.preferite), perOspiti: elenco(i.per_ospiti), modificate: elenco(i.modificate) };
}

/** «manca la panna», «mancano panna e guanciale», «tutto in casa». */
export function testoMancanti(indice: Indice, r: Ricetta, inCasa: Set<string>): string | null {
  if (!principali(indice, r).length) return null;
  const nomi = [...new Set(mancanti(indice, r, inCasa).map((g) => indice.nome(g.ingrediente_id).toLowerCase()))];
  if (!nomi.length) return 'tutto in casa';
  if (nomi.length === 1) return `manca ${nomi[0]}`;
  return `mancano ${nomi.slice(0, -1).join(', ')} e ${nomi[nomi.length - 1]}`;
}

/** Quanti giorni dall'ultima volta che una ricetta è stata nel menu (fino a oggi), per ricetta. */
export function ultimeVolte(portate: { data: string; ricetta_id?: string | null }[], oggiData: string): Map<string, string> {
  const ultima = new Map<string, string>();
  for (const p of portate) {
    if (!p.ricetta_id || p.data > oggiData) continue;
    const prima = ultima.get(p.ricetta_id);
    if (!prima || p.data > prima) ultima.set(p.ricetta_id, p.data);
  }
  return ultima;
}

export interface ContestoSuggerimenti {
  modo: ModoSuggerimento;
  inCasa: Set<string>;
  urgenti: string[];
  segni: Segni;
  persone: Persona[];
  gusti: Gusto[];
  /** Data dell'ultima volta nel menu, per ricetta. */
  ultimaVolta: Map<string, string>;
  oggi: string;
}

export interface Suggerita {
  ricetta: Ricetta;
  punti: number;
  motivi: string[];
}

/**
 * Le ricette in ordine di suggerimento, già filtrate dal chiamante (categoria, ingrediente…).
 * Con «casa» restano solo quelle a cui manca poco; si tolgono le ricette che a qualcuno non piacciono.
 */
export function suggerisci(indice: Indice, ricette: Ricetta[], c: ContestoSuggerimenti): Suggerita[] {
  const urgenti = indice.estendi(c.urgenti.filter((id) => id !== 'ing:avanzo'));
  const esito: Suggerita[] = [];
  for (const r of ricette) {
    if (r.categoria === 'base') continue;
    const righe = principali(indice, r);
    if (!righe.length) continue;
    const manca = mancanti(indice, r, c.inCasa);
    if (c.modo === 'casa' && !bastaLaCasa(righe.length, manca.length)) continue;
    const gusti = gustiPerPiatto(indice, r, c.persone, c.gusti);
    if (gusti.some((g) => g.valore === 'non_piace')) continue;
    const motivi: string[] = [];
    let punti = 0;
    const usa = righe.filter((g) => urgenti.has(g.ingrediente_id));
    if (usa.length) {
      punti += 4 * usa.length;
      motivi.push(`usa ${[...new Set(usa.map((g) => indice.nome(g.ingrediente_id).toLowerCase()))].join(', ')} che scade presto`);
    }
    const presenti = (righe.length - manca.length) / righe.length;
    if (c.modo === 'casa') {
      punti += 10 * (MASSIMO_MANCANTI - manca.length) + 2 * presenti;
      motivi.unshift(testoMancanti(indice, r, c.inCasa)!);
    } else {
      punti += presenti;
    }
    if (c.segni.preferite.has(r.id)) {
      punti += c.modo === 'casa' ? 2 : 4;
      motivi.push('⭐ preferita');
    }
    const piace = gusti.filter((g) => g.valore === 'piace');
    if (piace.length) {
      punti += 2;
      motivi.push(`piace a ${[...new Set(piace.map((g) => g.nome))].join(', ')}`);
    }
    if (c.modo === 'ricettario') {
      const ultima = c.ultimaVolta.get(r.id);
      if (!ultima) punti += 1;
      else {
        const giorni = giorniTra(ultima, c.oggi);
        if (ultima >= piuGiorni(c.oggi, -7)) punti -= 5;
        else if (giorni >= 30) {
          punti += 2;
          if (c.segni.preferite.has(r.id) || piace.length) motivi.push(`non la fate da ${giorni} giorni`);
        }
      }
    }
    esito.push({ ricetta: r, punti, motivi });
  }
  return esito.sort((a, b) => b.punti - a.punti || a.ricetta.titolo.localeCompare(b.ricetta.titolo, 'it'));
}
