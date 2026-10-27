/**
 * Menu della settimana: settimane, pasti della famiglia, porzioni automatiche, compatibilità di una
 * portata tenendo conto di chi non mangia o mangia altro, gusti dichiarati. Nessuna di queste funzioni
 * tocca la casa: pianificare è un'intenzione (T-PIA).
 */
import { type Esito, type Valutazione, valutaPerVincoli, type Verifica, verificataPer, type Vincolo } from './compatibilita';
import type { Indice, Ricetta } from './ricette';
import { piuGiorni } from './scadenze';

export const CATEGORIE_STANDARD = [
  { chiave: 'colazione', nome: 'Colazione', emoji: '☕', attiva: true },
  { chiave: 'spuntino', nome: 'Spuntino', emoji: '🍎', attiva: false },
  { chiave: 'pranzo', nome: 'Pranzo', emoji: '🍝', attiva: true },
  { chiave: 'merenda', nome: 'Merenda', emoji: '🧃', attiva: false },
  { chiave: 'cena', nome: 'Cena', emoji: '🌙', attiva: true },
] as const;

export interface CategoriaPasto {
  /** La chiave per quelle standard, l'id per quelle della famiglia: è il valore di `portata.categoria`. */
  valore: string;
  nome: string;
  emoji: string;
  attiva: boolean;
  standard: boolean;
  ordine: number;
  id?: string;
  versione?: number;
}

type Riga = Record<string, unknown> & { id: string };

/** Le categorie della famiglia in ordine: le standard (accese o spente) e quelle create. */
export function categorieDellaFamiglia(righe: Riga[]): CategoriaPasto[] {
  const standard = CATEGORIE_STANDARD.map((c, i): CategoriaPasto => {
    const r = righe.find((x) => x.chiave === c.chiave);
    return { valore: c.chiave, nome: c.nome, emoji: c.emoji, attiva: r ? r.attiva !== false : c.attiva, standard: true, ordine: i + 1 };
  });
  const proprie = righe
    .filter((r) => !r.chiave)
    .map((r): CategoriaPasto => ({
      valore: r.id,
      id: r.id,
      nome: String(r.nome),
      emoji: String(r.emoji ?? '🍽️'),
      attiva: r.attiva !== false,
      standard: false,
      ordine: Number(r.ordine ?? 99),
      versione: Number(r.versione ?? 1),
    }));
  return [...standard, ...proprie].sort((a, b) => a.ordine - b.ordine || a.nome.localeCompare(b.nome));
}

/** Il lunedì della settimana di una data «AAAA-MM-GG». */
export function lunedi(data: string): string {
  const giorno = new Date(`${data}T00:00:00Z`).getUTCDay();
  return piuGiorni(data, -((giorno + 6) % 7));
}

export function giorniDellaSettimana(lun: string): string[] {
  return Array.from({ length: 7 }, (_, i) => piuGiorni(lun, i));
}

const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

export function nomeGiorno(data: string, corto = false): string {
  const n = GIORNI[new Date(`${data}T00:00:00Z`).getUTCDay()];
  return corto ? n.slice(0, 3) : n;
}

/** «lunedì 3 novembre». */
export function dataLunga(data: string): string {
  const [, m, g] = data.split('-').map(Number);
  return `${nomeGiorno(data)} ${g} ${MESI[m - 1]}`;
}

/** «3–9 novembre» oppure «27 ottobre – 2 novembre». */
export function nomeSettimana(lun: string): string {
  const fine = piuGiorni(lun, 6);
  const [, m1, g1] = lun.split('-').map(Number);
  const [, m2, g2] = fine.split('-').map(Number);
  return m1 === m2 ? `${g1}–${g2} ${MESI[m2 - 1]}` : `${g1} ${MESI[m1 - 1]} – ${g2} ${MESI[m2 - 1]}`;
}

export interface Persona {
  id: string;
  nome: string;
  /** 1 = adulto, 0,6 = bambino. */
  porzione: number;
}

export interface Eccezione {
  id: string;
  portata_id: string;
  membro_id: string;
  tipo: 'non_mangia' | 'alternativa';
  ricetta_id: string | null;
  testo: string | null;
  porzioni: number | null;
  versione?: number;
}

/** Le porzioni del piatto principale: chi lo mangia, ognuno con la sua porzione. */
export function porzioniAutomatiche(persone: Persona[], eccezioni: Pick<Eccezione, 'membro_id'>[]): number {
  const fuori = new Set(eccezioni.map((e) => e.membro_id));
  const totale = persone.filter((p) => !fuori.has(p.id)).reduce((s, p) => s + p.porzione, 0);
  return Math.round(totale * 2) / 2;
}

export interface ValutazionePortata {
  esito: Esito;
  perMembro: { membro_id: string; nome: string; mangia: 'principale' | 'alternativa' | 'niente'; valutazione: Valutazione | null }[];
}

const PEGGIORE: Record<Esito, number> = { adatta: 0, da_verificare: 1, non_adatta: 2 };

/**
 * La portata va bene per chi la mangia? Chi non mangia non conta; chi mangia un'alternativa
 * si valuta sull'alternativa (se è testo libero l'app non può dirlo: da verificare se ha vincoli).
 * `ricetta` è null per una portata a testo libero.
 */
export function valutaPortata(
  indice: Indice,
  ricetta: Ricetta | null,
  persone: Persona[],
  vincoli: Vincolo[],
  eccezioni: Eccezione[],
  verifiche?: Verifica[],
): ValutazionePortata {
  const perMembro = persone.map((p) => {
    const e = eccezioni.find((x) => x.membro_id === p.id);
    const suoi = vincoli.filter((v) => v.membro_id === p.id);
    if (e?.tipo === 'non_mangia') return { membro_id: p.id, nome: p.nome, mangia: 'niente' as const, valutazione: null };
    const piatto = e?.tipo === 'alternativa' ? (e.ricetta_id ? (indice.perId.get(e.ricetta_id) ?? null) : null) : ricetta;
    const mangia = e?.tipo === 'alternativa' ? ('alternativa' as const) : ('principale' as const);
    if (piatto) return { membro_id: p.id, nome: p.nome, mangia, valutazione: valutaPerVincoli(indice, piatto, suoi, verificataPer(verifiche, p.id, piatto.id)) };
    const valutazione: Valutazione = suoi.length ? { esito: 'da_verificare', motivi: ['piatto scritto a mano: controlla tu gli ingredienti'] } : { esito: 'adatta', motivi: [] };
    return { membro_id: p.id, nome: p.nome, mangia, valutazione };
  });
  const esito = perMembro.reduce<Esito>((x, m) => (m.valutazione && PEGGIORE[m.valutazione.esito] > PEGGIORE[x] ? m.valutazione.esito : x), 'adatta');
  return { esito, perMembro };
}

export interface Gusto {
  id: string;
  membro_id: string;
  ingrediente_id: string | null;
  ricetta_id: string | null;
  valore: 'piace' | 'non_piace';
  versione?: number;
}

/** Gusti che riguardano un piatto per chi lo mangia: «a Sara non piacciono le zucchine». */
export function gustiPerPiatto(indice: Indice, ricetta: Ricetta, persone: Persona[], gusti: Gusto[]): { membro_id: string; nome: string; valore: Gusto['valore']; cosa: string }[] {
  const contiene = new Set(ricetta.ingredienti.filter((g) => !g.opzionale).flatMap((g) => indice.antenati(g.ingrediente_id)));
  const esito: { membro_id: string; nome: string; valore: Gusto['valore']; cosa: string }[] = [];
  for (const p of persone) {
    for (const g of gusti.filter((x) => x.membro_id === p.id)) {
      if (g.ricetta_id === ricetta.id) esito.push({ membro_id: p.id, nome: p.nome, valore: g.valore, cosa: ricetta.titolo });
      else if (g.ingrediente_id && contiene.has(g.ingrediente_id)) esito.push({ membro_id: p.id, nome: p.nome, valore: g.valore, cosa: indice.nome(g.ingrediente_id) });
    }
  }
  return esito;
}

export interface PortataMenu {
  id: string;
  data: string;
  categoria: string;
  ricetta_id: string | null;
  testo: string | null;
  porzioni: number | null;
  origine: string;
  bloccata: boolean;
  ordine: number;
  note: string | null;
  versione?: number;
  in_attesa?: boolean;
}

/**
 * Cosa mandare a `ripeti_portate` per copiare una settimana su un'altra (stessi giorni, +7·n).
 * Gli id nuovi li dà il chiamante: così l'anteprima sul dispositivo e il server coincidono.
 */
export function ripetiSettimana(portate: PortataMenu[], eccezioni: Eccezione[], da: string, a: string, nuovoId: () => string) {
  const spostamento = Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${da}T00:00:00Z`)) / 86_400_000);
  const fine = piuGiorni(da, 6);
  const scelte = portate.filter((p) => p.data >= da && p.data <= fine);
  const copie = scelte.map((p) => ({ da: p.id, id: nuovoId(), data: piuGiorni(p.data, spostamento) }));
  const nuovaDi = new Map(copie.map((c) => [c.da, c.id]));
  const ecc = eccezioni.filter((e) => nuovaDi.has(e.portata_id)).map((e) => ({ da: e.id, id: nuovoId(), portata_id: nuovaDi.get(e.portata_id)! }));
  return { portate: copie, eccezioni: ecc };
}
