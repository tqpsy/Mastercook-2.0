/**
 * Gli abbinamenti dello scontrino alle righe già confermate (dal carrello o a mano), così niente entra in casa due volte,
 * e l'unione delle righe ripetute («PETTO POLLO ×2»).
 */
import { type Indice, normalizza } from './ricette';
import { parole, suggerisciIngrediente } from './scontrini-prodotti';
import type { RigaLetta } from './scontrini-tipi';
import { leggiNumero } from './unita';

/** Una riga già confermata dal carrello, ancora senza prezzo, a cui uno scontrino può darlo. */
export interface RigaDaAbbinare {
  id: string;
  ingrediente_id: string | null;
  nome: string;
}

/** La parola senza la vocale finale: «mele» e «mela» sono la stessa, «latte» e «lattuga» no. */
const radice = (w: string) => w.replace(/[aeio]$/, '');

/**
 * Due parole si somigliano se iniziano uguali: «mozz» è mozzarella, «yog» è yogurt, «pane» non è «panna». Ma una parola
 * scritta per intero, che è già il nome di un ingrediente («latte», «mela», «pane», «riso»), non è l'inizio di un'altra:
 * «latte» non è «lattuga», «mela» non è «melanzane», «pane» non è «panettone». Quella si confronta con la radice.
 */
function parolaSimile(dalloScontrino: string, nota: string, intera: boolean): boolean {
  if (intera) return radice(dalloScontrino) === radice(nota);
  if (dalloScontrino.length === 3) return nota.startsWith(dalloScontrino);
  return dalloScontrino.slice(0, 4) === nota.slice(0, 4);
}

/** La parola è, per intero, una parola del nome o dei sinonimi di un ingrediente. */
const eParolaIntera = (w: string, indice: Indice) => indice.cercaIngredienti(w, 60).some((i) => [i.nome, ...i.sinonimi].some((n) => normalizza(n).split(' ').includes(w)));

/** Descrizione senza spazi e punteggiatura, per riconoscere la stessa riga ripetuta sullo scontrino. */
const chiaveRiga = (descrizione: string) => normalizza(descrizione).replace(/[^a-z0-9]/g, '');

/**
 * Abbina ogni riga letta a una riga già confermata (dal carrello o a mano), così non entra in casa due volte:
 * 1. per ingrediente suggerito, in tutte e due le direzioni (spaghetti ↔ pasta, mozzarella ↔ mozzarella di bufala);
 * 2. per parole in comune con il nome o i sinonimi;
 * 3. la stessa riga ripetuta (due confezioni passate una alla volta) va sulla stessa riga confermata della prima.
 * Ogni riga confermata prende al più una riga diversa; quelle senza abbinamento sono nuove.
 */
export function abbinaRighe(lette: RigaLetta[], candidate: RigaDaAbbinare[], indice: Indice): (string | null)[] {
  const usate = new Set<string>();
  const risultato: (string | null)[] = lette.map(() => null);
  const chiavi = lette.map((r) => chiaveRiga(r.descrizione));
  const suggeriti = lette.map((r) => suggerisciIngrediente(r.descrizione, indice));
  /** Una riga uguale a una già abbinata la segue, invece di prendere un'altra riga confermata. */
  const ripetuta = (i: number) => chiavi.slice(0, i).includes(chiavi[i]);
  const prendi = (i: number, c: RigaDaAbbinare | undefined) => {
    if (!c) return;
    usate.add(c.id);
    risultato[i] = c.id;
  };
  const libere = () => candidate.filter((x) => !usate.has(x.id));
  for (const [i] of lette.entries()) {
    const ing = suggeriti[i];
    if (!ing || ripetuta(i)) continue;
    const suoi = indice.antenati(ing.id);
    const conIngrediente = libere().filter((x) => x.ingrediente_id);
    prendi(i, conIngrediente.find((x) => suoi.includes(x.ingrediente_id!)) ?? conIngrediente.find((x) => indice.antenati(x.ingrediente_id!).includes(ing.id)));
  }
  for (const [i, r] of lette.entries()) {
    if (risultato[i] || ripetuta(i)) continue;
    const mie = parole(r.descrizione);
    if (!mie.length) continue;
    prendi(
      i,
      libere().find((x) => {
        const ing = x.ingrediente_id ? indice.ingrediente(x.ingrediente_id) : undefined;
        const note = [x.nome, ...(ing ? [ing.nome, ...ing.sinonimi] : [])].flatMap(parole);
        return note.some((w) => mie.some((m) => parolaSimile(m, w, eParolaIntera(m, indice))));
      }),
    );
  }
  for (const [i] of lette.entries()) {
    if (risultato[i]) continue;
    const prima = chiavi.findIndex((k, j) => j < i && k === chiavi[i] && risultato[j]);
    if (prima >= 0) risultato[i] = risultato[prima];
  }
  return risultato;
}

/** «PETTO POLLO» + «PETTO POLLO» = «PETTO POLLO ×2»; righe diverse si mettono una dopo l'altra. */
export function unisciDescrizioni(prima: string, altra: string): string {
  const m = /^(.*) ×(\d+)$/.exec(prima);
  const [testo, volte] = m ? [m[1], Number(m[2])] : [prima, 1];
  return (testo === altra ? `${testo} ×${volte + 1}` : `${prima} + ${altra}`).slice(0, 120);
}

/** Una riga dello scontrino in revisione, per quel che serve a unirla con le sue ripetizioni. */
export interface RigaRipetibile {
  id: string;
  descrizione: string;
  /** Il prezzo come lo si scrive («1,29»), vuoto se non c'è. */
  euro: string;
  azione: string;
  ing: { id: string } | null;
  numero: string;
  unita: string;
  luogo: string;
  quante?: string;
  /** Perché la riga è «da controllare» (le due letture divergono, prezzo ricavato dal conto): vale per la riga unita se vale per una delle due. */
  dubbia?: string;
}

/**
 * La stessa riga ripetuta (l'Iper stampa ogni confezione a parte): una riga sola con «× 2» e i prezzi sommati, così in
 * casa entra una riga «200 g × 2». Solo le righe che entrano in casa con la stessa descrizione, lo stesso prodotto, la
 * stessa quantità, lo stesso posto e lo stesso prezzo.
 */
export function unisciRipetute<T extends RigaRipetibile>(righe: T[]): T[] {
  const chiave = (r: T) => (r.azione === 'casa' && r.ing ? [normalizza(r.descrizione), r.ing.id, r.numero.trim(), r.unita, r.luogo].join('|') : null);
  const unite: { riga: T; chiave: string | null; euro: string }[] = [];
  for (const r of righe) {
    const k = chiave(r);
    const stessa = k ? unite.find((u) => u.chiave === k && u.euro === r.euro.trim()) : undefined;
    if (!stessa) {
      unite.push({ riga: { ...r }, chiave: k, euro: r.euro.trim() });
      continue;
    }
    const s = stessa.riga;
    s.dubbia ??= r.dubbia;
    s.quante = String((leggiNumero(s.quante || '1') ?? 1) + (leggiNumero(r.quante || '1') ?? 1));
    if (s.euro.trim()) s.euro = (Math.round(((leggiNumero(s.euro) ?? 0) + (leggiNumero(r.euro) ?? 0)) * 100) / 100).toFixed(2).replace('.', ',');
  }
  return unite.map((u) => u.riga);
}
