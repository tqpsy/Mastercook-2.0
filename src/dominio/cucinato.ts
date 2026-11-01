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
  ripiano: Ripiano;
}

/** Un posto preciso nel frigo: il ripiano e quanto in fondo. */
export interface Ripiano {
  posto: 'alto' | 'centrale';
  /** Il nome breve: «Ripiano in alto», «Ripiano centrale, in fondo». */
  nome: string;
  perche: string;
}

/**
 * Dove va un piatto cotto nel frigo, un posto solo: i delicati (pesce, uova, crema, riso) sul ripiano centrale
 * in fondo, il punto più freddo e stabile; gli altri sul ripiano in alto, sopra carne e pesce crudi.
 */
export function ripianoPer(regola: Pick<RegolaCotti, 'id'> | undefined | null): Ripiano {
  return regola && DELICATI.has(regola.id)
    ? { posto: 'centrale', nome: 'Ripiano centrale, in fondo', perche: 'È il punto più freddo e stabile. In un contenitore chiuso, mai nella porta.' }
    : { posto: 'alto', nome: 'Ripiano in alto', perche: 'I cibi cotti stanno sopra carne e pesce crudi. In un contenitore chiuso, mai nella porta.' };
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
    ripiano: ripianoPer(regola),
  };
}
