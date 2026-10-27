/**
 * Archivio sul dispositivo (IndexedDB con Dexie): la copia locale delle righe ricevute dal server,
 * la coda dei comandi non ancora applicati e i cursori di scarico. È una copia: la verità è sul server.
 */
import Dexie, { type Table } from 'dexie';
import type { Comando, Esito, Riga, Tabella } from './tipi';

export interface RigaLocale {
  tabella: Tabella;
  id: string;
  famiglia_id: string;
  seq: number;
  riga: Riga;
}

/**
 * `inviata`: il server l'ha applicata ma la copia locale non ha ancora scaricato le righe cambiate. Resta
 * nell'anteprima fino allo scarico che le porta, così la schermata non torna per un attimo allo stato di prima.
 */
export type StatoVoceCoda = 'in_attesa' | 'inviata' | 'da_sistemare';

export interface VoceCoda {
  /** Ordine d'inserimento: i comandi partono in quest'ordine. */
  ordine?: number;
  id: string;
  famiglia_id: string;
  comando: Comando;
  stato: StatoVoceCoda;
  tentativi: number;
  creato_il: string;
  /** Esito del server per i comandi da sistemare (conflitto o rifiuto). */
  esito?: Esito;
}

/** Una foto scattata o scelta su questo dispositivo, o già scaricata: resta qui anche senza rete. */
export interface FotoLocale {
  percorso: string;
  famiglia_id: string;
  file: Blob;
  /** Falso finché non è nel deposito del server. */
  caricata: boolean;
}

export interface Cursore {
  famiglia_id: string;
  seq: number;
  aggiornato_il: string;
}

/** Aumentare quando cambia la forma della copia locale: si riscarica tutto, la coda resta. */
export const VERSIONE_ARCHIVIO = 2;

export class Archivio extends Dexie {
  righe!: Table<RigaLocale, [Tabella, string]>;
  coda!: Table<VoceCoda, number>;
  cursori!: Table<Cursore, string>;
  foto!: Table<FotoLocale, string>;

  constructor(nome: string) {
    super(nome);
    this.version(VERSIONE_ARCHIVIO).stores({
      righe: '[tabella+id], tabella, famiglia_id, [famiglia_id+tabella]',
      coda: '++ordine, &id, famiglia_id, stato',
      cursori: 'famiglia_id',
      foto: 'percorso, famiglia_id',
    });
  }

  async cursore(famiglia: string): Promise<number> {
    return (await this.cursori.get(famiglia))?.seq ?? 0;
  }

  async righeDi(famiglia: string, tabella: Tabella): Promise<Riga[]> {
    const r = await this.righe.where('[famiglia_id+tabella]').equals([famiglia, tabella]).toArray();
    return r.map((x) => x.riga);
  }
}
