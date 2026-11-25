/**
 * Dalla riga dello scontrino al prodotto: l'ingrediente più probabile per una descrizione, la quantità da caricare in casa,
 * e ciò che Open Food Facts dice di un codice a barre.
 */
import { type Indice, type Ingrediente, normalizza } from './ricette';
import { formatoDaDescrizione } from './scontrini-righe';
import type { RigaLetta } from './scontrini-tipi';
import type { UnitaBase } from './unita';

const PAROLE_VUOTE = new Set(['gr', 'kg', 'ml', 'cl', 'lt', 'pz', 'conf', 'bio', 'gr', 'x', 'al', 'di', 'da', 'con', 'in', 'e', 'il', 'la', 'le', 'per', 'tipo']);

/** Le parole della descrizione che dicono qualcosa: senza numeri, unità di misura e parole vuote. */
export function parole(descrizione: string): string[] {
  return normalizza(descrizione)
    .split(' ')
    .filter((p) => p.length >= 3 && !/\d/.test(p) && !PAROLE_VUOTE.has(p));
}

/**
 * Ciò che sullo scontrino non è un alimento né una scorta di casa: sacchetti del banco e shopper, abiti, spazzolino e collutorio.
 * Mai un ingrediente: il prefisso di una parola («dent» come dentice, «sacchetto» come ghiaccio) li farebbe entrare in casa.
 */
const NON_ALIMENTO =
  /\b(SHOPPER|SACCHETTO DI CONFEZ\w*|NS SACCHETTO|SACCH\.? ?ORTOFR\w*|SACCHETTO COMPOST\w*|GONNA|CARDIGAN|MAGLIA|MAGLIETTA|CAMICIA|CAMICETTA|PANTALON\w*|GIACCA|CALZINI|COLLANT|MENTADENT|COLLUTORIO|DENTIFRICIO|TESTINE|SALVASLIP)\b/;

/** L'ingrediente più probabile per una descrizione dello scontrino, o undefined se non c'è un buon candidato. */
export function suggerisciIngrediente(descrizione: string, indice: Indice): Ingrediente | undefined {
  if (NON_ALIMENTO.test(descrizione.toUpperCase())) return undefined;
  const p = parole(descrizione);
  const tentativi = [p.join(' '), ...p.slice(0, -1).map((x, i) => `${x} ${p[i + 1]}`), ...p, ...p.filter((x) => x.length >= 5).map((x) => x.slice(0, -1))];
  // Quante parole della descrizione ha il nome (o sinonimo) che ne ha di più: «macinato tacchino pollo»
  // è il macinato di pollo o tacchino, non la carne macinata, anche se «macinato» da solo è quella.
  // A parità di parole in comune vince il nome con meno parole in più: «petto di pollo» è il petto di pollo, non «petto di pollo arrosto».
  const comuni = (i: Ingrediente) => Math.max(...[i.nome, ...i.sinonimi].map((n) => normalizza(n).split(' ')).map((w) => { const c = p.filter((x) => w.includes(x)).length; return c * 100 - (w.length - c); }));
  for (const t of tentativi) {
    if (!t) continue;
    // Solo se una parola del nome inizia con il testo cercato: «latte» sì, «atte» no.
    const buoni = indice
      .cercaIngredienti(t)
      .filter((i) => [i.nome, ...i.sinonimi].map(normalizza).some((n) => n.split(' ').some((w) => w.startsWith(t.split(' ')[0]))));
    if (!buoni.length) continue;
    // A parità di parole in comune resta il primo della ricerca (nome uguale prima di nome che inizia così).
    return buoni.reduce((meglio, i) => (comuni(i) > comuni(meglio) ? i : meglio));
  }
  return undefined;
}

/** La quantità da caricare in casa per una riga, nell'unità base dell'ingrediente, o null se non si sa. */
export function quantitaProposta(riga: RigaLetta, ingrediente: Pick<Ingrediente, 'dimensione' | 'peso_pz'>): { quantita: number; unita: UnitaBase } | null {
  if (ingrediente.dimensione === 'massa' && riga.grammi) return { quantita: riga.grammi, unita: 'g' };
  const base: UnitaBase = ingrediente.dimensione === 'massa' ? 'g' : ingrediente.dimensione === 'volume' ? 'ml' : 'pz';
  if (riga.formato && riga.formato.unita === base) return { quantita: riga.formato.quantita * (riga.pezzi ?? 1), unita: base };
  if (base === 'pz') return { quantita: riga.pezzi ?? 1, unita: 'pz' };
  // «ZUCCHINE 3 x 0,60»: si conta a pezzi, se si sa quanto pesa un pezzo (diventano grammi all'importazione).
  if (ingrediente.peso_pz && riga.pezzi) return { quantita: riga.pezzi, unita: 'pz' };
  return null;
}

/** Ciò che Open Food Facts dice di un codice a barre: solo nome e formato, da confermare. */
export interface ProdottoEsterno {
  nome: string;
  formato?: { quantita: number; unita: UnitaBase };
}

/** Legge la risposta di Open Food Facts (api/v3/product, accetta anche la v2); undefined se il prodotto non c'è. */
export function daOpenFoodFacts(risposta: unknown): ProdottoEsterno | undefined {
  const r = risposta as { status?: unknown; product?: Record<string, unknown> } | null;
  const p = r?.product;
  if (!p || r?.status === 0 || r?.status === 'failure') return undefined;
  const nome = [p.product_name_it, p.product_name, p.generic_name_it].find((x): x is string => typeof x === 'string' && x.trim() !== '')?.trim();
  if (!nome) return undefined;
  const marca = typeof p.brands === 'string' ? p.brands.split(',')[0].trim() : '';
  const tutto = marca && !nome.toLowerCase().includes(marca.toLowerCase()) ? `${nome} ${marca}` : nome;
  const q = Number(p.product_quantity);
  const u = String(p.product_quantity_unit ?? '').toLowerCase();
  let formato: ProdottoEsterno['formato'];
  if (q > 0 && (u === 'g' || u === 'ml')) formato = { quantita: q, unita: u };
  else if (typeof p.quantity === 'string') formato = formatoDaDescrizione(p.quantity);
  return { nome: tutto.slice(0, 120), ...(formato ? { formato } : {}) };
}

