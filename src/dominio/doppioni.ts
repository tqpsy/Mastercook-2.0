/**
 * Lo scontrino che si sta per importare è già in casa? Il database riconosce lo stesso scontrino solo se negozio, data, ora e
 * totale coincidono parola per parola, e una seconda foto dello stesso scontrino li legge quasi sempre un po' diversi
 * (un'ora sbagliata, un nome del negozio storpiato): allora tutto entrerebbe in casa due volte. Qui si guarda più in là:
 * stesso totale in giorni vicini, e la stessa ora, lo stesso negozio o righe con gli stessi nomi.
 */
import { compatto, somiglianza, SOGLIA_NOME } from './allineamento';
import { giorniTra } from './scadenze';

export interface ScontrinoNoto {
  data: string;
  ora: string | null;
  totale: number | null;
  negozio: string | null;
  descrizioni: string[];
}

export interface ScontrinoNuovo {
  data: string;
  ora: string;
  totale: number | null;
  negozio: string;
  descrizioni: string[];
}

export interface Doppione {
  /** Gli stessi dati, parola per parola: il database lo riconosce da solo, importarlo di nuovo non cambia niente. */
  esatto: boolean;
  noto: ScontrinoNoto;
}

/** Quante righe del nuovo scontrino hanno un nome uguale (a meno di una lettera ogni sette) tra quelle del noto, da 0 a 1. */
function righeInComune(nuovo: string[], noto: string[]): number {
  if (!nuovo.length || !noto.length) return 0;
  return nuovo.filter((d) => noto.some((n) => somiglianza(d, n) >= SOGLIA_NOME)).length / nuovo.length;
}

const stessoTotale = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 0.005);

/** Il primo scontrino già importato che sembra lo stesso (l'esatto prima), o null. */
export function trovaDoppione(nuovo: ScontrinoNuovo, noti: ScontrinoNoto[]): Doppione | null {
  const dati = (s: ScontrinoNoto | ScontrinoNuovo) => `${compatto(s.negozio ?? '')}|${s.data}|${s.ora ?? ''}|${s.totale ?? ''}`;
  const esatto = noti.find((n) => dati(n) === dati(nuovo));
  if (esatto) return { esatto: true, noto: esatto };
  for (const noto of noti) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nuovo.data) || Math.abs(giorniTra(noto.data, nuovo.data)) > 1) continue;
    const comune = righeInComune(nuovo.descrizioni, noto.descrizioni);
    const totaleUguale = nuovo.totale !== null && noto.totale !== null && stessoTotale(nuovo.totale, noto.totale);
    // Senza totale da confrontare servono più righe uguali; con lo stesso totale basta un altro segno.
    const stessoNegozio = !!nuovo.negozio && !!noto.negozio && somiglianza(nuovo.negozio, noto.negozio) >= 0.8;
    const stessaOra = !!nuovo.ora && nuovo.ora === noto.ora;
    if ((totaleUguale && (stessaOra || stessoNegozio || comune >= 0.5)) || (nuovo.totale === null && noto.totale === null && noto.data === nuovo.data && comune >= 0.6)) return { esatto: false, noto };
  }
  return null;
}
