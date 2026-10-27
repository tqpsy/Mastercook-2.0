/**
 * Sincronizzatore di una famiglia su un dispositivo.
 *
 * - Scrivere: ogni azione diventa un comando con id fisso, messo in coda e inviato in ordine.
 *   Se la rete cade, lo stesso comando (stesso id) si ripresenta: il server non lo applica due volte.
 * - Esiti: applicato → esce dalla coda; conflitto o rifiuto → «da sistemare», visibile finché
 *   l'utente non lo sostituisce o lo scarta; rifiuto transitorio (app vecchia, accesso scaduto) →
 *   la coda si ferma e aspetta, senza perdere nulla.
 * - Leggere: si scaricano le righe dopo il cursore; righe e cursore si salvano nella stessa transazione,
 *   quindi un'interruzione lascia la copia locale com'era e si riprende dallo stesso punto.
 */
import type { Archivio, VoceCoda } from './archivio';
import { type Comando, ErroreRete, type Esito, type RigaScaricata, type Trasporto, VERSIONE_APP } from './tipi';

export type Blocco = 'app_da_aggiornare' | 'accesso_scaduto' | 'non_autorizzato';

export interface StatoSincronizzazione {
  in_attesa: number;
  da_sistemare: number;
  /** La coda è ferma finché la causa non è risolta. */
  bloccato: Blocco | null;
  /** L'ultimo tentativo è fallito per la rete. */
  senza_rete: boolean;
  ultimo_scarico: string | null;
}

export interface OpzioniSincronizzatore {
  archivio: Archivio;
  trasporto: Trasporto;
  famiglia: string;
  dispositivo: string;
  versioneApp?: number;
  nuovoId?: () => string;
  ora?: () => Date;
  limitePagina?: number;
}

export class Sincronizzatore {
  private readonly o: Required<OpzioniSincronizzatore>;
  private ascoltatori = new Set<(s: StatoSincronizzazione) => void>();
  private stato: StatoSincronizzazione = { in_attesa: 0, da_sistemare: 0, bloccato: null, senza_rete: false, ultimo_scarico: null };
  /** Le operazioni sulla rete avvengono una alla volta. */
  private fila: Promise<unknown> = Promise.resolve();
  /**
   * Ultimi comandi applicati, anche già usciti dalla coda: la schermata può mostrare ancora per un attimo
   * la versione di prima dello scarico, e un tocco in quell'attimo parte da lì (vedi `ribasa`).
   */
  private applicati: VoceCoda[] = [];

  constructor(opzioni: OpzioniSincronizzatore) {
    this.o = {
      ...opzioni,
      versioneApp: opzioni.versioneApp ?? VERSIONE_APP,
      nuovoId: opzioni.nuovoId ?? (() => crypto.randomUUID()),
      ora: opzioni.ora ?? (() => new Date()),
      limitePagina: opzioni.limitePagina ?? 500,
    };
  }

  get famiglia() {
    return this.o.famiglia;
  }

  ascolta(fn: (s: StatoSincronizzazione) => void): () => void {
    this.ascoltatori.add(fn);
    fn(this.stato);
    return () => this.ascoltatori.delete(fn);
  }

  leggiStato(): StatoSincronizzazione {
    return this.stato;
  }

  private aggiorna(parziale: Partial<StatoSincronizzazione>) {
    this.stato = { ...this.stato, ...parziale };
    for (const fn of this.ascoltatori) fn(this.stato);
  }

  private async contaCoda() {
    const voci = await this.o.archivio.coda.where('famiglia_id').equals(this.o.famiglia).toArray();
    this.aggiorna({
      in_attesa: voci.filter((v) => v.stato === 'in_attesa').length,
      da_sistemare: voci.filter((v) => v.stato === 'da_sistemare').length,
    });
  }

  private inFila<T>(lavoro: () => Promise<T>): Promise<T> {
    const p = this.fila.then(lavoro, lavoro);
    this.fila = p.catch(() => undefined);
    return p;
  }

  /** Mette in coda un comando e restituisce il suo id. Non invia: per inviare si chiama `sincronizza`. */
  async accoda(tipo: string, dati: Record<string, unknown>): Promise<string> {
    // La vista mostra ancora la versione di prima dei comandi già applicati ma non scaricati.
    const inviate = (await this.voci()).filter((v) => v.stato === 'inviata' && !this.applicati.some((a) => a.id === v.id));
    const applicati = [...inviate, ...this.applicati].sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0));
    const comando: Comando = {
      id: this.o.nuovoId(),
      famiglia_id: this.o.famiglia,
      tipo,
      dati: ribasa(tipo, dati, applicati),
      versione_app: this.o.versioneApp,
      dispositivo: this.o.dispositivo,
    };
    await this.o.archivio.coda.add({
      id: comando.id,
      famiglia_id: comando.famiglia_id,
      comando,
      stato: 'in_attesa',
      tentativi: 0,
      creato_il: this.o.ora().toISOString(),
    });
    await this.contaCoda();
    return comando.id;
  }

  /** Voci della coda di questa famiglia, nell'ordine d'invio. */
  async voci(): Promise<VoceCoda[]> {
    return this.o.archivio.coda.where('famiglia_id').equals(this.o.famiglia).sortBy('ordine');
  }

  /** Invia la coda in ordine. Restituisce perché si è fermato. */
  invia(): Promise<'vuota' | 'rete' | 'bloccata'> {
    return this.inFila(() => this.inviaOra());
  }

  private async inviaOra(): Promise<'vuota' | 'rete' | 'bloccata'> {
    if (this.stato.bloccato) return 'bloccata';
    for (;;) {
      const voce = (await this.voci()).find((v) => v.stato === 'in_attesa');
      if (!voce) {
        await this.contaCoda();
        return 'vuota';
      }
      let esito: Esito;
      try {
        await this.caricaFotoDi(voce);
        esito = await this.o.trasporto.applica({ ...voce.comando, versione_app: this.o.versioneApp });
      } catch (e) {
        if (!(e instanceof ErroreRete)) throw e;
        await this.o.archivio.coda.update(voce.ordine!, { tentativi: voce.tentativi + 1 });
        this.aggiorna({ senza_rete: true });
        await this.contaCoda();
        return 'rete';
      }
      this.aggiorna({ senza_rete: false });

      if (esito.transitorio) {
        const motivo = esito.dettaglio.motivo;
        this.aggiorna({ bloccato: motivo === 'app_da_aggiornare' ? 'app_da_aggiornare' : 'accesso_scaduto' });
        await this.contaCoda();
        return 'bloccata';
      }
      if (esito.esito === 'applicato') {
        // Si toglie dalla coda con lo scarico che porta le sue righe (scaricaOra), non prima.
        await this.o.archivio.coda.update(voce.ordine!, { stato: 'inviata', esito });
        await this.ribasaCoda({ ...voce, esito });
      } else {
        await this.o.archivio.coda.update(voce.ordine!, { stato: 'da_sistemare', esito });
      }
      await this.contaCoda();
    }
  }

  /** I comandi in coda sulla stessa riga partono dalla versione che il comando appena applicato ha lasciato. */
  private async ribasaCoda(applicato: VoceCoda) {
    this.applicati = [...this.applicati.slice(-49), applicato];
    for (const v of await this.voci()) {
      if (v.stato !== 'in_attesa') continue;
      const dati = ribasa(v.comando.tipo, v.comando.dati, [applicato]);
      if (dati !== v.comando.dati) await this.o.archivio.coda.update(v.ordine!, { comando: { ...v.comando, dati } });
    }
  }

  /**
   * Una ricetta (o la conferma di un pasto) che cita una foto nuova: prima si carica il file, poi parte il comando, così sul
   * server una ricetta non punta mai a un file che non c'è. Se il deposito rifiuta il file (non per
   * la rete), il comando parte lo stesso e la ricetta resta senza immagine visibile.
   */
  private async caricaFotoDi(voce: VoceCoda) {
    const percorso = (voce.comando.dati.campi as Record<string, unknown> | undefined)?.foto ?? voce.comando.dati.foto;
    if (typeof percorso !== 'string' || !this.o.trasporto.caricaFoto) return;
    const foto = await this.o.archivio.foto.get(percorso);
    if (!foto || foto.caricata) return;
    try {
      await this.o.trasporto.caricaFoto(percorso, foto.file);
    } catch (e) {
      if (e instanceof ErroreRete) throw e;
    }
    await this.o.archivio.foto.update(percorso, { caricata: true });
  }

  /** Scarica tutte le modifiche dopo il cursore. */
  scarica(): Promise<'aggiornato' | 'rete' | 'bloccata'> {
    return this.inFila(() => this.scaricaOra());
  }

  private async scaricaOra(): Promise<'aggiornato' | 'rete' | 'bloccata'> {
    const { archivio, trasporto, famiglia } = this.o;
    // Tutte le pagine si scrivono insieme ai comandi inviati che contengono: la vista passa dall'anteprima
    // alle righe vere in un colpo solo, senza un attimo in cui non c'è né l'una né le altre.
    const dopo = await archivio.cursore(famiglia);
    const righe: RigaScaricata[] = [];
    for (let cursore = dopo; ; ) {
      let pagina;
      try {
        pagina = await trasporto.scarica(famiglia, cursore, this.o.limitePagina);
      } catch (e) {
        if (!(e instanceof ErroreRete)) throw e;
        this.aggiorna({ senza_rete: true });
        return 'rete';
      }
      if (pagina.errore) {
        this.aggiorna({ bloccato: pagina.errore === 'non_autenticato' ? 'accesso_scaduto' : 'non_autorizzato' });
        return 'bloccata';
      }
      righe.push(...pagina.righe);
      if (pagina.righe.length) cursore = pagina.righe[pagina.righe.length - 1].seq;
      if (!pagina.altre) break;
    }
    await archivio.transaction('rw', archivio.righe, archivio.cursori, archivio.coda, async () => {
      if (righe.length) {
        await archivio.righe.bulkPut(righe.map((r) => ({ tabella: r.tabella, id: r.riga.id, famiglia_id: famiglia, seq: r.seq, riga: r.riga })));
        await archivio.cursori.put({ famiglia_id: famiglia, seq: righe[righe.length - 1].seq, aggiornato_il: this.o.ora().toISOString() });
      }
      const inviate = (await archivio.coda.where('famiglia_id').equals(famiglia).toArray()).filter((v) => v.stato === 'inviata');
      if (inviate.length) await archivio.coda.bulkDelete(inviate.map((v) => v.ordine!));
    });
    this.aggiorna({ senza_rete: false, ultimo_scarico: this.o.ora().toISOString() });
    return 'aggiornato';
  }

  /** Invia la coda e poi scarica: la copia locale torna uguale al server. */
  async sincronizza(): Promise<void> {
    const invio = await this.invia();
    if (invio === 'rete') return;
    await this.scarica();
  }

  /** Dopo un aggiornamento dell'app o un nuovo accesso, la coda riparte. */
  sblocca(versioneApp?: number) {
    if (versioneApp !== undefined) this.o.versioneApp = versioneApp;
    this.aggiorna({ bloccato: null });
  }

  /** Scarta un comando da sistemare: l'utente ha deciso di non applicarlo. */
  async scarta(id: string): Promise<void> {
    await this.inFila(async () => {
      const voce = await this.o.archivio.coda.where('id').equals(id).first();
      if (voce?.stato === 'da_sistemare') await this.o.archivio.coda.delete(voce.ordine!);
      await this.contaCoda();
    });
  }

  /**
   * Sostituisce un comando da sistemare con una versione corretta dall'utente (per esempio con la
   * versione attesa aggiornata dopo un conflitto). Il nuovo comando ha un id nuovo e prende lo stesso posto.
   */
  async sostituisci(id: string, dati: Record<string, unknown>): Promise<string> {
    return this.inFila(async () => {
      const voce = await this.o.archivio.coda.where('id').equals(id).first();
      if (!voce || voce.stato !== 'da_sistemare') throw new Error('comando non da sistemare');
      const nuovo: Comando = { ...voce.comando, id: this.o.nuovoId(), dati };
      await this.o.archivio.coda.put({ ...voce, id: nuovo.id, comando: nuovo, stato: 'in_attesa', esito: undefined, tentativi: 0 });
      await this.contaCoda();
      return nuovo.id;
    });
  }
}

/**
 * Una modifica per campi porta la versione della riga che il dispositivo ha visto. Se nel frattempo un
 * comando dello stesso dispositivo sulla stessa riga è già stato applicato, il server ha alzato la
 * versione: senza aggiornarla, cambiare due volte lo stesso campo (porzione 1 → 2 → 1) sembrerebbe un
 * conflitto con qualcun altro. Si passa alla versione lasciata da quel comando solo se è sicuro:
 * - il comando applicato partiva dalla versione che il server aveva (nessun altro in mezzo), oppure
 * - tocca tutti i campi di questo (un cambio altrui su quei campi l'avrebbe già fatto fermare).
 */
export function ribasa(tipo: string, dati: Record<string, unknown>, applicati: VoceCoda[]): Record<string, unknown> {
  let attesa = dati.versione_attesa;
  const campi = dati.campi;
  if (typeof attesa !== 'number' || !campi || typeof campi !== 'object') return dati;
  for (const a of applicati) {
    const d = a.esito?.dettaglio as { versione_prima?: unknown; versione?: unknown } | undefined;
    if (a.comando.tipo !== tipo || a.comando.dati.id !== dati.id || a.comando.dati.versione_attesa !== attesa) continue;
    if (typeof d?.versione !== 'number' || typeof d.versione_prima !== 'number') continue;
    const campiApplicati = (a.comando.dati.campi ?? {}) as Record<string, unknown>;
    if (d.versione_prima === attesa || Object.keys(campi).every((c) => c in campiApplicati)) attesa = d.versione;
  }
  return attesa === dati.versione_attesa ? dati : { ...dati, versione_attesa: attesa };
}
