/**
 * Confezioni uguali in una riga: «Pasta 500 g × 2», non due righe da 500 g. Un lotto può ricordare quanto contiene
 * una confezione (`confezione`, nell'unità del lotto); la quantità resta il totale, così ricette e spesa contano come
 * prima. In Casa i lotti dello stesso prodotto, stessa confezione, stesso posto e stessa data si mostrano in una riga;
 * scadenze diverse restano righe diverse. Una confezione usata in parte è «aperta»: «500 g × 1 + 300 g aperta».
 * I prodotti a occhio (pezzi + livello) e i piatti cucinati non si raggruppano: contano già a modo loro.
 */
import { type Dimensione, formatta, inBase, leggiNumero, leggiQuante, type Scritta, type UnitaBase } from './unita';

export interface LottoContato {
  id: string;
  ingrediente_id: string;
  nome: string | null;
  quantita: number;
  unita: UnitaBase;
  luogo: string;
  posto?: string | null;
  data_limite: string | null;
  tipo_data: string;
  livello?: string | null;
  portata_id?: string | null;
  confezione?: number | null;
}

const arrotonda = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Quanto contiene una confezione, in unità base, da salvare nel lotto: solo con più confezioni intere (3 vasetti da
 * 125 g → 125). Con una confezione sola, o a pezzi di qualcosa che si pesa (3 zucchine), non serve: null.
 */
export function confezioneDa(s: Scritta, dimensione: Dimensione, pesoPz?: number | null): number | null {
  const quante = leggiQuante(s.quante);
  if (quante === null || quante < 2 || quante !== Math.trunc(quante)) return null;
  if (s.unita === 'pz' && dimensione !== 'pezzi') return null;
  const n = leggiNumero(s.numero);
  if (n === null) return null;
  const e = inBase(n, s.unita, dimensione, pesoPz);
  return e.ok ? e.quantita.valore : null;
}

/** Quanto contiene una confezione del lotto: quella ricordata o, se non la si sa, tutto il lotto (una confezione). */
export const taglia = (l: Pick<LottoContato, 'quantita' | 'confezione'>) => (l.confezione && l.confezione > 0 ? l.confezione : l.quantita);

/** Confezioni intere e la parte della confezione aperta (0 se sono tutte chiuse). */
export function pezziDelLotto(l: Pick<LottoContato, 'quantita' | 'confezione'>): { piene: number; aperta: number } {
  if (!l.confezione || l.confezione <= 0) return { piene: l.quantita > 0 ? 1 : 0, aperta: 0 };
  const piene = Math.floor(arrotonda(l.quantita / l.confezione) + 1e-9);
  const aperta = arrotonda(l.quantita - piene * l.confezione);
  return { piene, aperta: aperta > 0.0005 ? aperta : 0 };
}

/** Lotti che stanno nella stessa riga: stesso prodotto, nome, confezione, luogo, posto e data. */
export function chiaveGruppo(l: LottoContato): string {
  if (l.livello || l.portata_id) return `lotto:${l.id}`;
  return [l.ingrediente_id, l.nome ?? '', l.unita, l.luogo, l.posto ?? '', l.data_limite ?? '', l.tipo_data, arrotonda(taglia(l))].join('|');
}

export interface Gruppo<T extends LottoContato> {
  chiave: string;
  lotti: T[];
  /** Quello che si apre toccando la riga: la confezione aperta, se c'è. */
  primo: T;
  taglia: number;
  unita: UnitaBase;
  piene: number;
  aperte: number[];
  totale: number;
}

/** I lotti in righe, nell'ordine in cui arrivano (la prima volta che si vede un gruppo). */
export function raggruppa<T extends LottoContato>(lotti: T[]): Gruppo<T>[] {
  const perChiave = new Map<string, T[]>();
  for (const l of lotti) {
    const k = chiaveGruppo(l);
    const g = perChiave.get(k);
    if (g) g.push(l);
    else perChiave.set(k, [l]);
  }
  return [...perChiave].map(([chiave, elenco]) => gruppo(chiave, elenco));
}

function gruppo<T extends LottoContato>(chiave: string, lotti: T[]): Gruppo<T> {
  let piene = 0;
  const aperte: number[] = [];
  let primo = lotti[0];
  let apertaPrimo = Infinity;
  for (const l of lotti) {
    const p = pezziDelLotto(l);
    piene += p.piene;
    if (p.aperta) {
      aperte.push(p.aperta);
      if (p.aperta < apertaPrimo) {
        apertaPrimo = p.aperta;
        primo = l;
      }
    }
  }
  return {
    chiave,
    lotti,
    primo,
    taglia: taglia(lotti[0]),
    unita: lotti[0].unita,
    piene,
    aperte: aperte.sort((a, b) => a - b),
    totale: arrotonda(lotti.reduce((s, l) => s + l.quantita, 0)),
  };
}

/** I lotti dello stesso gruppo di `l`, tra quelli dati (almeno `l`). */
export function gruppoDi<T extends LottoContato>(lotti: T[], l: T): Gruppo<T> {
  const k = chiaveGruppo(l);
  const stessi = lotti.filter((x) => chiaveGruppo(x) === k);
  return gruppo(k, stessi.length ? stessi : [l]);
}

/** Quante confezioni (intere e aperte) ci sono nella riga. */
export const quanteConfezioni = (g: Gruppo<LottoContato>) => g.piene + g.aperte.length;

/** «500 g», «500 g × 2», «500 g × 2 + 300 g aperta», «300 g aperta (da 500 g)». */
export function descriviGruppo(g: Gruppo<LottoContato>): string {
  const una = formatta({ valore: g.taglia, unita: g.unita });
  const parti: string[] = [];
  if (g.piene > 0) parti.push(g.piene > 1 ? `${una} × ${g.piene}` : una);
  for (const a of g.aperte) parti.push(`${formatta({ valore: a, unita: g.unita })} aperta`);
  if (g.piene === 0 && g.aperte.length === 1) return `${parti[0]} (da ${una})`;
  return parti.join(' + ') || formatta({ valore: 0, unita: g.unita });
}

export interface Presa {
  lotto_id: string;
  quantita: number;
}

/** Da quali lotti prendere `quanto` della riga: prima le confezioni aperte (la più vuota per prima), poi le altre. */
export function daPrendere(g: Gruppo<LottoContato>, quanto: number): Presa[] {
  const ordine = [...g.lotti].sort((a, b) => (pezziDelLotto(a).aperta || Infinity) - (pezziDelLotto(b).aperta || Infinity));
  const prese: Presa[] = [];
  let resta = arrotonda(quanto);
  for (const l of ordine) {
    if (resta <= 0) break;
    const q = arrotonda(Math.min(resta, l.quantita));
    if (q > 0) prese.push({ lotto_id: l.id, quantita: q });
    resta = arrotonda(resta - q);
  }
  return prese;
}

/** Una confezione intera usata (o buttata): da un lotto che ne ha una chiusa, prima quelli senza confezione aperta. */
export function unaConfezione(g: Gruppo<LottoContato>): Presa | null {
  const conPiene = g.lotti.filter((l) => pezziDelLotto(l).piene > 0);
  const l = conPiene.find((x) => pezziDelLotto(x).aperta === 0) ?? conPiene[0];
  return l ? { lotto_id: l.id, quantita: Math.min(taglia(l), l.quantita) } : null;
}

/** Quella aperta finita: quel che ne resta, dal lotto con la confezione aperta più vuota. */
export function quellaAperta(g: Gruppo<LottoContato>): Presa | null {
  const l = g.lotti.filter((x) => pezziDelLotto(x).aperta > 0).sort((a, b) => pezziDelLotto(a).aperta - pezziDelLotto(b).aperta)[0];
  return l ? { lotto_id: l.id, quantita: pezziDelLotto(l).aperta } : null;
}
