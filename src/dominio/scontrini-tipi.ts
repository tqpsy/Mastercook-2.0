/** I tipi di uno scontrino letto: ciò che esce dalla lettura del testo (`leggiScontrino`) e che il resto dell'app consuma. */
import type { UnitaBase } from './unita';

export interface RigaLetta {
  descrizione: string;
  /** Prezzo pagato per la riga, sconti già tolti. */
  prezzo: number;
  /** «2 x 0,99»: quanti pezzi. */
  pezzi?: number;
  /** «0,856 kg x 1,99 €/kg»: il peso in grammi. */
  grammi?: number;
  /** La lettera dell'aliquota IVA scritta dopo il prezzo («A», «B», «C»). */
  iva?: string;
  /** Lo sconto già tolto dal prezzo (il prezzo scritto sotto la riga). */
  sconto?: number;
  /** Il prezzo letto non tornava con il totale: è stato corretto (cifre confuse) o ricavato dal resto. */
  corretta?: boolean;
  /** La descrizione si legge ma il prezzo no: la riga resta (con prezzo 0) perché lo scriva una persona. */
  senzaPrezzo?: boolean;
  /** Il formato scritto nella descrizione: «1L» → 1000 ml, «2X125G» → 250 g. */
  formato?: { quantita: number; unita: UnitaBase };
}

export interface ScontrinoLetto {
  negozio: string | null;
  data: string | null;
  ora: string | null;
  totale: number | null;
  righe: RigaLetta[];
  /** La somma delle righe coincide con il totale: la lettura è probabilmente completa. */
  quadra: boolean;
  /** Torna senza aiuto: nessun prezzo è stato corretto o ricavato dal conto per farlo tornare (`corretti === 0`). Un conto fatto tornare a forza prova meno. */
  quadraDaSola: boolean;
  /** Quanti prezzi sono stati corretti perché il conto tornasse. */
  corretti: number;
}
