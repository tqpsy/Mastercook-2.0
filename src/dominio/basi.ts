/**
 * Ricette collegate: una ricetta della famiglia può contenere una base (la besciamella fatta in casa…).
 * Il database copia gli ingredienti della base, per le dosi scelte, come righe della ricetta con
 * `da_ricetta_id`: spesa, consumi e allergie li leggono come gli altri. Qui si raggruppano per mostrarli.
 */
import type { Indice, Ricetta, RigaRicetta } from './ricette';

/** Le dosi che si possono scegliere: mezza, una, una e mezza, due. */
export const DOSI = [0.5, 1, 1.5, 2] as const;

export interface BaseCollegata {
  ricetta_id: string;
  dosi: number;
  righe: RigaRicetta[];
}

/** Le ricette «base» che si possono mettere dentro un'altra: non archiviate e senza basi a loro volta. */
export function basiDisponibili(indice: Indice, esclusa?: string): Ricetta[] {
  return indice.ricette.filter((r) => r.categoria === 'base' && !r.archiviata && r.id !== esclusa && !r.ingredienti.some((g) => g.da_ricetta_id));
}

/** Le righe scritte nella ricetta e quelle che vengono dalle basi, raggruppate per base. */
export function righeEBasi(r: Ricetta): { proprie: RigaRicetta[]; basi: BaseCollegata[] } {
  const proprie: RigaRicetta[] = [];
  const basi = new Map<string, BaseCollegata>();
  for (const g of r.ingredienti) {
    if (!g.da_ricetta_id) {
      proprie.push(g);
      continue;
    }
    const b = basi.get(g.da_ricetta_id) ?? { ricetta_id: g.da_ricetta_id, dosi: g.dosi ?? 1, righe: [] };
    b.righe.push(g);
    basi.set(g.da_ricetta_id, b);
  }
  return { proprie, basi: [...basi.values()] };
}

/** «mezza dose», «1 dose», «1,5 dosi». */
export function testoDosi(d: number): string {
  return d === 0.5 ? 'mezza dose' : d === 1 ? '1 dose' : `${d.toLocaleString('it-IT')} dosi`;
}

/** Il titolo della base, o un testo di riserva se non si trova più. */
export function titoloBase(indice: Indice, id: string): string {
  return indice.perId.get(id)?.titolo ?? 'Base';
}
