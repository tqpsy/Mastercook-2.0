/**
 * Catalogo di sistema: ingredienti, reparti, regole di conservazione dei cotti e ricette.
 * È lo stesso nel database (migrazione generata) e nell'app (catalogo.json), prodotto dallo script
 * `scripts/importa-catalogo.ts` a partire dal vecchio Mastercook, dopo i controlli documentati
 * in docs/catalogo-rapporto.md. Gli id non cambiano mai: sono salvati in lotti, ricette e pasti.
 */
import type { Dimensione, UnitaBase } from '../dominio/unita';

export type Luogo = 'frigo' | 'freezer' | 'dispensa';
export const LUOGHI: Luogo[] = ['frigo', 'freezer', 'dispensa'];
export const NOME_LUOGO: Record<Luogo, string> = { frigo: 'Frigo', freezer: 'Freezer', dispensa: 'Dispensa' };

export type Classe = 'carne' | 'maiale' | 'pesce' | 'latticini' | 'uova' | 'miele' | 'alcol';
export const CLASSI: Classe[] = ['carne', 'maiale', 'pesce', 'latticini', 'uova', 'miele', 'alcol'];

export type Categoria = 'antipasto' | 'primo' | 'secondo' | 'contorno' | 'piatto_unico' | 'dolce' | 'colazione' | 'base';
export const CATEGORIE: { id: Categoria; nome: string; emoji: string }[] = [
  { id: 'antipasto', nome: 'Antipasto', emoji: '🥗' },
  { id: 'primo', nome: 'Primo', emoji: '🍝' },
  { id: 'secondo', nome: 'Secondo', emoji: '🍽️' },
  { id: 'contorno', nome: 'Contorno', emoji: '🥦' },
  { id: 'piatto_unico', nome: 'Piatto unico', emoji: '🥘' },
  { id: 'dolce', nome: 'Dolce', emoji: '🍰' },
  { id: 'colazione', nome: 'Colazione', emoji: '☕' },
  // Basi e salse (besciamella…): si usano dentro altre ricette, non si propongono nei pasti.
  { id: 'base', nome: 'Basi e salse', emoji: '🥣' },
];

export interface Reparto {
  id: string;
  nome: string;
  emoji: string;
}

export interface Cucina {
  id: string;
  nome: string;
  bandiera: string;
}

export interface IngredienteCatalogo {
  id: string;
  nome: string;
  sinonimi: string[];
  reparto: string;
  sottocategoria: string | null;
  dimensione: Dimensione;
  /** Dove si tiene di solito. */
  luogo: Luogo;
  /** Durata indicativa nel luogo abituale, per le stime (indicative, da validare). */
  giorni: number;
  /** Codici dei 14 allergeni UE, senza prefisso: `glutine`, `latte`… */
  allergeni: string[];
  classi: Classe[];
  genitore: string | null;
  /** Dispensa di base (sale, pepe, olio, acqua): presunta presente. */
  base: boolean;
  mesi: number[] | null;
  /** Peso medio di un pezzo in grammi: è una stima, mai usata per sommare in silenzio. */
  peso_pz: number | null;
  emoji: string;
}

export interface RigaRicettaCatalogo {
  ingrediente_id: string;
  /** In unità base; `null` solo con `qb`. */
  quantita: number | null;
  unita: UnitaBase;
  qb: boolean;
  opzionale: boolean;
  testo: string;
}

export interface RicettaCatalogo {
  id: string;
  titolo: string;
  categoria: Categoria;
  cucina: string;
  provenienza: string | null;
  porzioni: number;
  minuti_totali: number;
  difficolta: 1 | 2 | 3;
  /** Regola di conservazione dei cotti (id), se indicata. */
  conservazione: string | null;
  mesi: number[] | null;
  allergeni_dichiarati: string[];
  ingredienti: RigaRicettaCatalogo[];
  passi: string[];
}

export interface RegolaCotti {
  id: string;
  nome: string;
  consigliati: number;
  massimo: number;
  rischio: number;
}

export interface Catalogo {
  versione: number;
  /** Commit del vecchio Mastercook da cui è stato letto. */
  origine: string;
  reparti: Reparto[];
  cucine: Cucina[];
  regole_cotti: RegolaCotti[];
  ingredienti: IngredienteCatalogo[];
  ricette: RicettaCatalogo[];
}
