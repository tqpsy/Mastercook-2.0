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
  modifica_famiglia: (righe, d, famiglia) => modifica('famiglia')(righe, { ...d, id: famiglia }, famiglia),
};

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
