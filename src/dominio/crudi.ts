/**
 * Alimenti crudi: salumi crudi, pesce e carne crudi, formaggi a latte crudo, uova crude.
 * Lo stesso ingrediente può essere crudo o cotto secondo la ricetta (il guanciale della carbonara si
 * rosola, la bresaola si mangia così): per questo, oltre a cosa è l'ingrediente, conta come lo usa la
 * ricetta. Le ricette di Mastercook sono state lette una per una; per quelle della famiglia l'app non
 * lo sa e chiede di controllare.
 */
import type { Indice, Ricetta } from './ricette';

export type Crudo = 'salumi' | 'pesce' | 'carne' | 'latte' | 'uova';

/** Le esigenze sui crudi, come si scelgono per un membro. */
export const ESIGENZE_CRUDI: { oggetto: string; nome: string; crudo: Crudo }[] = [
  {
    oggetto: 'cls:no_salumi_crudi',
    nome: 'Niente salumi crudi',
    crudo: 'salumi',
  },
  {
    oggetto: 'cls:no_pesce_crudo',
    nome: 'Niente pesce crudo',
    crudo: 'pesce',
  },
  {
    oggetto: 'cls:no_carne_cruda',
    nome: 'Niente carne cruda',
    crudo: 'carne',
  },
  {
    oggetto: 'cls:no_latte_crudo',
    nome: 'Niente formaggi a latte crudo',
    crudo: 'latte',
  },
  { oggetto: 'cls:no_uova_crude', nome: 'Niente uova crude', crudo: 'uova' },
];

/** Salumi che si fanno senza cottura: crudi se la ricetta non li cuoce. */
const SALUMI_CRUDI = [
  'ing:prosciutto_crudo',
  'ing:speck',
  'ing:salame',
  'ing:coppa',
  'ing:pancetta',
  'ing:guanciale',
  'ing:lardo',
  'ing:nduja',
  'ing:bresaola',
];

/** Formaggi a latte crudo per disciplinare. */
const LATTE_CRUDO = ['ing:parmigiano', 'ing:grana_padano', 'ing:pecorino', 'ing:fontina', 'ing:emmental'];
/** Formaggi e preparati che si trovano sia a latte crudo sia pastorizzati: lo dice l'etichetta. */
const LATTE_FORSE_CRUDO = ['ing:pecorino_dolce', 'ing:asiago', 'ing:caciocavallo', 'ing:provolone', 'ing:taleggio', 'ing:brie', 'ing:feta', 'ing:pesto'];
/** Preparati con uova che possono essere crude (la maionese fatta in casa). */
const UOVA_FORSE_CRUDE = ['ing:maionese'];

/**
 * Nelle ricette di Mastercook, gli ingredienti che si mangiano senza cottura (fra quelli di questo file).
 * Una ricetta di sistema che non compare qui cuoce tutto. Il formaggio aggiunto a fuoco spento, a
 * mantecare o grattugiato sopra conta come crudo.
 */
export const CRUDI_NELLE_RICETTE: Record<string, string[]> = {
  'sys:carbonara': ['ing:pecorino', 'ing:uova'],
  'sys:pasta_pomodoro': ['ing:parmigiano'],
  'sys:pasta_zucchine': ['ing:parmigiano'],
  'sys:risotto_parmigiano': ['ing:parmigiano'],
  'sys:risotto_funghi': ['ing:parmigiano'],
  'sys:risotto_zucca': ['ing:parmigiano'],
  'sys:risotto_milanese': ['ing:parmigiano'],
  'sys:risotto_asparagi': ['ing:parmigiano'],
  'sys:risotto_radicchio': ['ing:parmigiano'],
  'sys:orzotto': ['ing:parmigiano'],
  'sys:spinaci_burro': ['ing:parmigiano'],
  'sys:amatriciana': ['ing:pecorino'],
  'sys:cacio_pepe': ['ing:pecorino'],
  'sys:gricia': ['ing:pecorino'],
  'sys:trofie_pesto': ['ing:parmigiano', 'ing:pesto'],
  'sys:pasta_broccoli': ['ing:parmigiano'],
  'sys:pasta_patate': ['ing:parmigiano'],
  'sys:pasta_piselli': ['ing:parmigiano'],
  'sys:risi_bisi': ['ing:parmigiano'],
  'sys:tortellini_brodo': ['ing:parmigiano'],
  'sys:tortelli_burro_salvia': ['ing:parmigiano'],
  'sys:farfalle_prosciutto_piselli': ['ing:parmigiano'],
  'sys:vellutata_zucca': ['ing:parmigiano'],
  'sys:pasta_noci': ['ing:parmigiano'],
  'sys:tagliatelle_funghi': ['ing:parmigiano'],
  'sys:straccetti_rucola': ['ing:parmigiano'],
  'sys:bresaola_rucola': ['ing:bresaola', 'ing:parmigiano'],
  'sys:asparagi_uovo': ['ing:parmigiano'],
  'sys:insalata_greca': ['ing:feta'],
  'sys:sushi_maki': ['ing:salmone'],
  'sys:vitello_tonnato': ['ing:acciughe'],
  'sys:tiramisu': ['ing:uova'],
};

/** Prodotti già cotti o pastorizzati, che non contano come crudi. */
const SEMPRE_COTTI = [
  'ing:prosciutto_cotto',
  'ing:mortadella',
  'ing:porchetta',
  'ing:wurstel',
  'ing:cotechino',
  'ing:tacchino_affettato',
  'ing:ragu_pronto',
  'ing:tortellini',
  'ing:dado_carne',
  'ing:gelatina',
  'ing:cotolette_pronte',
  'ing:tonno_scatola',
  'ing:sgombro_scatola',
  'ing:sardine_scatola',
  'ing:salmone_scatola',
  'ing:surimi',
  'ing:bastoncini_pesce',
  'ing:dashi',
  'ing:salsa_ostrica',
];

/** Di che tipo di crudo è un ingrediente, se lo è; `forse` quando dipende dal prodotto comprato. */
export function tipoCrudo(indice: Indice, id: string): { crudo: Crudo; forse: boolean } | null {
  const catena = indice.antenati(id);
  const tra = (elenco: string[]) => catena.some((x) => elenco.includes(x));
  if (tra(SEMPRE_COTTI)) return null;
  if (tra(SALUMI_CRUDI)) return { crudo: 'salumi', forse: false };
  if (tra(LATTE_CRUDO)) return { crudo: 'latte', forse: false };
  if (tra(LATTE_FORSE_CRUDO)) return { crudo: 'latte', forse: true };
  if (tra(UOVA_FORSE_CRUDE)) return { crudo: 'uova', forse: true };
  const classi = indice.ingrediente(id)?.classi ?? [];
  if (classi.includes('pesce')) return { crudo: 'pesce', forse: false };
  if (classi.includes('carne') || classi.includes('maiale')) return { crudo: 'carne', forse: false };
  if (classi.includes('uova')) return { crudo: 'uova', forse: false };
  return null;
}

export interface RigaCruda {
  nome: string;
  /** Mangiato crudo in questa ricetta (`true`), cotto (`false`) o non si sa (`null`, ricetta della famiglia). */
  crudo: boolean | null;
  forse: boolean;
  opzionale: boolean;
}

/** Gli ingredienti della ricetta del tipo richiesto, e se la ricetta li lascia crudi. */
export function righeCrude(indice: Indice, r: Ricetta, crudo: Crudo): RigaCruda[] {
  const lista = r.id.startsWith('sys:') ? (CRUDI_NELLE_RICETTE[r.id] ?? []) : null;
  const righe: RigaCruda[] = [];
  for (const g of r.ingredienti) {
    const t = tipoCrudo(indice, g.ingrediente_id);
    if (!t || t.crudo !== crudo) continue;
    righe.push({
      nome: (indice.ingrediente(g.ingrediente_id)?.nome ?? g.ingrediente_id).toLowerCase(),
      crudo: lista ? lista.includes(g.ingrediente_id) : null,
      forse: t.forse,
      opzionale: g.opzionale,
    });
  }
  return righe;
}
