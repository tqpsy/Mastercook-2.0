/**
 * Antonino, il consigliere del menu. Qui ci sono le sue regole e la sua memoria, in un posto solo,
 * così si possono «insegnare» senza toccare il resto: le regole di base sono scritte qui sotto, la famiglia
 * può cambiarle (Impostazioni › Antonino) e Antonino ricorda quali piatti scartate e quali scegliete.
 *
 * - Regole: quante volte a settimana pesce, legumi, carne rossa… (linee guida CREA 2018 per adulti) e i pesi
 *   con cui pesa scadenze, casa, gusti, ripetizioni. Si salvano in famiglia.impostazioni.antonino.regole.
 * - Memoria: in famiglia.impostazioni.antonino (scartate, scelte, mai_piu), scritta dal comando antonino_impara.
 *
 * Antonino non tocca mai la sicurezza: propone solo ricette già «adatte» a chi mangia (vincoli e «non mi piace»
 * restano un filtro fisso, non un peso che si può insegnare).
 */
import { type Indice, principali, type Ricetta } from './ricette';
import { tipiPrincipali } from './principale';
import { giorniTra } from './scadenze';

export type Gruppo = 'pesce' | 'legumi' | 'carne_rossa' | 'carne_bianca' | 'salumi' | 'uova' | 'formaggi' | 'verdure';

export const GRUPPI: { id: Gruppo; nome: string; emoji: string }[] = [
  { id: 'pesce', nome: 'Pesce', emoji: '🐟' },
  { id: 'legumi', nome: 'Legumi', emoji: '🫘' },
  { id: 'carne_rossa', nome: 'Carne rossa', emoji: '🥩' },
  { id: 'carne_bianca', nome: 'Carne bianca', emoji: '🍗' },
  { id: 'salumi', nome: 'Salumi e insaccati', emoji: '🥓' },
  { id: 'uova', nome: 'Uova', emoji: '🥚' },
  { id: 'formaggi', nome: 'Formaggi', emoji: '🧀' },
  { id: 'verdure', nome: 'Verdure', emoji: '🥦' },
];

/** Quante volte a settimana (pranzi e cene): almeno `min`, al massimo `max`. */
export interface Obiettivo {
  min?: number;
  max?: number;
}

/** Quanto conta ogni cosa nel punteggio di una ricetta. */
export interface Pesi {
  /** Per ogni ingrediente principale che scade presto. */
  scade: number;
  /** Ricetta fatta tutta con ciò che c'è in casa (in proporzione). */
  casa: number;
  preferita: number;
  /** Ricetta 💫 quando ci sono ospiti. */
  ospiti: number;
  piace: number;
  /** Per ogni volta che la ricetta è già nel menu vicino. */
  ripetuta: number;
  /** Per ogni volta che la famiglia l'ha scartata (fino a 3). */
  scartata: number;
  /** Per ogni volta che la famiglia l'ha scelta da una proposta (fino a 3). */
  scelta: number;
  /** Quanto spinge Antonino per arrivare agli obiettivi della settimana. */
  equilibrio: number;
}

export interface RegoleAntonino {
  obiettivi: Partial<Record<Gruppo, Obiettivo>>;
  /** Almeno un piatto con le verdure ogni giorno. */
  verdureOgniGiorno: boolean;
  pesi: Pesi;
}

export const PESI_BASE: Pesi = { scade: 5, casa: 3, preferita: 2, ospiti: 3, piace: 2, ripetuta: 4, scartata: 2, scelta: 1, equilibrio: 4 };

/** Linee guida per una sana alimentazione (CREA 2018), porzioni a settimana per un adulto. */
export const REGOLE_BASE: RegoleAntonino = {
  obiettivi: {
    pesce: { min: 2, max: 3 },
    legumi: { min: 2, max: 4 },
    carne_rossa: { max: 1 },
    carne_bianca: { max: 3 },
    salumi: { max: 1 },
    uova: { max: 4 },
    formaggi: { max: 3 },
  },
  verdureOgniGiorno: true,
  pesi: PESI_BASE,
};

/** Un numero intero tra 0 e 14 (due pasti al giorno per una settimana), altrimenti niente. */
function volte(x: unknown): number | undefined {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 14 ? x : undefined;
}

/** Le regole della famiglia: quelle di base con sopra ciò che la famiglia ha insegnato (valori strani si ignorano). */
export function regoleDa(impostazioni: unknown): RegoleAntonino {
  const a = ((impostazioni ?? {}) as Record<string, unknown>).antonino as Record<string, unknown> | undefined;
  const r = (a?.regole ?? {}) as Record<string, unknown>;
  const obiettivi: Partial<Record<Gruppo, Obiettivo>> = { ...REGOLE_BASE.obiettivi };
  const scritti = (r.obiettivi ?? {}) as Record<string, unknown>;
  for (const g of GRUPPI) {
    const o = scritti[g.id] as Record<string, unknown> | null | undefined;
    if (o === undefined || typeof o !== 'object') continue;
    const min = volte(o?.min);
    const max = volte(o?.max);
    obiettivi[g.id] = { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
  }
  const pesi = { ...PESI_BASE };
  const pesiScritti = (r.pesi ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(PESI_BASE) as (keyof Pesi)[]) {
    const v = pesiScritti[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 20) pesi[k] = v;
  }
  return {
    obiettivi,
    verdureOgniGiorno: typeof r.verdure_ogni_giorno === 'boolean' ? r.verdure_ogni_giorno : REGOLE_BASE.verdureOgniGiorno,
    pesi,
  };
}

/** Le regole come si salvano (solo ciò che è diverso da quelle di base). */
export function regoleDaSalvare(r: RegoleAntonino): Record<string, unknown> {
  const obiettivi: Record<string, Obiettivo> = {};
  for (const g of GRUPPI) {
    const a = r.obiettivi[g.id] ?? {};
    const b = REGOLE_BASE.obiettivi[g.id] ?? {};
    if (a.min !== b.min || a.max !== b.max) obiettivi[g.id] = a;
  }
  const pesi: Partial<Pesi> = {};
  for (const k of Object.keys(PESI_BASE) as (keyof Pesi)[]) if (r.pesi[k] !== PESI_BASE[k]) pesi[k] = r.pesi[k];
  return {
    ...(Object.keys(obiettivi).length ? { obiettivi } : {}),
    ...(Object.keys(pesi).length ? { pesi } : {}),
    ...(r.verdureOgniGiorno !== REGOLE_BASE.verdureOgniGiorno ? { verdure_ogni_giorno: r.verdureOgniGiorno } : {}),
  };
}

/** Quante volte e quando, l'ultima. */
export interface Ricordo {
  n: number;
  ultima: string;
}

export interface MemoriaAntonino {
  scartate: Map<string, Ricordo>;
  scelte: Map<string, Ricordo>;
  /** Ricette da non proporre più (si possono riprendere da Impostazioni › Antonino). */
  maiPiu: Set<string>;
}

export const MEMORIA_VUOTA: MemoriaAntonino = { scartate: new Map(), scelte: new Map(), maiPiu: new Set() };

function ricordi(x: unknown): Map<string, Ricordo> {
  const m = new Map<string, Ricordo>();
  if (!x || typeof x !== 'object' || Array.isArray(x)) return m;
  for (const [id, v] of Object.entries(x as Record<string, unknown>)) {
    const r = v as Record<string, unknown> | null;
    if (r && typeof r.n === 'number' && r.n > 0 && typeof r.ultima === 'string') m.set(id, { n: r.n, ultima: r.ultima });
  }
  return m;
}

export function memoriaDa(impostazioni: unknown): MemoriaAntonino {
  const a = ((impostazioni ?? {}) as Record<string, unknown>).antonino as Record<string, unknown> | undefined;
  if (!a) return MEMORIA_VUOTA;
  return {
    scartate: ricordi(a.scartate),
    scelte: ricordi(a.scelte),
    maiPiu: new Set(Array.isArray(a.mai_piu) ? a.mai_piu.filter((v): v is string => typeof v === 'string') : []),
  };
}

/**
 * Quanto la memoria sposta il punteggio di una ricetta: giù per ogni scarto, su per ogni scelta (al massimo 3
 * volte ciascuno). Ciò che è successo più di 60 giorni fa conta la metà: i gusti cambiano.
 */
export function pesoMemoria(m: MemoriaAntonino, id: string, pesi: Pesi, oggiData: string): { punti: number; motivo?: string } {
  const quanto = (r: Ricordo | undefined) => (r ? Math.min(3, r.n) * (giorniTra(r.ultima, oggiData) > 60 ? 0.5 : 1) : 0);
  const scelta = quanto(m.scelte.get(id));
  const punti = pesi.scelta * scelta - pesi.scartata * quanto(m.scartate.get(id));
  return { punti, motivo: scelta >= 2 ? 'la scegliete spesso' : undefined };
}

const CARNE_ROSSA = [
  'ing:manzo',
  'ing:bistecca',
  'ing:spezzatino',
  'ing:bollito',
  'ing:carne_macinata',
  'ing:hamburger',
  'ing:vitello',
  'ing:ossobuco',
  'ing:fegato',
  'ing:maiale',
  'ing:braciole_maiale',
  'ing:costine_maiale',
  'ing:agnello',
  'ing:cavallo',
];
const SALUMI = [
  'ing:prosciutto_cotto',
  'ing:prosciutto_crudo',
  'ing:speck',
  'ing:mortadella',
  'ing:salame',
  'ing:coppa',
  'ing:pancetta',
  'ing:guanciale',
  'ing:lardo',
  'ing:nduja',
  'ing:porchetta',
  'ing:wurstel',
  'ing:cotechino',
  'ing:bresaola',
  'ing:tacchino_affettato',
  'ing:salsiccia',
];

/** I gruppi di una ricetta per l'equilibrio della settimana (una carbonara conta come salumi e uova). */
export function gruppiDi(indice: Indice, r: Ricetta): Set<Gruppo> {
  const gruppi = new Set<Gruppo>();
  for (const t of tipiPrincipali(indice, r)) {
    if (t === 'pesce' || t === 'legumi' || t === 'uova' || t === 'formaggi' || t === 'verdure') gruppi.add(t);
  }
  for (const g of principali(indice, r)) {
    const i = indice.ingrediente(g.ingrediente_id);
    if (!i || g.qb || !i.classi.includes('carne')) continue;
    const radici = indice.antenati(i.id);
    if (radici.some((x) => SALUMI.includes(x))) gruppi.add('salumi');
    else if (radici.some((x) => CARNE_ROSSA.includes(x))) gruppi.add('carne_rossa');
    else gruppi.add('carne_bianca');
  }
  return gruppi;
}

export interface VoceEquilibrio {
  gruppo: Gruppo | 'verdure_giorni';
  nome: string;
  emoji: string;
  conta: number;
  min?: number;
  max?: number;
  stato: 'ok' | 'poco' | 'troppo';
}

/**
 * Come va la settimana: per ogni gruppo con un obiettivo, quante volte c'è e se va bene.
 * `piatti` sono le ricette di pranzi e cene della settimana, con il giorno; `giorni` quanti giorni conta la settimana.
 */
export function equilibrio(indice: Indice, piatti: { data: string; ricetta: Ricetta }[], regole: RegoleAntonino, giorni: string[]): VoceEquilibrio[] {
  const conta = new Map<Gruppo, number>();
  const conVerdure = new Set<string>();
  for (const p of piatti) {
    const gruppi = gruppiDi(indice, p.ricetta);
    for (const g of gruppi) conta.set(g, (conta.get(g) ?? 0) + 1);
    if (gruppi.has('verdure')) conVerdure.add(p.data);
  }
  const voci: VoceEquilibrio[] = [];
  for (const g of GRUPPI) {
    const o = regole.obiettivi[g.id];
    if (!o || (o.min === undefined && o.max === undefined)) continue;
    const n = conta.get(g.id) ?? 0;
    voci.push({ gruppo: g.id, nome: g.nome, emoji: g.emoji, conta: n, ...o, stato: o.max !== undefined && n > o.max ? 'troppo' : o.min !== undefined && n < o.min ? 'poco' : 'ok' });
  }
  if (regole.verdureOgniGiorno) {
    const n = giorni.filter((d) => conVerdure.has(d)).length;
    voci.push({ gruppo: 'verdure_giorni', nome: 'Verdure ogni giorno', emoji: '🥦', conta: n, min: giorni.length, stato: n < giorni.length ? 'poco' : 'ok' });
  }
  return voci;
}

/**
 * Quanto conviene una ricetta per arrivare agli obiettivi, dato ciò che c'è già nella settimana.
 * Sopra il massimo è quasi esclusa; sotto il minimo spinge di più quando restano pochi pasti da riempire.
 */
export function spintaEquilibrio(
  gruppi: Set<Gruppo>,
  conta: Map<Gruppo, number>,
  regole: RegoleAntonino,
  restanti: number,
  giornoSenzaVerdure: boolean,
): { punti: number; motivo?: string } {
  let punti = 0;
  let motivo: string | undefined;
  for (const g of gruppi) {
    const o = regole.obiettivi[g];
    const n = conta.get(g) ?? 0;
    if (o?.max !== undefined && n >= o.max) punti -= 100;
    else if (o?.min !== undefined && n < o.min) {
      const manca = o.min - n;
      punti += regole.pesi.equilibrio * Math.min(1, (3 * manca) / Math.max(1, restanti));
      const nome = GRUPPI.find((x) => x.id === g)!.nome.toLowerCase();
      motivo ??= `${nome}: ${n + 1} su ${o.min} questa settimana`;
    }
  }
  if (giornoSenzaVerdure && gruppi.has('verdure')) punti += regole.pesi.equilibrio * 0.75;
  return { punti, motivo };
}
