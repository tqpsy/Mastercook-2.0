/**
 * La famiglia aperta su questo dispositivo: archivio locale, sincronizzatore e azioni.
 */
import { liveQuery } from 'dexie';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ascoltaFamiglia, trasportoSupabase } from '../piattaforma/supabase';
import { Archivio, type VoceCoda } from './archivio';
import { attive, type RigaInVista, type Righe, vistaConAnteprima } from './anteprima';
import { pianifica, type Pianificatore } from './pianificatore';
import { Sincronizzatore, type StatoSincronizzazione } from './sincronizzatore';
import type { Tabella } from './tipi';

export interface Sessione {
  utenteId: string;
  famiglia: string;
  ruolo: 'amministratore' | 'membro';
}

interface ValoreContesto extends Sessione {
  archivio: Archivio;
  sync: Sincronizzatore;
  /** Mette in coda un comando e chiede di inviarlo subito. */
  esegui(tipo: string, dati: Record<string, unknown>): Promise<string>;
  pianificatore: Pianificatore;
}

const Contesto = createContext<ValoreContesto | null>(null);

export function nomeArchivio(utenteId: string) {
  return `mastercook-${utenteId}`;
}

export function idDispositivo(): string {
  try {
    let id = localStorage.getItem('mc-dispositivo');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('mc-dispositivo', id);
    }
    return id;
  } catch {
    return 'sconosciuto';
  }
}

/** Apre archivio e sincronizzazione una volta: per cambiare famiglia si monta di nuovo (key). */
export function FamigliaAperta({ sessione, children }: { sessione: Sessione; children: ReactNode }) {
  const [base] = useState(() => {
    const archivio = new Archivio(nomeArchivio(sessione.utenteId));
    const sync = new Sincronizzatore({ archivio, trasporto: trasportoSupabase, famiglia: sessione.famiglia, dispositivo: idDispositivo() });
    return { archivio, sync };
  });
  // Il ciclo di sincronizzazione vive finché la famiglia è aperta; `pianificatore` gira le richieste
  // al ciclo attivo (in sviluppo React monta e smonta due volte).
  const attivo = useRef<Pianificatore | null>(null);
  const pianificatore = useMemo<Pianificatore>(() => ({ subito: () => attivo.current?.subito(), ferma: () => attivo.current?.ferma() }), []);
  useEffect(() => {
    const p = pianifica(base.sync, { ascoltaServer: (avviso) => ascoltaFamiglia(sessione.famiglia, avviso) });
    attivo.current = p;
    return () => {
      p.ferma();
      if (attivo.current === p) attivo.current = null;
    };
  }, [base, sessione.famiglia]);

  const valore = useMemo<ValoreContesto>(
    () => ({
      ...sessione,
      ...base,
      pianificatore,
      async esegui(tipo: string, dati: Record<string, unknown>) {
        const id = await base.sync.accoda(tipo, dati);
        pianificatore.subito();
        return id;
      },
    }),
    [sessione, base, pianificatore],
  );

  return <Contesto.Provider value={valore}>{children}</Contesto.Provider>;
}

export function useFamiglia(): ValoreContesto {
  const c = useContext(Contesto);
  if (!c) throw new Error('useFamiglia fuori da FamigliaAperta');
  return c;
}

export function useStatoSync(): StatoSincronizzazione {
  const { sync } = useFamiglia();
  const [stato, setStato] = useState(sync.leggiStato());
  useEffect(() => sync.ascolta(setStato), [sync]);
  return stato;
}

const TABELLE: Tabella[] = [
  'famiglia',
  'utente_famiglia',
  'membro',
  'vincolo_alimentare',
  'invito',
  'ingrediente',
  'ricetta',
  'ricetta_ingrediente',
  'ricetta_passo',
  'lotto',
  'movimento',
  'categoria_pasto',
  'portata',
  'eccezione_membro',
  'gusto',
  'voce_spesa',
  'acquisto',
  'acquisto_riga',
  'prodotto',
  'scontrino',
  'scontrino_riga',
];

export interface Vista {
  righe: Righe;
  coda: VoceCoda[];
  pronta: boolean;
}

/** Copia locale con sopra l'anteprima della coda, aggiornata a ogni cambiamento dell'archivio. */
export function useVista(): Vista {
  const { archivio, famiglia } = useFamiglia();
  const [vista, setVista] = useState<Vista>({ righe: {}, coda: [], pronta: false });
  useEffect(() => {
    const osservata = liveQuery(async () => {
      const righe: Righe = {};
      for (const t of TABELLE) righe[t] = await archivio.righeDi(famiglia, t);
      const coda = await archivio.coda.where('famiglia_id').equals(famiglia).sortBy('ordine');
      return { righe: vistaConAnteprima(righe, coda), coda, pronta: true };
    });
    const s = osservata.subscribe({ next: setVista, error: () => undefined });
    return () => s.unsubscribe();
  }, [archivio, famiglia]);
  return vista;
}

export function righeAttive(vista: Vista, tabella: Tabella): RigaInVista[] {
  return attive(vista.righe[tabella]);
}
