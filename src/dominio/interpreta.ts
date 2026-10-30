/**
 * Cosa vuol dire un vincolo scritto a parole («Niente funghi», «no frutti di mare e sedano»): l'app lo
 * traduce in allergeni, esigenze e ingredienti del catalogo, così lo può controllare sulle ricette come
 * quelli scelti dall'elenco. Quello che non riconosce resta «da verificare», mai «adatto».
 * Serve anche a capire cos'è un ingrediente aggiunto dalla famiglia («vino di riso» è un alcolico).
 */
import type { Classe } from '../catalogo/tipi';
import { normalizza, type Indice, type Ingrediente } from './ricette';

/** Un pezzo del testo, riconosciuto: un codice di vincolo (`all:`, `cls:`, `ing:`) o un gruppo di ingredienti. */
export interface Capito {
  /** Il pezzo di testo da cui viene. */
  testo: string;
  nome: string;
  emoji: string;
  /** Allergene, esigenza o intolleranza: si valuta come se fosse stato scelto dall'elenco. */
  oggetto?: string;
  /** Ingredienti del catalogo da evitare (contano anche le varietà, es. funghi → porcini). */
  ingredienti?: string[];
}

export interface Interpretazione {
  capiti: Capito[];
  /** I pezzi che l'app non ha riconosciuto. */
  nonCapiti: string[];
}

/** Parole che non dicono cosa evitare ma solo che va evitato. */
const ATTACCHI =
  /^(niente|nessun[oa]?|no|non|senza|evitare|evita|vietat[oiae]|mai|zero|allergi[ac][oa]?|intolleran(te|za)|sensibile|deve|puo|puoi|mangiare|mangia|mangiano|bere|beve|prendere|al|allo|alla|ai|agli|alle|all|a|il|lo|la|i|gli|le|l|un|uno|una|del|dello|della|dei|degli|delle|di|da|ad|anche|per|tipo|cibi|cibo|alimenti|alimento|qualsiasi|tutti|tutte|tutto|ogni)$/;

/** Gruppi che si scrivono con una parola sola: si traducono in allergeni, esigenze o reparti. */
const GRUPPI: { parole: string[]; nome: string; emoji: string; oggetto?: string; sottocategorie?: string[] }[] = [
  { parole: ['uova crude', 'uovo crudo', 'uova poco cotte'], nome: 'Uova crude', emoji: '🥚', oggetto: 'cls:no_uova_crude' },
  { parole: ['pesce crudo', 'sushi', 'crudo di pesce', 'crudi di pesce'], nome: 'Pesce crudo', emoji: '🍣', oggetto: 'cls:no_pesce_crudo' },
  { parole: ['carne cruda', 'carne al sangue', 'tartare', 'carpaccio'], nome: 'Carne cruda', emoji: '🥩', oggetto: 'cls:no_carne_cruda' },
  { parole: ['salumi crudi', 'affettati crudi', 'insaccati crudi'], nome: 'Salumi crudi', emoji: '🥓', oggetto: 'cls:no_salumi_crudi' },
  { parole: ['salumi', 'affettati', 'insaccati'], nome: 'Salumi', emoji: '🥓', sottocategorie: ['Salumi'] },
  {
    parole: ['latte crudo', 'formaggi a latte crudo', 'formaggi crudi', 'formaggio a latte crudo', 'latticini crudi'],
    nome: 'Formaggi a latte crudo',
    emoji: '🧀',
    oggetto: 'cls:no_latte_crudo',
  },
  { parole: ['carne', 'carni'], nome: 'Carne', emoji: '🥩', oggetto: 'cls:no_carne' },
  { parole: ['maiale', 'carne di maiale'], nome: 'Senza maiale', emoji: '🐖', oggetto: 'cls:senza_maiale' },
  { parole: ['alcol', 'alcolici', 'alcool', 'vino', 'vini', 'superalcolici'], nome: 'Senza alcol', emoji: '🍷', oggetto: 'cls:senza_alcol' },
  { parole: ['vegetariano', 'vegetariana', 'vegetariani'], nome: 'Vegetariano', emoji: '🥕', oggetto: 'cls:vegetariano' },
  { parole: ['vegano', 'vegana', 'vegani'], nome: 'Vegano', emoji: '🌱', oggetto: 'cls:vegano' },
  { parole: ['glutine', 'celiachia', 'celiaco', 'celiaca', 'frumento', 'grano'], nome: 'Glutine', emoji: '🌾', oggetto: 'all:glutine' },
  { parole: ['crostacei', 'crostaceo'], nome: 'Crostacei', emoji: '🦐', oggetto: 'all:crostacei' },
  { parole: ['molluschi', 'mollusco'], nome: 'Molluschi', emoji: '🦑', oggetto: 'all:molluschi' },
  { parole: ['frutti di mare', 'frutto di mare'], nome: 'Frutti di mare', emoji: '🦐', sottocategorie: ['Molluschi', 'Crostacei', 'Polpi, calamari e seppie'] },
  { parole: ['uova', 'uovo'], nome: 'Uova', emoji: '🥚', oggetto: 'all:uova' },
  { parole: ['pesce', 'pesci'], nome: 'Pesce', emoji: '🐟', oggetto: 'all:pesce' },
  { parole: ['arachidi', 'arachide', 'noccioline', 'burro di arachidi'], nome: 'Arachidi', emoji: '🥜', oggetto: 'all:arachidi' },
  { parole: ['soia'], nome: 'Soia', emoji: '🫘', oggetto: 'all:soia' },
  { parole: ['latte', 'latticini', 'derivati del latte', 'proteine del latte'], nome: 'Latte', emoji: '🥛', oggetto: 'all:latte' },
  { parole: ['lattosio'], nome: 'Lattosio', emoji: '🥛', oggetto: 'ing:lattosio' },
  { parole: ['frutta a guscio', 'frutta secca', 'frutta secca a guscio'], nome: 'Frutta a guscio', emoji: '🌰', oggetto: 'all:frutta_a_guscio' },
  { parole: ['sedano'], nome: 'Sedano', emoji: '🥬', oggetto: 'all:sedano' },
  { parole: ['senape'], nome: 'Senape', emoji: '🟡', oggetto: 'all:senape' },
  { parole: ['sesamo'], nome: 'Sesamo', emoji: '⚪', oggetto: 'all:sesamo' },
  { parole: ['solfiti', 'anidride solforosa'], nome: 'Solfiti', emoji: '🍷', oggetto: 'all:solfiti' },
  { parole: ['lupini', 'lupino'], nome: 'Lupini', emoji: '🫘', oggetto: 'all:lupini' },
  { parole: ['nichel'], nome: 'Nichel', emoji: '🔩', oggetto: 'ing:nichel' },
  { parole: ['istamina'], nome: 'Istamina', emoji: '🧪', oggetto: 'ing:istamina' },
  { parole: ['fruttosio'], nome: 'Fruttosio', emoji: '🍯', oggetto: 'ing:fruttosio' },
  { parole: ['sorbitolo'], nome: 'Sorbitolo', emoji: '🍬', oggetto: 'ing:sorbitolo' },
  { parole: ['formaggi', 'formaggio'], nome: 'Formaggi', emoji: '🧀', sottocategorie: ['Formaggi freschi', 'Formaggi stagionati e da grattugiare', 'Formaggi morbidi ed erborinati'] },
  { parole: ['legumi', 'legume'], nome: 'Legumi', emoji: '🫘', sottocategorie: ['Legumi'] },
  { parole: ['frutta'], nome: 'Frutta', emoji: '🍎', sottocategorie: ['Frutta'] },
  { parole: ['spezie', 'piccante', 'piccanti'], nome: 'Spezie', emoji: '🌶️', sottocategorie: ['Sale e spezie'] },
];

/** Singolare e plurale insieme: «fungo» e «funghi», «pomodoro» e «pomodori». */
function radice(parola: string): string {
  return parola
    .split(' ')
    .map((p) => (p.length > 3 ? p.replace(/h?[aeiou]$/, '') : p))
    .join(' ');
}

function pulisci(pezzo: string): string {
  const parole = normalizza(pezzo).split(' ').filter(Boolean);
  while (parole.length && ATTACCHI.test(parole[0]!)) parole.shift();
  while (parole.length && /^(per favore|grazie|in generale|ecc|eccetera)$/.test(parole[parole.length - 1]!)) parole.pop();
  return parole.join(' ');
}

/** Il pezzo è un ingrediente del catalogo? Si sceglie il più generale tra quelli che combaciano. */
function cercaNelCatalogo(indice: Indice, pezzo: string): Ingrediente | undefined {
  const r = radice(pezzo);
  const candidati: Ingrediente[] = [];
  for (const i of indice.ingredienti.values()) {
    if (!i.di_sistema) continue;
    const nomi = [i.nome, ...i.sinonimi].map(normalizza);
    if (nomi.some((n) => n === pezzo || radice(n) === r)) candidati.push(i);
  }
  return candidati.sort((a, b) => indice.antenati(a.id).length - indice.antenati(b.id).length)[0];
}

/** Traduce un vincolo scritto a parole. */
export function interpreta(indice: Indice, testo: string): Interpretazione {
  const capiti: Capito[] = [];
  const nonCapiti: string[] = [];
  // Si spezza sul testo originale (virgole, «e», «o», «né»), poi si pulisce ogni pezzo.
  for (const grezzo of testo.split(/[,;/+]|\s+(?:e|o|né|ne|ed|oppure)\s+/i)) {
    const pezzo = pulisci(grezzo);
    if (!pezzo) continue;
    const gruppo = GRUPPI.find((g) => g.parole.some((p) => p === pezzo || radice(p) === radice(pezzo)));
    if (gruppo) {
      const ingredienti = gruppo.sottocategorie
        ? [...indice.ingredienti.values()].filter((i) => i.di_sistema && gruppo.sottocategorie!.includes((i as { sottocategoria?: string }).sottocategoria ?? '')).map((i) => i.id)
        : undefined;
      capiti.push({ testo: pezzo, nome: gruppo.nome, emoji: gruppo.emoji, oggetto: gruppo.oggetto, ingredienti });
      continue;
    }
    const ing = cercaNelCatalogo(indice, pezzo);
    if (ing) capiti.push({ testo: pezzo, nome: ing.nome, emoji: ing.emoji, ingredienti: [ing.id] });
    else nonCapiti.push(pezzo);
  }
  return { capiti, nonCapiti };
}

/** Parole che dicono di che tipo è un prodotto, quando il catalogo non basta. */
const PAROLE_CLASSI: [RegExp, Classe][] = [
  [/\b(vino|vini|sake|birra|liquore|grappa|rum|brandy|cognac|whisky|vodka|gin|marsala|mirin|porto|vermouth|amaro|limoncello)\b/, 'alcol'],
  [/\b(formaggi?|latte|panna|burro|ricotta|mozzarella|yogurt|mascarpone)\b/, 'latticini'],
  [/\b(uova|uovo|tuorli?|albumi?)\b/, 'uova'],
  [/\b(miele)\b/, 'miele'],
  [/\b(maiale|suino|lardo|strutto)\b/, 'maiale'],
  [/\b(carne|manzo|vitello|pollo|tacchino|agnello|coniglio|anatra)\b/, 'carne'],
  [/\b(pesce|tonno|salmone|merluzzo|acciughe|alici|gamberi|calamari|cozze|vongole)\b/, 'pesce'],
];
/** Le parole che, prese da sole, non dicono cos'è («latte» di cocco, «burro» di arachidi). */
const VEGETALI = /\b(cocco|soia|riso|avena|mandorl[ae]|arachidi|cacao|vegetale|vegan[oa]?)\b/;

/**
 * Di che tipo è un ingrediente (carne, pesce, latticini, uova, alcol…) e se lo si sa. Per quelli del
 * catalogo è scritto; per quelli della famiglia si usa quanto salvato e il nome («vino di riso»).
 */
export function classiDi(indice: Indice, ing: Ingrediente | undefined): { classi: Classe[]; note: boolean } {
  if (!ing) return { classi: [], note: false };
  if (ing.di_sistema) return { classi: ing.classi, note: true };
  const classi = new Set<Classe>(ing.classi);
  const nome = normalizza(ing.nome);
  let riconosciuto = false;
  const intero = cercaNelCatalogo(indice, nome);
  if (intero) {
    riconosciuto = true;
    for (const c of intero.classi) classi.add(c);
  } else {
    for (const [re, c] of PAROLE_CLASSI) {
      if (!re.test(nome)) continue;
      riconosciuto = true;
      if ((c === 'latticini' || c === 'carne') && VEGETALI.test(nome)) continue;
      classi.add(c);
    }
    if (classi.has('maiale')) classi.add('carne');
  }
  return { classi: [...classi], note: ing.allergeni_noti || ing.classi.length > 0 || riconosciuto };
}
