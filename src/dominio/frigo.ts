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
  /** Come confezionarlo: contenitore ermetico, sacchetto microforato, carta assorbente… */
  confezione?: string;
}

/**
 * Mappa termica di un frigo combinato: in alto è più tiepido (il caldo sale), il ripiano sopra i cassetti è il più
 * freddo, i cassetti sono umidi, lo sportello è la zona più calda e che cambia di più a ogni apertura.
 */
export function temperatura(frigo: Frigo, p: Posto): string {
  switch (p.zona) {
    case 'freezer':
      return '−18 °C';
    case 'sportello':
      return '8–10 °C';
    case 'cassetto':
      return '6–8 °C, umido';
    case 'ripiano':
      if (frigo.ripiani > 1 && p.n === frigo.ripiani) return '0–2 °C, il più freddo';
      if (frigo.ripiani > 2 && p.n === 1) return '4–5 °C';
      return '2–4 °C';
  }
}

/** Cosa va in ogni zona, a parole: per la guida del configuratore. */
export function zonaPerGuida(frigo: Frigo, p: Posto): string {
  switch (p.zona) {
    case 'freezer':
      if (frigo.freezer.parti > 1 && p.n === 1) return 'Piatti cotti in porzioni, con la data: a portata di mano.';
      if (frigo.freezer.parti > 1 && p.n === frigo.freezer.parti) return 'Carne e pesce crudi da congelare, in sacchetti piatti e senz’aria.';
      return 'Surgelati comprati (verdure, pesce, gelati), chiusi bene.';
    case 'cassetto':
      return frigo.cassetti > 1 && p.n > 1 ? 'Frutta, e qui la frutta che produce etilene, lontana dalle verdure.' : 'Verdure (sensibili all’etilene), in sacchetti microforati.';
    case 'sportello':
      if (frigo.balconcini > 2 && p.n === 1) return 'Burro e formaggi spalmabili.';
      if (p.n === frigo.balconcini && frigo.balconcini > 1) return 'Bevande e acqua.';
      return 'Salse, condimenti e sughi aperti. Mai uova, latte fresco o cibi deperibili.';
    case 'ripiano':
      if (frigo.ripiani > 1 && p.n === frigo.ripiani) return 'Carne e pesce crudi, in contenitori chiusi: non gocciolano su niente.';
      if (p.n === 1) return 'Piatti cotti, avanzi e cibi pronti, sopra tutto ciò che è crudo.';
      return 'Latte, uova, yogurt, formaggi e salumi.';
  }
}

const MAI_PORTA = 'mai nello sportello';
const COTTI = 'In un contenitore ermetico, dopo averli fatti raffreddare (entro 2 ore dalla cottura).';

/** Dove va un piatto cotto: in alto (sopra i crudi), i delicati sul ripiano centrale in fondo; in freezer il primo. */
export function postoPiatto(frigo: Frigo, delicato: boolean, inFreezer = false): Consiglio {
  if (inFreezer && frigo.freezer.posizione !== 'nessuno') {
    return {
      posto: posto(frigo, 'f1')!,
      inFondo: false,
      perche: 'In alto, a portata di mano.',
      confezione: 'In porzioni, in contenitori o sacchetti da freezer senz’aria, con la data scritta sopra.',
    };
  }
  if (delicato && frigo.ripiani > 1) {
    return { posto: posto(frigo, `r${centrale(frigo)}`)!, inFondo: true, perche: `In fondo è il punto più freddo e stabile, ${MAI_PORTA}.`, confezione: COTTI };
  }
  return { posto: posto(frigo, 'r1')!, inFondo: false, perche: `I cibi cotti stanno sopra carne e pesce crudi, ${MAI_PORTA}.`, confezione: COTTI };
}

/**
 * Etilene: alcuni frutti (e il pomodoro) lo emettono maturando, e fa maturare, ingiallire e appassire prima le
 * verdure sensibili. In frigo vanno tenuti separati: in cassetti diversi, o almeno in sacchetti chiusi a parte.
 */
export const PRODUCONO_ETILENE = new Set([
  'ing:mela', 'ing:pera', 'ing:pesca', 'ing:albicocca', 'ing:susine', 'ing:fichi', 'ing:kiwi', 'ing:melone', 'ing:mango',
  'ing:avocado', 'ing:banana', 'ing:pomodoro', 'ing:pomodorini', 'ing:cachi',
]);
const SENSIBILI_SOTTOCATEGORIE = new Set(['Insalate e verdure a foglia', 'Cavoli', 'Erbe aromatiche']);
const SENSIBILI = new Set(['ing:carota', 'ing:cetriolo', 'ing:zucchina', 'ing:asparagi', 'ing:fagiolini', 'ing:taccole', 'ing:melanzana', 'ing:peperone', 'ing:piselli_freschi', 'ing:fave', 'ing:sedano']);

export type Etilene = 'produce' | 'sensibile' | null;

export function etilene(ing: { id?: string; sottocategoria?: string | null }): Etilene {
  if (ing.id && PRODUCONO_ETILENE.has(ing.id)) return 'produce';
  if ((ing.id && SENSIBILI.has(ing.id)) || (ing.sottocategoria && SENSIBILI_SOTTOCATEGORIE.has(ing.sottocategoria))) return 'sensibile';
  return null;
}

/** Come confezionare frutta e verdura, per tenere l'umidità giusta. */
function confezioneVerdura(ing: { id?: string; sottocategoria?: string | null }): string {
  if (ing.id === 'ing:fragole' || ing.id === 'ing:frutti_bosco' || ing.id === 'ing:ciliegie')
    return 'Senza lavarli, in un contenitore basso con carta assorbente sul fondo: si lavano solo prima di mangiarli.';
  if (ing.sottocategoria === 'Funghi') return 'In un sacchetto di carta, mai di plastica: nella plastica sudano e si rovinano.';
  if (ing.sottocategoria === 'Erbe aromatiche') return 'Avvolte in carta assorbente appena umida, in un contenitore o sacchetto chiuso.';
  if (ing.sottocategoria === 'Insalate e verdure a foglia') return 'Senza lavarla, in un sacchetto microforato con un foglio di carta assorbente che prende l’acqua in più.';
  if (etilene(ing) === 'produce') return 'In un sacchetto a parte, ben separato dalle verdure: l’etilene che emette le fa appassire prima.';
  return 'In un sacchetto microforato: respira senza seccarsi.';
}

/** Le cose da sportello: sopportano gli sbalzi di temperatura quando si apre. */
const SALSE = new Set(['Salse', 'Sughi e creme pronte', 'Brodi e insaporitori']);

/** Il balconcino giusto: in alto burro e formaggi spalmabili, in mezzo salse, in basso bevande. */
function balconcino(frigo: Frigo, quale: 'alto' | 'mezzo' | 'basso'): Posto | null {
  const b = frigo.balconcini;
  if (b === 0) return null;
  const n = quale === 'alto' ? 1 : quale === 'basso' ? b : Math.min(b, Math.max(1, Math.ceil(b / 2)));
  return posto(frigo, `s${n}`);
}

/**
 * Dove va un ingrediente in frigo o in freezer, secondo la mappa termica, l'etilene e il reparto (e la
 * sottocategoria) del catalogo; con il modo di confezionarlo.
 */
export function postoIngrediente(
  frigo: Frigo,
  ing: { id?: string; reparto: string; sottocategoria?: string | null },
  luogo: 'frigo' | 'freezer',
): Consiglio | null {
  if (luogo === 'freezer') {
    if (frigo.freezer.posizione === 'nessuno') return null;
    const crudo = ing.reparto === 'carne' || ing.reparto === 'pesce';
    return crudo
      ? {
          posto: posto(frigo, `f${frigo.freezer.parti}`)!,
          inFondo: false,
          perche: 'Carne e pesce crudi in basso, lontani dai cibi pronti.',
          confezione: 'In sacchetti da freezer senz’aria, piatti e sottili (si scongelano prima), con la data.',
        }
      : { posto: posto(frigo, 'f1')!, inFondo: false, perche: 'In alto, così lo trovi subito.', confezione: 'Ben chiuso, con la data.' };
  }
  const basso = frigo.ripiani;
  const mezzo = centrale(frigo);
  switch (ing.reparto) {
    case 'carne':
    case 'pesce':
      return {
        posto: posto(frigo, `r${basso}`)!,
        inFondo: true,
        perche: 'Il ripiano più basso è il più freddo (0–2 °C), e se gocciola non contamina il resto.',
        confezione: 'Nella confezione chiusa o in un contenitore ermetico, appoggiato su un piatto che raccoglie i liquidi.',
      };
    case 'frutta_verdura': {
      const e = etilene(ing);
      const confezione = confezioneVerdura(ing);
      if (frigo.cassetti >= 2) {
        // Due cassetti: verdure nel primo, frutta (e chi produce etilene) nel secondo.
        const frutta = ing.sottocategoria === 'Frutta' || e === 'produce';
        return {
          posto: posto(frigo, frutta ? 'c2' : 'c1')!,
          inFondo: false,
          perche: frutta
            ? e === 'produce'
              ? 'Produce etilene: nel cassetto della frutta, separato dalle verdure.'
              : 'Nel cassetto della frutta, lontano dalle verdure.'
            : e === 'sensibile'
              ? 'Sensibile all’etilene: nel cassetto delle verdure, lontano da mele, pere, kiwi e pomodori.'
              : 'Nel cassetto delle verdure, che tiene l’umidità giusta.',
          confezione,
        };
      }
      if (frigo.cassetti === 1) {
        return {
          posto: posto(frigo, 'c1')!,
          inFondo: false,
          perche:
            e === 'produce'
              ? 'Produce etilene: nel cassetto, ma chiuso in un sacchetto a parte e dal lato opposto alle verdure.'
              : e === 'sensibile'
                ? 'Sensibile all’etilene: nel cassetto, lontano da mele, pere, kiwi e pomodori (tienili in sacchetti separati).'
                : 'Il cassetto tiene l’umidità giusta per frutta e verdura.',
          confezione,
        };
      }
      return { posto: posto(frigo, `r${basso}`)!, inFondo: false, perche: 'Senza cassetti: sul ripiano più basso, separato da carne e pesce.', confezione };
    }
    case 'latticini': {
      if (ing.sottocategoria === 'Burro e panna' && balconcino(frigo, 'alto'))
        return {
          posto: balconcino(frigo, 'alto')!,
          inFondo: false,
          perche: 'Burro e panna sopportano lo sportello, nel balconcino in alto.',
          confezione: 'Ben chiusi: il burro prende gli odori.',
        };
      const uova = ing.sottocategoria === 'Uova';
      return {
        posto: posto(frigo, `r${mezzo}`)!,
        inFondo: false,
        perche: `Latte, uova, yogurt e formaggi nella parte centrale (2–4 °C), ${MAI_PORTA}.`,
        confezione: uova
          ? 'Nella loro confezione, senza lavarle: il guscio ha una protezione naturale.'
          : ing.sottocategoria?.startsWith('Formaggi')
            ? 'Nella carta per alimenti e poi in un contenitore: respira senza seccarsi.'
            : 'Ben chiusi; il latte aperto va finito in pochi giorni.',
      };
    }
    case 'gastronomia':
      return {
        posto: posto(frigo, `r${mezzo}`)!,
        inFondo: false,
        perche: 'Salumi e formaggi nella parte centrale, separati dai cibi crudi.',
        confezione: ing.sottocategoria === 'Salumi'
          ? 'Gli affettati nella loro carta o in un contenitore ermetico.'
          : 'Nella carta per alimenti e poi in un contenitore: respira senza seccarsi.',
      };
    default: {
      if (ing.sottocategoria && SALSE.has(ing.sottocategoria) && balconcino(frigo, 'mezzo'))
        return { posto: balconcino(frigo, 'mezzo')!, inFondo: false, perche: 'Salse e condimenti sopportano gli sbalzi dello sportello.', confezione: 'Con il tappo ben chiuso.' };
      if (ing.reparto === 'bevande' && balconcino(frigo, 'basso'))
        return { posto: balconcino(frigo, 'basso')!, inFondo: false, perche: 'Le bevande nel balconcino in basso, il più robusto.' };
      return { posto: posto(frigo, 'r1')!, inFondo: false, perche: 'Sul ripiano in alto, dove si vede subito.', confezione: 'In un contenitore chiuso.' };
    }
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
  { nome: 'Carne e pesce crudi', dove: (f) => postoIngrediente(f, { reparto: 'carne' }, 'frigo') },
  { nome: 'Verdure (sensibili all’etilene)', dove: (f) => postoIngrediente(f, { id: 'ing:zucchina', reparto: 'frutta_verdura', sottocategoria: 'Ortaggi' }, 'frigo') },
  { nome: 'Frutta che produce etilene, in un sacchetto a parte', dove: (f) => postoIngrediente(f, { id: 'ing:mela', reparto: 'frutta_verdura', sottocategoria: 'Frutta' }, 'frigo') },
  { nome: 'Latte, uova, yogurt e formaggi', dove: (f) => postoIngrediente(f, { reparto: 'latticini', sottocategoria: 'Uova' }, 'frigo') },
  { nome: 'Salumi', dove: (f) => postoIngrediente(f, { reparto: 'gastronomia', sottocategoria: 'Salumi' }, 'frigo') },
  { nome: 'Burro e panna', dove: (f) => postoIngrediente(f, { reparto: 'latticini', sottocategoria: 'Burro e panna' }, 'frigo') },
  { nome: 'Salse e condimenti', dove: (f) => postoIngrediente(f, { reparto: 'condimenti', sottocategoria: 'Salse' }, 'frigo') },
  { nome: 'Bevande', dove: (f) => postoIngrediente(f, { reparto: 'bevande' }, 'frigo') },
  { nome: 'Piatti cotti da congelare', dove: (f) => postoPiatto(f, false, true) },
  { nome: 'Carne e pesce da congelare', dove: (f) => postoIngrediente(f, { reparto: 'carne' }, 'freezer') },
];

/** Le regole d'oro del confezionamento, per la guida. */
export const REGOLE_CONFEZIONE = [
  'Contenitori ermetici per cibi cotti, avanzi e carne o pesce crudi: niente odori, niente gocce, niente contaminazioni.',
  'Sacchetti microforati per le verdure: fanno uscire l’umidità in più senza seccarle.',
  'Carta assorbente con insalata, frutti di bosco e fragole: prende l’acqua che li fa marcire.',
  'Funghi in sacchetti di carta, formaggi nella carta per alimenti: devono respirare.',
  'Non lavare frutta e verdura prima di metterle via: si lavano quando si usano.',
  'I cibi cotti si raffreddano e vanno in frigo entro 2 ore; mai caldi, mai lasciati fuori di notte.',
  'Non riempire troppo: l’aria fredda deve girare, e la temperatura media giusta è 4 °C.',
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
