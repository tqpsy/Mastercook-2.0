/**
 * Il «tipo di ingrediente principale» di una ricetta (pasta, carne, pesce…), per filtrare idee e ricerca
 * quando si sceglie un piatto per un pasto. Una ricetta può averne più di uno (pasta e pesce).
 * Si guardano solo gli ingredienti che contano: niente facoltativi, dispensa di base, «q.b.», aromi e
 * soffritto (aglio, cipolla, carota…), né formaggi grattugiati sopra.
 */
import { type Indice, principali, type Ricetta, type RigaRicetta } from './ricette';

export type Principale = 'pasta' | 'riso' | 'carne' | 'pesce' | 'uova' | 'legumi' | 'formaggi' | 'verdure';

export const PRINCIPALI: { id: Principale; nome: string; emoji: string }[] = [
  { id: 'pasta', nome: 'Pasta', emoji: '🍝' },
  { id: 'riso', nome: 'Riso', emoji: '🍚' },
  { id: 'carne', nome: 'Carne', emoji: '🥩' },
  { id: 'pesce', nome: 'Pesce', emoji: '🐟' },
  { id: 'uova', nome: 'Uova', emoji: '🥚' },
  { id: 'legumi', nome: 'Legumi', emoji: '🫘' },
  { id: 'formaggi', nome: 'Formaggi', emoji: '🧀' },
  { id: 'verdure', nome: 'Verdure', emoji: '🥦' },
];

const PASTA = [
  'ing:pasta',
  'ing:pasta_uovo',
  'ing:lasagne',
  'ing:pasta_ripiena',
  'ing:pasta_integrale',
  'ing:pasta_senza_glutine',
  'ing:pastina',
  'ing:gnocchi',
];
const LEGUMI = ['ing:ceci', 'ing:fagioli', 'ing:lenticchie', 'ing:piselli', 'ing:fave', 'ing:lupini', 'ing:cicerchie', 'ing:edamame'];
/** Latticini che non fanno di un piatto «un piatto di formaggio». */
const NON_FORMAGGI = ['ing:burro', 'ing:latte', 'ing:panna', 'ing:yogurt'];
/** Formaggi che di solito si grattugiano sopra: contano solo in quantità da piatto (dai 100 g). */
const GRATTUGIATI = ['ing:parmigiano', 'ing:grana', 'ing:pecorino'];
/** Aromi, soffritto e frutta: sono nel reparto frutta e verdura ma non rendono un piatto «di verdure». */
const NON_VERDURE = [
  'ing:aglio',
  'ing:cipolla',
  'ing:cipollotto',
  'ing:scalogno',
  'ing:carota',
  'ing:sedano',
  'ing:zenzero',
  'ing:basilico',
  'ing:prezzemolo',
  'ing:rosmarino',
  'ing:salvia',
  'ing:menta',
  'ing:aneto',
  'ing:coriandolo',
  'ing:erba_cipollina',
  'ing:maggiorana',
  'ing:limone',
  'ing:lime',
  'ing:mela',
  'ing:pera',
  'ing:banana',
  'ing:pesca',
  'ing:albicocca',
  'ing:susine',
  'ing:ciliegie',
  'ing:fragole',
  'ing:frutti_bosco',
  'ing:uva',
  'ing:anguria',
  'ing:melone',
  'ing:fichi',
  'ing:cachi',
  'ing:melograno',
  'ing:arancia',
  'ing:mandarino',
  'ing:pompelmo',
  'ing:kiwi',
  'ing:ananas',
  'ing:mango',
  'ing:castagne',
];

/** I tipi di ingrediente principale di una ricetta. */
export function tipiPrincipali(indice: Indice, r: Ricetta): Set<Principale> {
  const tipi = new Set<Principale>();
  for (const g of principali(indice, r)) {
    const t = tipoDellaRiga(indice, r, g);
    if (t) tipi.add(t);
  }
  return tipi;
}

/** Che tipo di ingrediente principale è una riga della ricetta (pasta, carne…), o null se non lo è. */
export function tipoDellaRiga(indice: Indice, r: Ricetta, g: RigaRicetta): Principale | null {
  if (g.qb || g.opzionale) return null;
  const i = indice.ingrediente(g.ingrediente_id);
  if (!i || i.base) return null;
  const radici = indice.antenati(i.id);
  const ha = (ids: string[]) => radici.some((x) => ids.includes(x));
  if (i.classi.includes('pesce')) return 'pesce';
  if (i.classi.includes('carne')) return 'carne';
  if (ha(PASTA)) return 'pasta';
  if (ha(['ing:riso'])) return 'riso';
  if (i.classi.includes('uova') || ha(['ing:uova'])) {
    // Un uovo per legare le polpette o impanare non fa un piatto di uova: servono almeno 3 uova ogni 4 porzioni.
    return uovaPerPorzione(g.quantita, g.unita, r.porzioni) >= 0.75 ? 'uova' : null;
  }
  if (ha(LEGUMI)) return 'legumi';
  if (i.classi.includes('latticini')) {
    if (ha(NON_FORMAGGI)) return null;
    if (ha(GRATTUGIATI) && (g.quantita ?? 0) < 100) return null;
    return 'formaggi';
  }
  if (i.reparto === 'frutta_verdura' && !ha(NON_VERDURE)) return 'verdure';
  return null;
}

function uovaPerPorzione(quantita: number | null, unita: string, porzioni: number): number {
  if (quantita === null) return 0;
  const uova = unita === 'pz' ? quantita : quantita / 55;
  return uova / Math.max(1, porzioni);
}

/** Vero se la ricetta ha quel tipo di ingrediente principale (o se non si filtra). */
export function haPrincipale(indice: Indice, r: Ricetta, p: Principale | null | undefined): boolean {
  return !p || tipiPrincipali(indice, r).has(p);
}

/** Vero se la ricetta usa quell'ingrediente (o uno più preciso: «pasta» vale per gli spaghetti), facoltativi esclusi. */
export function usaIngrediente(indice: Indice, r: Ricetta, id: string | null | undefined): boolean {
  return !id || r.ingredienti.some((g) => !g.opzionale && indice.antenati(g.ingrediente_id).includes(id));
}
