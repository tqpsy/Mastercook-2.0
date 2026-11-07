/**
 * Lettura della copia locale per la vista condivisa (vedi `VistaCondivisa` in contesto.tsx), senza lavoro inutile.
 *
 * - Le righe cambiano solo con uno scarico, che sposta anche il cursore nella stessa transazione (lo stesso fa
 *   l'eliminazione della famiglia, che lo toglie). Se il cursore non si è mosso, le righe sono quelle di prima e non
 *   si rileggono: mettere un comando in coda o segnarlo «inviato» costa solo la lettura della coda.
 * - Le righe si leggono per chiave primaria ([tabella+id]): Dexie osserva l'intervallo e non ogni singola chiave,
 *   che con decine di migliaia di righe costava secondi sul tablet a ogni modifica.
 * - Una tabella che dopo lo scarico ha le stesse righe (stessi id e stesse versioni) resta lo stesso array: i calcoli
 *   delle schermate che dipendono solo da quella tabella non si rifanno.
 */
import Dexie from 'dexie';
import { type RigaInVista, type Righe, vistaConAnteprima } from './anteprima';
import type { Archivio, RigaLocale, VoceCoda } from './archivio';
import type { Riga, Tabella } from './tipi';

export interface Letta {
  righe: Righe;
  coda: VoceCoda[];
}

interface Copia {
  cursore: number;
  /** Per tabella: le righe della famiglia e le loro versioni (seq), nello stesso ordine. */
  tabelle: Map<Tabella, { righe: Riga[]; seq: number[] }>;
}

function stesseRighe(prima: { righe: Riga[]; seq: number[] }, locali: RigaLocale[]): boolean {
  if (prima.righe.length !== locali.length) return false;
  for (let i = 0; i < locali.length; i++) if (prima.righe[i].id !== locali[i].id || prima.seq[i] !== locali[i].seq) return false;
  return true;
}

/**
 * Restituisce la funzione da passare a `liveQuery`: ogni chiamata legge, in una sola transazione, cursore, coda e
 * (solo se serve) righe, e ne fa la vista con l'anteprima della coda. Tiene l'ultima lettura per riusarla.
 */
export function lettoreVista(archivio: Archivio, famiglia: string, tabelle: readonly Tabella[]): () => Promise<Letta> {
  let copia: Copia | null = null;
  let ultima: { base: Righe; coda: VoceCoda[]; vista: Righe } | null = null;

  return () =>
    archivio.transaction('r', archivio.righe, archivio.coda, archivio.cursori, async () => {
      const cursore = await archivio.cursore(famiglia);
      const coda = await archivio.coda.where('famiglia_id').equals(famiglia).sortBy('ordine');
      let base: Righe;
      if (copia && copia.cursore === cursore) {
        base = ultima!.base;
      } else {
        const nuove: Copia = { cursore, tabelle: new Map() };
        base = {};
        for (const t of tabelle) {
          const locali = (await archivio.righe.where('[tabella+id]').between([t, Dexie.minKey], [t, Dexie.maxKey]).toArray()).filter(
            (r) => r.famiglia_id === famiglia,
          );
          const prima = copia?.tabelle.get(t);
          const voce = prima && stesseRighe(prima, locali) ? prima : { righe: locali.map((r) => r.riga), seq: locali.map((r) => r.seq) };
          nuove.tabelle.set(t, voce);
          base[t] = voce.righe as RigaInVista[];
        }
        // Se nessuna tabella è cambiata resta anche lo stesso oggetto.
        if (ultima && tabelle.every((t) => ultima!.base[t] === base[t])) base = ultima.base;
        copia = nuove;
      }
      const vista = ultima && ultima.base === base && stessaCoda(ultima.coda, coda) ? ultima.vista : vistaConAnteprima(base, coda);
      ultima = { base, coda, vista };
      return { righe: vista, coda };
    });
}

/**
 * Stesse voci con gli stessi dati, e da sistemare le stesse: l'anteprima verrebbe identica (un comando «inviato» ha
 * lo stesso effetto di uno «in attesa» finché lo scarico non porta le sue righe).
 */
function stessaCoda(a: VoceCoda[], b: VoceCoda[]): boolean {
  return (
    a.length === b.length &&
    a.every((v, i) => v.id === b[i].id && (v.stato === 'da_sistemare') === (b[i].stato === 'da_sistemare') && JSON.stringify(v.comando.dati) === JSON.stringify(b[i].comando.dati))
  );
}
