/**
 * Dalla foto del frigo alle proposte per la casa: ogni alimento riconosciuto da Gemini si abbina a un
 * ingrediente del catalogo. Quello che non si riconosce resta fuori (si aggiunge a mano), le quantità
 * sono solo suggerite e si correggono prima di confermare.
 */
import type { Indice, Ingrediente } from './ricette';
import { UNITA_BASE, type UnitaBase } from './unita';

export interface Riconosciuto {
  nome: string;
  quantita: number | null;
  unita: 'g' | 'ml' | 'pz' | null;
}

export interface PropostaFoto {
  nome: string;
  ingrediente: Ingrediente | null;
  /** Nell'unità dell'ingrediente; null se dalla foto non si capisce (va scritta). */
  quantita: number | null;
  unita: UnitaBase | null;
}

export function abbinaAlimenti(indice: Indice, alimenti: Riconosciuto[]): PropostaFoto[] {
  const visti = new Set<string>();
  const esito: PropostaFoto[] = [];
  for (const a of alimenti) {
    const ingrediente = indice.cercaIngredienti(a.nome, 1)[0] ?? null;
    if (ingrediente && visti.has(ingrediente.id)) continue;
    if (ingrediente) visti.add(ingrediente.id);
    const unita = ingrediente ? UNITA_BASE[ingrediente.dimensione] : null;
    const quantita = ingrediente && a.quantita !== null && a.unita === unita ? a.quantita : null;
    esito.push({ nome: a.nome, ingrediente, quantita, unita });
  }
  // Prima quelli riconosciuti, poi quelli da aggiungere a mano.
  return [...esito.filter((x) => x.ingrediente), ...esito.filter((x) => !x.ingrediente)];
}
