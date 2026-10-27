/**
 * Consumi: cosa prevede un piatto, quali pasti sono da confermare, quanto dura un avanzo.
 * Lo scarico dalla casa lo fa il database (comando `conferma_pasto`); qui solo ciò che serve a mostrare
 * e a proporre, con lo stesso calcolo del server.
 */
import type { RegolaCotti } from '../catalogo/tipi';
import { porzioniAutomatiche, type Eccezione, type Persona, type PortataMenu } from './menu';
import type { Indice, Ricetta } from './ricette';
import { piuGiorni } from './scadenze';
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
  in_attesa?: boolean;
}

export interface Consumo {
  ingrediente_id: string;
  unita: UnitaBase;
  quantita: number;
}

const chiave = (c: Pick<Consumo, 'ingrediente_id' | 'unita'>) => `${c.ingrediente_id}|${c.unita}`;

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

/** Il previsto di una portata: il piatto per le sue porzioni e le alternative di chi mangia altro. */
export function previstoPortata(indice: Indice, portata: PortataMenu, persone: Persona[], eccezioni: Eccezione[]): Consumo[] {
  const sue = eccezioni.filter((e) => e.portata_id === portata.id);
  const piatti: [Ricetta | undefined, number][] = [];
  if (portata.ricetta_id) piatti.push([indice.perId.get(portata.ricetta_id), portata.porzioni ?? porzioniAutomatiche(persone, sue)]);
  for (const e of sue) {
    const p = persone.find((x) => x.id === e.membro_id);
    if (e.tipo === 'alternativa' && e.ricetta_id && p) piatti.push([indice.perId.get(e.ricetta_id), e.porzioni ?? p.porzione]);
  }
  const somme = new Map<string, Consumo>();
  for (const [r, porzioni] of piatti) {
    if (!r) continue;
    for (const c of ingredientiPiatto(indice, r, porzioni)) {
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
