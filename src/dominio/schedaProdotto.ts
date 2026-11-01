/**
 * La scheda di un prodotto confezionato come la dà Open Food Facts (API v3): tutti i valori
 * nutrizionali dichiarati, l'elenco completo degli ingredienti, allergeni, additivi e gli indicatori
 * ufficiali che la banca dati calcola (NOVA, Nutri-Score, livelli di grassi/zuccheri/sale).
 *
 * L'app non inventa voti propri: mostra i dati e gli indicatori pubblicati, dicendo da dove vengono.
 */

/** Campi chiesti a Open Food Facts: solo quelli che servono, per una risposta leggera. */
export const CAMPI_OFF = [
  'code',
  'product_name',
  'product_name_it',
  'generic_name_it',
  'brands',
  'quantity',
  'product_quantity',
  'product_quantity_unit',
  'serving_size',
  'nutriments',
  'nutrition_data_per',
  'no_nutrition_data',
  'ingredients_text_it',
  'ingredients_text',
  'ingredients',
  'allergens_tags',
  'traces_tags',
  'additives_tags',
  'nova_group',
  'nutriscore_grade',
  'nutrient_levels',
  'labels_tags',
  'last_modified_t',
] as const;

export interface ValoreNutrizionale {
  /** Chiave di Open Food Facts, es. "saturated-fat". */
  chiave: string;
  nome: string;
  /** Valore per 100 g (o 100 ml), già nell'unità da mostrare. */
  per100?: number;
  /** Valore per porzione, se dichiarato. */
  perPorzione?: number;
  unita: string;
  /** Rientrato sotto la voce principale (es. «di cui zuccheri»). */
  sotto: boolean;
}

export interface Ingrediente {
  nome: string;
  /** Percentuale dichiarata in etichetta (non la stima di Open Food Facts). */
  percentuale?: number;
  sotto?: Ingrediente[];
}

export type Livello = 'basso' | 'moderato' | 'alto';

export interface SchedaProdotto {
  codice: string;
  valori: ValoreNutrizionale[];
  /** "100 ml" per le bevande, altrimenti "100 g". */
  base: '100 g' | '100 ml';
  porzione?: string;
  /** Testo completo degli ingredienti come in etichetta; `linguaIngredienti` dice se non è in italiano. */
  ingredienti?: string;
  linguaIngredienti?: 'it' | 'altra';
  elencoIngredienti: Ingrediente[];
  allergeni: string[];
  tracce: string[];
  /** Sigle degli additivi, es. "E330". */
  additivi: string[];
  /** NOVA 1–4: grado di lavorazione (Monteiro et al., Università di San Paolo). */
  nova?: 1 | 2 | 3 | 4;
  /** Nutri-Score A–E (algoritmo ufficiale adottato da Santé publique France e altri Paesi UE). */
  nutriScore?: 'A' | 'B' | 'C' | 'D' | 'E';
  /** Livelli per 100 g secondo le soglie del Regno Unito (FSA), usate da Open Food Facts. */
  livelli: Partial<Record<'grassi' | 'grassi saturi' | 'zuccheri' | 'sale', Livello>>;
  biologico: boolean;
  /** Data dell'ultima modifica della scheda su Open Food Facts (AAAA-MM-GG). */
  aggiornataIl?: string;
}

type Unita = 'kcal' | 'kJ' | 'g' | 'mg' | 'µg' | '%';

/**
 * Le voci nell'ordine dell'etichetta europea (Reg. UE 1169/2011), poi vitamine e minerali.
 * `u` è l'unità in cui si mostra; Open Food Facts salva i valori per 100 g in grammi.
 */
const VOCI: { k: string; nome: string; u: Unita; sotto?: boolean }[] = [
  { k: 'energy-kj', nome: 'Energia', u: 'kJ' },
  { k: 'energy-kcal', nome: 'Energia', u: 'kcal' },
  { k: 'fat', nome: 'Grassi', u: 'g' },
  { k: 'saturated-fat', nome: 'di cui saturi', u: 'g', sotto: true },
  { k: 'monounsaturated-fat', nome: 'di cui monoinsaturi', u: 'g', sotto: true },
  { k: 'polyunsaturated-fat', nome: 'di cui polinsaturi', u: 'g', sotto: true },
  { k: 'trans-fat', nome: 'di cui grassi trans', u: 'g', sotto: true },
  { k: 'omega-3-fat', nome: 'omega 3', u: 'g', sotto: true },
  { k: 'omega-6-fat', nome: 'omega 6', u: 'g', sotto: true },
  { k: 'cholesterol', nome: 'Colesterolo', u: 'mg' },
  { k: 'carbohydrates', nome: 'Carboidrati', u: 'g' },
  { k: 'sugars', nome: 'di cui zuccheri', u: 'g', sotto: true },
  { k: 'added-sugars', nome: 'di cui zuccheri aggiunti', u: 'g', sotto: true },
  { k: 'lactose', nome: 'di cui lattosio', u: 'g', sotto: true },
  { k: 'polyols', nome: 'di cui polioli', u: 'g', sotto: true },
  { k: 'starch', nome: 'di cui amido', u: 'g', sotto: true },
  { k: 'fiber', nome: 'Fibre', u: 'g' },
  { k: 'proteins', nome: 'Proteine', u: 'g' },
  { k: 'salt', nome: 'Sale', u: 'g' },
  { k: 'sodium', nome: 'Sodio', u: 'mg' },
  { k: 'alcohol', nome: 'Alcol', u: '%' },
  { k: 'vitamin-a', nome: 'Vitamina A', u: 'µg' },
  { k: 'vitamin-d', nome: 'Vitamina D', u: 'µg' },
  { k: 'vitamin-e', nome: 'Vitamina E', u: 'mg' },
  { k: 'vitamin-k', nome: 'Vitamina K', u: 'µg' },
  { k: 'vitamin-c', nome: 'Vitamina C', u: 'mg' },
  { k: 'vitamin-b1', nome: 'Tiamina (B1)', u: 'mg' },
  { k: 'vitamin-b2', nome: 'Riboflavina (B2)', u: 'mg' },
  { k: 'vitamin-pp', nome: 'Niacina (B3)', u: 'mg' },
  { k: 'pantothenic-acid', nome: 'Acido pantotenico (B5)', u: 'mg' },
  { k: 'vitamin-b6', nome: 'Vitamina B6', u: 'mg' },
  { k: 'biotin', nome: 'Biotina (B8)', u: 'µg' },
  { k: 'vitamin-b9', nome: 'Folati (B9)', u: 'µg' },
  { k: 'folates', nome: 'Folati', u: 'µg' },
  { k: 'vitamin-b12', nome: 'Vitamina B12', u: 'µg' },
  { k: 'potassium', nome: 'Potassio', u: 'mg' },
  { k: 'chloride', nome: 'Cloruro', u: 'mg' },
  { k: 'calcium', nome: 'Calcio', u: 'mg' },
  { k: 'phosphorus', nome: 'Fosforo', u: 'mg' },
  { k: 'magnesium', nome: 'Magnesio', u: 'mg' },
  { k: 'iron', nome: 'Ferro', u: 'mg' },
  { k: 'zinc', nome: 'Zinco', u: 'mg' },
  { k: 'copper', nome: 'Rame', u: 'mg' },
  { k: 'manganese', nome: 'Manganese', u: 'mg' },
  { k: 'fluoride', nome: 'Fluoro', u: 'mg' },
  { k: 'selenium', nome: 'Selenio', u: 'µg' },
  { k: 'chromium', nome: 'Cromo', u: 'µg' },
  { k: 'molybdenum', nome: 'Molibdeno', u: 'µg' },
  { k: 'iodine', nome: 'Iodio', u: 'µg' },
  { k: 'caffeine', nome: 'Caffeina', u: 'mg' },
  { k: 'taurine', nome: 'Taurina', u: 'mg' },
];

/** Chiavi di `nutriments` che non sono valori nutrizionali (indici e punteggi calcolati). */
const NON_NUTRIENTI = /^(nova|nutrition-score|fruits-vegetables|carbon-footprint|ph|cocoa|collagen|energy$)/;

const FATTORE: Record<Unita, number> = { kcal: 1, kJ: 1, '%': 1, g: 1, mg: 1000, µg: 1_000_000 };

const ALLERGENI: Record<string, string> = {
  gluten: 'glutine',
  crustaceans: 'crostacei',
  eggs: 'uova',
  fish: 'pesce',
  peanuts: 'arachidi',
  soybeans: 'soia',
  milk: 'latte',
  nuts: 'frutta a guscio',
  celery: 'sedano',
  mustard: 'senape',
  'sesame-seeds': 'sesamo',
  'sulphur-dioxide-and-sulphites': 'anidride solforosa e solfiti',
  lupin: 'lupini',
  molluscs: 'molluschi',
};

const LIVELLI: Record<string, Livello> = { low: 'basso', moderate: 'moderato', high: 'alto' };
const NOMI_LIVELLI = { fat: 'grassi', 'saturated-fat': 'grassi saturi', sugars: 'zuccheri', salt: 'sale' } as const;

function numero(x: unknown): number | undefined {
  const n = typeof x === 'string' ? Number(x.replace(',', '.')) : x;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

function arrotonda(n: number): number {
  const a = Math.abs(n);
  const cifre = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
  return Number(n.toFixed(cifre));
}

/** "en:sesame-seeds" → "sesamo"; un tag sconosciuto diventa leggibile ("it:arachidi" → "arachidi"). */
function nomeTag(tag: string, nomi: Record<string, string> = {}): string {
  const [, valore = tag] = tag.split(':');
  return nomi[valore] ?? valore.replace(/-/g, ' ');
}

function valori(n: Record<string, unknown>): ValoreNutrizionale[] {
  const risultato: ValoreNutrizionale[] = [];
  const noti = new Set(VOCI.map((v) => v.k));
  for (const v of VOCI) {
    const per100 = numero(n[`${v.k}_100g`]);
    const perPorzione = numero(n[`${v.k}_serving`]);
    if (per100 === undefined && perPorzione === undefined) continue;
    const f = FATTORE[v.u];
    risultato.push({
      chiave: v.k,
      nome: v.nome,
      unita: v.u,
      sotto: !!v.sotto,
      ...(per100 !== undefined ? { per100: arrotonda(per100 * f) } : {}),
      ...(perPorzione !== undefined ? { perPorzione: arrotonda(perPorzione * f) } : {}),
    });
  }
  // Ciò che l'etichetta dichiara oltre alle voci note non si perde: si mostra con il nome della banca dati.
  for (const chiave of Object.keys(n)) {
    const m = /^(.+)_100g$/.exec(chiave);
    if (!m || noti.has(m[1]) || NON_NUTRIENTI.test(m[1])) continue;
    const per100 = numero(n[chiave]);
    if (per100 === undefined) continue;
    const unita = String(n[`${m[1]}_unit`] ?? 'g');
    const u: Unita = unita === 'mg' || unita === 'µg' || unita === '%' ? unita : 'g';
    risultato.push({ chiave: m[1], nome: m[1].replace(/-/g, ' '), per100: arrotonda(per100 * FATTORE[u]), unita: u, sotto: false });
  }
  return risultato;
}

function ingredienti(lista: unknown, profondita = 0): Ingrediente[] {
  if (!Array.isArray(lista) || profondita > 3) return [];
  return lista.flatMap((x: Record<string, unknown>) => {
    const nome = typeof x?.text === 'string' ? x.text.replace(/_/g, '').trim() : '';
    if (!nome) return [];
    const percentuale = numero(x.percent);
    const sotto = ingredienti(x.ingredients, profondita + 1);
    return [{ nome, ...(percentuale !== undefined ? { percentuale: arrotonda(percentuale) } : {}), ...(sotto.length ? { sotto } : {}) }];
  });
}

function tag(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((t): t is string => typeof t === 'string' && t !== '') : [];
}

/** Legge la risposta di Open Food Facts (api/v3/product, ma accetta anche la v2); undefined se il prodotto non c'è. */
export function schedaDaOpenFoodFacts(risposta: unknown): SchedaProdotto | undefined {
  const r = risposta as { status?: unknown; code?: unknown; product?: Record<string, unknown> } | null;
  const p = r?.product;
  if (!p || r?.status === 0 || r?.status === 'failure') return undefined;
  const n = (p.nutriments && typeof p.nutriments === 'object' ? p.nutriments : {}) as Record<string, unknown>;
  const testoIt = typeof p.ingredients_text_it === 'string' ? p.ingredients_text_it.trim() : '';
  const testo = typeof p.ingredients_text === 'string' ? p.ingredients_text.trim() : '';
  const nova = numero(p.nova_group);
  const ns = typeof p.nutriscore_grade === 'string' ? p.nutriscore_grade.toUpperCase() : '';
  const liv = (p.nutrient_levels && typeof p.nutrient_levels === 'object' ? p.nutrient_levels : {}) as Record<string, unknown>;
  const livelli: SchedaProdotto['livelli'] = {};
  for (const [k, nome] of Object.entries(NOMI_LIVELLI)) {
    const l = LIVELLI[String(liv[k])];
    if (l) livelli[nome] = l;
  }
  const t = numero(p.last_modified_t);
  // Le bevande hanno i valori per 100 ml: Open Food Facts lo dice con l'unità del formato.
  const base = String(p.product_quantity_unit ?? '').toLowerCase() === 'ml' || /\d\s*(ml|cl|l)\b/i.test(String(p.quantity ?? '')) ? '100 ml' : '100 g';
  const ingredientiTesto = (testoIt || testo).replace(/_/g, '');
  return {
    codice: String(r?.code ?? p.code ?? ''),
    valori: p.no_nutrition_data === 'on' ? [] : valori(n),
    base,
    ...(typeof p.serving_size === 'string' && p.serving_size.trim() ? { porzione: p.serving_size.trim() } : {}),
    ...(ingredientiTesto ? { ingredienti: ingredientiTesto, linguaIngredienti: testoIt ? 'it' : 'altra' } : {}),
    elencoIngredienti: ingredienti(p.ingredients),
    allergeni: tag(p.allergens_tags).map((x) => nomeTag(x, ALLERGENI)),
    tracce: tag(p.traces_tags).map((x) => nomeTag(x, ALLERGENI)),
    additivi: tag(p.additives_tags).map((x) => nomeTag(x).toUpperCase()),
    ...(nova === 1 || nova === 2 || nova === 3 || nova === 4 ? { nova } : {}),
    ...(/^[A-E]$/.test(ns) ? { nutriScore: ns as SchedaProdotto['nutriScore'] } : {}),
    livelli,
    biologico: tag(p.labels_tags).some((x) => /^en:(organic|eu-organic)$/.test(x)),
    ...(t ? { aggiornataIl: new Date(t * 1000).toISOString().slice(0, 10) } : {}),
  };
}

/** Le spiegazioni ufficiali, in breve, dei quattro gruppi NOVA. */
export const SIGNIFICATO_NOVA: Record<1 | 2 | 3 | 4, string> = {
  1: 'Alimento non lavorato o minimamente lavorato',
  2: 'Ingrediente culinario lavorato (olio, burro, zucchero, sale…)',
  3: 'Alimento lavorato',
  4: 'Alimento ultra-lavorato',
};

/** True se la scheda non ha niente da mostrare oltre al nome. */
export function schedaVuota(s: SchedaProdotto): boolean {
  return !s.valori.length && !s.ingredienti && !s.elencoIngredienti.length && !s.allergeni.length && !s.tracce.length && !s.additivi.length && !s.nova && !s.nutriScore;
}
