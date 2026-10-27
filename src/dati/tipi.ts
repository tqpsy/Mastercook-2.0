/**
 * Forme scambiate tra il dispositivo e il server. Il contratto completo è in docs/database.md.
 */

/** Versione dell'app che scrive. Il server rifiuta i comandi sotto la sua versione minima. */
export const VERSIONE_APP = 1;

export interface Comando {
  /** Scelto dal dispositivo al momento del tocco, uguale in ogni ritentativo. */
  id: string;
  famiglia_id: string;
  tipo: string;
  dati: Record<string, unknown>;
  versione_app: number;
  dispositivo?: string;
}

export type TipoEsito = 'applicato' | 'conflitto' | 'rifiutato';

export interface Esito {
  id?: string;
  esito: TipoEsito;
  dettaglio: Record<string, unknown> & { motivo?: string };
  /** Lo stesso id era già stato applicato: nessun nuovo effetto. */
  ripetuto?: boolean;
  /** Rifiuto non registrato (accesso scaduto, app da aggiornare): si ripresenta lo stesso comando dopo. */
  transitorio?: boolean;
  famiglia_id?: string;
}

/** Tabelle che il server invia al dispositivo. */
export type Tabella =
  | 'famiglia'
  | 'utente_famiglia'
  | 'membro'
  | 'vincolo_alimentare'
  | 'invito'
  | 'comando'
  | 'ingrediente'
  | 'ricetta'
  | 'ricetta_ingrediente'
  | 'ricetta_passo'
  | 'lotto'
  | 'movimento'
  | 'categoria_pasto'
  | 'portata'
  | 'eccezione_membro'
  | 'gusto'
  | 'voce_spesa'
  | 'acquisto'
  | 'acquisto_riga'
  | 'prodotto'
  | 'scontrino'
  | 'scontrino_riga'
  | 'conferma_pasto'
  | 'consumo_riga'
  | 'consumo_lotto';

export interface Riga {
  id: string;
  famiglia_id: string;
  versione?: number;
  eliminato_il?: string | null;
  seq: number;
  [campo: string]: unknown;
}

export interface RigaScaricata {
  tabella: Tabella;
  seq: number;
  riga: Riga;
}

export interface Pagina {
  righe: RigaScaricata[];
  altre: boolean;
  errore?: string;
}

/**
 * Il collegamento con il server. Se la rete fallisce, `applica` e `scarica` lanciano un'eccezione:
 * in quel caso il dispositivo non sa se il comando è arrivato e lo ripresenta con lo stesso id.
 */
export interface Trasporto {
  applica(comando: Comando): Promise<Esito>;
  scarica(famiglia: string, dopo: number, limite?: number): Promise<Pagina>;
  /** Carica una foto nel deposito prima del comando che la usa. ErroreRete se manca la rete. */
  caricaFoto?(percorso: string, file: Blob): Promise<void>;
}

export class ErroreRete extends Error {
  constructor(messaggio = 'rete non disponibile') {
    super(messaggio);
    this.name = 'ErroreRete';
  }
}
