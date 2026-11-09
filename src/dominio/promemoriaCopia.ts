import { giorniTra } from './scadenze';

/** Dopo quanti giorni senza una copia di sicurezza l'app ne ricorda l'utilità. */
export const GIORNI_PROMEMORIA = 14;
/** Quanto tace il promemoria dopo «Più tardi». */
export const GIORNI_RINVIO = 7;

export interface StatoCopia {
  /** Dove stanno i dati: il promemoria serve solo a chi li ha solo sul telefono. */
  dove: 'locale' | 'server';
  /** Famiglia già collegata al Drive: la copia la fa da sola. */
  conDrive: boolean;
  /** Giorno dell'ultima copia salvata a mano su questo telefono. */
  ultimaCopia: string | null;
  /** Primo giorno in cui il promemoria ha visto questa famiglia (si parte a contare da lì). */
  primaVolta: string | null;
  /** Giorno fino a cui la persona ha chiesto di non essere disturbata. */
  rinviataFino: string | null;
}

/** Vero se è ora di ricordare che, perso il telefono, i dati della famiglia si perdono. */
export function serveRicordareCopia(s: StatoCopia, giorno: string): boolean {
  if (s.dove !== 'locale' || s.conDrive) return false;
  if (s.rinviataFino && giorno < s.rinviataFino) return false;
  const base = s.ultimaCopia ?? s.primaVolta;
  if (!base) return false;
  return giorniTra(base, giorno) >= GIORNI_PROMEMORIA;
}
