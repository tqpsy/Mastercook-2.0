/**
 * Ingredienti che un comando doveva togliere dalla casa ma che in casa non c'erano (o non abbastanza):
 * `conferma_pasto`, `cucina_portata` e `usa_ricetta` li restituiscono in `mancanti`. Ricordarli serve a dire
 * alla persona che la casa e il pasto non coincidono (non l'ha comprato? non l'ha registrato?).
 */
import type { Indice } from './ricette';
import { formatta } from './unita';

export interface Mancante {
  ingrediente_id: string;
  unita: 'g' | 'ml' | 'pz';
  quantita: number;
}

/** Legge `mancanti` dal dettaglio di un esito; ignora ciò che non ha la forma attesa. */
export function mancantiDi(dettaglio: Record<string, unknown> | undefined): Mancante[] {
  const m = dettaglio?.mancanti;
  if (!Array.isArray(m)) return [];
  return m.flatMap((x): Mancante[] => {
    const r = x as Partial<Mancante> | null;
    const quantita = Number(r?.quantita);
    if (!r || typeof r.ingrediente_id !== 'string' || (r.unita !== 'g' && r.unita !== 'ml' && r.unita !== 'pz') || !(quantita > 0)) return [];
    return [{ ingrediente_id: r.ingrediente_id, unita: r.unita, quantita }];
  });
}

/** «300 g di pasta, 2 pz di uova»: nomi dal catalogo, in minuscolo. */
export function descriviMancanti(indice: Indice, mancanti: Mancante[]): string {
  return mancanti.map((m) => `${formatta({ valore: m.quantita, unita: m.unita })} di ${indice.nome(m.ingrediente_id).toLowerCase()}`).join(', ');
}
