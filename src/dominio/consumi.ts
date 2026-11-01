/**
 * Consumi: cosa prevede un piatto, quali pasti sono da confermare, quanto dura un avanzo.
 * Lo scarico dalla casa lo fa il database (comando `conferma_pasto`); qui solo ciò che serve a mostrare
 * e a proporre, con lo stesso calcolo del server.
 */
import type { RegolaCotti } from '../catalogo/tipi';
import { valutaPerFamiglia, type Verifica, type Vincolo } from './compatibilita';
import { alPasto, porzioniAutomatiche, type Eccezione, type OspitiPasto, ospitiDel, type Persona, type PortataMenu } from './menu';
import { copertura, type Indice, principali, type Ricetta } from './ricette';

import { piuGiorni } from './scadenze';
import { quotaSenza } from './senza';
import type { UnitaBase } from './unita';

export type EsitoPasto = 'come_previsto' | 'quantita_diverse' | 'altro_piatto' | 'saltato';

export interface ConfermaPasto {
  id: string;
  portata_id: string;
  revisione: number;
  esito: EsitoPasto;
  ricetta_id: string | null;
  testo: string | null;
  porzioni: number | null;
  attiva: boolean;
  nota: string | null;
  foto?: string | null;
  in_attesa?: boolean;
}

export interface Consumo {
  ingrediente_id: string;
  unita: UnitaBase;
  quantita: number;
}

const chiave = (c: Pick<Consumo, 'ingrediente_id' | 'unita'>) => `${c.ingrediente_id}|${c.unita}`;
const AVANZO = 'ing:avanzo';

/** Gli ingredienti che un piatto consuma: senza «q.b.», facoltativi e ingredienti di base (sale, olio, pepe). */
export function ingredientiPiatto(indice: Indice, ricetta: Ricetta, porzioni: number): Consumo[] {
  const somme = new Map<string, Consumo>();
  if (porzioni <= 0) return [];
  for (const g of ricetta.ingredienti) {
    if (g.qb || g.opzionale || g.quantita == null || indice.ingrediente(g.ingrediente_id)?.base) continue;
    const c = somme.get(chiave(g)) ?? { ingrediente_id: g.ingrediente_id, unita: g.unita, quantita: 0 };
    c.quantita += (g.quantita * porzioni) / ricetta.porzioni;
    somme.set(chiave(g), c);
  }
  return [...somme.values()].map((c) => ({ ...c, quantita: Math.round(c.quantita * 10) / 10 }));
}

/** Le porzioni di una portata: quelle scritte, o automatiche da chi mangia (ospiti del pasto compresi). */
export function porzioniPortata(portata: PortataMenu, persone: Persona[], eccezioni: Eccezione[], ospiti: OspitiPasto[] = []): number {
  if (portata.porzioni != null) return portata.porzioni;
  const chi = alPasto(persone, [], ospitiDel(ospiti, portata.data, portata.categoria)).persone;
  return porzioniAutomatiche(chi, eccezioni.filter((e) => e.portata_id === portata.id));
}

/** Gli avanzi programmati di una portata: le portate dei giorni dopo che mangiano quello che avanza. */
export function avanziDi(portata: PortataMenu, portate: PortataMenu[]): PortataMenu[] {
  return portate.filter((p) => p.avanzo_di === portata.id).sort((a, b) => a.data.localeCompare(b.data));
}

/**
 * Il previsto di una portata: il piatto per le sue porzioni e le alternative di chi mangia altro.
 * Un piatto che dura più giorni si cucina tutto il primo giorno; il giorno dopo si mangia l'avanzo, in porzioni.
 */
export function previstoPortata(
  indice: Indice,
  portata: PortataMenu,
  persone: Persona[],
  eccezioni: Eccezione[],
  portate: PortataMenu[] = [],
  ospiti: OspitiPasto[] = [],
): Consumo[] {
  const sue = eccezioni.filter((e) => e.portata_id === portata.id);
  if (portata.avanzo_di) {
    const n = porzioniPortata(portata, persone, eccezioni, ospiti);
    return n > 0 ? [{ ingrediente_id: AVANZO, unita: 'pz', quantita: n }] : [];
  }
  const piatti: [Ricetta | undefined, number, ((c: Consumo) => number) | null][] = [];
  const dopo = avanziDi(portata, portate).reduce((t, a) => t + porzioniPortata(a, persone, eccezioni, ospiti), 0);
  if (portata.ricetta_id) {
    // Un ingrediente tolto a qualcuno: si compra e si scala solo per chi lo mangia (per tutti tolto: niente).
    const porzioni = porzioniPortata(portata, persone, eccezioni, ospiti);
    const fuori = new Set(sue.map((e) => e.membro_id));
    const quota = portata.senza?.length ? (c: Consumo) => quotaSenza(portata.senza, c.ingrediente_id, persone, fuori, porzioni) : null;
    piatti.push([indice.perId.get(portata.ricetta_id), porzioni + dopo, quota]);
  }
  for (const e of sue) {
    const p = persone.find((x) => x.id === e.membro_id);
    if (e.tipo === 'alternativa' && e.ricetta_id && p) piatti.push([indice.perId.get(e.ricetta_id), e.porzioni ?? p.porzione, null]);
  }
  const somme = new Map<string, Consumo>();
  for (const [r, porzioni, quota] of piatti) {
    if (!r) continue;
    for (const tutto of ingredientiPiatto(indice, r, porzioni)) {
      const c = quota ? { ...tutto, quantita: Math.round(tutto.quantita * quota(tutto) * 10) / 10 } : tutto;
      if (c.quantita <= 0) continue;
      const prima = somme.get(chiave(c));
      somme.set(chiave(c), prima ? { ...prima, quantita: Math.round((prima.quantita + c.quantita) * 10) / 10 } : c);
    }
  }
  return [...somme.values()].sort((a, b) => indice.nome(a.ingrediente_id).localeCompare(indice.nome(b.ingrediente_id), 'it'));
}

/** La conferma attiva di ogni portata. */
export function confermeAttive(conferme: ConfermaPasto[]): Map<string, ConfermaPasto> {
  return new Map(conferme.filter((c) => c.attiva).map((c) => [c.portata_id, c]));
}

/** I pasti da confermare: quelli fino a oggi (al più `giorni` indietro) senza una conferma. */
export function daConfermare(portate: PortataMenu[], attive: Map<string, ConfermaPasto>, oggi: string, giorni = 3): PortataMenu[] {
  const dal = piuGiorni(oggi, -giorni);
  return portate.filter((p) => p.data >= dal && p.data <= oggi && !attive.has(p.id)).sort((a, b) => a.data.localeCompare(b.data));
}

/**
 * Quanti giorni dura in frigo l'avanzo di una ricetta, secondo la regola dei cotti (giorni consigliati).
 * Senza regola non si stima: la data resta sconosciuta (R-SCA-4). In freezer non si stima.
 */
export function giorniAvanzo(ricetta: Pick<Ricetta, 'conservazione'> | null | undefined, regole: RegolaCotti[]): number | null {
  const r = ricetta?.conservazione ? regole.find((x) => x.id === ricetta.conservazione) : undefined;
  return r ? r.consigliati : null;
}

export const NOME_ESITO: Record<EsitoPasto, string> = {
  come_previsto: 'Mangiato come previsto',
  quantita_diverse: 'Mangiato, quantità diverse',
  altro_piatto: 'Mangiato altro',
  saltato: 'Saltato',
};

export interface RicettaPerUrgenti {
  ricetta: Ricetta;
  /** Gli ingredienti da usare presto che la ricetta usa. */
  usa: string[];
  presenti: number;
  totali: number;
}

/**
 * Ricette che usano ciò che scade presto (R-SCA-5): prima chi ne usa di più, poi chi ha più ingredienti
 * già in casa. Quelle non adatte a qualcuno della famiglia non si propongono.
 */
export function ricettePerUrgenti(
  indice: Indice,
  urgenti: string[],
  inCasa: string[],
  membri: { id: string; nome: string }[],
  vincoli: Vincolo[],
  limite = 3,
  verifiche?: Verifica[],
): RicettaPerUrgenti[] {
  const daUsare = indice.estendi(urgenti.filter((id) => id !== AVANZO));
  if (!daUsare.size) return [];
  const casa = new Set(inCasa);
  const trovate: RicettaPerUrgenti[] = [];
  for (const r of indice.ricette) {
    if (r.archiviata) continue;
    const usa = [...new Set(principali(indice, r).map((g) => g.ingrediente_id).filter((id) => daUsare.has(id)))];
    if (!usa.length) continue;
    if (valutaPerFamiglia(indice, r, membri, vincoli, verifiche).esito === 'non_adatta') continue;
    trovate.push({ ricetta: r, usa, ...copertura(indice, r, casa) });
  }
  return trovate
    .sort(
      (a, b) =>
        b.usa.length - a.usa.length ||
        b.presenti / Math.max(1, b.totali) - a.presenti / Math.max(1, a.totali) ||
        a.ricetta.titolo.localeCompare(b.ricetta.titolo, 'it'),
    )
    .slice(0, limite);
}
