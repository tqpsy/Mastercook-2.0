/**
 * Pianificazione automatica (Fase 6): l'app propone, la famiglia decide. Nessuna proposta entra nel menu
 * senza conferma e nessuna viola un vincolo: si propongono solo ricette «adatte» a tutti quelli che
 * mangiano a casa (anche grazie al «va bene» della famiglia) e senza ingredienti che a qualcuno non piacciono.
 *
 * Il punteggio preferisce, in quest'ordine: ciò che scade presto, ciò che è già in casa, i piatti che
 * piacciono, la varietà (niente stesso piatto in due settimane, niente pasta a pranzo e a cena).
 */
import { valutaPerFamiglia, type Verifica, type Vincolo } from './compatibilita';
import { gustiPerPiatto, type Gusto, type Persona } from './menu';
import type { Categoria } from '../catalogo/tipi';
import { haPrincipale, type Principale, usaIngrediente } from './principale';
import { copertura, type Indice, mancanti, principali, type Ricetta } from './ricette';
import { bastaLaCasa, MASSIMO_MANCANTI, type ModoSuggerimento, type Segni, testoMancanti } from './suggerimenti';

/** Le categorie di ricetta adatte a ogni pasto. Gli altri pasti (spuntino…) non si propongono. */
export const RICETTE_PER_PASTO: Record<string, Ricetta['categoria'][]> = {
  colazione: ['colazione'],
  pranzo: ['primo', 'piatto_unico', 'secondo'],
  cena: ['secondo', 'piatto_unico', 'primo'],
  merenda: ['dolce'],
};

/** Il tipo di piatto, per non ripetere la stessa cosa nello stesso giorno. */
export function tipoPiatto(indice: Indice, r: Ricetta): string {
  const righe = principali(indice, r);
  const classi = new Set(righe.flatMap((g) => indice.ingrediente(g.ingrediente_id)?.classi ?? []));
  const radici = new Set(righe.flatMap((g) => indice.antenati(g.ingrediente_id)));
  if (classi.has('pesce')) return 'pesce';
  if (classi.has('carne')) return 'carne';
  if (radici.has('ing:pasta')) return 'pasta';
  if (radici.has('ing:riso')) return 'riso';
  if (radici.has('ing:uova')) return 'uova';
  return 'verdure';
}

export interface ContestoProposte {
  persone: Persona[];
  vincoli: Vincolo[];
  verifiche?: Verifica[];
  gusti: Gusto[];
  /** Ingredienti in casa e quelli che scadono presto. */
  inCasa: string[];
  urgenti: string[];
  /** Ricette già in menu nei giorni vicini (prima e dopo), per non ripeterle. */
  recenti: string[];
  /** Le ricette ⭐ preferite e 💫 da ospiti della famiglia. */
  segni?: Segni;
  /** Al pasto ci sono ospiti: le ricette 💫 valgono di più. */
  conOspiti?: boolean;
}

export interface Candidata {
  ricetta: Ricetta;
  punti: number;
  motivi: string[];
  tipo: string;
}

/** Filtri scelti a mano: una categoria di ricetta (al posto di quelle del pasto) e l'ingrediente principale. */
export interface FiltroProposte {
  categoria?: Categoria | null;
  principale?: Principale | null;
  /** Un ingrediente preciso che la ricetta deve usare (zucchine, ceci…). */
  ingrediente?: string | null;
  /** Solo le ⭐ preferite o solo le 💫 da ospiti. */
  segno?: 'preferita' | 'ospiti' | null;
  /**
   * Come suggerire: «casa» solo ricette a cui manca al massimo qualche ingrediente (prima le complete),
   * «ricettario» tutto il ricettario (la casa conta poco). Senza: l'equilibrio di «Proponi la settimana».
   */
  modo?: ModoSuggerimento | null;
}

/** Le ricette proponibili per un pasto, dalla migliore. Solo ricette adatte a tutti e senza «non mi piace». */
export function candidate(indice: Indice, pasto: string, c: ContestoProposte, filtro: FiltroProposte = {}): Candidata[] {
  const categorie = filtro.categoria ? [filtro.categoria] : RICETTE_PER_PASTO[pasto];
  if (!categorie) return [];
  const casa = new Set(c.inCasa);
  const urgenti = indice.estendi(c.urgenti.filter((id) => id !== 'ing:avanzo'));
  const recenti = new Map<string, number>();
  for (const id of c.recenti) recenti.set(id, (recenti.get(id) ?? 0) + 1);
  const esito: Candidata[] = [];
  for (const r of indice.ricette) {
    if (r.archiviata || !categorie.includes(r.categoria)) continue;
    if (!haPrincipale(indice, r, filtro.principale) || !usaIngrediente(indice, r, filtro.ingrediente)) continue;
    const preferita = !!c.segni?.preferite.has(r.id);
    const daOspiti = !!c.segni?.perOspiti.has(r.id);
    if ((filtro.segno === 'preferita' && !preferita) || (filtro.segno === 'ospiti' && !daOspiti)) continue;
    if (filtro.modo === 'casa' && !bastaLaCasa(principali(indice, r).length, mancanti(indice, r, casa).length)) continue;
    if (valutaPerFamiglia(indice, r, c.persone, c.vincoli, c.verifiche).esito !== 'adatta') continue;
    const gusti = gustiPerPiatto(indice, r, c.persone, c.gusti);
    if (gusti.some((g) => g.valore === 'non_piace')) continue;
    const motivi: string[] = [];
    let punti = 0;
    const usa = principali(indice, r).filter((g) => urgenti.has(g.ingrediente_id));
    if (usa.length) {
      punti += 5 * usa.length;
      motivi.push(`usa ${[...new Set(usa.map((g) => indice.nome(g.ingrediente_id).toLowerCase()))].join(', ')} che scade presto`);
    }
    const { presenti, totali } = copertura(indice, r, casa);
    if (totali && filtro.modo === 'casa') {
      punti += 10 * (MASSIMO_MANCANTI - (totali - presenti)) + (2 * presenti) / totali;
      motivi.unshift(testoMancanti(indice, r, casa)!);
    } else if (totali && filtro.modo === 'ricettario') {
      punti += presenti / totali;
    } else if (totali) {
      punti += (3 * presenti) / totali;
      if (presenti === totali) motivi.push('tutto in casa');
      else if (presenti) motivi.push(`${presenti} su ${totali} ingredienti in casa`);
    }
    if (preferita) {
      punti += filtro.modo === 'ricettario' ? 3 : 2;
      motivi.push('⭐ preferita');
    }
    if (daOspiti && c.conOspiti) {
      punti += 3;
      motivi.push('💫 da ospiti');
    }
    const piace = gusti.filter((g) => g.valore === 'piace');
    if (piace.length) {
      punti += 2;
      motivi.push(`piace a ${[...new Set(piace.map((g) => g.nome))].join(', ')}`);
    }
    // Il tipo di ricetta più adatto al pasto (a pranzo un primo, a cena un secondo) vale un po' di più.
    punti += (categorie.length - categorie.indexOf(r.categoria)) * 0.3;
    punti -= 4 * (recenti.get(r.id) ?? 0);
    esito.push({ ricetta: r, punti, motivi, tipo: tipoPiatto(indice, r) });
  }
  return esito.sort((a, b) => b.punti - a.punti || a.ricetta.titolo.localeCompare(b.ricetta.titolo, 'it'));
}

export interface Proposta {
  data: string;
  categoria: string;
  ricetta: Ricetta;
  motivi: string[];
  /** Le altre candidate per lo stesso pasto, per cambiarla con un tocco. */
  altre: Ricetta[];
}

/**
 * Propone un piatto per ogni pasto vuoto. `posti` sono i pasti da riempire, in ordine di giorno;
 * `tipiDelGiorno` dice cosa c'è già in ogni giorno (per non fare pasta due volte).
 * `scarta` (ricetta per pasto) serve a chiedere «un'altra»: quella ricetta non si ripropone lì.
 */
export function proponi(
  indice: Indice,
  posti: { data: string; categoria: string }[],
  c: ContestoProposte,
  tipiDelGiorno: Map<string, string[]> = new Map(),
  scarta: Map<string, string[]> = new Map(),
): Proposta[] {
  const perPasto = new Map<string, Candidata[]>();
  const usate = new Set<string>();
  const tipi = new Map([...tipiDelGiorno].map(([k, v]) => [k, [...v]]));
  const proposte: Proposta[] = [];
  for (const posto of posti) {
    if (!perPasto.has(posto.categoria)) perPasto.set(posto.categoria, candidate(indice, posto.categoria, c));
    const tutte = perPasto.get(posto.categoria)!;
    const no = new Set(scarta.get(`${posto.data}|${posto.categoria}`) ?? []);
    const giorno = tipi.get(posto.data) ?? [];
    const libere = tutte.filter((x) => !usate.has(x.ricetta.id) && !no.has(x.ricetta.id));
    const scelta = libere.find((x) => !giorno.includes(x.tipo)) ?? libere[0];
    if (!scelta) continue;
    usate.add(scelta.ricetta.id);
    tipi.set(posto.data, [...giorno, scelta.tipo]);
    proposte.push({
      ...posto,
      ricetta: scelta.ricetta,
      motivi: scelta.motivi,
      altre: libere.filter((x) => x !== scelta).slice(0, 5).map((x) => x.ricetta),
    });
  }
  return proposte;
}
