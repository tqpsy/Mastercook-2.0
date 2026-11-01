/**
 * Ricette come le vede l'app: quelle di sistema (dal catalogo) e quelle della famiglia (dal database),
 * nella stessa forma. Qui ci sono anche ricerca e filtri, che non dipendono dall'interfaccia.
 */
import { CATEGORIE, type Catalogo, type Categoria, type Classe, type IngredienteCatalogo, type RicettaCatalogo } from '../catalogo/tipi';
import type { Dimensione, UnitaBase } from './unita';
import { disegnoDalTitolo, iconaIngrediente } from './iconeCibo';

export interface Ingrediente {
  id: string;
  nome: string;
  sinonimi: string[];
  reparto: string;
  dimensione: Dimensione;
  luogo: 'frigo' | 'freezer' | 'dispensa';
  giorni: number | null;
  allergeni: string[];
  /** Falso per un ingrediente della famiglia di cui non si conoscono gli allergeni. */
  allergeni_noti: boolean;
  classi: Classe[];
  genitore: string | null;
  base: boolean;
  emoji: string;
  di_sistema: boolean;
  versione?: number;
  in_attesa?: boolean;
}

export interface RigaRicetta {
  id: string;
  ingrediente_id: string;
  quantita: number | null;
  unita: UnitaBase;
  qb: boolean;
  opzionale: boolean;
  testo: string | null;
  ordine: number;
  versione?: number;
  /** Riga che viene da una base collegata (la besciamella…): la ricetta della base e quante dosi. */
  da_ricetta_id?: string | null;
  dosi?: number | null;
}

export interface Passo {
  id: string;
  ordine: number;
  testo: string;
  versione?: number;
}

export interface Ricetta {
  id: string;
  di_sistema: boolean;
  titolo: string;
  descrizione: string | null;
  categoria: Categoria;
  cucina: string;
  provenienza: string | null;
  porzioni: number;
  minuti_preparazione: number | null;
  minuti_cottura: number | null;
  minuti_totali: number | null;
  difficolta: number | null;
  conservazione: string | null;
  mesi: number[] | null;
  allergeni_dichiarati: string[];
  derivata_da: string | null;
  foto: string | null;
  archiviata: boolean;
  ingredienti: RigaRicetta[];
  passi: Passo[];
  versione?: number;
  in_attesa?: boolean;
}

type RigaDb = Record<string, unknown> & { id: string; eliminato_il?: unknown; in_attesa?: boolean };

const numero = (x: unknown) => (x === null || x === undefined || x === '' ? null : Number(x));

export function ingredienteDiSistema(i: IngredienteCatalogo): Ingrediente {
  return { ...i, allergeni_noti: true, di_sistema: true };
}

export function ingredienteDellaFamiglia(r: RigaDb): Ingrediente {
  return {
    id: r.id,
    nome: String(r.nome),
    sinonimi: (r.sinonimi as string[]) ?? [],
    reparto: String(r.reparto ?? 'altro'),
    dimensione: r.dimensione as Dimensione,
    luogo: (r.luogo as Ingrediente['luogo']) ?? 'dispensa',
    giorni: numero(r.giorni),
    allergeni: (r.allergeni as string[]) ?? [],
    allergeni_noti: r.allergeni_noti !== false,
    classi: (r.classi as Classe[]) ?? [],
    genitore: (r.genitore as string | null) ?? null,
    base: false,
    emoji: String(r.emoji ?? '🛒'),
    di_sistema: false,
    versione: Number(r.versione ?? 1),
    in_attesa: r.in_attesa,
  };
}

export function ricettaDiSistema(r: RicettaCatalogo): Ricetta {
  return {
    id: r.id,
    di_sistema: true,
    titolo: r.titolo,
    descrizione: null,
    categoria: r.categoria,
    cucina: r.cucina,
    provenienza: r.provenienza,
    porzioni: r.porzioni,
    minuti_preparazione: null,
    minuti_cottura: null,
    minuti_totali: r.minuti_totali,
    difficolta: r.difficolta,
    conservazione: r.conservazione,
    mesi: r.mesi,
    allergeni_dichiarati: r.allergeni_dichiarati,
    derivata_da: null,
    foto: null,
    archiviata: false,
    ingredienti: r.ingredienti.map((g, n) => ({ ...g, id: `${r.id}:${n + 1}`, ordine: n + 1 })),
    passi: r.passi.map((testo, n) => ({ id: `${r.id}:p${n + 1}`, ordine: n + 1, testo })),
  };
}

/** Le ricette della famiglia dalle righe scaricate (già senza le cancellate). */
export function ricetteDellaFamiglia(ricette: RigaDb[], righe: RigaDb[], passi: RigaDb[]): Ricetta[] {
  const perRicetta = <T extends { ordine: number }>(xs: RigaDb[], f: (r: RigaDb) => T) => {
    const m = new Map<string, T[]>();
    for (const r of xs) {
      const k = String(r.ricetta_id);
      m.set(k, [...(m.get(k) ?? []), f(r)]);
    }
    for (const v of m.values()) v.sort((a, b) => a.ordine - b.ordine);
    return m;
  };
  const ing = perRicetta(righe, (r) => ({
    id: r.id,
    ingrediente_id: String(r.ingrediente_id),
    quantita: numero(r.quantita),
    unita: r.unita as UnitaBase,
    qb: Boolean(r.qb),
    opzionale: Boolean(r.opzionale),
    testo: (r.testo as string | null) ?? null,
    ordine: Number(r.ordine ?? 0),
    versione: Number(r.versione ?? 1),
    da_ricetta_id: (r.da_ricetta_id as string | null) ?? null,
    dosi: numero(r.dosi),
  }));
  const pas = perRicetta(passi, (r) => ({ id: r.id, ordine: Number(r.ordine ?? 0), testo: String(r.testo), versione: Number(r.versione ?? 1) }));
  return ricette.map((r) => ({
    id: r.id,
    di_sistema: false,
    titolo: String(r.titolo),
    descrizione: (r.descrizione as string | null) ?? null,
    categoria: r.categoria as Categoria,
    cucina: String(r.cucina ?? 'italiana'),
    provenienza: (r.provenienza as string | null) ?? null,
    porzioni: Number(r.porzioni),
    minuti_preparazione: numero(r.minuti_preparazione),
    minuti_cottura: numero(r.minuti_cottura),
    minuti_totali: numero(r.minuti_totali),
    difficolta: numero(r.difficolta),
    conservazione: (r.conservazione as string | null) ?? null,
    mesi: (r.mesi as number[] | null) ?? null,
    allergeni_dichiarati: (r.allergeni_dichiarati as string[]) ?? [],
    derivata_da: (r.derivata_da as string | null) ?? null,
    foto: (r.foto as string | null) ?? null,
    archiviata: Boolean(r.archiviata),
    ingredienti: ing.get(r.id) ?? [],
    passi: pas.get(r.id) ?? [],
    versione: Number(r.versione ?? 1),
    in_attesa: r.in_attesa,
  }));
}

/** Indice di ingredienti e ricette: catalogo di sistema più quello della famiglia. */
export class Indice {
  readonly ingredienti: Map<string, Ingrediente>;
  readonly ricette: Ricetta[];
  readonly perId: Map<string, Ricetta>;

  constructor(
    readonly catalogo: Catalogo,
    ingredientiFamiglia: Ingrediente[] = [],
    ricetteFamiglia: Ricetta[] = [],
  ) {
    this.ingredienti = new Map([...catalogo.ingredienti.map(ingredienteDiSistema), ...ingredientiFamiglia].map((i) => [i.id, i]));
    this.ricette = [...ricetteFamiglia, ...catalogo.ricette.map(ricettaDiSistema)];
    this.perId = new Map(this.ricette.map((r) => [r.id, r]));
  }

  ingrediente(id: string): Ingrediente | undefined {
    return this.ingredienti.get(id);
  }

  nome(id: string): string {
    return this.ingredienti.get(id)?.nome ?? 'Ingrediente sconosciuto';
  }

  /** L'ingrediente e i suoi antenati: gli spaghetti valgono anche come pasta. */
  antenati(id: string): string[] {
    const catena: string[] = [];
    for (let x: string | null | undefined = id; x && !catena.includes(x); x = this.ingredienti.get(x)?.genitore) catena.push(x);
    return catena;
  }

  /** Gli ingredienti con tutti i loro antenati: chi ha gli spaghetti ha anche «pasta». */
  estendi(ids: Iterable<string>): Set<string> {
    const tutti = new Set<string>();
    for (const id of ids) for (const a of this.antenati(id)) tutti.add(a);
    return tutti;
  }

  /** Ricerca per nome e sinonimi, senza accenti; prima chi inizia con il testo. */
  cercaIngredienti(testo: string, limite = 12): Ingrediente[] {
    const t = normalizza(testo);
    if (!t) return [];
    const trovati: { i: Ingrediente; punti: number }[] = [];
    for (const i of this.ingredienti.values()) {
      const nomi = [i.nome, ...i.sinonimi].map(normalizza);
      const punti = nomi.some((n) => n === t) ? 0 : nomi.some((n) => n.startsWith(t)) ? 1 : nomi.some((n) => n.includes(t)) ? 2 : -1;
      if (punti >= 0) trovati.push({ i, punti: punti + (i.di_sistema ? 0.5 : 0) });
    }
    return trovati
      .sort((a, b) => a.punti - b.punti || a.i.nome.localeCompare(b.i.nome, 'it'))
      .slice(0, limite)
      .map((x) => x.i);
  }
}

export function normalizza(testo: string): string {
  return testo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface Filtri {
  testo?: string;
  categoria?: Categoria | null;
  cucina?: string | null;
  /** Al massimo questi minuti in tutto. */
  minuti?: number | null;
  /** Solo ricette con almeno un ingrediente principale tra questi (quelli in casa). */
  inCasa?: Set<string> | null;
  origine?: 'tutte' | 'famiglia' | 'sistema';
  archiviate?: boolean;
}

/** Ricerca e filtri sull'elenco delle ricette. */
export function filtra(indice: Indice, f: Filtri): Ricetta[] {
  const t = f.testo ? normalizza(f.testo) : '';
  const casa = f.inCasa ? indice.estendi(f.inCasa) : null;
  return indice.ricette.filter((r) => {
    if (!f.archiviate && r.archiviata) return false;
    if (f.origine === 'famiglia' && r.di_sistema) return false;
    if (f.origine === 'sistema' && !r.di_sistema) return false;
    if (f.categoria && r.categoria !== f.categoria) return false;
    if (f.cucina && r.cucina !== f.cucina) return false;
    if (f.minuti && (r.minuti_totali ?? (r.minuti_preparazione ?? 0) + (r.minuti_cottura ?? 0)) > f.minuti) return false;
    if (casa && !principali(indice, r).some((g) => casa.has(g.ingrediente_id))) return false;
    if (t) {
      const campi = [r.titolo, r.provenienza ?? '', ...r.ingredienti.map((g) => indice.nome(g.ingrediente_id))].map(normalizza).join(' ');
      if (!t.split(' ').every((parola) => campi.includes(parola))) return false;
    }
    return true;
  });
}

/** Gli ingredienti che contano: né facoltativi né di dispensa di base (sale, olio…). */
export function principali(indice: Indice, r: Ricetta): RigaRicetta[] {
  return r.ingredienti.filter((g) => !g.opzionale && !indice.ingrediente(g.ingrediente_id)?.base);
}

/** Quanti ingredienti principali della ricetta ci sono in casa (gli spaghetti in casa valgono per «pasta»). */
export function copertura(indice: Indice, r: Ricetta, inCasa: Set<string>): { presenti: number; totali: number } {
  const casa = indice.estendi(inCasa);
  const p = principali(indice, r);
  return { presenti: p.filter((g) => casa.has(g.ingrediente_id)).length, totali: p.length };
}

/** Gli ingredienti principali che mancano in casa (gli spaghetti in casa valgono per «pasta»). */
export function mancanti(indice: Indice, r: Ricetta, inCasa: Set<string>): RigaRicetta[] {
  const casa = indice.estendi(inCasa);
  return principali(indice, r).filter((g) => !casa.has(g.ingrediente_id));
}

/** Icone di ingredienti troppo generiche per rappresentare un piatto (la farina). */
const ICONE_GENERICHE = ['🌾'];

/**
 * L'icona di una ricetta: quella scelta dalla famiglia, altrimenti il disegno del piatto riconosciuto dal titolo
 * (lasagna, risotto…, vedi iconeCibo.ts), altrimenti quella dell'ingrediente principale
 * (il primo che conta e ha un'icona), altrimenti quella della categoria. Per dolci e colazioni vale la
 * categoria: il primo ingrediente è spesso farina o zucchero.
 */
export function iconaRicetta(indice: Indice, r: Ricetta, scelta?: string | null): string {
  if (scelta) return scelta;
  const piatto = disegnoDalTitolo(r.titolo);
  if (piatto) return piatto;
  const categoria = CATEGORIE.find((c) => c.id === r.categoria)?.emoji ?? '🍽️';
  if (r.categoria === 'dolce' || r.categoria === 'colazione') return categoria;
  // Una pizza è una pizza, qualunque sia il condimento (il primo ingrediente sarebbe il lievito).
  if (/^pizza\b/i.test(r.titolo.trim())) return '🍕';
  for (const g of principali(indice, r)) {
    const e = iconaIngrediente(indice.ingrediente(g.ingrediente_id));
    if (e && !ICONE_GENERICHE.includes(e)) return e;
  }
  return categoria;
}
