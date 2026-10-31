/**
 * Le icone disegnate per Mastercook (src/ui/disegniCibo.ts) e quando usarle al posto delle emoji.
 *
 * Un'icona si scrive come un'emoji, in un testo: un'emoji vera («🍝») o `mc:<id>` per un disegno («mc:lasagna»).
 * Così si salvano nello stesso campo (icona_ricetta.emoji) e chi non conosce un disegno mostra l'emoji di riserva.
 */

export const PREFISSO_DISEGNO = 'mc:';

export const eDisegno = (icona: string | null | undefined): icona is string => !!icona && icona.startsWith(PREFISSO_DISEGNO);

export const disegno = (id: string) => PREFISSO_DISEGNO + id;

/**
 * I piatti riconosciuti dal titolo, per le ricette di Mastercook e per quelle della famiglia («Lasagne della
 * nonna»). In ordine: vince la prima regola che corrisponde («Risotto alla parmigiana» è un risotto).
 */
const PIATTI_DAL_TITOLO: [RegExp, string][] = [
  [/\blasagn/i, 'lasagna'],
  [/\b(risott|risi e bisi|orzotto)/i, 'risotto'],
  [/\b(tortellin|tortell|cappellett|agnolott)/i, 'tortellini'],
  [/\bcannellon/i, 'cannelloni'],
  [/\b(pasta al forno|pastitsio|timballo)/i, 'pasta_forno'],
  [/\bgnocch/i, 'gnocchi'],
  [/\b(parmigiana di|moussaka)/i, 'parmigiana'],
  [/\b(vellutat|crema di)/i, 'vellutata'],
  [/\b(minestr|ribollita|zuppa|fasolada|pasta e fagioli)/i, 'zuppa'],
  [/\bpolenta/i, 'polenta'],
  [/\b(cotolett|tonkatsu)/i, 'cotoletta'],
  [/\b(polpette\b|keftedes)/i, 'polpette'],
  [/\b(spezzatino|stracotto|stufato|gulasch|goulash)/i, 'spezzatino'],
  [/\bfrittat/i, 'frittata'],
  [/\b(torta salata|torta pasqualina|spanakopita|quiche)/i, 'torta_salata'],
  [/\barancin/i, 'arancino'],
  [/\bbruschett/i, 'bruschetta'],
  [/\bfocacc/i, 'focaccia'],
  [/\btiramis/i, 'tiramisu'],
  [/\bpanna ?cotta/i, 'panna_cotta'],
  [/\bcrostat/i, 'crostata'],
  [/\bciambell/i, 'ciambellone'],
];

export function disegnoDalTitolo(titolo: string): string | null {
  const t = titolo.trim();
  for (const [regola, id] of PIATTI_DAL_TITOLO) if (regola.test(t)) return disegno(id);
  return null;
}

/** Gli ingredienti del catalogo che hanno un disegno: in casa, nella spesa e come icona di una ricetta. */
const PER_INGREDIENTE: Record<string, string> = {
  'ing:spaghetti': 'spaghetti',
  'ing:linguine': 'spaghetti',
  'ing:bucatini': 'spaghetti',
  'ing:penne': 'penne',
  'ing:fusilli': 'fusilli',
  'ing:farfalle': 'farfalle',
  'ing:rigatoni': 'rigatoni',
  'ing:paccheri': 'rigatoni',
  'ing:orecchiette': 'orecchiette',
  'ing:pasta_uovo': 'tagliatelle',
  'ing:lasagne': 'lasagna',
  'ing:ravioli': 'ravioli',
  'ing:pasta_ripiena': 'ravioli',
  'ing:tortellini': 'tortellini',
  'ing:gnocchi': 'gnocchi',
  'ing:polenta': 'polenta',
  'ing:focaccia': 'focaccia',
  'ing:salmone': 'salmone',
  'ing:salmone_affumicato': 'salmone',
  'ing:tonno_scatola': 'tonno',
  'ing:orata': 'orata',
  'ing:branzino': 'orata',
  'ing:trota': 'orata',
  'ing:acciughe': 'acciughe',
  'ing:sardine': 'acciughe',
  'ing:acciughe_sottolio': 'acciughe',
  'ing:cozze': 'cozze',
  'ing:vongole': 'vongole',
  'ing:telline': 'vongole',
  'ing:calamari': 'calamari',
  'ing:totani': 'calamari',
  'ing:pesce_spada': 'pesce_spada',
  'ing:bistecca': 'bistecca',
  'ing:manzo': 'bistecca',
  'ing:petto_pollo': 'petto_pollo',
  'ing:salsiccia': 'salsiccia',
  'ing:carne_macinata': 'macinato',
  'ing:macinato_pollo': 'macinato',
  'ing:costine_maiale': 'costine',
  'ing:porchetta': 'arrosto',
  'ing:parmigiano': 'parmigiano',
  'ing:grana_padano': 'parmigiano',
  'ing:mozzarella': 'mozzarella',
  'ing:mozzarella_bufala': 'mozzarella',
  'ing:gorgonzola': 'gorgonzola',
  'ing:ricotta': 'ricotta',
  'ing:pecorino': 'pecorino',
  'ing:pecorino_dolce': 'pecorino',
  'ing:burrata': 'burrata',
  'ing:stracciatella': 'burrata',
  'ing:provolone': 'provolone',
  'ing:caciocavallo': 'provolone',
  'ing:prosciutto_crudo': 'prosciutto_crudo',
  'ing:speck': 'prosciutto_crudo',
  'ing:prosciutto_cotto': 'prosciutto_cotto',
  'ing:mortadella': 'mortadella',
  'ing:salame': 'salame',
  'ing:pancetta': 'guanciale',
  'ing:guanciale': 'guanciale',
  'ing:lardo': 'guanciale',
  'ing:bresaola': 'bresaola',
};

export const ID_INGREDIENTI_DISEGNATI: readonly string[] = Object.keys(PER_INGREDIENTE);
export const ID_DISEGNI_USATI: readonly string[] = [...new Set([...PIATTI_DAL_TITOLO.map(([, id]) => id), ...Object.values(PER_INGREDIENTE)])];

/** L'icona di un ingrediente: il disegno se c'è, altrimenti la sua emoji. */
export function iconaIngrediente(ing: { id: string; emoji?: string | null } | undefined | null): string | undefined {
  if (!ing) return undefined;
  const id = PER_INGREDIENTE[ing.id];
  return id ? disegno(id) : (ing.emoji ?? undefined);
}
