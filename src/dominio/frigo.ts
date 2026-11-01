/**
 * «Il mio frigorifero»: com'è fatto il frigo di casa (ripiani, cassetti, sportello, freezer) e dove va ogni cosa.
 * Si salva in famiglia.impostazioni.frigo (comando imposta_frigo). Ogni parte ha un id breve e stabile:
 *
 *   r1…rN  ripiani del frigo, dall'alto          c1…cN  cassetti in basso nel frigo
 *   s1…sN  balconcini dello sportello, dall'alto  f1…fN  ripiani o cassetti del freezer, dall'alto
 *
 * Il posto si salva anche sui lotti (lotto.posto): se il frigo cambia, un posto che non esiste più si ignora.
 */

export type PosizioneFreezer = 'sotto' | 'sopra' | 'fianco' | 'nessuno';
export type Lato = 'sx' | 'dx';

export interface Frigo {
  ripiani: number;
  cassetti: number;
  balconcini: number;
  /** Da che parte si apre lo sportello del frigo (dove sono le cerniere, e quindi i balconcini a frigo aperto). */
  sportello: Lato;
  litri: number | null;
  freezer: {
    posizione: PosizioneFreezer;
    /** Quanti ripiani o cassetti. */
    parti: number;
    tipo: 'cassetti' | 'ripiani';
    litri: number | null;
  };
}

/** Il frigo più comune in Italia: combinato con freezer sotto a tre cassetti. */
export const FRIGO_BASE: Frigo = {
  ripiani: 4,
  cassetti: 1,
  balconcini: 4,
  sportello: 'dx',
  litri: null,
  freezer: { posizione: 'sotto', parti: 3, tipo: 'cassetti', litri: null },
};

export const LIMITI = { ripiani: [1, 8], cassetti: [0, 3], balconcini: [0, 7], freezer: [1, 8], litri: [10, 1000] } as const;

const intero = (v: unknown, [min, max]: readonly [number, number], base: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : base;
const litri = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= LIMITI.litri[0] && v <= LIMITI.litri[1] ? Math.round(v) : null);

/** Il frigo salvato nelle impostazioni della famiglia, o null se non è ancora stato configurato. Valori strani → quelli di base. */
export function frigoDa(impostazioni: unknown): Frigo | null {
  const f = ((impostazioni ?? {}) as Record<string, unknown>).frigo as Record<string, unknown> | undefined;
  if (!f || typeof f !== 'object') return null;
  const z = (f.freezer ?? {}) as Record<string, unknown>;
  const posizione = (['sotto', 'sopra', 'fianco', 'nessuno'] as const).find((p) => p === z.posizione) ?? FRIGO_BASE.freezer.posizione;
  return {
    ripiani: intero(f.ripiani, LIMITI.ripiani, FRIGO_BASE.ripiani),
    cassetti: intero(f.cassetti, LIMITI.cassetti, FRIGO_BASE.cassetti),
    balconcini: intero(f.balconcini, LIMITI.balconcini, FRIGO_BASE.balconcini),
    sportello: f.sportello === 'sx' ? 'sx' : 'dx',
    litri: litri(f.litri),
    freezer: {
      posizione,
      parti: intero(z.parti, LIMITI.freezer, FRIGO_BASE.freezer.parti),
      tipo: z.tipo === 'ripiani' ? 'ripiani' : 'cassetti',
      litri: litri(z.litri),
    },
  };
}

export type Zona = 'ripiano' | 'cassetto' | 'sportello' | 'freezer';

export interface Posto {
  id: string;
  zona: Zona;
  /** 1 = il primo dall'alto. */
  n: number;
  nome: string;
}

const ZONA: Record<string, Zona> = { r: 'ripiano', c: 'cassetto', s: 'sportello', f: 'freezer' };

function nomeDi(frigo: Frigo, zona: Zona, n: number): string {
  switch (zona) {
    case 'ripiano':
      if (frigo.ripiani === 1) return 'Ripiano';
      if (n === 1) return 'Ripiano 1, in alto';
      if (n === frigo.ripiani) return `Ripiano ${n}, in basso`;
      return `Ripiano ${n}`;
    case 'cassetto':
      return frigo.cassetti === 1 ? 'Cassetto delle verdure' : `Cassetto ${n}`;
    case 'sportello':
      return frigo.balconcini === 1 ? 'Sportello' : `Sportello, balconcino ${n}`;
    case 'freezer': {
      const parte = frigo.freezer.tipo === 'cassetti' ? 'cassetto' : 'ripiano';
      return frigo.freezer.parti === 1 ? 'Freezer' : `Freezer, ${parte} ${n}`;
    }
  }
}

/** Tutte le parti del frigo, in ordine: ripiani, cassetti, sportello, freezer. */
export function posti(frigo: Frigo): Posto[] {
  const elenco: Posto[] = [];
  const aggiungi = (lettera: string, quanti: number) => {
    for (let n = 1; n <= quanti; n++) elenco.push({ id: `${lettera}${n}`, zona: ZONA[lettera], n, nome: nomeDi(frigo, ZONA[lettera], n) });
  };
  aggiungi('r', frigo.ripiani);
  aggiungi('c', frigo.cassetti);
  aggiungi('s', frigo.balconcini);
  if (frigo.freezer.posizione !== 'nessuno') aggiungi('f', frigo.freezer.parti);
  return elenco;
}

/** Il posto con quell'id, se nel frigo c'è ancora. */
export function posto(frigo: Frigo, id: string | null | undefined): Posto | null {
  const m = /^([rcsf])([1-9])$/.exec(id ?? '');
  if (!m) return null;
  return posti(frigo).find((p) => p.id === id) ?? null;
}

/** Il ripiano in mezzo (il più freddo e stabile dopo quello sopra i cassetti). */
const centrale = (frigo: Frigo) => Math.min(frigo.ripiani, Math.max(1, Math.ceil(frigo.ripiani / 2)));

export interface Consiglio {
  posto: Posto;
  /** Anche più in fondo possibile (i delicati). */
  inFondo: boolean;
  perche: string;
}

const MAI_PORTA = 'In un contenitore chiuso, mai nello sportello.';

/** Dove va un piatto cotto: in alto (sopra i crudi), i delicati sul ripiano centrale in fondo; in freezer il primo. */
export function postoPiatto(frigo: Frigo, delicato: boolean, inFreezer = false): Consiglio {
  if (inFreezer && frigo.freezer.posizione !== 'nessuno') {
    return { posto: posto(frigo, 'f1')!, inFondo: false, perche: 'In alto, a portata di mano: scrivi la data sul contenitore.' };
  }
  if (delicato && frigo.ripiani > 1) {
    return { posto: posto(frigo, `r${centrale(frigo)}`)!, inFondo: true, perche: `In fondo è il punto più freddo e stabile. ${MAI_PORTA}` };
  }
  return { posto: posto(frigo, 'r1')!, inFondo: false, perche: `I cibi cotti stanno sopra carne e pesce crudi. ${MAI_PORTA}` };
}

/** Le cose che vanno nello sportello: dove la temperatura cambia di più, ma a loro non fa niente. */
const DA_SPORTELLO = new Set(['Burro e panna', 'Salse', 'Sughi e creme pronte', 'Brodi e insaporitori', 'Latte']);

/** Dove va un ingrediente in frigo o in freezer, secondo il reparto (e la sottocategoria) del catalogo. */
export function postoIngrediente(
  frigo: Frigo,
  ing: { reparto: string; sottocategoria?: string | null },
  luogo: 'frigo' | 'freezer',
): Consiglio | null {
  if (luogo === 'freezer') {
    if (frigo.freezer.posizione === 'nessuno') return null;
    const crudo = ing.reparto === 'carne' || ing.reparto === 'pesce';
    const ultimo = frigo.freezer.parti;
    return crudo
      ? { posto: posto(frigo, `f${ultimo}`)!, inFondo: false, perche: 'Carne e pesce crudi in basso, ben chiusi.' }
      : { posto: posto(frigo, 'f1')!, inFondo: false, perche: 'In alto, così lo trovi subito.' };
  }
  const basso = frigo.ripiani;
  switch (ing.reparto) {
    case 'carne':
    case 'pesce':
      return {
        posto: posto(frigo, `r${basso}`)!,
        inFondo: true,
        perche: 'Il ripiano più basso è il più freddo, e se gocciola non sporca il resto. In un contenitore chiuso.',
      };
    case 'frutta_verdura':
      if (ing.sottocategoria === 'Erbe aromatiche' && frigo.balconcini > 0)
        return { posto: posto(frigo, 's1')!, inFondo: false, perche: 'In un bicchiere d’acqua, come i fiori.' };
      return frigo.cassetti > 0
        ? { posto: posto(frigo, 'c1')!, inFondo: false, perche: 'Il cassetto tiene l’umidità giusta per frutta e verdura.' }
        : { posto: posto(frigo, `r${basso}`)!, inFondo: false, perche: 'Sul ripiano più basso, in un sacchetto aperto.' };
    case 'latticini':
      if (ing.sottocategoria && DA_SPORTELLO.has(ing.sottocategoria) && frigo.balconcini > 0) {
        return { posto: posto(frigo, `s${Math.min(2, frigo.balconcini)}`)!, inFondo: false, perche: 'Sopporta il caldo dello sportello quando si apre.' };
      }
      return { posto: posto(frigo, `r${centrale(frigo)}`)!, inFondo: false, perche: 'Uova e latticini nella parte centrale, mai nello sportello.' };
    case 'gastronomia':
      return { posto: posto(frigo, `r${centrale(frigo)}`)!, inFondo: false, perche: 'Salumi e formaggi nella parte centrale, ben chiusi.' };
    default:
      if (ing.sottocategoria && DA_SPORTELLO.has(ing.sottocategoria) && frigo.balconcini > 0) {
        return { posto: posto(frigo, `s${Math.min(2, frigo.balconcini)}`)!, inFondo: false, perche: 'Sopporta il caldo dello sportello quando si apre.' };
      }
      return { posto: posto(frigo, 'r1')!, inFondo: false, perche: 'Sul ripiano in alto, dove si vede subito.' };
  }
}

/** Il frigo descritto a parole per Gemini: le parti, con il loro id, e quale parte c'è nella foto. */
export function descriviPerFoto(frigo: Frigo, inquadrato: string | null): string {
  const righe = posti(frigo).map((p) => `- ${p.id}: ${p.nome}`);
  const lato = frigo.sportello === 'sx' ? 'a sinistra' : 'a destra';
  const freezer = { sotto: 'sotto il frigo', sopra: 'sopra il frigo', fianco: 'di fianco al frigo', nessuno: '' }[frigo.freezer.posizione];
  const parte = inquadrato ? posto(frigo, inquadrato) : null;
  return [
    `Il frigo di questa famiglia ha ${frigo.ripiani} ripiani (numerati dall'alto), ${frigo.cassetti} cassetti in basso e lo sportello ${lato} con ${frigo.balconcini} balconcini${freezer ? `; il freezer è ${freezer}` : ''}.`,
    'Le parti, con il loro codice:',
    ...righe,
    parte ? `Nella foto c'è solo questa parte: ${parte.id} (${parte.nome}).` : 'Nella foto può esserci tutto il frigo o una parte.',
    'Per ogni alimento scrivi in "posto" il codice della parte dove lo vedi; se non lo capisci, null.',
  ].join('\n');
}

/** Il codice di posto che arriva da Gemini, solo se esiste in questo frigo. */
export function postoValido(frigo: Frigo | null, id: unknown): string | null {
  return frigo && typeof id === 'string' && posto(frigo, id) ? id : null;
}

/** «Combinato, freezer sotto · 4 ripiani · 1 cassetto · sportello a destra»: la riga sotto la voce delle Impostazioni. */
export function riassunto(frigo: Frigo | null): string {
  if (!frigo) return 'Non ancora configurato: dimmi com’è fatto e ti dico dove mettere le cose';
  const pl = (n: number, uno: string, tanti: string) => `${n} ${n === 1 ? uno : tanti}`;
  const freezer = { sotto: 'freezer sotto', sopra: 'freezer sopra', fianco: 'freezer di fianco', nessuno: 'senza freezer' }[frigo.freezer.posizione];
  return [
    freezer,
    pl(frigo.ripiani, 'ripiano', 'ripiani'),
    pl(frigo.cassetti, 'cassetto', 'cassetti'),
    `sportello a ${frigo.sportello === 'sx' ? 'sinistra' : 'destra'}`,
    frigo.litri ? `${frigo.litri} litri` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Esempi di cose da mettere via, per dire cosa va in ogni parte del frigo. */
const ESEMPI: { nome: string; dove: (f: Frigo) => Consiglio | null }[] = [
  { nome: 'Piatti cotti e avanzi', dove: (f) => postoPiatto(f, false) },
  { nome: 'Riso, pesce, uova e creme cotti (in fondo)', dove: (f) => postoPiatto(f, true) },
  { nome: 'Carne e pesce crudi', dove: (f) => postoIngrediente(f, { reparto: 'carne', sottocategoria: null }, 'frigo') },
  { nome: 'Frutta e verdura', dove: (f) => postoIngrediente(f, { reparto: 'frutta_verdura', sottocategoria: 'Ortaggi' }, 'frigo') },
  { nome: 'Erbe aromatiche', dove: (f) => postoIngrediente(f, { reparto: 'frutta_verdura', sottocategoria: 'Erbe aromatiche' }, 'frigo') },
  { nome: 'Uova, yogurt e formaggi', dove: (f) => postoIngrediente(f, { reparto: 'latticini', sottocategoria: 'Uova' }, 'frigo') },
  { nome: 'Salumi', dove: (f) => postoIngrediente(f, { reparto: 'gastronomia', sottocategoria: 'Salumi' }, 'frigo') },
  { nome: 'Latte, burro e salse', dove: (f) => postoIngrediente(f, { reparto: 'latticini', sottocategoria: 'Burro e panna' }, 'frigo') },
  { nome: 'Piatti cotti da congelare', dove: (f) => postoPiatto(f, false, true) },
  { nome: 'Carne e pesce da congelare', dove: (f) => postoIngrediente(f, { reparto: 'carne', sottocategoria: null }, 'freezer') },
];

/** Cosa va in una parte del frigo: per la legenda del configuratore. */
export function cosaCiVa(frigo: Frigo, id: string): string[] {
  return ESEMPI.filter((e) => e.dove(frigo)?.posto.id === id).map((e) => e.nome);
}

/** Le parti di un luogo: il freezer ha le sue, il frigo ripiani, cassetti e sportello; la dispensa nessuna. */
export function postiDi(frigo: Frigo, luogo: string): Posto[] {
  if (luogo === 'dispensa') return [];
  return posti(frigo).filter((p) => (p.zona === 'freezer') === (luogo === 'freezer'));
}

/** Il posto di un lotto, solo se esiste nel frigo di adesso e va d'accordo con il luogo (un lotto spostato in freezer perde il ripiano). */
export function postoDelLotto(frigo: Frigo | null, lotto: { posto?: unknown; luogo?: unknown }): Posto | null {
  if (!frigo || typeof lotto.posto !== 'string') return null;
  return postiDi(frigo, String(lotto.luogo)).find((p) => p.id === lotto.posto) ?? null;
}
