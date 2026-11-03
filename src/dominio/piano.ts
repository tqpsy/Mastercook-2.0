/**
 * Il piano del nutrizionista in un file: le regole della settimana per Antonino (frequenze, cena senza
 * carboidrati, abbinamenti, alimenti da preferire) e qualche ricetta del piano. Il file si prepara una volta
 * fuori dall'app e si carica da Impostazioni › Antonino: vale per tutta la famiglia e resta solo nei suoi dati.
 *
 * Formato (versione 1):
 *   { "formato": "mastercook-piano", "versione": 1, "nome": "Piano del nutrizionista",
 *     "regole": { "obiettivi": { "pesce": { "min": 3, "max": 3 } … }, "verdure_ogni_giorno": true,
 *                 "piano": { "cena_senza_carboidrati": true, … "preferiti": ["ing:farro"] } },
 *     "ricette": [ { "titolo", "categoria", "porzioni", "minuti_totali", "descrizione"?,
 *                    "ingredienti": [ { "ingrediente_id", "quantita"?, "unita"?, "qb"?, "opzionale"?, "testo"? } ],
 *                    "passi": [ "…" ] } ] }
 */
import type { Categoria } from '../catalogo/tipi';
import { PESI_BASE, regoleDa, type RegoleAntonino } from './antonino';

export interface RigaPiano {
  ingrediente_id: string;
  quantita: number | null;
  unita: 'g' | 'ml' | 'pz' | null;
  qb: boolean;
  opzionale: boolean;
  testo: string | null;
}

export interface RicettaPiano {
  titolo: string;
  categoria: Categoria;
  porzioni: number;
  minuti_totali: number | null;
  descrizione: string | null;
  ingredienti: RigaPiano[];
  passi: string[];
}

export interface Piano {
  nome: string;
  regole: RegoleAntonino;
  ricette: RicettaPiano[];
}

const CATEGORIE: Categoria[] = ['colazione', 'antipasto', 'primo', 'secondo', 'contorno', 'piatto_unico', 'dolce', 'base'];

function oggetto(x: unknown): Record<string, unknown> | null {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

function riga(x: unknown): RigaPiano | null {
  const g = oggetto(x);
  if (!g || typeof g.ingrediente_id !== 'string' || !/^ing:[a-z0-9_]{1,60}$/.test(g.ingrediente_id)) return null;
  const qb = g.qb === true;
  const quantita = typeof g.quantita === 'number' && g.quantita > 0 && g.quantita < 100000 ? g.quantita : null;
  const unita = g.unita === 'g' || g.unita === 'ml' || g.unita === 'pz' ? g.unita : null;
  if (!qb && (quantita === null || unita === null)) return null;
  const testo = typeof g.testo === 'string' && g.testo.trim() ? g.testo.trim().slice(0, 120) : null;
  return { ingrediente_id: g.ingrediente_id, quantita: qb ? null : quantita, unita: qb ? null : unita, qb, opzionale: g.opzionale === true, testo };
}

function ricetta(x: unknown): RicettaPiano | null {
  const r = oggetto(x);
  if (!r || typeof r.titolo !== 'string' || !r.titolo.trim() || !CATEGORIE.includes(r.categoria as Categoria)) return null;
  const ingredienti = Array.isArray(r.ingredienti) ? r.ingredienti.map(riga) : [];
  const passi = Array.isArray(r.passi) ? r.passi.filter((p): p is string => typeof p === 'string' && !!p.trim()).map((p) => p.trim().slice(0, 1000)) : [];
  if (!ingredienti.length || ingredienti.some((g) => !g) || !passi.length) return null;
  const porzioni = typeof r.porzioni === 'number' && Number.isInteger(r.porzioni) && r.porzioni > 0 && r.porzioni <= 50 ? r.porzioni : 1;
  const minuti = typeof r.minuti_totali === 'number' && Number.isInteger(r.minuti_totali) && r.minuti_totali > 0 && r.minuti_totali < 1440 ? r.minuti_totali : null;
  return {
    titolo: r.titolo.trim().slice(0, 120),
    categoria: r.categoria as Categoria,
    porzioni,
    minuti_totali: minuti,
    descrizione: typeof r.descrizione === 'string' && r.descrizione.trim() ? r.descrizione.trim().slice(0, 500) : null,
    ingredienti: ingredienti as RigaPiano[],
    passi,
  };
}

/**
 * Legge il file del piano. Le regole passano dagli stessi controlli di quelle scritte a mano (valori strani
 * ignorati); una ricetta incompleta fa fallire tutto il file, così non si carica un piano a metà.
 * `oggi` è la data di caricamento, che si mostra in Impostazioni › Antonino.
 */
export function leggiPiano(testo: string, oggi: string): Piano {
  let dati: unknown;
  try {
    dati = JSON.parse(testo);
  } catch {
    throw new Error('Il file non è un piano di Mastercook.');
  }
  const d = oggetto(dati);
  if (!d || d.formato !== 'mastercook-piano') throw new Error('Il file non è un piano di Mastercook.');
  if (d.versione !== 1) throw new Error('Questo piano è di una versione più nuova: aggiorna l’app.');
  const nome = typeof d.nome === 'string' && d.nome.trim() ? d.nome.trim().slice(0, 80) : 'Piano del nutrizionista';
  const scritte = oggetto(d.regole) ?? {};
  const piano = { ...(oggetto(scritte.piano) ?? {}), nome, caricato_il: oggi };
  const regole = regoleDa({ antonino: { regole: { ...scritte, piano, pesi: undefined } } });
  const ricette: RicettaPiano[] = [];
  for (const [i, x] of (Array.isArray(d.ricette) ? d.ricette : []).entries()) {
    const r = ricetta(x);
    if (!r) throw new Error(`La ricetta n. ${i + 1} del piano è incompleta.`);
    ricette.push(r);
  }
  return { nome, regole: { ...regole, pesi: PESI_BASE }, ricette };
}

/** Le regole da salvare caricando il piano: quelle del piano, tenendo i pesi che la famiglia ha già scelto. */
export function regoleConPiano(attuali: RegoleAntonino, piano: Piano): RegoleAntonino {
  return { ...piano.regole, pesi: attuali.pesi };
}

/** Le ricette del piano che la famiglia non ha ancora (stesso titolo, senza badare a maiuscole). */
export function ricetteNuove(piano: Piano, titoliDellaFamiglia: string[]): RicettaPiano[] {
  const ci = new Set(titoliDellaFamiglia.map((t) => t.trim().toLowerCase()));
  return piano.ricette.filter((r) => !ci.has(r.titolo.toLowerCase()));
}

/** Il comando salva_ricetta per creare una ricetta del piano nella famiglia. `nuovoId` dà gli id (ricetta e righe). */
export function comandoRicetta(r: RicettaPiano, nuovoId: () => string): Record<string, unknown> {
  return {
    id: nuovoId(),
    nuova: true,
    campi: {
      titolo: r.titolo,
      descrizione: r.descrizione,
      categoria: r.categoria,
      cucina: 'italiana',
      provenienza: 'Piano del nutrizionista',
      porzioni: r.porzioni,
      minuti_totali: r.minuti_totali,
      foto: null,
      derivata_da: null,
    },
    ingredienti: { aggiungi: r.ingredienti.map((g, ordine) => ({ id: nuovoId(), ...g, ordine })), modifica: [], rimuovi: [] },
    basi: { imposta: [], rimuovi: [] },
    passi: { aggiungi: r.passi.map((testo, ordine) => ({ id: nuovoId(), testo, ordine })), modifica: [], rimuovi: [] },
  };
}
