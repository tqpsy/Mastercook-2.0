/**
 * Verifica fotografica dell'inventario: si fotografano una o più zone del frigo e l'app confronta ciò che Gemini
 * vede con ciò che c'è in casa. Non crea un secondo inventario: legge i lotti e propone correzioni che la persona
 * conferma (comando `verifica_inventario`). Le foto e il riconoscimento non cambiano mai la casa da soli.
 *
 * Un alimento non visto in foto non è per forza finito (può essere dietro a un altro): si chiede, non si decide.
 * Il menu aiuta a dare un contesto (sappiamo cosa serve nei prossimi giorni) ma non è una prova che ci sia.
 */
import { FRIGO_BASE, type Frigo, type Posto, posto as postoFrigo, postoIngrediente, posti } from './frigo';
import type { Indice, Ingrediente } from './ricette';
import type { Luogo } from './scadenze';
import { formatta, inBase, type Unita, UNITA_BASE, type UnitaBase } from './unita';

export interface ZonaVerifica {
  id: string;
  nome: string;
  luogo: Luogo;
  /** Le parti del frigo configurato (r1, c1, s2…) che stanno in questa zona: legano la zona al posto dei lotti. */
  posti?: string[];
}

export const MAX_ZONE = 20;
export const MAX_FOTO_ZONA = 4;

/**
 * Le zone di partenza: dal frigo configurato (ogni ripiano e cassetto, lo sportello tutto insieme), altrimenti
 * quattro ripiani, il cassetto delle verdure e la porta.
 */
export function zoneBase(frigo: Frigo | null): ZonaVerifica[] {
  if (!frigo)
    return [
      ...[1, 2, 3, 4].map((n) => ({ id: `r${n}`, nome: `Ripiano ${n}`, luogo: 'frigo' as const, posti: [`r${n}`] })),
      { id: 'c1', nome: 'Cassetto verdure', luogo: 'frigo', posti: ['c1'] },
      { id: 'porta', nome: 'Porta del frigo', luogo: 'frigo', posti: ['s1', 's2', 's3', 's4'] },
    ];
  const parti = posti(frigo);
  const sportello = parti.filter((p) => p.zona === 'sportello').map((p) => p.id);
  return [
    ...parti
      .filter((p) => p.zona === 'ripiano' || p.zona === 'cassetto')
      .map((p) => ({ id: p.id, nome: p.zona === 'cassetto' && frigo.cassetti === 1 ? 'Cassetto verdure' : p.nome.replace(/, in (alto|basso)$/, ''), luogo: 'frigo' as const, posti: [p.id] })),
    ...(sportello.length ? [{ id: 'porta', nome: 'Porta del frigo', luogo: 'frigo' as const, posti: sportello }] : []),
  ];
}

const ID_ZONA = /^[a-z0-9_-]{1,24}$/;
const POSTO = /^[rcsf][1-9]$/;

/** Le zone della famiglia (impostazioni.verifica.zone) se valide, altrimenti quelle di partenza. */
export function zoneDa(impostazioni: unknown, frigo: Frigo | null): ZonaVerifica[] {
  const salvate = (impostazioni as { verifica?: { zone?: unknown } } | null | undefined)?.verifica?.zone;
  if (!Array.isArray(salvate) || !salvate.length) return zoneBase(frigo);
  const zone: ZonaVerifica[] = [];
  for (const z of salvate) {
    if (!z || typeof z !== 'object') continue;
    const { id, nome, luogo, posti: p } = z as Record<string, unknown>;
    if (typeof id !== 'string' || !ID_ZONA.test(id) || typeof nome !== 'string' || !nome.trim()) continue;
    if (luogo !== 'frigo' && luogo !== 'freezer' && luogo !== 'dispensa') continue;
    if (zone.some((x) => x.id === id)) continue;
    zone.push({ id, nome: nome.trim(), luogo, ...(Array.isArray(p) ? { posti: p.filter((x): x is string => typeof x === 'string' && POSTO.test(x)) } : {}) });
  }
  return zone.length ? zone : zoneBase(frigo);
}

/** Un id per una zona aggiunta a mano, diverso da quelli che ci sono. */
export function idNuovaZona(zone: ZonaVerifica[], caso: () => number = Math.random): string {
  for (;;) {
    const id = `z-${Math.floor(caso() * 36 ** 5)
      .toString(36)
      .padStart(5, '0')}`;
    if (!zone.some((z) => z.id === id)) return id;
  }
}

/** Le date dell'ultima verifica di ogni zona. */
export function ultimeVerifiche(impostazioni: unknown): Record<string, string> {
  const u = (impostazioni as { verifica?: { ultime?: unknown } } | null | undefined)?.verifica?.ultime;
  if (!u || typeof u !== 'object') return {};
  return Object.fromEntries(Object.entries(u).filter(([, v]) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))) as Record<string, string>;
}

// ───────────────────────── Memoria ─────────────────────────

export interface Memoria {
  /** «nome visto da Gemini» → ingrediente corretto dalla famiglia. */
  alias: Record<string, string>;
  /** «nome visto da Gemini» → quante volte non c'era. */
  errori: Record<string, number>;
  /** ingrediente → zona dove sta di solito, e quante volte di fila ce l'abbiamo trovato. */
  posizioni: Record<string, { zona: string; volte: number }>;
}

export const MEMORIA_VUOTA: Memoria = { alias: {}, errori: {}, posizioni: {} };

export function memoriaDa(impostazioni: unknown): Memoria {
  const m = (impostazioni as { verifica?: { memoria?: unknown } } | null | undefined)?.verifica?.memoria as Record<string, unknown> | undefined;
  if (!m || typeof m !== 'object') return MEMORIA_VUOTA;
  const voci = (x: unknown) => (x && typeof x === 'object' ? Object.entries(x as Record<string, Record<string, unknown>>).filter(([, v]) => v && typeof v === 'object') : []);
  return {
    alias: Object.fromEntries(voci(m.alias).flatMap(([k, v]) => (typeof v.i === 'string' ? [[k, v.i]] : []))),
    errori: Object.fromEntries(voci(m.errori).flatMap(([k, v]) => (typeof v.n === 'number' ? [[k, v.n]] : []))),
    posizioni: Object.fromEntries(voci(m.posizioni).flatMap(([k, v]) => (typeof v.z === 'string' ? [[k, { zona: v.z, volte: typeof v.n === 'number' ? v.n : 1 }]] : []))),
  };
}

// ───────────────────────── In casa ─────────────────────────

export interface LottoInCasa {
  id: string;
  ingrediente_id: string;
  quantita: number;
  unita: UnitaBase;
  luogo: Luogo;
  posto?: string | null;
  data_limite: string | null;
}

/** La zona di un lotto: dal suo posto nel frigo, altrimenti da dove sta di solito quell'alimento. */
export function zonaDelLotto(l: LottoInCasa, zone: ZonaVerifica[], memoria: Memoria): ZonaVerifica | null {
  const qui = zone.filter((z) => z.luogo === l.luogo);
  if (l.posto) {
    const z = qui.find((x) => x.posti?.includes(l.posto!));
    if (z) return z;
  }
  const solita = memoria.posizioni[l.ingrediente_id];
  return (solita && qui.find((z) => z.id === solita.zona)) || null;
}

/**
 * Cosa ci si aspetta di trovare nelle zone fotografate. Un lotto senza zona conta solo se si sono fotografate
 * tutte le zone del suo luogo: altrimenti potrebbe essere in una zona che non si è guardata.
 */
export function lottiAttesi(lotti: LottoInCasa[], zone: ZonaVerifica[], fotografate: string[], memoria: Memoria): Map<string, LottoInCasa[]> {
  const scelte = new Set(fotografate);
  const luoghiInteri = new Set(
    (['frigo', 'freezer', 'dispensa'] as const).filter((l) => {
      const del = zone.filter((z) => z.luogo === l);
      return del.length > 0 && del.every((z) => scelte.has(z.id));
    }),
  );
  const attesi = new Map<string, LottoInCasa[]>();
  for (const l of lotti) {
    if (l.quantita <= 0) continue;
    const z = zonaDelLotto(l, zone, memoria);
    if (z ? !scelte.has(z.id) : !luoghiInteri.has(l.luogo)) continue;
    attesi.set(l.ingrediente_id, [...(attesi.get(l.ingrediente_id) ?? []), l]);
  }
  return attesi;
}

// ───────────────────────── Riconosciuto ─────────────────────────

export type Certezza = 'sicuro' | 'probabile' | 'incerto';
const LIVELLI: Certezza[] = ['sicuro', 'probabile', 'incerto'];

/** Un alimento visto da Gemini in una zona (tutte le foto della zona insieme). */
export interface Visto {
  nome: string;
  zona: string;
  quantita: number | null;
  unita: 'g' | 'ml' | 'pz' | null;
  certezza: Certezza;
  /** L'ingrediente dei prodotti in casa che Gemini dice di riconoscere (dal codice dell'elenco che gli si manda). */
  ingrediente_id?: string | null;
}

/** I prodotti in casa da mandare a Gemini con un codice breve: così può dire «è questo». */
export interface ProdottoNoto {
  codice: string;
  ingrediente_id: string;
  nome: string;
  quantita: string;
  zona: string | null;
}

export function prodottiNoti(indice: Indice, lotti: LottoInCasa[], zone: ZonaVerifica[], memoria: Memoria, luogo: Luogo, massimo = 60): ProdottoNoto[] {
  const per = new Map<string, LottoInCasa[]>();
  for (const l of lotti) if (l.luogo === luogo && l.quantita > 0) per.set(l.ingrediente_id, [...(per.get(l.ingrediente_id) ?? []), l]);
  return [...per]
    .slice(0, massimo)
    .map(([ingrediente_id, ls], i) => ({
      codice: `p${i + 1}`,
      ingrediente_id,
      nome: indice.nome(ingrediente_id).toLowerCase(),
      quantita: formatta({ valore: ls.reduce((s, l) => s + l.quantita, 0), unita: ls[0].unita }),
      zona: zonaDelLotto(ls[0], zone, memoria)?.nome ?? null,
    }));
}

/**
 * Il testo che accompagna le foto di una zona: dove siamo, cosa c'è registrato in casa, cosa serve per il menu
 * (non è una prova) e cosa la famiglia ha già corretto. Breve: Gemini lo legge a ogni foto.
 */
export function contestoPerGemini(zona: ZonaVerifica, foto: number, noti: ProdottoNoto[], menu: string[], memoria: Memoria): string {
  const righe = [
    `Le ${foto === 1 ? 'foto è' : `${foto} foto sono`} della zona «${zona.nome}» (${zona.luogo}).${foto > 1 ? ' Sono la stessa zona da angolazioni diverse: non contare due volte lo stesso oggetto.' : ''}`,
  ];
  if (noti.length) {
    righe.push('Prodotti registrati in casa (codice: nome, quantità, dove sta di solito). Se vedi uno di questi scrivi il suo codice:');
    for (const p of noti) righe.push(`- ${p.codice}: ${p.nome}, ${p.quantita}${p.zona ? `, di solito in «${p.zona}»` : ''}`);
  }
  if (menu.length) righe.push(`Servono per il menu dei prossimi giorni (NON vuol dire che ci siano): ${menu.slice(0, 30).join(', ')}.`);
  const corretti = Object.entries(memoria.alias).slice(0, 30);
  if (corretti.length) righe.push(`La famiglia ha già corretto: ${corretti.map(([k]) => `«${k}» = ${noti.find((p) => p.ingrediente_id === memoria.alias[k])?.nome ?? memoria.alias[k].replace(/^ing:/, '').replace(/-/g, ' ')}`).join('; ')}.`);
  const errori = Object.entries(memoria.errori)
    .filter(([, n]) => n >= 2)
    .slice(0, 20);
  if (errori.length) righe.push(`Spesso visti per errore (sii prudente): ${errori.map(([k]) => k).join(', ')}.`);
  return righe.join('\n').slice(0, 6000);
}

/** Abbassa la certezza di un nome che la famiglia ha già detto più volte che non c'era. */
function certezzaDi(v: Visto, memoria: Memoria): Certezza {
  const n = memoria.errori[v.nome] ?? 0;
  const i = LIVELLI.indexOf(v.certezza);
  return LIVELLI[Math.min(2, i + (n >= 2 ? 1 : 0))];
}

/** L'ingrediente di un nome visto: correzione della famiglia, poi il codice dato da Gemini, poi il catalogo. */
export function ingredienteDi(indice: Indice, v: Visto, memoria: Memoria, correzioni: Record<string, string> = {}): Ingrediente | null {
  for (const id of [correzioni[v.nome], memoria.alias[v.nome], v.ingrediente_id]) {
    const i = id ? indice.ingrediente(id) : undefined;
    if (i) return i;
  }
  return indice.cercaIngredienti(v.nome, 1)[0] ?? null;
}

// ───────────────────────── Confronto ─────────────────────────

export type TipoRiga = 'posto' | 'non_visto' | 'quantita' | 'nuovo' | 'incerto' | 'coerente';

export const NOME_TIPO: Record<TipoRiga, string> = {
  posto: 'Al posto sbagliato',
  non_visto: 'In casa ma non visti',
  quantita: 'Quantità diverse',
  nuovo: 'Nuovi',
  incerto: 'Da controllare',
  coerente: 'Tutto a posto',
};

export interface RigaVerifica {
  /** Stabile tra un calcolo e l'altro: l'ingrediente, o il nome visto se non lo si riconosce. */
  chiave: string;
  tipo: TipoRiga;
  ingrediente: Ingrediente | null;
  /** I nomi con cui Gemini l'ha visto (per imparare dalle correzioni). */
  nomi: string[];
  /** La zona dove l'ha visto, o dove dovrebbe essere. */
  zona: string | null;
  /** I lotti in casa che si aspettavano qui. */
  lotti: LottoInCasa[];
  /** Quanto ce n'è in casa (nelle zone fotografate), nell'unità base. */
  inCasa: number | null;
  /** Quanto se ne vede, nell'unità base; null se non si capisce. */
  visto: number | null;
  unita: UnitaBase | null;
  certezza: Certezza | null;
  /** In casa ma registrato in un'altra zona: «di solito in Ripiano 3». */
  altrove: string | null;
  /** Il primo giorno del menu che lo usa: aiuta a dare la precedenza, non è una prova. */
  menu: string | null;
  /** Visto in un posto che non va bene secondo le regole del frigo (src/dominio/frigo.ts). */
  avvisoPosto?: AvvisoPosto | null;
}

export interface AvvisoPosto {
  /** Sicurezza (contaminazione o temperatura): si vede anche nella verifica rapida. Altrimenti è un consiglio. */
  grave: boolean;
  /** Dove va. */
  dove: Posto;
  perche: string;
}

const genere = (p: Posto) => (p.zona === 'cassetto' ? 'cassetto' : p.zona === 'sportello' ? 'sportello' : p.zona === 'freezer' ? 'freezer' : 'ripiano');

/**
 * Il posto dove si è visto un alimento va bene? Regole di igiene (HACCP domestico) del configuratore del frigo:
 * - carne e pesce crudi solo sul ripiano più basso: se gocciolano non contaminano cibi pronti, frutta e verdura;
 * - latte, uova, yogurt e formaggi mai nello sportello: la temperatura cambia a ogni apertura.
 * Il resto (frutta nel cassetto, salse nello sportello…) è un consiglio: cambia la durata, non la sicurezza.
 */
export function controllaPosto(frigo: Frigo, ing: Pick<Ingrediente, 'id' | 'reparto' | 'sottocategoria'>, visto: Posto): AvvisoPosto | null {
  if (visto.zona === 'freezer') return null;
  const c = postoIngrediente(frigo, ing, 'frigo');
  if (!c || c.posto.id === visto.id) return null;
  if (ing.reparto === 'carne' || ing.reparto === 'pesce')
    return {
      grave: true,
      dove: c.posto,
      perche:
        visto.zona === 'cassetto'
          ? 'Crudo sopra o accanto a frutta e verdura: se gocciola le contamina. Va sul ripiano più basso, in un contenitore chiuso.'
          : 'Carne e pesce crudi vanno sul ripiano più basso (il più freddo): se gocciolano non contaminano i cibi sotto.',
    };
  if (ing.reparto === 'latticini' && ing.sottocategoria !== 'Burro e panna' && visto.zona === 'sportello')
    return { grave: true, dove: c.posto, perche: 'Latte, uova e latticini mai nello sportello: la temperatura cambia a ogni apertura.' };
  if (genere(c.posto) === genere(visto)) return null;
  return { grave: false, dove: c.posto, perche: c.perche };
}

/** Due quantità sono diverse se per i pezzi manca almeno uno, per pesi e volumi più di un quarto (e più di 50). */
export function diverse(a: number, b: number, unita: UnitaBase): boolean {
  if (unita === 'pz') return Math.abs(a - b) >= 1;
  return Math.abs(a - b) > Math.max(50, 0.25 * Math.max(a, b));
}

/**
 * Quanto c'è in casa, in una sola unità: quella preferita (l'unità base dell'ingrediente) se almeno un lotto la usa,
 * altrimenti quella del primo lotto. I lotti in un'altra unità (un formaggio «a occhio», contato in pezzi, accanto a
 * uno pesato) non si sommano: 1 pezzo più 200 g non fa 201 g.
 */
function misura(ls: LottoInCasa[], preferita: UnitaBase | null): { unita: UnitaBase; inCasa: number } {
  const unita = preferita && ls.some((l) => l.unita === preferita) ? preferita : ls[0].unita;
  return { unita, inCasa: ls.filter((l) => l.unita === unita).reduce((s, l) => s + l.quantita, 0) };
}

const ORDINE: Record<TipoRiga, number> = { posto: 0, non_visto: 1, quantita: 2, nuovo: 3, incerto: 4, coerente: 5 };

/**
 * Confronta ciò che si vede con ciò che c'è: una riga per alimento. In verifica rapida si mostrano solo le righe
 * diverse da «coerente».
 */
export function confronta({
  indice,
  lotti,
  zone,
  fotografate,
  visti,
  memoria,
  menu = new Map(),
  correzioni = {},
  frigo = null,
}: {
  indice: Indice;
  lotti: LottoInCasa[];
  zone: ZonaVerifica[];
  fotografate: string[];
  visti: Visto[];
  memoria: Memoria;
  /** ingrediente → primo giorno del menu che lo usa. */
  menu?: Map<string, string>;
  /** Correzioni fatte adesso: nome visto → ingrediente. */
  correzioni?: Record<string, string>;
  /** Il frigo configurato, per controllare il posto (senza: quello di base, come le zone di partenza). */
  frigo?: Frigo | null;
}): RigaVerifica[] {
  const attesi = lottiAttesi(lotti, zone, fotografate, memoria);
  const nomeZona = (id: string | null | undefined) => zone.find((z) => z.id === id)?.nome ?? null;
  const righe = new Map<string, RigaVerifica>();

  for (const v of visti) {
    const ing = ingredienteDi(indice, v, memoria, correzioni);
    // Corretto adesso dalla persona: sa lei cos'è.
    const certezza: Certezza = correzioni[v.nome] ? 'sicuro' : certezzaDi(v, memoria);
    const chiave = ing?.id ?? `?${v.nome}`;
    const unita = ing ? UNITA_BASE[ing.dimensione] : null;
    let q: number | null = null;
    if (ing && v.quantita !== null && v.unita) {
      const b = inBase(v.quantita, v.unita as Unita, ing.dimensione, ing.peso_pz);
      q = b.ok ? b.quantita.valore : null;
    }
    const r = righe.get(chiave);
    if (r) {
      r.nomi = [...new Set([...r.nomi, v.nome])];
      r.visto = r.visto === null || q === null ? (r.visto ?? q) : r.visto + q;
      if (LIVELLI.indexOf(certezza) < LIVELLI.indexOf(r.certezza!)) r.certezza = certezza;
      continue;
    }
    righe.set(chiave, { chiave, tipo: 'coerente', ingrediente: ing, nomi: [v.nome], zona: v.zona, lotti: [], inCasa: null, visto: q, unita, certezza, altrove: null, menu: null });
  }

  for (const [id, ls] of attesi) {
    const r = righe.get(id);
    const ing = indice.ingrediente(id);
    const m = misura(ls, r?.unita ?? (ing ? UNITA_BASE[ing.dimensione] : null));
    if (r) {
      r.lotti = ls;
      r.inCasa = m.inCasa;
      // Gemini e la casa possono usare unità diverse (prodotti «a occhio», in pezzi): allora non si confronta.
      if (r.unita !== m.unita) {
        r.visto = null;
        r.unita = m.unita;
      }
      continue;
    }
    righe.set(id, {
      chiave: id,
      tipo: 'non_visto',
      ingrediente: ing ?? null,
      nomi: [],
      zona: zonaDelLotto(ls[0], zone, memoria)?.id ?? null,
      lotti: ls,
      inCasa: m.inCasa,
      visto: null,
      unita: m.unita,
      certezza: null,
      altrove: null,
      menu: null,
    });
  }

  const fotografateLuoghi = new Set(zone.filter((z) => fotografate.includes(z.id)).map((z) => z.luogo));
  for (const r of righe.values()) {
    r.menu = r.ingrediente ? (menu.get(r.ingrediente.id) ?? null) : null;
    if (r.tipo === 'non_visto') continue;
    if (!r.ingrediente || r.certezza === 'incerto') {
      r.tipo = 'incerto';
      continue;
    }
    if (r.lotti.length) {
      r.tipo = r.visto !== null && r.inCasa !== null && r.unita && diverse(r.visto, r.inCasa, r.unita) ? 'quantita' : 'coerente';
      continue;
    }
    // Visto ma non atteso qui: se è in casa in un'altra zona dello stesso luogo, è solo spostato.
    const altrove = lotti.filter((l) => l.ingrediente_id === r.ingrediente!.id && l.quantita > 0 && fotografateLuoghi.has(l.luogo));
    if (altrove.length) {
      const m = misura(altrove, r.unita);
      r.lotti = altrove;
      r.inCasa = m.inCasa;
      r.altrove = nomeZona(zonaDelLotto(altrove[0], zone, memoria)?.id) ?? 'un’altra zona';
      if (r.unita !== m.unita) {
        r.visto = null;
        r.unita = m.unita;
      }
      r.tipo = r.visto !== null && r.unita && diverse(r.visto, r.inCasa, r.unita) ? 'quantita' : 'coerente';
      continue;
    }
    r.tipo = 'nuovo';
  }

  // Il posto dove l'abbiamo visto: solo se visto davvero, in una zona del frigo legata a una sua parte.
  const f = frigo ?? FRIGO_BASE;
  for (const r of righe.values()) {
    if (!r.ingrediente || !r.nomi.length || r.tipo === 'incerto' || !r.zona || !fotografate.includes(r.zona)) continue;
    const z = zone.find((x) => x.id === r.zona);
    const qui = z && z.luogo === 'frigo' && z.posti?.length ? postoFrigo(f, z.posti[0]) : null;
    if (!qui) continue;
    r.avvisoPosto = controllaPosto(f, r.ingrediente, qui);
    if (r.tipo === 'coerente' && r.avvisoPosto?.grave) r.tipo = 'posto';
  }

  return [...righe.values()].sort(
    (a, b) =>
      ORDINE[a.tipo] - ORDINE[b.tipo] ||
      (a.menu ?? '9999').localeCompare(b.menu ?? '9999') ||
      (a.ingrediente?.nome ?? a.nomi[0] ?? '').localeCompare(b.ingrediente?.nome ?? b.nomi[0] ?? '', 'it'),
  );
}

/** Verifica rapida: solo ciò che va guardato. */
export const daGuardare = (righe: RigaVerifica[]) => righe.filter((r) => r.tipo !== 'coerente');

// ───────────────────────── Decisioni e comando ─────────────────────────

export type Decisione =
  | { azione: 'presente' }
  | { azione: 'terminato' }
  | { azione: 'quantita'; valore: number }
  | { azione: 'non_verificabile' }
  /** Nuovo: mettilo in casa con questa quantità. */
  | { azione: 'aggiungi'; valore: number }
  /** Visto ma non c'è: Gemini si è sbagliato. */
  | { azione: 'non_c_e' };

export type Operazione =
  | { azione: 'quantita'; lotto_id: string; quantita: number; posto?: string }
  | { azione: 'presente'; lotto_id: string; posto?: string }
  | { azione: 'non_verificabile'; lotto_id: string }
  | {
      azione: 'aggiungi';
      id: string;
      ingrediente_id: string;
      quantita: number;
      unita: UnitaBase;
      luogo: Luogo;
      posto: string | null;
      tipo_data: 'stimata' | 'sconosciuta';
      data_limite?: string;
      fonte_data?: 'app';
      calcolata_il?: string;
      affidabilita?: 'bassa';
    };

/**
 * Porta il totale dei lotti di un alimento al valore nuovo: si toglie prima da quello che scade prima (è il primo
 * che si usa), si aggiunge a quello che scade per ultimo. Solo i lotti che cambiano.
 */
export function distribuisci(lotti: LottoInCasa[], totale: number): { lotto_id: string; quantita: number }[] {
  const ordinati = [...lotti].sort((a, b) => (a.data_limite ?? '9999').localeCompare(b.data_limite ?? '9999'));
  const ora = ordinati.reduce((s, l) => s + l.quantita, 0);
  const tondo = (x: number) => Math.round(x * 1000) / 1000;
  if (totale >= ora) {
    if (totale === ora || !ordinati.length) return [];
    const ultimo = ordinati[ordinati.length - 1];
    return [{ lotto_id: ultimo.id, quantita: tondo(ultimo.quantita + totale - ora) }];
  }
  let togli = ora - totale;
  const esito: { lotto_id: string; quantita: number }[] = [];
  for (const l of ordinati) {
    if (togli <= 0) break;
    const qui = Math.min(l.quantita, togli);
    esito.push({ lotto_id: l.id, quantita: tondo(l.quantita - qui) });
    togli -= qui;
  }
  return esito;
}

export interface Modifica {
  chiave: string;
  nome: string;
  prima: string;
  dopo: string;
}

/** Il posto del frigo per un alimento nuovo trovato in una zona: la prima parte della zona. */
const postoDiZona = (z: ZonaVerifica | undefined) => (z && z.luogo !== 'dispensa' ? (z.posti?.[0] ?? null) : null);

/**
 * Dalle decisioni al comando `verifica_inventario`, con il riepilogo da mostrare prima di confermare e ciò che
 * l'app impara (posizioni, correzioni, errori). Le righe senza decisione non cambiano niente.
 */
export function preparaVerifica({
  righe,
  decisioni,
  zone,
  fotografate,
  correzioni,
  nuovoId,
  stima,
  spostati = {},
}: {
  righe: RigaVerifica[];
  decisioni: Record<string, Decisione>;
  zone: ZonaVerifica[];
  fotografate: string[];
  correzioni: Record<string, string>;
  nuovoId: () => string;
  /** La data stimata per un fresco nuovo nel suo luogo (src/dominio/scadenze.ts), o null. */
  stima: (ing: Ingrediente, luogo: Luogo) => { data_limite: string; calcolata_il: string } | null;
  /** Righe spostate dalla persona nel posto giusto: chiave → parte del frigo (r4, c1…). */
  spostati?: Record<string, string>;
}): {
  dati: { zone: string[]; operazioni: Operazione[]; impara: { alias: Record<string, string>; errori: string[]; posizioni: Record<string, string> } };
  modifiche: Modifica[];
} {
  const operazioni: Operazione[] = [];
  const modifiche: Modifica[] = [];
  const errori: string[] = [];
  const posizioni: Record<string, string> = {};
  const q = (v: number | null, u: UnitaBase | null) => (v === null || !u ? '—' : formatta({ valore: v, unita: u }));

  for (const r of righe) {
    const d = decisioni[r.chiave];
    const nome = r.ingrediente?.nome ?? r.nomi[0] ?? 'Alimento';
    const presente = d ? d.azione !== 'terminato' && d.azione !== 'non_c_e' && d.azione !== 'non_verificabile' : r.tipo === 'coerente' && r.visto !== null;
    // Dove l'abbiamo visto davvero (non una zona solo attesa): si impara la posizione.
    if (r.ingrediente && presente && r.nomi.length && r.zona && fotografate.includes(r.zona)) posizioni[r.ingrediente.id] = r.zona;
    if (!d) continue;
    if (d.azione === 'non_c_e') {
      errori.push(...r.nomi);
      continue;
    }
    if (d.azione === 'aggiungi') {
      if (!r.ingrediente || !(d.valore > 0)) continue;
      const zona = zone.find((z) => z.id === r.zona);
      const luogo = zona?.luogo ?? 'frigo';
      const s = stima(r.ingrediente, luogo);
      const unita = UNITA_BASE[r.ingrediente.dimensione];
      operazioni.push({
        azione: 'aggiungi',
        id: nuovoId(),
        ingrediente_id: r.ingrediente.id,
        quantita: d.valore,
        unita,
        luogo,
        posto: postoDiZona(zona),
        ...(s ? { tipo_data: 'stimata', data_limite: s.data_limite, fonte_data: 'app', calcolata_il: s.calcolata_il, affidabilita: 'bassa' } : { tipo_data: 'sconosciuta' }),
      });
      modifiche.push({ chiave: r.chiave, nome, prima: 'non in casa', dopo: q(d.valore, unita) });
      continue;
    }
    if (!r.lotti.length) continue;
    if (d.azione === 'presente' || d.azione === 'non_verificabile') {
      for (const l of r.lotti) operazioni.push({ azione: d.azione, lotto_id: l.id });
      continue;
    }
    const totale = d.azione === 'terminato' ? 0 : d.valore;
    if (!(totale >= 0)) continue;
    // Finito: tutti i lotti a zero. Una quantità nuova vale solo per i lotti nella stessa unità (non per quelli «a occhio» in pezzi).
    const cambi = distribuisci(d.azione === 'terminato' ? r.lotti : r.lotti.filter((l) => l.unita === r.unita), totale);
    for (const c of cambi) operazioni.push({ azione: 'quantita', lotto_id: c.lotto_id, quantita: c.quantita });
    if (cambi.length) modifiche.push({ chiave: r.chiave, nome, prima: q(r.inCasa, r.unita), dopo: totale === 0 ? 'finito' : q(totale, r.unita) });
  }

  // Un lotto una volta sola: se due righe toccano lo stesso lotto vale la prima che lo cambia.
  const visti = new Set<string>();
  const uniche = operazioni.filter((o) => {
    if (!('lotto_id' in o)) return true;
    if (visti.has(o.lotto_id)) return false;
    visti.add(o.lotto_id);
    return true;
  });

  // Spostato nel posto giusto: il posto va sui lotti (insieme alla quantità, se cambia anche quella).
  for (const r of righe) {
    const nuovo = spostati[r.chiave];
    if (!nuovo || !/^[rcsf][1-9]$/.test(nuovo)) continue;
    let mossi = 0;
    for (const l of r.lotti.filter((x) => x.luogo !== 'dispensa' && x.posto !== nuovo)) {
      const o = uniche.find((x) => 'lotto_id' in x && x.lotto_id === l.id);
      if (o && (o.azione === 'quantita' || o.azione === 'presente')) {
        if (o.azione === 'quantita' && o.quantita === 0) continue;
        o.posto = nuovo;
      } else if (o) continue;
      else uniche.push({ azione: 'presente', lotto_id: l.id, posto: nuovo });
      mossi++;
    }
    for (const o of uniche) if (o.azione === 'aggiungi' && o.ingrediente_id === r.ingrediente?.id) o.posto = nuovo;
    const z = zone.find((x) => x.posti?.includes(nuovo));
    if (r.ingrediente && z) posizioni[r.ingrediente.id] = z.id;
    if (mossi) modifiche.push({ chiave: `${r.chiave}:posto`, nome: r.ingrediente?.nome ?? r.nomi[0] ?? 'Alimento', prima: zone.find((x) => x.id === r.zona)?.nome ?? '—', dopo: r.avvisoPosto?.dove.nome ?? nuovo });
  }

  return {
    dati: { zone: fotografate, operazioni: uniche, impara: { alias: correzioni, errori: [...new Set(errori)], posizioni } },
    modifiche,
  };
}

/** Il primo giorno (da oggi in poi) in cui il menu usa ogni ingrediente, con i suoi antenati (spaghetti → pasta). */
export function ingredientiDelMenu(
  indice: Indice,
  portate: { data: string; ricetta_id: string | null }[],
  dal: string,
  al: string,
): Map<string, string> {
  const esito = new Map<string, string>();
  for (const p of [...portate].sort((a, b) => a.data.localeCompare(b.data))) {
    if (!p.ricetta_id || p.data < dal || p.data > al) continue;
    const r = indice.perId.get(p.ricetta_id);
    for (const riga of r?.ingredienti ?? []) for (const id of indice.antenati(riga.ingrediente_id)) if (!esito.has(id)) esito.set(id, p.data);
  }
  return esito;
}

/** Dalla risposta di Gemini per una zona ai `Visto`: il codice del prodotto registrato diventa il suo ingrediente. */
export function vistiDaGemini(
  zona: string,
  risposta: { nome: string; codice: string | null; quantita: number | null; unita: 'g' | 'ml' | 'pz' | null; certezza: Certezza }[],
  noti: ProdottoNoto[],
): Visto[] {
  return risposta.map((r) => ({
    nome: r.nome,
    zona,
    quantita: r.quantita,
    unita: r.unita,
    certezza: r.certezza,
    ingrediente_id: (r.codice && noti.find((p) => p.codice === r.codice)?.ingrediente_id) || null,
  }));
}
