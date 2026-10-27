/**
 * Esportazione dei dati della famiglia nel formato documentato `mastercook-2`
 * (docs/formato-esportazione.md) e controllo di un file prima del ripristino.
 */
import type { Riga, RigaScaricata, Tabella, Trasporto } from './tipi';

export const FORMATO = 'mastercook-2';
export const VERSIONE_FILE = 3;

/** Tabelle esportate: i dati della famiglia. Accessi, inviti e cronologia restano fuori. */
export const TABELLE_ESPORTATE = [
  'famiglia',
  'membro',
  'vincolo_alimentare',
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
] as const satisfies readonly Tabella[];

/** Le tabelle presenti nei file della versione 1, che si possono ancora ripristinare. */
const TABELLE_V1 = ['famiglia', 'membro', 'vincolo_alimentare'] as const;

export interface FileEsportazione {
  formato: typeof FORMATO;
  versione_schema: number;
  esportato_il: string;
  tabelle: Record<(typeof TABELLE_ESPORTATE)[number], Riga[]>;
  conteggi: Record<(typeof TABELLE_ESPORTATE)[number], number>;
}

/** Costruisce il file dalle righe scaricate: per ogni riga vale l'ultima versione ricevuta. */
export function componiFile(righe: RigaScaricata[], adesso: Date): FileEsportazione {
  const ultime = new Map<string, RigaScaricata>();
  for (const r of righe) {
    if (!(TABELLE_ESPORTATE as readonly string[]).includes(r.tabella)) continue;
    const chiave = `${r.tabella}:${r.riga.id}`;
    const prima = ultime.get(chiave);
    if (!prima || prima.seq < r.seq) ultime.set(chiave, r);
  }
  const tabelle = Object.fromEntries(TABELLE_ESPORTATE.map((t) => [t, [] as Riga[]])) as FileEsportazione['tabelle'];
  for (const r of [...ultime.values()].sort((a, b) => a.seq - b.seq)) {
    if (r.riga.eliminato_il) continue;
    tabelle[r.tabella as (typeof TABELLE_ESPORTATE)[number]].push(r.riga);
  }
  const conteggi = Object.fromEntries(TABELLE_ESPORTATE.map((t) => [t, tabelle[t].length])) as FileEsportazione['conteggi'];
  return { formato: FORMATO, versione_schema: VERSIONE_FILE, esportato_il: adesso.toISOString(), tabelle, conteggi };
}

/** Scarica dal server tutte le righe della famiglia e compone il file. Serve la rete. */
export async function esporta(trasporto: Trasporto, famiglia: string, adesso = new Date()): Promise<FileEsportazione> {
  const righe: RigaScaricata[] = [];
  let dopo = 0;
  for (;;) {
    const p = await trasporto.scarica(famiglia, dopo, 1000);
    if (p.errore) throw new Error(p.errore);
    righe.push(...p.righe);
    if (p.righe.length) dopo = p.righe[p.righe.length - 1].seq;
    if (!p.altre) break;
  }
  return componiFile(righe, adesso);
}

export type ControlloFile = { valido: true; file: FileEsportazione } | { valido: false; motivo: string };

/** Controllo sul dispositivo, prima di inviare: il server ricontrolla tutto comunque. */
export function controllaFile(testo: string): ControlloFile {
  let f: unknown;
  try {
    f = JSON.parse(testo);
  } catch {
    return { valido: false, motivo: 'Il file non è un’esportazione di Mastercook.' };
  }
  const file = f as Partial<FileEsportazione>;
  if (file?.formato !== FORMATO) return { valido: false, motivo: 'Il file non è un’esportazione di Mastercook.' };
  if (file.versione_schema !== 1 && file.versione_schema !== VERSIONE_FILE) {
    return { valido: false, motivo: 'Il file viene da una versione dell’app che questa non sa leggere.' };
  }
  const t = file.tabelle;
  if (!t || !Array.isArray(t.famiglia) || t.famiglia.length !== 1 || !Array.isArray(t.membro) || !Array.isArray(t.vincolo_alimentare)) {
    return { valido: false, motivo: 'Il file è incompleto.' };
  }
  const attese: readonly (typeof TABELLE_ESPORTATE)[number][] = file.versione_schema === 1 ? TABELLE_V1 : TABELLE_ESPORTATE;
  for (const k of attese) {
    if (!Array.isArray(t[k]) || file.conteggi?.[k] !== t[k].length) return { valido: false, motivo: 'Il file è stato modificato o è incompleto.' };
  }
  return { valido: true, file: file as FileEsportazione };
}
