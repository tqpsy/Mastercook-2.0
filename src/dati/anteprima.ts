/**
 * Anteprima delle modifiche in coda: mostra subito l'effetto previsto dei comandi non ancora
 * applicati dal server, marcando le righe come «in attesa». Non scrive nulla: quando il server
 * risponde, la copia locale scaricata prende il posto dell'anteprima.
 */
import type { VoceCoda } from './archivio';
import type { Riga, Tabella } from './tipi';

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
};

function cambiaQuantita(righe: Righe, id: string, nuova: (q: number) => number) {
  righe.lotto = (righe.lotto ?? []).map((r) => {
    if (r.id !== id) return r;
    const q = Math.max(0, nuova(Number(r.quantita)));
    return { ...r, quantita: q, chiuso_il: q === 0 ? 'in_attesa' : null, in_attesa: true };
  });
}

/** Righe del server con sopra l'effetto previsto dei comandi in attesa, nell'ordine della coda. */
export function vistaConAnteprima(righe: Righe, coda: VoceCoda[]): Righe {
  const vista: Righe = {};
  for (const [t, elenco] of Object.entries(righe)) vista[t as Tabella] = [...(elenco ?? [])];
  for (const voce of coda) {
    if (voce.stato !== 'in_attesa') continue;
    EFFETTI[voce.comando.tipo]?.(vista, voce.comando.dati, voce.famiglia_id);
  }
  return vista;
}

/** Righe visibili: senza le cancellate. */
export function attive<T extends Riga>(righe: T[] | undefined): T[] {
  return (righe ?? []).filter((r) => !r.eliminato_il);
}
