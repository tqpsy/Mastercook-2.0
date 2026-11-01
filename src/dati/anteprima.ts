/**
 * Anteprima delle modifiche in coda: mostra subito l'effetto previsto dei comandi non ancora
 * applicati dal server, marcando le righe come «in attesa». Non scrive nulla: quando il server
 * risponde, la copia locale scaricata prende il posto dell'anteprima.
 */
import type { VoceCoda } from './archivio';
import type { Riga, Tabella } from './tipi';
import { piuGiorni } from '../dominio/scadenze';

export interface RigaInVista extends Riga {
  /** Effetto di un comando non ancora applicato dal server. */
  in_attesa?: boolean;
}

export type Righe = Partial<Record<Tabella, RigaInVista[]>>;

type Effetto = (righe: Righe, dati: Record<string, unknown>, famiglia: string) => void;

function aggiungi(tabella: Tabella, campi: (d: Record<string, unknown>) => Record<string, unknown>): Effetto {
  return (righe, d, famiglia) => {
    const elenco = righe[tabella] ?? [];
    if (elenco.some((r) => r.id === d.id)) return;
    righe[tabella] = [...elenco, { id: String(d.id), famiglia_id: famiglia, seq: Infinity, ...campi(d), in_attesa: true }];
  };
}

function modifica(tabella: Tabella): Effetto {
  return (righe, d) => {
    const campi = (d.campi ?? {}) as Record<string, unknown>;
    righe[tabella] = (righe[tabella] ?? []).map((r) => (r.id === d.id ? { ...r, ...campi, in_attesa: true } : r));
  };
}

function elimina(tabella: Tabella): Effetto {
  return (righe, d) => {
    righe[tabella] = (righe[tabella] ?? []).map((r) => (r.id === d.id ? { ...r, eliminato_il: 'in_attesa', in_attesa: true } : r));
  };
}

const EFFETTI: Record<string, Effetto> = {
  unisci_membri: (righe, d) => {
    righe.membro = (righe.membro ?? []).map((r) => (r.id === d.toglie ? { ...r, eliminato_il: 'in_attesa', in_attesa: true } : r));
  },
  aggiungi_membro: aggiungi('membro', (d) => ({ nome: d.nome, emoji: d.emoji ?? null, porzione: d.porzione ?? 1, note: d.note ?? null, archiviato: false })),
  modifica_membro: modifica('membro'),
  aggiungi_vincolo: aggiungi('vincolo_alimentare', (d) => ({
    membro_id: d.membro_id,
    tipo: d.tipo,
    oggetto: d.oggetto,
    severita: d.severita ?? 'evitare',
    fonte: d.fonte ?? 'dichiarato',
    testo: d.testo ?? null,
  })),
  rimuovi_vincolo: elimina('vincolo_alimentare'),
  crea_invito: aggiungi('invito', (d) => ({ usi: 0, usi_massimi: d.usi_massimi ?? 5, revocato: false, scade_il: null })),
  revoca_invito: (righe, d) => {
    righe.invito = (righe.invito ?? []).map((r) => (r.id === d.id ? { ...r, revocato: true, in_attesa: true } : r));
  },
  modifica_famiglia: (righe, d, famiglia) => modifica('famiglia')(righe, { ...d, id: famiglia }, famiglia),
  // I giorni scelti per la spesa si vedono subito; le voci le ricalcola il server.
  ricalcola_spesa: (righe, d, famiglia) => {
    righe.famiglia = (righe.famiglia ?? []).map((r) => {
      if (r.id !== famiglia) return r;
      const impostazioni = { ...((r.impostazioni as Record<string, unknown> | undefined) ?? {}) };
      if (Array.isArray(d.giorni)) impostazioni.spesa_giorni = d.giorni;
      else delete impostazioni.spesa_giorni;
      return { ...r, impostazioni };
    });
  },

  crea_ingrediente: aggiungi('ingrediente', (d) => ({
    nome: d.nome,
    reparto: d.reparto ?? 'altro',
    dimensione: d.dimensione,
    luogo: d.luogo ?? 'dispensa',
    allergeni: d.allergeni ?? [],
    allergeni_noti: d.allergeni_noti ?? false,
    classi: d.classi ?? [],
    genitore: d.genitore ?? null,
    emoji: d.emoji ?? null,
    versione: 1,
  })),
  modifica_ingrediente: modifica('ingrediente'),

  salva_ricetta: (righe, d, famiglia) => {
    if (d.nuova) aggiungi('ricetta', (x) => ({ ...(x.campi as object), archiviata: false, versione: 1 }))(righe, d, famiglia);
    else if (d.campi && Object.keys(d.campi as object).length) modifica('ricetta')(righe, d, famiglia);
    for (const [tabella, chiave] of [
      ['ricetta_ingrediente', 'ingredienti'],
      ['ricetta_passo', 'passi'],
    ] as const) {
      const diff = (d[chiave] ?? {}) as { aggiungi?: Record<string, unknown>[]; modifica?: Record<string, unknown>[]; rimuovi?: string[] };
      for (const r of diff.aggiungi ?? []) aggiungi(tabella, (x) => ({ ...x, ricetta_id: d.id, versione: 1 }))(righe, r, famiglia);
      for (const r of diff.modifica ?? []) modifica(tabella)(righe, r, famiglia);
      for (const id of diff.rimuovi ?? []) elimina(tabella)(righe, { id }, famiglia);
    }
  },
  elimina_ricetta: elimina('ricetta'),

  aggiungi_lotto: aggiungi('lotto', (d) => ({
    ingrediente_id: d.ingrediente_id,
    nome: d.nome ?? null,
    quantita: Number(d.quantita),
    unita: d.unita,
    luogo: d.luogo,
    data_acquisto: d.data_acquisto ?? null,
    data_limite: d.data_limite ?? null,
    tipo_data: d.tipo_data,
    fonte_data: d.fonte_data ?? null,
    calcolata_il: d.calcolata_il ?? null,
    origine: 'manuale',
    note: d.note ?? null,
    chiuso_il: null,
    versione: 1,
  })),
  scarica_lotto: (righe, d) => cambiaQuantita(righe, String(d.lotto_id), (q) => q - Number(d.quantita)),
  correggi_lotto: (righe, d) => cambiaQuantita(righe, String(d.lotto_id), () => Number(d.quantita_nuova)),
  sposta_lotto: (righe, d, famiglia) => {
    const stima = (d.stima ?? {}) as Record<string, unknown>;
    const lotto = (righe.lotto ?? []).find((r) => r.id === d.lotto_id);
    if (!lotto) return;
    const parte = d.quantita == null ? null : Number(d.quantita);
    if (parte === null || parte >= Number(lotto.quantita)) {
      righe.lotto = (righe.lotto ?? []).map((r) => (r.id === d.lotto_id ? { ...r, luogo: d.luogo, ...stima, in_attesa: true } : r));
      return;
    }
    cambiaQuantita(righe, lotto.id, (q) => q - parte);
    const copia: Record<string, unknown> = { ...lotto };
    for (const k of ['id', 'seq', 'in_attesa']) delete copia[k];
    aggiungi('lotto', () => ({ ...copia, quantita: parte, luogo: d.luogo, ...stima, versione: 1 }))(righe, { id: d.nuovo_id }, famiglia);
  },
  modifica_lotto: modifica('lotto'),

  imposta_categoria: (righe, d, famiglia) => {
    const elenco = righe.categoria_pasto ?? [];
    const esistente = elenco.find((r) => r.chiave === d.chiave && !r.eliminato_il);
    if (esistente) righe.categoria_pasto = elenco.map((r) => (r === esistente ? { ...r, attiva: d.attiva, in_attesa: true } : r));
    else aggiungi('categoria_pasto', () => ({ chiave: d.chiave, nome: null, attiva: d.attiva, ordine: 99, versione: 1 }))(righe, { id: `chiave:${String(d.chiave)}` }, famiglia);
  },
  crea_categoria: aggiungi('categoria_pasto', (d) => ({ chiave: null, nome: d.nome, emoji: d.emoji ?? null, ordine: d.ordine ?? 99, attiva: true, versione: 1 })),
  modifica_categoria: modifica('categoria_pasto'),
  aggiungi_portata: aggiungi('portata', (d) => ({
    data: d.data,
    categoria: d.categoria,
    ricetta_id: d.ricetta_id ?? null,
    testo: d.testo ?? null,
    porzioni: d.porzioni ?? null,
    origine: d.origine === 'automatica' ? 'automatica' : 'manuale',
    bloccata: false,
    ordine: d.ordine ?? 0,
    note: d.note ?? null,
    versione: 1,
  })),
  aggiungi_avanzo: (righe, d, famiglia) => {
    const da = (righe.portata ?? []).find((r) => r.id === d.avanzo_di && !r.eliminato_il);
    if (!da) return;
    aggiungi('portata', () => ({
      data: d.data,
      categoria: d.categoria,
      ricetta_id: da.ricetta_id,
      testo: null,
      porzioni: d.porzioni ?? null,
      origine: 'manuale',
      avanzo_di: da.id,
      bloccata: false,
      ordine: d.ordine ?? 0,
      note: null,
      versione: 1,
    }))(righe, d, famiglia);
  },
  modifica_portata: modifica('portata'),
  rimuovi_portata: (righe, d, famiglia) => {
    elimina('portata')(righe, d, famiglia);
    // Con il piatto se ne vanno anche i suoi avanzi dei giorni dopo non ancora confermati.
    const confermate = new Set((righe.conferma_pasto ?? []).filter((c) => c.attiva && !c.eliminato_il).map((c) => c.portata_id));
    const tolte = new Set([d.id]);
    righe.portata = (righe.portata ?? []).map((p) => {
      if (p.avanzo_di !== d.id || p.eliminato_il || confermate.has(p.id)) return p;
      tolte.add(p.id);
      return { ...p, eliminato_il: 'in_attesa', in_attesa: true };
    });
    righe.eccezione_membro = (righe.eccezione_membro ?? []).map((r) => (tolte.has(r.portata_id) && !r.eliminato_il ? { ...r, eliminato_il: 'in_attesa', in_attesa: true } : r));
  },
  ripeti_portate: (righe, d, famiglia) => {
    const portate = righe.portata ?? [];
    for (const x of (d.portate ?? []) as Record<string, unknown>[]) {
      const da = portate.find((r) => r.id === x.da && !r.eliminato_il);
      if (!da) continue;
      const origine = (d.portate as Record<string, unknown>[]).find((y) => da.avanzo_di && y.da === da.avanzo_di);
      const avanzo_di = origine && String(origine.data) < String(x.data) ? origine.id : null;
      aggiungi('portata', () => ({ ...senzaChiavi(da), data: x.data, categoria: x.categoria ?? da.categoria, origine: 'ripetuta', avanzo_di, bloccata: false, versione: 1 }))(righe, x, famiglia);
    }
    const eccezioni = righe.eccezione_membro ?? [];
    for (const x of (d.eccezioni ?? []) as Record<string, unknown>[]) {
      const da = eccezioni.find((r) => r.id === x.da && !r.eliminato_il);
      if (da) aggiungi('eccezione_membro', () => ({ ...senzaChiavi(da), portata_id: x.portata_id, versione: 1 }))(righe, x, famiglia);
    }
  },
  imposta_eccezione: (righe, d, famiglia) => {
    const campi = { tipo: d.tipo, ricetta_id: d.ricetta_id ?? null, testo: d.testo ?? null, porzioni: d.porzioni ?? null };
    const elenco = righe.eccezione_membro ?? [];
    const esistente = elenco.find((r) => r.portata_id === d.portata_id && r.membro_id === d.membro_id && !r.eliminato_il);
    if (esistente) righe.eccezione_membro = elenco.map((r) => (r === esistente ? { ...r, ...campi, in_attesa: true } : r));
    else aggiungi('eccezione_membro', () => ({ portata_id: d.portata_id, membro_id: d.membro_id, ...campi, versione: 1 }))(righe, d, famiglia);
  },
  rimuovi_eccezione: elimina('eccezione_membro'),
  imposta_gusto: (righe, d, famiglia) => {
    const chiave = d.ingrediente_id ?? d.ricetta_id;
    const elenco = righe.gusto ?? [];
    const esistente = elenco.find((r) => r.membro_id === d.membro_id && (r.ingrediente_id ?? r.ricetta_id) === chiave && !r.eliminato_il);
    if (esistente) righe.gusto = elenco.map((r) => (r === esistente ? { ...r, valore: d.valore, in_attesa: true } : r));
    else
      aggiungi('gusto', () => ({ membro_id: d.membro_id, ingrediente_id: d.ingrediente_id ?? null, ricetta_id: d.ricetta_id ?? null, valore: d.valore, versione: 1 }))(
        righe,
        d,
        famiglia,
      );
  },
  rimuovi_gusto: elimina('gusto'),

  // Il ricalcolo della lista lo fa il server: sul dispositivo la lista si aggiorna quando risponde.
  aggiungi_voce: aggiungi('voce_spesa', (d) => ({
    tipo: 'manuale',
    ingrediente_id: d.ingrediente_id ?? null,
    testo: d.testo ?? null,
    unita: d.unita ?? null,
    quantita_richiesta: d.quantita ?? null,
    quantita_scelta: null,
    stato: 'da_acquistare',
    non_piu_necessaria: false,
    nota: d.nota ?? null,
    versione: 1,
  })),
  modifica_voce: modifica('voce_spesa'),
  imposta_stato_voce: (righe, d) => {
    righe.voce_spesa = (righe.voce_spesa ?? []).map((r) =>
      r.id === d.id && r.stato !== 'acquistata' ? { ...r, stato: d.stato, non_piu_necessaria: d.stato === 'rimossa' ? false : r.non_piu_necessaria, in_attesa: true } : r,
    );
  },
  conferma_acquisto: (righe, d, famiglia) => {
    if ((righe.acquisto ?? []).some((a) => a.id === d.id)) return;
    const data = d.data ?? null;
    aggiungi('acquisto', () => ({ fonte: d.fonte ?? 'carrello', data, negozio: d.negozio ?? null, stato: 'confermato', versione: 1 }))(righe, d, famiglia);
    for (const r of (d.righe ?? []) as Record<string, unknown>[]) {
      const conIngrediente = r.ingrediente_id != null;
      if (conIngrediente) {
        aggiungi('lotto', (x) => ({
          ingrediente_id: x.ingrediente_id,
          nome: x.nome ?? null,
          quantita: Number(x.quantita),
          unita: x.unita,
          luogo: x.luogo ?? 'dispensa',
          data_acquisto: data,
          data_limite: x.data_limite ?? null,
          tipo_data: x.tipo_data ?? 'sconosciuta',
          fonte_data: x.fonte_data ?? null,
          calcolata_il: x.calcolata_il ?? null,
          origine: 'acquisto',
          versione: 1,
        }))(righe, { ...r, id: r.lotto_id }, famiglia);
      }
      aggiungi('acquisto_riga', (x) => ({
        acquisto_id: d.id,
        voce_id: x.voce_id ?? null,
        ingrediente_id: x.ingrediente_id ?? null,
        nome: x.nome ?? null,
        quantita: x.quantita ?? null,
        unita: x.unita ?? null,
        prezzo: x.prezzo ?? null,
        lotto_id: conIngrediente ? x.lotto_id : null,
        versione: 1,
      }))(righe, r, famiglia);
      if (r.voce_id) {
        righe.voce_spesa = (righe.voce_spesa ?? []).map((v) => (v.id === r.voce_id ? { ...v, stato: 'acquistata', non_piu_necessaria: false, in_attesa: true } : v));
      }
    }
  },
  importa_scontrino: (righe, d, famiglia) => {
    if ((righe.scontrino ?? []).some((x) => x.id === d.id)) return;
    const elenco = (d.righe ?? []) as Record<string, unknown>[];
    const nuove: Record<string, unknown>[] = elenco.filter((r) => r.nuova).map((r) => ({ ...(r.nuova as Record<string, unknown>), prezzo: r.prezzo ?? null, descrizione: r.descrizione }));
    const conAcquisto = nuove.length > 0;
    aggiungi('scontrino', (x) => ({
      negozio: x.negozio ?? null,
      data: x.data,
      ora: x.ora ?? null,
      totale: x.totale ?? null,
      testo: x.testo ?? null,
      acquisto_id: conAcquisto ? x.acquisto_id : null,
      versione: 1,
    }))(righe, d, famiglia);
    if (conAcquisto) {
      EFFETTI.conferma_acquisto(
        righe,
        { id: d.acquisto_id, fonte: 'scontrino', data: d.data, negozio: d.negozio, righe: nuove.map((n) => ({ ...n, nome: n.nome ?? (n.ingrediente_id ? null : n.descrizione) })) },
        famiglia,
      );
      righe.acquisto = (righe.acquisto ?? []).map((a) => (a.id === d.acquisto_id ? { ...a, scontrino_id: d.id } : a));
      righe.lotto = (righe.lotto ?? []).map((l) => (l.in_attesa && nuove.some((n) => n.lotto_id === l.id) ? { ...l, origine: 'scontrino' } : l));
    }
    for (const r of elenco) {
      if (r.abbina) {
        righe.acquisto_riga = (righe.acquisto_riga ?? []).map((x) => (x.id === r.abbina ? { ...x, prezzo: r.prezzo ?? x.prezzo, in_attesa: true } : x));
      }
      const riga = r.abbina ?? (r.nuova as Record<string, unknown> | undefined)?.id ?? null;
      aggiungi('scontrino_riga', (x) => ({ scontrino_id: d.id, descrizione: x.descrizione, prezzo: x.prezzo ?? null, acquisto_riga_id: riga, versione: 1 }))(righe, r, famiglia);
    }
  },
  fissa_pasto: (righe, d, famiglia) => {
    aggiungi('pasto_fisso', (x) => ({
      categoria: x.categoria,
      ricetta_id: x.ricetta_id ?? null,
      testo: x.testo ?? null,
      porzioni: x.porzioni ?? null,
      ordine: x.ordine ?? 0,
      dal: x.dal,
      al: null,
      versione: 1,
    }))(righe, d, famiglia);
    if (d.da_portata) righe.portata = (righe.portata ?? []).map((p) => (p.id === d.da_portata ? { ...p, fisso_id: d.id, in_attesa: true } : p));
  },
  ferma_pasto_fisso: (righe, d) => {
    const dal = String(d.dal);
    const ieri = piuGiorni(dal, -1);
    righe.pasto_fisso = (righe.pasto_fisso ?? []).map((f) => (f.id === d.id ? { ...f, al: f.al && String(f.al) < ieri ? f.al : ieri, in_attesa: true } : f));
    const confermate = new Set((righe.conferma_pasto ?? []).filter((c) => c.attiva && !c.eliminato_il).map((c) => c.portata_id));
    righe.portata = (righe.portata ?? []).map((p) =>
      p.fisso_id === d.id && String(p.data) >= dal && !p.eliminato_il && p.id !== d.tieni && !confermate.has(p.id) ? { ...p, eliminato_il: 'in_attesa', in_attesa: true } : p,
    );
  },
  imposta_ospiti: (righe, d, famiglia) => {
    const quanti = Number(d.adulti ?? 0) + Number(d.bambini ?? 0);
    const esistente = (righe.ospiti_pasto ?? []).find((o) => o.data === d.data && o.categoria === d.categoria && !o.eliminato_il);
    const campi = { adulti: Number(d.adulti ?? 0), bambini: Number(d.bambini ?? 0), oggetti: (d.oggetti as string[] | undefined) ?? [] };
    if (esistente) {
      righe.ospiti_pasto = (righe.ospiti_pasto ?? []).map((o) => (o === esistente ? { ...o, ...(quanti ? campi : { eliminato_il: 'in_attesa' }), in_attesa: true } : o));
    } else if (quanti) {
      aggiungi('ospiti_pasto', (x) => ({ data: x.data, categoria: x.categoria, ...campi, versione: 1 }))(righe, { ...d, id: `ospiti:${String(d.data)}:${String(d.categoria)}` }, famiglia);
    }
  },
  verifica_ricetta: (righe, d, famiglia) => {
    const esistente = (righe.ricetta_verificata ?? []).find((r) => r.membro_id === d.membro_id && r.ricetta_id === d.ricetta_id && !r.eliminato_il);
    const scelta = d.scelta ?? (d.va_bene ? 'va_bene' : 'togli');
    const segna = scelta === 'va_bene' || scelta === 'non_va_bene';
    if (esistente) {
      righe.ricetta_verificata = (righe.ricetta_verificata ?? []).map((r) =>
        r === esistente ? { ...r, ...(segna ? { versione_ricetta: d.versione_ricetta, va_bene: scelta === 'va_bene' } : { eliminato_il: new Date().toISOString() }), in_attesa: true } : r,
      );
    } else if (segna) {
      aggiungi('ricetta_verificata', (x) => ({ membro_id: x.membro_id, ricetta_id: x.ricetta_id, versione_ricetta: x.versione_ricetta, va_bene: scelta === 'va_bene', versione: 1 }))(righe, d, famiglia);
    }
  },
  scegli_icona: (righe, d, famiglia) => {
    const esistente = (righe.icona_ricetta ?? []).find((r) => r.ricetta_id === d.ricetta_id && !r.eliminato_il);
    if (esistente) {
      righe.icona_ricetta = (righe.icona_ricetta ?? []).map((r) =>
        r === esistente ? { ...r, ...(d.emoji ? { emoji: d.emoji } : { eliminato_il: new Date().toISOString() }), in_attesa: true } : r,
      );
    } else if (d.emoji) aggiungi('icona_ricetta', (x) => ({ ricetta_id: x.ricetta_id, emoji: x.emoji, versione: 1 }))(righe, d, famiglia);
  },
  salva_prodotto: (righe, d, famiglia) => {
    const esistente = (righe.prodotto ?? []).find((p) => p.codice === d.codice && !p.eliminato_il);
    const campi = { codice: d.codice, ingrediente_id: d.ingrediente_id, nome: d.nome ?? null, quantita: d.quantita ?? null, unita: d.unita ?? null };
    if (esistente) righe.prodotto = (righe.prodotto ?? []).map((p) => (p === esistente ? { ...p, ...campi, in_attesa: true } : p));
    else aggiungi('prodotto', () => ({ ...campi, versione: 1 }))(righe, d, famiglia);
  },
  cucina_portata: (righe, d, famiglia) => {
    if ((righe.lotto ?? []).some((l) => l.portata_id === d.portata_id && !l.eliminato_il)) return;
    aggiungi('lotto', (x) => ({
      ingrediente_id: 'ing:avanzo',
      nome: x.nome ?? null,
      quantita: Number(x.porzioni),
      unita: 'pz',
      luogo: x.luogo ?? 'frigo',
      data_limite: x.data_limite ?? null,
      tipo_data: x.tipo_data ?? 'sconosciuta',
      fonte_data: x.fonte_data ?? null,
      calcolata_il: x.calcolata_il ?? null,
      origine: 'avanzo',
      portata_id: x.portata_id,
      versione: 1,
    }))(righe, d, famiglia);
  },
  conferma_pasto: (righe, d, famiglia) => {
    if ((righe.conferma_pasto ?? []).some((c) => c.id === d.id)) return;
    // Piatto già cucinato: restano nel piatto pronto le porzioni avanzate, nessun lotto nuovo.
    const pronto = (righe.lotto ?? []).find((l) => l.portata_id === d.portata_id && !l.eliminato_il);
    if (pronto) {
      const resta = Array.isArray(d.avanzi) && (d.esito === 'come_previsto' || d.esito === 'quantita_diverse')
        ? (d.avanzi as Record<string, unknown>[]).reduce((t, a) => t + Number(a.quantita), 0)
        : null;
      d = { ...d, avanzi: [] };
      if (resta !== null) cambiaQuantita(righe, pronto.id, () => resta);
    }
    const prima = (righe.conferma_pasto ?? []).find((c) => c.portata_id === d.portata_id && c.attiva);
    if (prima && d.revisione_attesa == null) return;
    righe.conferma_pasto = (righe.conferma_pasto ?? []).map((c) => (c === prima ? { ...c, attiva: false, in_attesa: true } : c));
    aggiungi('conferma_pasto', (x) => ({
      portata_id: x.portata_id,
      revisione: Number(prima?.revisione ?? 0) + 1,
      esito: x.esito,
      ricetta_id: x.esito === 'altro_piatto' ? (x.ricetta_id ?? null) : null,
      testo: x.esito === 'altro_piatto' ? (x.testo ?? null) : null,
      porzioni: x.esito === 'altro_piatto' ? (x.porzioni ?? null) : null,
      attiva: true,
      nota: x.nota ?? null,
      versione: 1,
    }))(righe, d, famiglia);
    for (const a of (d.avanzi ?? []) as Record<string, unknown>[]) {
      aggiungi('lotto', (x) => ({
        ingrediente_id: 'ing:avanzo',
        nome: x.nome ?? null,
        quantita: Number(x.quantita),
        unita: 'pz',
        luogo: x.luogo ?? 'frigo',
        data_limite: x.data_limite ?? null,
        tipo_data: x.tipo_data ?? 'sconosciuta',
        fonte_data: x.fonte_data ?? null,
        calcolata_il: x.calcolata_il ?? null,
        origine: 'avanzo',
        conferma_id: d.id,
        versione: 1,
      }))(righe, { ...a, id: a.lotto_id }, famiglia);
    }
  },
  foto_pasto: (righe, d) => {
    righe.conferma_pasto = (righe.conferma_pasto ?? []).map((c) => (c.id === d.id ? { ...c, foto: d.foto ?? null, in_attesa: true } : c));
  },
  annulla_acquisto: (righe, d) => {
    const acquisto = (righe.acquisto ?? []).find((a) => a.id === d.id);
    if (!acquisto || acquisto.stato === 'annullato') return;
    righe.acquisto = (righe.acquisto ?? []).map((a) => (a === acquisto ? { ...a, stato: 'annullato', in_attesa: true } : a));
    for (const r of (righe.acquisto_riga ?? []).filter((x) => x.acquisto_id === d.id && x.lotto_id)) {
      cambiaQuantita(righe, String(r.lotto_id), (q) => q - Math.min(q, Number(r.quantita)));
    }
  },
  correggi_riga_acquisto: (righe, d) => {
    const riga = (righe.acquisto_riga ?? []).find((r) => r.id === d.id);
    if (!riga) return;
    const nuova = d.quantita_nuova == null ? null : Number(d.quantita_nuova);
    if (nuova !== null && riga.lotto_id) cambiaQuantita(righe, String(riga.lotto_id), (q) => q + nuova - Number(riga.quantita));
    righe.acquisto_riga = (righe.acquisto_riga ?? []).map((r) =>
      r === riga ? { ...r, ...(nuova !== null ? { quantita: nuova } : {}), ...('prezzo' in d ? { prezzo: d.prezzo } : {}), in_attesa: true } : r,
    );
  },
};

/** Una riga copiata senza identità né stato di sincronizzazione. */
function senzaChiavi(r: RigaInVista): Record<string, unknown> {
  const copia: Record<string, unknown> = { ...r };
  for (const k of ['id', 'seq', 'in_attesa', 'eliminato_il']) delete copia[k];
  return copia;
}

function cambiaQuantita(righe: Righe, id: string, nuova: (q: number) => number) {
  righe.lotto = (righe.lotto ?? []).map((r) => {
    if (r.id !== id) return r;
    const q = Math.max(0, nuova(Number(r.quantita)));
    return { ...r, quantita: q, chiuso_il: q === 0 ? 'in_attesa' : null, in_attesa: true };
  });
}

/** Righe del server con sopra l'effetto previsto dei comandi in attesa (o applicati ma non ancora scaricati), nell'ordine della coda. */
export function vistaConAnteprima(righe: Righe, coda: VoceCoda[]): Righe {
  const vista: Righe = {};
  for (const [t, elenco] of Object.entries(righe)) vista[t as Tabella] = [...(elenco ?? [])];
  for (const voce of coda) {
    if (voce.stato === 'da_sistemare') continue;
    EFFETTI[voce.comando.tipo]?.(vista, voce.comando.dati, voce.famiglia_id);
  }
  return vista;
}

/** Righe visibili: senza le cancellate. */
export function attive<T extends Riga>(righe: T[] | undefined): T[] {
  return (righe ?? []).filter((r) => !r.eliminato_il);
}
