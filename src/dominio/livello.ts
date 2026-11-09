/**
 * Prodotti «a occhio»: il formaggio, l'olio, il sale si usano senza pesare. Invece dei grammi si dicono i pezzi (o le
 * confezioni) e, a parole, quanto resta di quello in uso: tanto, metà, poco, sta per finire. Nel database il lotto ha
 * `livello` e unità «pz»: la quantità è il numero di pezzi. Le ricette non tolgono grammi da questi lotti; l'app avvisa
 * quando ne resta poco, e la spesa lo considera presente salvo l'ultimo pezzo che sta per finire.
 */
import type { Dimensione } from './unita';

export type Livello = 'tanto' | 'meta' | 'poco' | 'finendo';

export const LIVELLI: { id: Livello; nome: string; simbolo: string }[] = [
  { id: 'tanto', nome: 'Tanto', simbolo: '●●●●' },
  { id: 'meta', nome: 'Metà', simbolo: '●●○○' },
  { id: 'poco', nome: 'Poco', simbolo: '●○○○' },
  { id: 'finendo', nome: 'Sta per finire', simbolo: '○○○○' },
];

export const NOME_LIVELLO: Record<Livello, string> = { tanto: 'tanto', meta: 'metà', poco: 'poco', finendo: 'sta per finire' };

export function eLivello(x: unknown): x is Livello {
  return x === 'tanto' || x === 'meta' || x === 'poco' || x === 'finendo';
}

/** Si può tenere a occhio ciò che si pesa o si versa; ciò che si conta (uova) si conta e basta. */
export const puoAOcchio = (ing: { id: string; dimensione: Dimensione } | null | undefined) => !!ing && ing.dimensione !== 'pezzi' && ing.id !== 'ing:avanzo';

/** «Metà», «2 pezzi · metà». */
export function descriviLivello(pezzi: number, livello: Livello): string {
  const nome = NOME_LIVELLO[livello];
  return pezzi > 1 ? `${pezzi} pezzi · ${nome}` : nome.charAt(0).toUpperCase() + nome.slice(1);
}

interface LottoAOcchio {
  ingrediente_id: string;
  quantita: number;
  livello?: Livello | null;
}

/** Vero se di un prodotto a occhio resta poco: un pezzo solo, «poco» o «sta per finire». */
export const eBasso = (l: LottoAOcchio) => !!l.livello && l.quantita <= 1 && (l.livello === 'poco' || l.livello === 'finendo');

export interface ScortaAOcchio {
  /** Il livello più basso tra i lotti a occhio dell'ingrediente (o dei suoi «figli»). */
  livello: Livello;
  pezzi: number;
  /** Ce n'è anche di misurato (in grammi o ml). */
  misurato: boolean;
}

/**
 * Per ogni ingrediente delle ricette, come sta a occhio la casa: solo per gli ingredienti che hanno almeno un lotto a
 * occhio. `antenati` dà l'ingrediente e i suoi antenati (il parmigiano vale anche come «formaggio»).
 */
export function scorteAOcchio(lotti: LottoAOcchio[], antenati: (id: string) => string[]): Map<string, ScortaAOcchio> {
  const ordine: Livello[] = ['finendo', 'poco', 'meta', 'tanto'];
  const mappa = new Map<string, ScortaAOcchio>();
  for (const l of lotti) {
    if (l.quantita <= 0) continue;
    for (const id of antenati(l.ingrediente_id)) {
      const prima = mappa.get(id) ?? { livello: 'tanto' as Livello, pezzi: 0, misurato: false };
      if (!l.livello) mappa.set(id, { ...prima, misurato: true });
      else {
        // Con un pezzo nuovo in più, quello aperto che finisce non preoccupa: conta il più pieno.
        const piu = prima.pezzi + l.quantita;
        const livello = prima.pezzi === 0 ? l.livello : ordine[Math.max(ordine.indexOf(prima.livello), ordine.indexOf(l.livello))];
        mappa.set(id, { ...prima, pezzi: piu, livello });
      }
    }
  }
  for (const [id, s] of mappa) if (s.pezzi === 0) mappa.delete(id);
  return mappa;
}

/** L'avviso per un ingrediente di una ricetta, o null se non è a occhio o ce n'è abbastanza. */
export function avvisoScorta(s: ScortaAOcchio | undefined): string | null {
  if (!s || s.misurato || s.pezzi > 1) return null;
  if (s.livello === 'finendo') return 'sta per finire: controlla se basta';
  if (s.livello === 'poco') return 'ne resta poco: controlla se basta';
  return null;
}
