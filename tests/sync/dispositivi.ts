/**
 * Dispositivi simulati: ognuno ha il suo archivio locale (IndexedDB finto) e il suo sincronizzatore,
 * collegati al Postgres di prova da una rete che si può spegnere o rendere inaffidabile.
 */
import 'fake-indexeddb/auto';
import { randomUUID } from 'node:crypto';
import { Archivio } from '../../src/dati/archivio';
import { Sincronizzatore } from '../../src/dati/sincronizzatore';
import { type Comando, ErroreRete, type Esito, type Pagina, type Trasporto } from '../../src/dati/tipi';
import type { Banco, Utente } from '../db/banco';

/** Generatore pseudo-casuale con seme, per prove casuali ripetibili. */
export function casuale(seme: number) {
  let s = seme >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Guasti {
  /** La richiesta non arriva al server. */
  perdiRichiesta?: number;
  /** Il server applica, ma la risposta si perde. */
  perdiRisposta?: number;
  /** La richiesta arriva due volte. */
  duplica?: number;
}

export class Rete implements Trasporto {
  accesa = true;
  guasti: Guasti = {};
  richieste = 0;
  /** Le foto arrivate al deposito, in ordine, con il numero della richiesta di comando dopo cui sono arrivate. */
  foto: { percorso: string; dopo: number }[] = [];
  /** Il deposito delle foto non risponde (la rete dei comandi sì). */
  fotoGuaste = false;
  constructor(
    private utente: Utente,
    private caso: () => number = Math.random,
  ) {}

  private controlla() {
    if (!this.accesa) throw new ErroreRete('offline');
  }

  async applica(c: Comando): Promise<Esito> {
    this.controlla();
    this.richieste++;
    if (this.caso() < (this.guasti.perdiRichiesta ?? 0)) throw new ErroreRete('richiesta persa');
    const esito = this.caso() < (this.guasti.duplica ?? 0)
      ? (await Promise.all([this.utente.applica(c), this.utente.applica(c)]))[0]
      : await this.utente.applica(c);
    if (this.caso() < (this.guasti.perdiRisposta ?? 0)) throw new ErroreRete('risposta persa');
    return esito as Esito;
  }

  async caricaFoto(percorso: string): Promise<void> {
    this.controlla();
    if (this.fotoGuaste) throw new ErroreRete('deposito irraggiungibile');
    this.foto.push({ percorso, dopo: this.richieste });
  }

  async scarica(famiglia: string, dopo: number, limite?: number): Promise<Pagina> {
    this.controlla();
    if (this.caso() < (this.guasti.perdiRisposta ?? 0)) throw new ErroreRete('risposta persa');
    return (await this.utente.scarica(famiglia, dopo, limite)) as Pagina;
  }
}

export interface Dispositivo {
  nome: string;
  archivio: Archivio;
  rete: Rete;
  sync: Sincronizzatore;
  /** Simula la chiusura e riapertura dell'app: stesso archivio, nuovo sincronizzatore. */
  riavvia(): Dispositivo;
}

export function dispositivo(utente: Utente, famiglia: string, nome: string, opzioni: { caso?: () => number; limitePagina?: number; versioneApp?: number } = {}): Dispositivo {
  const archivio = new Archivio(`mc-${nome}-${randomUUID()}`);
  const rete = new Rete(utente, opzioni.caso);
  const crea = (a: Archivio, r: Rete): Dispositivo => {
    const sync = new Sincronizzatore({ archivio: a, trasporto: r, famiglia, dispositivo: nome, limitePagina: opzioni.limitePagina, versioneApp: opzioni.versioneApp });
    return { nome, archivio: a, rete: r, sync, riavvia: () => crea(a, r) };
  };
  return crea(archivio, rete);
}

const TABELLE_DATI = ['famiglia', 'utente_famiglia', 'membro', 'vincolo_alimentare'] as const;

/** Stato della famiglia sul server, letto dal proprietario del database. */
export async function statoServer(banco: Banco, famiglia: string) {
  const stato: Record<string, Record<string, unknown>> = {};
  for (const t of TABELLE_DATI) {
    const righe = await banco.sql(`select to_jsonb(t) as r from ${t} t where famiglia_id = $1`, [famiglia]);
    for (const { r } of righe) stato[`${t}:${r.id}`] = normalizza(r);
  }
  return stato;
}

/** Stato della famiglia nella copia locale di un dispositivo. */
export async function statoLocale(d: Dispositivo, famiglia: string) {
  const stato: Record<string, Record<string, unknown>> = {};
  for (const t of TABELLE_DATI) {
    for (const r of await d.archivio.righeDi(famiglia, t)) stato[`${t}:${r.id}`] = normalizza(r);
  }
  return stato;
}

function normalizza(r: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(r));
}
