/**
 * Controlli sul catalogo di sistema (docs/fase-0/07, sezione 2). Li usa lo script d'importazione
 * prima di scrivere e li ripete il test sul catalogo pubblicato: un errore blocca, un avviso va nel
 * rapporto perché qualcuno lo guardi.
 */
import { ALLERGENI_UE } from '../dominio/vincoli';
import { UNITA_BASE } from '../dominio/unita';
import { CATEGORIE, CLASSI, LUOGHI, type Catalogo } from './tipi';

export interface Problema {
  dove: string;
  cosa: string;
}

export interface EsitoControlli {
  errori: Problema[];
  avvisi: Problema[];
}

const ALLERGENI = new Set(ALLERGENI_UE.map((a) => a.oggetto.slice(4)));
const SLUG_INGREDIENTE = /^ing:[a-z0-9_]{1,60}$/;
const SLUG_RICETTA = /^sys:[a-z0-9_]{1,60}$/;
/** Oltre questo numero di pezzi per 4 porzioni probabilmente sono grammi scritti come pezzi. */
const PEZZI_SOSPETTI = 40;

/** Allergeni contenuti in una ricetta secondo i suoi ingredienti. */
export function allergeniDagliIngredienti(c: Catalogo, ricettaId: string): Set<string> {
  const perId = new Map(c.ingredienti.map((i) => [i.id, i]));
  const r = c.ricette.find((x) => x.id === ricettaId);
  const tutti = new Set<string>();
  for (const riga of r?.ingredienti ?? []) for (const a of perId.get(riga.ingrediente_id)?.allergeni ?? []) tutti.add(a);
  return tutti;
}

export function controllaCatalogo(c: Catalogo): EsitoControlli {
  const errori: Problema[] = [];
  const avvisi: Problema[] = [];
  const errore = (dove: string, cosa: string) => errori.push({ dove, cosa });
  const avviso = (dove: string, cosa: string) => avvisi.push({ dove, cosa });

  const reparti = new Set(c.reparti.map((r) => r.id));
  const cucine = new Set(c.cucine.map((x) => x.id));
  const regole = new Set(c.regole_cotti.map((r) => r.id));
  const categorie = new Set(CATEGORIE.map((x) => x.id));
  const perId = new Map<string, Catalogo['ingredienti'][number]>();

  for (const i of c.ingredienti) {
    if (!SLUG_INGREDIENTE.test(i.id)) errore(i.id, 'id non valido');
    if (perId.has(i.id)) errore(i.id, 'id ripetuto');
    perId.set(i.id, i);
    if (!i.nome.trim()) errore(i.id, 'nome vuoto');
    if (!reparti.has(i.reparto)) errore(i.id, `reparto sconosciuto: ${i.reparto}`);
    if (!(i.dimensione in UNITA_BASE)) errore(i.id, `dimensione sconosciuta: ${i.dimensione}`);
    if (!LUOGHI.includes(i.luogo)) errore(i.id, `luogo sconosciuto: ${i.luogo}`);
    if (!(Number.isInteger(i.giorni) && i.giorni > 0)) errore(i.id, `durata non valida: ${i.giorni}`);
    for (const a of i.allergeni) if (!ALLERGENI.has(a)) errore(i.id, `allergene sconosciuto: ${a}`);
    for (const k of i.classi) if (!CLASSI.includes(k)) errore(i.id, `classe sconosciuta: ${k}`);
    if (i.mesi?.some((m) => !(Number.isInteger(m) && m >= 1 && m <= 12))) errore(i.id, 'mesi non validi');
    if (i.peso_pz !== null && !(i.peso_pz > 0)) errore(i.id, 'peso medio non valido');
  }
  for (const i of c.ingredienti) {
    if (i.genitore && !perId.has(i.genitore)) errore(i.id, `genitore sconosciuto: ${i.genitore}`);
    const visti = new Set<string>();
    for (let x: string | null = i.id; x; x = perId.get(x)?.genitore ?? null) {
      if (visti.has(x)) {
        errore(i.id, 'catena di genitori circolare');
        break;
      }
      visti.add(x);
    }
    const g = i.genitore ? perId.get(i.genitore) : undefined;
    if (g && g.dimensione !== i.dimensione) avviso(i.id, `misurato in ${UNITA_BASE[i.dimensione]}, il genitore ${g.id} in ${UNITA_BASE[g.dimensione]}: le quantità non si sommano`);
  }

  const ricette = new Set<string>();
  for (const r of c.ricette) {
    if (!SLUG_RICETTA.test(r.id)) errore(r.id, 'id non valido');
    if (ricette.has(r.id)) errore(r.id, 'id ripetuto');
    ricette.add(r.id);
    if (!r.titolo.trim()) errore(r.id, 'titolo vuoto');
    if (!categorie.has(r.categoria)) errore(r.id, `categoria non prevista: ${r.categoria}`);
    if (!cucine.has(r.cucina)) errore(r.id, `cucina sconosciuta: ${r.cucina}`);
    if (!(Number.isInteger(r.porzioni) && r.porzioni > 0)) errore(r.id, 'porzioni non valide');
    if (!(r.minuti_totali > 0)) errore(r.id, 'tempo non valido');
    if (![1, 2, 3].includes(r.difficolta)) errore(r.id, 'difficoltà non valida');
    if (r.conservazione && !regole.has(r.conservazione)) errore(r.id, `regola di conservazione sconosciuta: ${r.conservazione}`);
    if (!r.ingredienti.length) errore(r.id, 'nessun ingrediente');
    if (!r.passi.length || r.passi.some((p) => !p.trim())) errore(r.id, 'passaggi mancanti');
    for (const a of r.allergeni_dichiarati) if (!ALLERGENI.has(a)) errore(r.id, `allergene dichiarato sconosciuto: ${a}`);

    const righe = new Set<string>();
    for (const riga of r.ingredienti) {
      const ing = perId.get(riga.ingrediente_id);
      const dove = `${r.id} → ${riga.ingrediente_id}`;
      if (!ing) {
        errore(dove, 'ingrediente non presente nella tassonomia');
        continue;
      }
      if (righe.has(riga.ingrediente_id) && !riga.opzionale) avviso(dove, 'ingrediente ripetuto nella stessa ricetta');
      righe.add(riga.ingrediente_id);
      if (riga.unita !== UNITA_BASE[ing.dimensione]) errore(dove, `unità ${riga.unita} incompatibile con ${ing.dimensione}`);
      if (riga.qb) {
        if (riga.quantita !== null) errore(dove, 'q.b. con una quantità');
      } else if (riga.quantita === null || !(riga.quantita > 0) || !Number.isFinite(riga.quantita)) {
        errore(dove, 'quantità mancante o non valida');
      } else if (riga.unita === 'pz') {
        if (!Number.isInteger(riga.quantita * 2)) errore(dove, `pezzi non interi: ${riga.quantita}`);
        if ((riga.quantita * 4) / r.porzioni > PEZZI_SOSPETTI) errore(dove, `${riga.quantita} pezzi: sembrano grammi`);
      }
    }

    const calcolati = allergeniDagliIngredienti(c, r.id);
    const mancanti = r.allergeni_dichiarati.filter((a) => !calcolati.has(a));
    if (mancanti.length) avviso(r.id, `allergeni dichiarati ma non dagli ingredienti: ${mancanti.join(', ')} (restano: valgono dichiarati ∪ ingredienti)`);
  }

  return { errori, avvisi };
}
