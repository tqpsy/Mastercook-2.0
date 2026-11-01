/**
 * Piatto senza un ingrediente: quando una ricetta è ⛔ per qualcuno solo per un ingrediente che si può togliere
 * (la panna per chi non tollera il lattosio), la si può fare senza, solo per quella persona o per tutti.
 * Vale per quel pasto: la ricetta non cambia. Si sceglie quando si aggiunge un piatto a mano o lo propone Antonino.
 *
 * Non si toglie mai: l'ingrediente che regge il piatto (togliendolo sparisce un tipo principale: la pasta della
 * carbonara, il gorgonzola degli gnocchi al gorgonzola; la parte più grande del piatto o almeno il 40% del peso:
 * la panna della panna cotta; il pane della ribollita), un ingrediente nel nome del piatto («Pollo alle mandorle»),
 * dentro una base collegata (il latte della besciamella) o nell'impasto di dolci, pane e pizza, un allergene
 * dichiarato dalla ricetta (c'è anche dove
 * non si vede), le uova crude (si usano pastorizzate), una ricetta segnata «non va bene» dalla famiglia.
 */
import { type Esito, type ValutazioneFamiglia, valutaPerVincoli, type Verifica, verificataPer, type Vincolo } from './compatibilita';
import type { Persona } from './menu';
import { tipiPrincipali, tipoDellaRiga } from './principale';
import { type Indice, normalizza, type Ricetta } from './ricette';

/** Un ingrediente tolto da una portata: per tutti (`membro_id` null) o solo per una persona. */
export interface Senza {
  ingrediente_id: string;
  membro_id: string | null;
}

/** Legge `portata.senza` com'è nel database, scartando ciò che non ha senso. */
export function leggiSenza(x: unknown): Senza[] {
  if (!Array.isArray(x)) return [];
  return x
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && typeof (s as Record<string, unknown>).ingrediente_id === 'string')
    .map((s) => ({ ingrediente_id: String(s.ingrediente_id), membro_id: typeof s.membro_id === 'string' ? s.membro_id : null }));
}

/** La ricetta senza quegli ingredienti (anche quelli che vengono da una base collegata). */
export function ricettaSenza(r: Ricetta, ids: Iterable<string>): Ricetta {
  const via = new Set(ids);
  if (!via.size) return r;
  return { ...r, ingredienti: r.ingredienti.filter((g) => !via.has(g.ingrediente_id)) };
}

/** Gli ingredienti che quella persona non trova nel piatto: quelli tolti per tutti e quelli tolti solo a lei. */
export function senzaPer(senza: Senza[] | null | undefined, membro_id: string): string[] {
  return [...new Set((senza ?? []).filter((s) => s.membro_id === null || s.membro_id === membro_id).map((s) => s.ingrediente_id))];
}

/**
 * Quanta parte di un ingrediente serve davvero: 1 tutto, 0 niente (tolto per tutti), in mezzo se è tolto solo ad
 * alcuni (le loro porzioni si mettono da parte prima di aggiungerlo). `fuori` sono quelli che non mangiano il piatto
 * (non mangiano o mangiano altro): per loro non si toglie niente. Lo stesso calcolo di `interno.quota_senza`.
 */
export function quotaSenza(senza: Senza[] | null | undefined, ingrediente_id: string, persone: Persona[], fuori: Set<string>, porzioni: number): number {
  const sue = (senza ?? []).filter((s) => s.ingrediente_id === ingrediente_id);
  if (!sue.length) return 1;
  if (sue.some((s) => s.membro_id === null)) return 0;
  if (porzioni <= 0) return 1;
  const chi = new Set(sue.map((s) => s.membro_id));
  const tolte = persone.filter((p) => chi.has(p.id) && !fuori.has(p.id)).reduce((t, p) => t + p.porzione, 0);
  return Math.max(0, 1 - tolte / porzioni);
}

export interface RimedioPersona {
  membro_id: string;
  nome: string;
  /** Gli ingredienti da togliere per lei. */
  togli: string[];
  /** Perché togliere non basta, se non basta. */
  bloccato: string | null;
  /** Com'è il piatto per lei senza quegli ingredienti. */
  dopo: Esito;
}

export interface Rimedio {
  /** Togliendo gli ingredienti indicati nessuno ha più ⛔. */
  possibile: boolean;
  /** Tolti gli ingredienti, è ✅ per tutti (non solo «da verificare»). */
  adattaDopo: boolean;
  /** Solo le persone con ⛔. */
  perMembro: RimedioPersona[];
  /** Tutti gli ingredienti da togliere. */
  togli: string[];
}

/**
 * Per un piatto ⛔: chi ha il problema, quali ingredienti togliere e se togliendoli si risolve.
 * Null se il piatto non è ⛔ per nessuno.
 */
export function rimedio(indice: Indice, r: Ricetta, persone: Pick<Persona, 'id' | 'nome'>[], vincoli: Vincolo[], verifiche?: Verifica[]): Rimedio | null {
  const perMembro: RimedioPersona[] = [];
  let adattaDopo = true;
  const valutate = persone.map((p) => {
    const suoi = vincoli.filter((v) => v.membro_id === p.id);
    const verifica = verificataPer(verifiche, p.id, r.id);
    return { p, suoi, verifica, v: valutaPerVincoli(indice, r, suoi, verifica) };
  });
  for (const { p, v } of valutate) {
    if (v.esito !== 'non_adatta') {
      if (v.esito !== 'adatta') adattaDopo = false;
      continue;
    }
    const motivi = (v.dettagli ?? []).filter((d) => d.esito === 'non_adatta');
    const senzaRimedio = v.scartata ? { testo: 'l’avete segnata «non va bene»' } : motivi.find((d) => !d.ingredienti?.length);
    perMembro.push({
      membro_id: p.id,
      nome: p.nome,
      togli: [...new Set(motivi.flatMap((d) => d.ingredienti ?? []))],
      bloccato: senzaRimedio ? `${senzaRimedio.testo}: non basta togliere un ingrediente` : null,
      dopo: 'non_adatta',
    });
  }
  if (!perMembro.length) return null;
  const togli = [...new Set(perMembro.flatMap((m) => m.togli))];

  // Togliendoli sparisce un tipo principale (la pasta, la carne del ragù)? Allora non è più quel piatto.
  const prima = tipiPrincipali(indice, r);
  const dopo = tipiPrincipali(indice, ricettaSenza(r, togli));
  const persi = new Set([...prima].filter((t) => !dopo.has(t)));
  if (persi.size) {
    for (const m of perMembro) {
      if (m.bloccato) continue;
      const regge = r.ingredienti.filter((g) => m.togli.includes(g.ingrediente_id) && persi.has(tipoDellaRiga(indice, r, g)!));
      if (regge.length) {
        const nomi = [...new Set(regge.map((g) => indice.nome(g.ingrediente_id).toLowerCase()))];
        m.bloccato = `${nomi.join(', ')} ${nomi.length > 1 ? 'sono' : 'è'} l’ingrediente principale: senza, non sarebbe più questo piatto`;
      }
    }
  }

  // Un ingrediente nel nome del piatto, dentro una base o nell'impasto, o la parte più grande del piatto: non si toglie.
  for (const m of perMembro) {
    if (m.bloccato) continue;
    m.bloccato = m.togli.map((id) => perchéNonSiToglie(indice, r, id)).find((x) => x) ?? null;
  }

  for (const m of perMembro) {
    if (m.bloccato) continue;
    const x = valutate.find((y) => y.p.id === m.membro_id)!;
    m.dopo = valutaPerVincoli(indice, ricettaSenza(r, m.togli), x.suoi, x.verifica).esito;
    if (m.dopo !== 'adatta') adattaDopo = false;
  }
  const possibile = perMembro.every((m) => !m.bloccato && m.dopo !== 'non_adatta');
  return { possibile, adattaDopo: possibile && adattaDopo, perMembro, togli };
}

/** Ingredienti dell'impasto di dolci, pane e pizza: senza, l'impasto non viene. */
const IMPASTO = ['ing:farina', 'ing:farina_integrale', 'ing:semola', 'ing:farina_ceci', 'ing:farina_riso', 'ing:lievito_birra', 'ing:lievito_dolci', 'ing:zucchero', 'ing:uova', 'ing:burro', 'ing:latte'];
/** Pane, farine e cereali: in quantità da piatto (dai 30 g a porzione) reggono il piatto (la ribollita, l'orzotto). */
const AMIDI = ['ing:pane', 'ing:farina', 'ing:farina_integrale', 'ing:semola', 'ing:farina_ceci', 'ing:farina_riso', 'ing:orzo', 'ing:farro'];
const LIEVITI = ['ing:lievito_birra', 'ing:lievito_dolci'];

/** Perché un ingrediente non si può togliere da quella ricetta, o null se si può. */
export function perchéNonSiToglie(indice: Indice, r: Ricetta, id: string): string | null {
  const nome = indice.nome(id).toLowerCase();
  const righe = r.ingredienti.filter((g) => g.ingrediente_id === id);
  const base = righe.find((g) => g.da_ricetta_id);
  if (base) return `${nome} è dentro ${(indice.perId.get(base.da_ricetta_id!)?.titolo ?? 'una base').toLowerCase()}: senza, non si può preparare`;
  if (nelNome(indice, r.titolo, id)) return `${nome} è nel nome del piatto: senza, non sarebbe più questo piatto`;
  const radici = indice.antenati(id);
  const ha = (ids: string[]) => radici.some((x) => ids.includes(x));
  const impasto = r.categoria === 'dolce' || r.categoria === 'colazione' || r.ingredienti.some((g) => indice.antenati(g.ingrediente_id).some((x) => LIEVITI.includes(x)));
  if (impasto && ha(IMPASTO)) return `${nome} fa parte dell’impasto: senza, non viene`;
  const pesi = pesoRighe(indice, r);
  if (ha(AMIDI) && (pesi.get(id) ?? 0) / Math.max(1, r.porzioni) >= 30) return `${nome} regge il piatto: senza, non sarebbe più questo piatto`;
  const totale = [...pesi.values()].reduce((t, x) => t + x, 0);
  const massimo = Math.max(0, ...pesi.values());
  const peso = pesi.get(id) ?? 0;
  if (totale && peso > 0 && (peso === massimo || peso / totale >= QUOTA_MASSIMA)) return `${nome} è la parte più grande del piatto: senza, non sarebbe più questo piatto`;
  return null;
}

/** Il nome dell'ingrediente (o un sinonimo) è nel titolo: «Pollo alle mandorle», «Risotto alla parmigiana». */
function nelNome(indice: Indice, titolo: string, id: string): boolean {
  const ing = indice.ingrediente(id);
  if (!ing) return false;
  const parole = normalizza(titolo).split(' ');
  // Basta la prima parola del nome, a meno dell'ultima lettera (mandorla/mandorle, parmigiano/parmigiana).
  const radice = (p: string) => (p.length >= 5 ? p.slice(0, -1) : p);
  return [ing.nome, ...ing.sinonimi].some((n) => {
    const prima = normalizza(n).split(' ')[0];
    return prima.length >= 4 && parole.some((p) => p === prima || (p.length >= 5 && radice(p) === radice(prima)));
  });
}

/** Oltre questa parte del peso del piatto un ingrediente non si toglie. */
const QUOTA_MASSIMA = 0.4;

/** Il peso di ogni ingrediente della ricetta, in grammi (ml come grammi, un uovo 55 g); sale, olio e q.b. esclusi. */
function pesoRighe(indice: Indice, r: Ricetta): Map<string, number> {
  const pesi = new Map<string, number>();
  for (const g of r.ingredienti) {
    if (g.qb || g.opzionale || g.quantita == null || indice.ingrediente(g.ingrediente_id)?.base) continue;
    const grammi = g.unita === 'g' || g.unita === 'ml' ? g.quantita : indice.antenati(g.ingrediente_id).includes('ing:uova') ? g.quantita * 55 : 0;
    pesi.set(g.ingrediente_id, (pesi.get(g.ingrediente_id) ?? 0) + grammi);
  }
  return pesi;
}

/** «panna» oppure «panna e burro». */
export function elencoNomi(indice: Indice, ids: string[]): string {
  const nomi = ids.map((id) => indice.nome(id).toLowerCase());
  return nomi.length > 1 ? `${nomi.slice(0, -1).join(', ')} e ${nomi[nomi.length - 1]}` : (nomi[0] ?? '');
}

/** «Si fa senza panna per Sara» / «per Sara e Marco». */
export function testoRimedio(indice: Indice, x: Rimedio): string {
  const nomi = x.perMembro.map((m) => m.nome);
  const chi = nomi.length > 1 ? `${nomi.slice(0, -1).join(', ')} e ${nomi[nomi.length - 1]}` : nomi[0];
  return `Si fa senza ${elencoNomi(indice, x.togli)} per ${chi}`;
}

/**
 * Cosa scrivere in `portata.senza`: per tutti un ingrediente solo (membro null); solo per loro una voce per persona
 * e ingrediente. Gli ospiti non sono persone della famiglia: per loro si toglie per tutti.
 */
export function senzaDaScegliere(x: Rimedio, perTutti: boolean, famiglia: Set<string>): Senza[] {
  if (perTutti) return x.togli.map((ingrediente_id) => ({ ingrediente_id, membro_id: null }));
  const voci: Senza[] = [];
  const tutti = new Set(x.perMembro.filter((m) => !famiglia.has(m.membro_id)).flatMap((m) => m.togli));
  for (const id of tutti) voci.push({ ingrediente_id: id, membro_id: null });
  for (const m of x.perMembro) {
    if (!famiglia.has(m.membro_id)) continue;
    for (const id of m.togli) if (!tutti.has(id)) voci.push({ ingrediente_id: id, membro_id: m.membro_id });
  }
  return voci;
}

/** La valutazione della famiglia per un piatto da cui è tolto qualcosa: ognuno sul suo piatto. */
export function valutaFamigliaSenza(
  indice: Indice,
  r: Ricetta,
  membri: { id: string; nome: string }[],
  vincoli: Vincolo[],
  verifiche: Verifica[] | undefined,
  senza: Senza[] | undefined,
): ValutazioneFamiglia {
  const perMembro = membri.map((m) => ({
    membro_id: m.id,
    nome: m.nome,
    valutazione: valutaPerVincoli(
      indice,
      ricettaSenza(r, senzaPer(senza, m.id)),
      vincoli.filter((v) => v.membro_id === m.id),
      verificataPer(verifiche, m.id, r.id),
    ),
  }));
  const ordine: Record<Esito, number> = { adatta: 0, da_verificare: 1, non_adatta: 2 };
  return { esito: perMembro.reduce<Esito>((e, x) => (ordine[x.valutazione.esito] > ordine[e] ? x.valutazione.esito : e), 'adatta'), perMembro };
}
