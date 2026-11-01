/**
 * «Cucinato»: un piatto del menu preparato in anticipo. Dove conservarlo (frigo o freezer), fino a quando,
 * e su quale ripiano del frigo. Le date sono stime: si possono sempre cambiare.
 */
import type { RegolaCotti } from '../catalogo/tipi';
import { giorniTra, piuGiorni } from './scadenze';

/** Oltre questi giorni dalla cottura al pasto, il piatto va in freezer. */
export const GIORNI_FRIGO_MAX = 2;
/** Giorni in frigo senza una regola per il piatto. */
const GIORNI_FRIGO_SENZA_REGOLA = 2;
/** Un piatto cotto in freezer: circa tre mesi. */
export const GIORNI_FREEZER = 90;

/** I piatti più delicati (pesce, uova, crema, riso) vanno sul ripiano centrale, il più stabile. */
const DELICATI = new Set(['pesce_cotto', 'piatti_uova', 'dolci_crema', 'riso_cotto']);

export interface ConsiglioCucinato {
  /** Giorni dalla cottura all'ultimo pasto in cui si mangia. */
  giorniAlPasto: number;
  /** Quanti giorni può stare in frigo, al massimo: il più piccolo fra 2 e la regola del piatto. */
  limiteFrigo: number;
  /** Il pasto è più in là del limite: meglio congelarlo. */
  congela: boolean;
  /** Data stimata per consumarlo, in frigo e in freezer. */
  entroFrigo: string;
  entroFreezer: string;
  /** Su quale ripiano del frigo metterlo. */
  ripiano: string;
}

export function consiglioCucinato(regola: Pick<RegolaCotti, 'id' | 'consigliati'> | undefined, cucinatoIl: string, ultimoPasto: string): ConsiglioCucinato {
  const giorniFrigo = regola?.consigliati ?? GIORNI_FRIGO_SENZA_REGOLA;
  const limiteFrigo = Math.min(GIORNI_FRIGO_MAX, giorniFrigo);
  const giorniAlPasto = Math.max(0, giorniTra(cucinatoIl, ultimoPasto));
  return {
    giorniAlPasto,
    limiteFrigo,
    congela: giorniAlPasto > limiteFrigo,
    entroFrigo: piuGiorni(cucinatoIl, giorniFrigo),
    entroFreezer: piuGiorni(cucinatoIl, GIORNI_FREEZER),
    ripiano:
      regola && DELICATI.has(regola.id)
        ? 'Ripiano centrale, in fondo (il punto più freddo e stabile), in un contenitore chiuso. Mai nella porta.'
        : 'Ripiano alto o centrale, in un contenitore chiuso: i cibi cotti stanno sopra carne e pesce crudi. Mai nella porta.',
  };
}
