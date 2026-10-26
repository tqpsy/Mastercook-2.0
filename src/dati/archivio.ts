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

export type StatoVoceCoda = 'in_attesa' | 'da_sistemare';

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

export interface Cursore {
  famiglia_id: string;
  seq: number;
  aggiornato_il: string;
}

/** Aumentare quando cambia la forma della copia locale: si riscarica tutto, la coda resta. */
export const VERSIONE_ARCHIVIO = 1;

export class Archivio extends Dexie {
  righe!: Table<RigaLocale, [Tabella, string]>;
  coda!: Table<VoceCoda, number>;
  cursori!: Table<Cursore, string>;

  constructor(nome: string) {
    super(nome);
    this.version(VERSIONE_ARCHIVIO).stores({
      righe: '[tabella+id], tabella, famiglia_id, [famiglia_id+tabella]',
      coda: '++ordine, &id, famiglia_id, stato',
      cursori: 'famiglia_id',
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
