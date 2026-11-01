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
import { type Rimedio, rimedio, testoRimedio } from './senza';
import { bastaLaCasa, MASSIMO_MANCANTI, type ModoSuggerimento, type Segni, testoMancanti } from './suggerimenti';
import { type Gruppo, gruppiDi, type MemoriaAntonino, PESI_BASE, pesoMemoria, type RegoleAntonino, spintaEquilibrio } from './antonino';

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
  /** Le regole di Antonino (pesi e obiettivi della settimana). Senza: i pesi di base e nessun obiettivo. */
  regole?: RegoleAntonino;
  /** Cosa Antonino ricorda di questa famiglia (scarti, scelte, «non proporla più»). */
  memoria?: MemoriaAntonino;
  /** Oggi, per pesare meno i ricordi vecchi. */
  oggi?: string;
}

export interface Candidata {
  ricetta: Ricetta;
  punti: number;
  motivi: string[];
  tipo: string;
  /** La ricetta è ⛔ per qualcuno ma va bene togliendo un ingrediente: cosa togliere e per chi. */
  rimedio?: Rimedio;
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
  /**
   * Anche le ricette ⛔ che vanno bene togliendo un ingrediente (la panna a chi non tollera il lattosio), dopo le
   * altre. Solo per «Antonino consiglia» di un pasto: lì si sceglie per chi toglierlo.
   */
  conRimedi?: boolean;
}

/**
 * Quanto pesa dover togliere un ingrediente: una ricetta così viene dopo quelle che vanno bene come sono e con
 * le stesse cose in casa, ma prima di una a cui manca un ingrediente in più («con ciò che ho» vale 10 a ingrediente).
 */
const PENALITA_RIMEDIO = 5;

/** Le ricette proponibili per un pasto, dalla migliore. Solo ricette adatte a tutti e senza «non mi piace». */
export function candidate(indice: Indice, pasto: string, c: ContestoProposte, filtro: FiltroProposte = {}): Candidata[] {
  const categorie = filtro.categoria ? [filtro.categoria] : RICETTE_PER_PASTO[pasto];
  if (!categorie) return [];
  const casa = new Set(c.inCasa);
  const urgenti = indice.estendi(c.urgenti.filter((id) => id !== 'ing:avanzo'));
  const recenti = new Map<string, number>();
  for (const id of c.recenti) recenti.set(id, (recenti.get(id) ?? 0) + 1);
  const pesi = c.regole?.pesi ?? PESI_BASE;
  const esito: Candidata[] = [];
  for (const r of indice.ricette) {
    if (r.archiviata || !categorie.includes(r.categoria)) continue;
    if (c.memoria?.maiPiu.has(r.id)) continue;
    if (!haPrincipale(indice, r, filtro.principale) || !usaIngrediente(indice, r, filtro.ingrediente)) continue;
    const preferita = !!c.segni?.preferite.has(r.id);
    const daOspiti = !!c.segni?.perOspiti.has(r.id);
    if ((filtro.segno === 'preferita' && !preferita) || (filtro.segno === 'ospiti' && !daOspiti)) continue;
    if (filtro.modo === 'casa' && !bastaLaCasa(principali(indice, r).length, mancanti(indice, r, casa).length)) continue;
    let rimedia: Rimedio | undefined;
    if (valutaPerFamiglia(indice, r, c.persone, c.vincoli, c.verifiche).esito !== 'adatta') {
      const x = filtro.conRimedi ? rimedio(indice, r, c.persone, c.vincoli, c.verifiche) : null;
      if (!x?.adattaDopo) continue;
      rimedia = x;
    }
    const gusti = gustiPerPiatto(indice, r, c.persone, c.gusti);
    if (gusti.some((g) => g.valore === 'non_piace')) continue;
    const motivi: string[] = [];
    // Prima le ricette che vanno bene così come sono.
    let punti = rimedia ? -PENALITA_RIMEDIO : 0;
    const usa = principali(indice, r).filter((g) => urgenti.has(g.ingrediente_id));
    if (usa.length) {
      punti += pesi.scade * usa.length;
      motivi.push(`usa ${[...new Set(usa.map((g) => indice.nome(g.ingrediente_id).toLowerCase()))].join(', ')} che scade presto`);
    }
    const { presenti, totali } = copertura(indice, r, casa);
    if (totali && filtro.modo === 'casa') {
      punti += 10 * (MASSIMO_MANCANTI - (totali - presenti)) + (2 * presenti) / totali;
      motivi.unshift(testoMancanti(indice, r, casa)!);
    } else if (totali && filtro.modo === 'ricettario') {
      punti += presenti / totali;
    } else if (totali) {
      punti += (pesi.casa * presenti) / totali;
      if (presenti === totali) motivi.push('tutto in casa');
      else if (presenti) motivi.push(`${presenti} su ${totali} ingredienti in casa`);
    }
    if (preferita) {
      punti += pesi.preferita + (filtro.modo === 'ricettario' ? 1 : 0);
      motivi.push('⭐ preferita');
    }
    if (daOspiti && c.conOspiti) {
      punti += pesi.ospiti;
      motivi.push('💫 da ospiti');
    }
    const piace = gusti.filter((g) => g.valore === 'piace');
    if (piace.length) {
      punti += pesi.piace;
      motivi.push(`piace a ${[...new Set(piace.map((g) => g.nome))].join(', ')}`);
    }
    // Il tipo di ricetta più adatto al pasto (a pranzo un primo, a cena un secondo) vale un po' di più.
    punti += (categorie.length - categorie.indexOf(r.categoria)) * 0.3;
    punti -= pesi.ripetuta * (recenti.get(r.id) ?? 0);
    if (c.memoria && c.oggi) {
      const m = pesoMemoria(c.memoria, r.id, pesi, c.oggi);
      punti += m.punti;
      if (m.motivo) motivi.push(m.motivo);
    }
    if (rimedia) motivi.push(`✂️ ${testoRimedio(indice, rimedia).replace(/^Si/, 'si')}`);
    esito.push({ ricetta: r, punti, motivi, tipo: tipoPiatto(indice, r), ...(rimedia ? { rimedio: rimedia } : {}) });
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

/** Per l'equilibrio della settimana: i piatti già nel menu (pranzi e cene) e i giorni da contare. */
export interface Settimana {
  piatti: { data: string; ricetta: Ricetta }[];
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
  settimana?: Settimana,
): Proposta[] {
  const perPasto = new Map<string, Candidata[]>();
  const usate = new Set<string>();
  const tipi = new Map([...tipiDelGiorno].map(([k, v]) => [k, [...v]]));
  const proposte: Proposta[] = [];
  // Con le regole di Antonino si guarda anche l'equilibrio: cosa c'è già nella settimana, gruppo per gruppo.
  const regole = c.regole;
  const gruppi = new Map<string, Set<Gruppo>>();
  const gruppiDiRicetta = (r: Ricetta) => {
    if (!gruppi.has(r.id)) gruppi.set(r.id, gruppiDi(indice, r));
    return gruppi.get(r.id)!;
  };
  const conta = new Map<Gruppo, number>();
  const conVerdure = new Set<string>();
  const conta1 = (data: string, r: Ricetta) => {
    const g = gruppiDiRicetta(r);
    for (const x of g) conta.set(x, (conta.get(x) ?? 0) + 1);
    if (g.has('verdure')) conVerdure.add(data);
  };
  if (regole) for (const p of settimana?.piatti ?? []) conta1(p.data, p.ricetta);
  posti.forEach((posto, k) => {
    if (!perPasto.has(posto.categoria)) perPasto.set(posto.categoria, candidate(indice, posto.categoria, c));
    const tutte = perPasto.get(posto.categoria)!;
    const no = new Set(scarta.get(`${posto.data}|${posto.categoria}`) ?? []);
    const giorno = tipi.get(posto.data) ?? [];
    const libere = tutte.filter((x) => !usate.has(x.ricetta.id) && !no.has(x.ricetta.id));
    let ordinate: { x: Candidata; motivo?: string }[];
    if (regole && libere.length) {
      // Ultimo pasto del giorno ancora senza verdure: si spinge per metterle.
      const ultimoDelGiorno = !posti.slice(k + 1).some((p) => p.data === posto.data);
      const senzaVerdure = regole.verdureOgniGiorno && ultimoDelGiorno && !conVerdure.has(posto.data);
      const restanti = posti.length - k;
      ordinate = libere
        .map((x) => {
          const s = spintaEquilibrio(gruppiDiRicetta(x.ricetta), conta, regole, restanti, senzaVerdure);
          return { x, motivo: s.motivo, punti: x.punti + s.punti - (giorno.includes(x.tipo) ? 50 : 0) };
        })
        .sort((a, b) => b.punti - a.punti);
    } else {
      const prima = libere.find((x) => !giorno.includes(x.tipo)) ?? libere[0];
      ordinate = prima ? [{ x: prima }, ...libere.filter((x) => x !== prima).map((x) => ({ x }))] : [];
    }
    const scelta = ordinate[0];
    if (!scelta) return;
    usate.add(scelta.x.ricetta.id);
    tipi.set(posto.data, [...giorno, scelta.x.tipo]);
    if (regole) conta1(posto.data, scelta.x.ricetta);
    proposte.push({
      ...posto,
      ricetta: scelta.x.ricetta,
      motivi: scelta.motivo ? [...scelta.x.motivi, scelta.motivo] : scelta.x.motivi,
      altre: ordinate.slice(1, 6).map((o) => o.x.ricetta),
    });
  });
  return proposte;
}
