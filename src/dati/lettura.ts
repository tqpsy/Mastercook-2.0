/**
 * Lettura della copia locale per la vista condivisa (vedi `VistaCondivisa` in contesto.tsx), senza lavoro inutile.
 *
 * - Le righe cambiano solo con uno scarico, che sposta anche il cursore nella stessa transazione (lo stesso fa
 *   l'eliminazione della famiglia, che lo toglie). Se il cursore non si è mosso, le righe sono quelle di prima e non
 *   si rileggono: mettere un comando in coda o segnarlo «inviato» costa solo la lettura della coda.
 * - Le righe si leggono per chiave primaria ([tabella+id]): Dexie osserva l'intervallo e non ogni singola chiave,
 *   che con decine di migliaia di righe costava secondi sul tablet a ogni modifica.
 * - Dopo uno scarico si leggono solo le righe arrivate (seq tra il cursore di prima e quello nuovo, indice
 *   [famiglia_id+seq]) e si mettono al loro posto; la prima volta, o se il cursore torna indietro, si legge tutto.
 * - Una tabella senza righe nuove resta lo stesso array: i calcoli delle schermate che dipendono solo da quella
 *   tabella non si rifanno.
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
      } else if (copia && cursore > copia.cursore) {
        const arrivate = await archivio.righe.where('[famiglia_id+seq]').between([famiglia, copia.cursore], [famiglia, cursore], false, true).toArray();
        const aggiornate = aggiorna(copia.tabelle, arrivate);
        const cambiate = [...aggiornate].filter(([t, voce]) => voce !== copia!.tabelle.get(t));
        base = cambiate.length ? { ...ultima!.base } : ultima!.base;
        for (const [t, voce] of cambiate) base[t] = voce.righe as RigaInVista[];
        copia = { cursore, tabelle: aggiornate };
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

/** Le tabelle con dentro le righe appena arrivate: nuove in ordine di id (come la chiave primaria), le altre al loro posto. */
function aggiorna(prima: Copia['tabelle'], arrivate: RigaLocale[]): Copia['tabelle'] {
  const perTabella = new Map<Tabella, RigaLocale[]>();
  for (const r of arrivate) {
    if (!prima.has(r.tabella)) continue;
    const elenco = perTabella.get(r.tabella);
    if (elenco) elenco.push(r);
    else perTabella.set(r.tabella, [r]);
  }
  const dopo = new Map(prima);
  for (const [t, nuove] of perTabella) {
    const { righe, seq } = prima.get(t)!;
    const posto = new Map(righe.map((r, i) => [r.id, i]));
    const r2 = [...righe];
    const s2 = [...seq];
    const aggiunte: RigaLocale[] = [];
    for (const n of nuove) {
      const i = posto.get(n.id);
      if (i === undefined) aggiunte.push(n);
      else {
        r2[i] = n.riga;
        s2[i] = n.seq;
      }
    }
    if (!aggiunte.length) {
      dopo.set(t, { righe: r2, seq: s2 });
      continue;
    }
    const tutte = [...r2.map((riga, i) => ({ riga, seq: s2[i] })), ...aggiunte.map((n) => ({ riga: n.riga, seq: n.seq }))].sort((a, b) =>
      a.riga.id < b.riga.id ? -1 : a.riga.id > b.riga.id ? 1 : 0,
    );
    dopo.set(t, { righe: tutte.map((x) => x.riga), seq: tutte.map((x) => x.seq) });
  }
  return dopo;
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
