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
  /** Per ogni volta che lo stesso cereale, legume, tipo di pesce o verdura è già nella settimana. */
  varieta: number;
  /** Ricetta con cereali integrali (farro, orzo, pasta o riso integrale…). */
  integrali: number;
  /** Ricetta di stagione (in più) o fuori stagione (in meno). */
  stagione: number;
  /** Cucina mediterranea (italiana, greca). */
  mediterranea: number;
}

export interface RegoleAntonino {
  obiettivi: Partial<Record<Gruppo, Obiettivo>>;
  /** Almeno un piatto con le verdure ogni giorno. */
  verdureOgniGiorno: boolean;
  pesi: Pesi;
}

export const PESI_BASE: Pesi = { scade: 5, casa: 3, preferita: 2, ospiti: 3, piace: 2, ripetuta: 4, scartata: 2, scelta: 1, equilibrio: 4, varieta: 1.5, integrali: 1, stagione: 2, mediterranea: 1.5 };

/**
 * Le frequenze per i pasti principali della settimana insegnate dal «dietista» di Luca (1/11/2026), coerenti con
 * le linee guida CREA 2018: legumi 3–4, pesce 2–3, carne bianca 1–2, carne rossa circa 1, uova 1–2, formaggi 2–3,
 * salumi solo ogni tanto, verdure ogni giorno. Sono indicazioni, non quote: Antonino spinge verso il minimo e
 * evita di superare il massimo.
 */
export const REGOLE_BASE: RegoleAntonino = {
  obiettivi: {
    pesce: { min: 2, max: 3 },
    legumi: { min: 3, max: 4 },
    carne_rossa: { max: 1 },
    carne_bianca: { min: 1, max: 2 },
    salumi: { max: 1 },
    uova: { min: 1, max: 2 },
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

// ---------------------------------------------------------------------------------------------------------------
// Il «dietista» di Antonino: composizione del pasto, varietà, stagione, bambini e voto della settimana.
// Antonino non ha valori nutrizionali (calorie, grammi di proteine…): ragiona per gruppi di alimenti presenti
// negli ingredienti principali e lo dice. Tutto ciò che è stima è scritto come stima.
// ---------------------------------------------------------------------------------------------------------------

const PASTA_RADICI = ['ing:pasta', 'ing:pasta_uovo', 'ing:lasagne', 'ing:pasta_ripiena', 'ing:noodles', 'ing:noodles_riso', 'ing:soba', 'ing:pastina'];
/** I cereali (e le patate) per l'alternanza: il primo che si trova tra gli ingredienti principali. */
const CEREALI: { id: string; radici: string[] }[] = [
  { id: 'pasta', radici: PASTA_RADICI },
  { id: 'gnocchi', radici: ['ing:gnocchi'] },
  { id: 'riso', radici: ['ing:riso', 'ing:riso_risotti', 'ing:riso_basmati', 'ing:riso_integrale', 'ing:riso_sushi'] },
  { id: 'orzo', radici: ['ing:orzo'] },
  { id: 'farro', radici: ['ing:farro'] },
  { id: 'cous cous', radici: ['ing:couscous'] },
  { id: 'quinoa', radici: ['ing:quinoa'] },
  { id: 'polenta', radici: ['ing:polenta'] },
  { id: 'avena', radici: ['ing:fiocchi_avena'] },
  { id: 'pane', radici: ['ing:pane', 'ing:pane_integrale', 'ing:pita', 'ing:piadina', 'ing:tortillas', 'ing:focaccia', 'ing:pasta_pizza', 'ing:farina', 'ing:farina_integrale', 'ing:semola'] },
];
const INTEGRALI = ['ing:pasta_integrale', 'ing:riso_integrale', 'ing:farro', 'ing:orzo', 'ing:pane_integrale', 'ing:farina_integrale', 'ing:fiocchi_avena', 'ing:quinoa'];
const PATATE = 'Patate e tuberi';

export interface Composizione {
  /** Cereali, pane o patate. */
  carboidrati: boolean;
  /** Legumi, pesce, carne, uova o formaggi in quantità da piatto. */
  proteine: boolean;
  verdure: boolean;
  cereale?: string;
  integrale: boolean;
}

/** Cosa c'è in una ricetta, guardando solo gli ingredienti principali (niente q.b., aromi, grattugiato sopra). */
export function composizione(indice: Indice, r: Ricetta): Composizione {
  const gruppi = gruppiDi(indice, r);
  let cereale: string | undefined;
  let patate = false;
  let integrale = false;
  for (const g of principali(indice, r)) {
    if (g.qb) continue;
    const radici = indice.antenati(g.ingrediente_id);
    if (radici.some((x) => INTEGRALI.includes(x))) integrale = true;
    cereale ??= CEREALI.find((c) => radici.some((x) => c.radici.includes(x)))?.id;
    if (indice.ingrediente(g.ingrediente_id)?.sottocategoria === PATATE) patate = true;
  }
  return {
    carboidrati: !!cereale || patate,
    proteine: [...gruppi].some((g) => g !== 'verdure'),
    verdure: gruppi.has('verdure'),
    ...(cereale ? { cereale } : {}),
    integrale,
  };
}

/** Come completare un pranzo o una cena con questa ricetta; `null` se non serve dirlo (dolci, colazioni…). */
export function notaComposizione(c: Composizione, categoria: Ricetta['categoria']): string | null {
  if (!['primo', 'secondo', 'piatto_unico'].includes(categoria)) return null;
  if (c.carboidrati && c.proteine && c.verdure) return 'piatto unico: basta così';
  if (c.carboidrati && c.proteine) return 'da completare con un contorno di verdure';
  if (c.proteine && c.verdure) return 'da completare con pane, patate o un cereale';
  if (c.carboidrati && c.verdure) return 'da completare con legumi, uova, pesce o formaggio';
  if (c.carboidrati) return 'da completare con un secondo e le verdure';
  if (c.proteine) return 'da completare con verdure e pane';
  return null;
}

/** Le «basi» di una ricetta per la varietà: cereale, legume, tipo di pesce, verdure principali. */
export function basiDi(indice: Indice, r: Ricetta): string[] {
  const basi = new Set<string>();
  const c = composizione(indice, r);
  if (c.cereale) basi.add(`cereale:${c.cereale}`);
  for (const g of principali(indice, r)) {
    if (g.qb) continue;
    const i = indice.ingrediente(g.ingrediente_id);
    if (!i) continue;
    const radici = indice.antenati(i.id);
    const radice = radici[radici.length - 1] ?? i.id;
    if (i.sottocategoria === 'Legumi') basi.add(`legume:${radice}`);
    else if (i.classi.includes('pesce')) {
      const s = i.sottocategoria ?? '';
      basi.add(`pesce:${s === 'Pesce azzurro' ? 'azzurro' : /Molluschi|Polpi|Crostacei/.test(s) ? 'mare' : 'bianco'}`);
    } else if (i.reparto === 'frutta_verdura' && i.sottocategoria !== 'Erbe aromatiche' && i.sottocategoria !== 'Frutta') basi.add(`verdura:${radice}`);
  }
  return [...basi];
}

/** Quanto pesa ripetere una base già usata nella settimana: la pasta si ripete più volentieri del resto. */
export function pesoRipetizione(base: string): number {
  if (base === 'cereale:pasta') return 0.3;
  if (base.startsWith('cereale:')) return 0.6;
  if (base.startsWith('verdura:')) return 0.5;
  return 1;
}

/**
 * La stagione di una ricetta nel mese dato (1–12): 1 di stagione, -1 fuori stagione, 0 sempre o non si sa.
 * Prima i mesi della ricetta, poi quelli delle verdure e della frutta principali (calendario del catalogo).
 */
export function stagione(indice: Indice, r: Ricetta, mese: number): -1 | 0 | 1 {
  const dentro = (mesi: number[] | null | undefined) => (!mesi || !mesi.length || mesi.length >= 12 ? null : mesi.includes(mese));
  const propria = dentro(r.mesi);
  if (propria !== null) return propria ? 1 : -1;
  let esito: -1 | 0 | 1 = 0;
  for (const g of principali(indice, r)) {
    const d = dentro(indice.ingrediente(g.ingrediente_id)?.mesi);
    if (d === false) return -1;
    if (d === true) esito = 1;
  }
  return esito;
}

export interface Adattamento {
  testo: string;
  /** Alimento a rischio di soffocamento se non si adatta (frutta secca intera). */
  rischio?: boolean;
}

const FRUTTA_SECCA = ['ing:noci', 'ing:mandorle', 'ing:nocciole', 'ing:pistacchi', 'ing:pinoli', 'ing:anacardi', 'ing:arachidi'];
const TONDI = ['ing:pomodorini', 'ing:uva', 'ing:olive', 'ing:mirtilli', 'ing:ciliegie'];
const DA_TAGLIARE_PER_LUNGO = ['ing:salsiccia', 'ing:wurstel'];
const CON_OSSI = ['ing:ali_pollo', 'ing:cosce_pollo', 'ing:costine_maiale', 'ing:ossobuco', 'ing:coniglio', 'ing:braciole_maiale', 'ing:agnello'];
const SALATI = ['ing:acciughe', 'ing:capperi', 'ing:dado', 'ing:dado_carne', 'ing:dado_vegetale', 'ing:salsa_soia', 'ing:bottarga', 'ing:olive'];

/**
 * Come preparare la ricetta per i bambini piccoli (3 anni): stesso piatto della famiglia, con gli adattamenti
 * di sicurezza (Ministero della Salute, prevenzione del soffocamento). Non toglie mai la ricetta: la adatta.
 */
export function adattamentiBambini(indice: Indice, r: Ricetta): Adattamento[] {
  const usa = (ids: string[]) =>
    r.ingredienti.filter((g) => !g.opzionale && indice.antenati(g.ingrediente_id).some((x) => ids.includes(x))).map((g) => indice.nome(g.ingrediente_id).toLowerCase());
  const nomi = (x: string[]) => [...new Set(x)].join(', ');
  const esito: Adattamento[] = [];
  const secca = usa(FRUTTA_SECCA);
  if (secca.length) esito.push({ testo: `${nomi(secca)}: solo tritati finemente o in crema, mai interi`, rischio: true });
  const tondi = usa(TONDI);
  if (tondi.length) esito.push({ testo: `${nomi(tondi)}: tagliare in quattro per il lungo${tondi.some((n) => n.includes('oliv')) ? ' (olive snocciolate)' : ''}` });
  const lunghi = usa(DA_TAGLIARE_PER_LUNGO);
  if (lunghi.length) esito.push({ testo: `${nomi(lunghi)}: tagliare per il lungo, mai a rondelle` });
  if (principali(indice, r).some((g) => ['Pesce fresco', 'Pesce azzurro'].includes(indice.ingrediente(g.ingrediente_id)?.sottocategoria ?? '')))
    esito.push({ testo: 'pesce: controllare bene le lische' });
  const ossi = usa(CON_OSSI);
  if (ossi.length) esito.push({ testo: `${nomi(ossi)}: togliere ossa e ossicini, tagliare a pezzetti` });
  if (usa(SALATI).length || gruppiDi(indice, r).has('salumi')) esito.push({ testo: 'piatto saporito: poco sale, salare a parte la porzione degli adulti' });
  return esito;
}

const LAVORATI = ['Sughi e creme pronte', 'Piatti pronti e dolci surgelati', 'Snack e dolciumi'];

export interface VoceVoto {
  nome: string;
  punti: number;
  max: number;
}

export interface VotoSettimana {
  totale: number;
  voci: VoceVoto[];
  criticita: string[];
}

/**
 * Il voto della settimana da 0 a 100, con i pesi del dietista di Luca. È una stima per confrontare due
 * settimane, non un giudizio clinico: Antonino non conosce calorie e nutrienti, solo i gruppi di alimenti.
 * `piatti` sono pranzi e cene; `bambini` se a tavola ci sono bambini piccoli.
 */
export function votoSettimana(
  indice: Indice,
  piatti: { data: string; ricetta: Ricetta }[],
  regole: RegoleAntonino,
  giorni: string[],
  opzioni: { bambini: boolean; mese: number; urgenti?: number; urgentiUsati?: number },
): VotoSettimana {
  const criticita: string[] = [];
  const arrotonda = (x: number) => Math.round(x * 10) / 10;
  const conPiatti = giorni.filter((d) => piatti.some((p) => p.data === d));

  // Equilibrio (25): ogni giorno, tra pranzo e cena, cereali o patate, proteine e verdure.
  let completi = 0;
  const mancano = { carboidrati: 0, proteine: 0, verdure: 0 };
  for (const d of conPiatti) {
    const c = piatti.filter((p) => p.data === d).map((p) => composizione(indice, p.ricetta));
    const ha = { carboidrati: c.some((x) => x.carboidrati), proteine: c.some((x) => x.proteine), verdure: c.some((x) => x.verdure) };
    if (ha.carboidrati && ha.proteine && ha.verdure) completi++;
    for (const k of Object.keys(mancano) as (keyof typeof mancano)[]) if (!ha[k]) mancano[k]++;
  }
  const equilibrioPunti = conPiatti.length ? (25 * completi) / conPiatti.length : 0;
  if (mancano.verdure) criticita.push(`${mancano.verdure} ${mancano.verdure === 1 ? 'giorno' : 'giorni'} senza verdure nei piatti: aggiungere un contorno`);
  if (mancano.proteine) criticita.push(`${mancano.proteine} ${mancano.proteine === 1 ? 'giorno' : 'giorni'} senza legumi, pesce, uova, carne o formaggio`);
  if (mancano.carboidrati) criticita.push(`${mancano.carboidrati} ${mancano.carboidrati === 1 ? 'giorno' : 'giorni'} senza cereali né patate: aggiungere pane`);

  // Varietà (20): ricette ripetute, quanti cereali e quante fonti di proteine diverse.
  const volte = new Map<string, number>();
  for (const p of piatti) volte.set(p.ricetta.id, (volte.get(p.ricetta.id) ?? 0) + 1);
  const ripetute = [...volte.values()].reduce((s, n) => s + n - 1, 0);
  const cereali = new Set(piatti.map((p) => composizione(indice, p.ricetta).cereale).filter(Boolean));
  const fonti = new Set(piatti.flatMap((p) => [...gruppiDi(indice, p.ricetta)].filter((g) => g !== 'verdure')));
  let varieta = (cereali.size >= 3 ? 10 : cereali.size === 2 ? 6 : cereali.size === 1 ? 3 : 0) + (fonti.size >= 4 ? 10 : fonti.size === 3 ? 7 : fonti.size === 2 ? 4 : fonti.size ? 2 : 0);
  varieta = Math.max(0, varieta - 4 * ripetute);
  if (ripetute) criticita.push(`${ripetute} ${ripetute === 1 ? 'ricetta ripetuta' : 'ricette ripetute'}`);
  if (piatti.length >= 6 && cereali.size < 3) criticita.push('pochi cereali diversi: alternare pasta, riso, orzo, farro, cous cous');

  // Adeguatezza alle età (20): con bambini piccoli, i piatti con un rischio da adattare tolgono punti.
  const aRischio = opzioni.bambini ? piatti.filter((p) => adattamentiBambini(indice, p.ricetta).some((a) => a.rischio)) : [];
  const eta = Math.max(0, 20 - 4 * aRischio.length);
  for (const p of aRischio) criticita.push(`${p.ricetta.titolo}: per i bambini la frutta secca va tritata`);

  // Qualità degli alimenti (10): salumi e prodotti pronti tolgono, i cereali integrali aiutano.
  const lavorati = piatti.filter(
    (p) => gruppiDi(indice, p.ricetta).has('salumi') || principali(indice, p.ricetta).some((g) => LAVORATI.includes(indice.ingrediente(g.ingrediente_id)?.sottocategoria ?? '')),
  ).length;
  const integrali = piatti.filter((p) => composizione(indice, p.ricetta).integrale).length;
  const qualita = Math.max(0, Math.min(10, 8 - 2 * lavorati + Math.min(2, integrali)));
  if (lavorati >= 2) criticita.push(`${lavorati} piatti con salumi o prodotti pronti`);
  if (piatti.length >= 6 && !integrali) criticita.push('nessun cereale integrale');

  // Frequenze (10): gli obiettivi della settimana rispettati.
  const voci = equilibrio(indice, piatti, regole, conPiatti);
  const frequenze = voci.length ? (10 * voci.filter((v) => v.stato === 'ok').length) / voci.length : 10;
  for (const v of voci.filter((x) => x.stato !== 'ok' && x.gruppo !== 'verdure_giorni')) {
    criticita.push(v.stato === 'troppo' ? `${v.nome.toLowerCase()}: ${v.conta}, più di ${v.max}` : `${v.nome.toLowerCase()}: ${v.conta}, meno di ${v.min}`);
  }

  // Stagionalità (5).
  const fuori = piatti.filter((p) => stagione(indice, p.ricetta, opzioni.mese) < 0);
  const stagionalita = piatti.length ? 5 * (1 - fuori.length / piatti.length) : 5;
  if (fuori.length) criticita.push(`fuori stagione: ${fuori.map((p) => p.ricetta.titolo).join(', ')}`);

  // Dispensa (5): quanto di ciò che scade presto viene usato.
  const dispensa = opzioni.urgenti ? (5 * Math.min(opzioni.urgenti, opzioni.urgentiUsati ?? 0)) / opzioni.urgenti : 5;
  if (opzioni.urgenti && (opzioni.urgentiUsati ?? 0) < opzioni.urgenti) criticita.push('qualcosa che scade presto non è usato');

  // Organizzazione (5): tempo medio dei piatti.
  const minuti = piatti.map((p) => p.ricetta.minuti_totali).filter((m): m is number => typeof m === 'number');
  const media = minuti.length ? minuti.reduce((s, m) => s + m, 0) / minuti.length : 30;
  const organizzazione = media <= 40 ? 5 : media <= 60 ? 3 : 1;
  if (media > 60) criticita.push('piatti lunghi da preparare: in settimana servono più piatti veloci');

  const tutte: VoceVoto[] = [
    { nome: 'Equilibrio dei pasti', punti: arrotonda(equilibrioPunti), max: 25 },
    { nome: 'Varietà', punti: arrotonda(varieta), max: 20 },
    { nome: 'Adatto alle età', punti: arrotonda(eta), max: 20 },
    { nome: 'Qualità degli alimenti', punti: arrotonda(qualita), max: 10 },
    { nome: 'Frequenze', punti: arrotonda(frequenze), max: 10 },
    { nome: 'Stagionalità', punti: arrotonda(stagionalita), max: 5 },
    { nome: 'Dispensa', punti: arrotonda(dispensa), max: 5 },
    { nome: 'Tempi di preparazione', punti: arrotonda(organizzazione), max: 5 },
  ];
  return { totale: Math.round(tutte.reduce((s, v) => s + v.punti, 0)), voci: tutte, criticita };
}
