/**
 * Valutazione oggettiva della lettura di uno scontrino: si confronta quello che l'app ha letto con la verità
 * scritta a mano (`tests/scontrini/casi/*\/verita.json`), riga per riga. Serve a dire con numeri se un intervento
 * (parser, lettura della foto, abbinamenti…) migliora davvero, e dove.
 *
 * Si misura tutta la catena che arriva in casa, non solo il testo:
 * 1. la lettura: righe, prezzi, nomi, data, ora, totale;
 * 2. i campi della riga: pezzi e formato letti dalla descrizione;
 * 3. la conversione in prodotti: ingrediente suggerito e quantità che entrerebbe in casa;
 * 4. l'abbinamento alle righe già comprate con le spunte.
 *
 * Gli errori contano in modo diverso: un errore *segnalato* (riga senza prezzo, prezzo corretto dal conto) lo vede
 * chi controlla; uno *silenzioso* (prezzo sbagliato senza nessun avviso, riga persa, quantità sbagliata) arriva
 * in casa. Il «falso quadra» è la lettura che dichiara il conto in ordine ma ha righe sbagliate.
 *
 * Qui non c'è I/O: i testi e la verità arrivano da fuori (test, script).
 */
import type { Indice } from './ricette';
import { abbinaRighe, leggiScontrino, quantitaProposta, type RigaDaAbbinare, suggerisciIngrediente } from './scontrini';

export type UnitaCarico = 'g' | 'ml' | 'pz';
export interface Carico {
  quantita: number;
  unita: UnitaCarico;
}

/** Una riga come è stampata sullo scontrino (una riga per ogni linea di prodotto, anche se si ripete). */
export interface RigaVera {
  descrizione: string;
  /** Quanto si è pagato per la riga, sconti già tolti (come `RigaLetta.prezzo`). */
  prezzo: number;
  pezzi?: number;
  /** Il formato scritto nella descrizione (400 g, 1 L). */
  formato?: Carico;
  /** L'ingrediente giusto (id del catalogo); `null` = non è cibo. Assente = non si misura. */
  ingrediente?: string | null;
  /** Cosa dovrebbe entrare in casa; `null` = non si può sapere (la quantità si scrive dopo). Si misura solo con `ingrediente`. */
  carico?: Carico | null;
  /** Con `carrello`: la riga già comprata a cui va il prezzo, o `null` se è nuova. Assente = non si misura. */
  abbina?: string | null;
}

export interface Verita {
  versione: 1;
  id: string;
  /** Da dove viene lo scontrino: uno vero della famiglia, un esempio vero già nel repo, o costruito per la prova. */
  origine: 'scontrino-reale' | 'esempio-reale' | 'sintetico';
  /** Come si è stabilita la verità: guardando la carta, ricavandola da testo e conti, o costruendo lo scontrino dalla verità. */
  verita: 'carta' | 'ricavata' | 'costruzione';
  negozio?: string | null;
  data: string;
  ora?: string | null;
  totale: number;
  righe: RigaVera[];
  carrello?: RigaDaAbbinare[];
  /** Solo per gli scontrini sintetici: le linee come sono stampate, `[testo a sinistra, testo a destra?]`. */
  stampa?: [string, string?][];
  note?: string;
}

/** Ciò che l'app ricava da un testo: la lettura, e per ogni riga ciò che finirebbe in casa. */
export interface RigaLettaValutata {
  descrizione: string;
  prezzo: number;
  pezzi?: number;
  formato?: Carico;
  senzaPrezzo: boolean;
  corretta: boolean;
  ingrediente: string | null;
  carico: Carico | null;
  abbina: string | null;
}
export interface LetturaValutata {
  negozio: string | null;
  data: string | null;
  ora: string | null;
  totale: number | null;
  quadra: boolean;
  corretti: number;
  righe: RigaLettaValutata[];
}

/** Dal testo letto a ciò che l'app propone (stesse funzioni della schermata «Scontrino»). */
export function leggiPerValutare(testo: string, indice: Indice, carrello: RigaDaAbbinare[] = []): LetturaValutata {
  const s = leggiScontrino(testo);
  const abbinate = carrello.length ? abbinaRighe(s.righe, carrello, indice) : s.righe.map(() => null);
  return {
    negozio: s.negozio,
    data: s.data,
    ora: s.ora,
    totale: s.totale,
    quadra: s.quadra,
    corretti: s.corretti,
    righe: s.righe.map((r, i) => {
      const ing = suggerisciIngrediente(r.descrizione, indice);
      const q = ing ? quantitaProposta(r, ing) : null;
      return {
        descrizione: r.descrizione,
        prezzo: r.prezzo,
        ...(r.pezzi !== undefined ? { pezzi: r.pezzi } : {}),
        ...(r.formato ? { formato: r.formato } : {}),
        senzaPrezzo: !!r.senzaPrezzo,
        corretta: !!r.corretta,
        ingrediente: ing?.id ?? null,
        carico: q,
        abbina: abbinate[i] ?? null,
      };
    }),
  };
}

// ───────────────────────── Confronto ─────────────────────────

/** Il nome senza maiuscole, accenti, spazi e punteggiatura: gli spazi persi dalla lettura non sono il problema qui. */
const compatto = (s: string) =>
  s
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]/g, '');

function distanza(a: string, b: string): number {
  let prec = Array.from({ length: b.length + 1 }, (_, k) => k);
  for (let x = 1; x <= a.length; x++) {
    const riga = [x];
    for (let y = 1; y <= b.length; y++) riga[y] = Math.min(prec[y] + 1, riga[y - 1] + 1, prec[y - 1] + (a[x - 1] === b[y - 1] ? 0 : 1));
    prec = riga;
  }
  return prec[b.length];
}

/** Quanto due nomi si somigliano, da 0 a 1. */
export function somiglianza(a: string, b: string): number {
  const [x, y] = [compatto(a), compatto(b)];
  if (!x && !y) return 1;
  return 1 - distanza(x, y) / Math.max(x.length, y.length);
}

/** Da questa somiglianza in su il nome si considera letto bene (una lettera ogni sette). */
export const SOGLIA_NOME = 0.85;
const stessoPrezzo = (a: number, b: number) => Math.abs(a - b) < 0.005;
const stessoCarico = (a: Carico | null | undefined, b: Carico | null | undefined) => (!a || !b ? !a && !b : a.unita === b.unita && Math.abs(a.quantita - b.quantita) < 0.001);

/**
 * Abbina le righe vere a quelle lette, nell'ordine dello scontrino: una riga letta è «la stessa» se il nome si
 * somiglia, oppure se il prezzo è uguale e il nome non è del tutto diverso (nome rovinato, prezzo giusto).
 * Massimizza la somiglianza totale; le righe senza coppia sono mancanti (vere) o in più (lette).
 */
export function allinea(vere: RigaVera[], lette: RigaLettaValutata[]): (number | null)[] {
  const punti = (t: RigaVera, r: RigaLettaValutata) => {
    const nome = somiglianza(t.descrizione, r.descrizione);
    const p = stessoPrezzo(t.prezzo, r.prezzo);
    const s = nome * 0.7 + (p ? 0.3 : 0);
    return nome >= 0.5 || (p && nome >= 0.25) ? s : -Infinity;
  };
  const n = vere.length;
  const m = lette.length;
  const tab = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const coppia = punti(vere[i], lette[j]);
      tab[i][j] = Math.max(tab[i + 1][j], tab[i][j + 1], coppia === -Infinity ? -Infinity : coppia + tab[i + 1][j + 1]);
    }
  }
  const out: (number | null)[] = vere.map(() => null);
  for (let i = 0, j = 0; i < n && j < m; ) {
    const coppia = punti(vere[i], lette[j]);
    if (coppia !== -Infinity && Math.abs(tab[i][j] - (coppia + tab[i + 1][j + 1])) < 1e-9) {
      out[i] = j;
      i++;
      j++;
    } else if (tab[i][j] === tab[i + 1][j]) i++;
    else j++;
  }
  return out;
}

export interface Conta {
  misurate: number;
  ok: number;
}

export interface Valutazione {
  /** Tutte le righe giuste (nome e prezzo), nessuna in più, e data, ora e totale giusti: l'import non richiederebbe correzioni. */
  perfetta: boolean;
  /** Niente in casa di sbagliato: nessuna quantità sbagliata, nessuna riga in più che entra in casa, nessun abbinamento sbagliato. */
  sicura: boolean;
  campi: { data: boolean; ora: boolean | null; totale: boolean; negozio: boolean | null };
  /** La lettura dice che il conto torna. */
  quadra: boolean;
  /** Dice che il conto torna ma qualche riga è sbagliata, persa o in più (la data non conta: non entra nel conto). */
  falsoQuadra: boolean;
  righe: {
    vere: number;
    lette: number;
    ok: number;
    /** Prezzo sbagliato senza nessun segnale (la riga non è «senza prezzo» né «corretta»). */
    prezzoSilenzioso: number;
    /** Prezzo sbagliato ma segnalato (senza prezzo, o corretto dal conto). */
    prezzoSegnalato: number;
    /** Prezzo giusto, nome letto male. */
    nome: number;
    mancanti: number;
    inPiu: number;
  };
  pezzi: Conta;
  formato: Conta;
  ingrediente: Conta;
  /** La quantità che entrerebbe in casa, sulle righe con `ingrediente` e `carico`. */
  giacenza: { misurate: number; ok: number; sbagliata: number; mancata: number; persa: number; inPiu: number };
  abbinamenti: Conta & { sbagliati: number };
  /** Una frase per ogni errore, per leggere cosa non va. */
  errori: string[];
  /** Cosa è stato letto, per capire se due letture sono uguali. */
  firma: string;
}

const conta = (): Conta => ({ misurate: 0, ok: 0 });
const euro = (n: number) => n.toFixed(2).replace('.', ',');
const testoCarico = (c: Carico | null) => (c ? `${c.quantita} ${c.unita}` : 'niente');

/** Confronta una lettura con la verità. `carrello` della verità serve già a `leggiPerValutare`. */
export function valuta(verita: Verita, letta: LetturaValutata): Valutazione {
  const coppie = allinea(verita.righe, letta.righe);
  const usate = new Set(coppie.filter((x): x is number => x !== null));
  const errori: string[] = [];
  const v: Valutazione = {
    perfetta: false,
    sicura: false,
    campi: { data: false, ora: null, totale: false, negozio: null },
    quadra: letta.quadra,
    falsoQuadra: false,
    righe: { vere: verita.righe.length, lette: letta.righe.length, ok: 0, prezzoSilenzioso: 0, prezzoSegnalato: 0, nome: 0, mancanti: 0, inPiu: 0 },
    pezzi: conta(),
    formato: conta(),
    ingrediente: conta(),
    giacenza: { misurate: 0, ok: 0, sbagliata: 0, mancata: 0, persa: 0, inPiu: 0 },
    abbinamenti: { ...conta(), sbagliati: 0 },
    errori,
    firma: '',
  };

  for (const [i, t] of verita.righe.entries()) {
    const k = coppie[i];
    const misuraCarico = t.ingrediente !== undefined && t.carico !== undefined;
    if (k === null) {
      v.righe.mancanti++;
      errori.push(`riga ${i + 1} «${t.descrizione}» ${euro(t.prezzo)}: non letta`);
      if (misuraCarico && t.carico) {
        v.giacenza.misurate++;
        v.giacenza.persa++;
      }
      if (t.ingrediente !== undefined) v.ingrediente.misurate++;
      if (t.abbina !== undefined) v.abbinamenti.misurate++;
      continue;
    }
    const r = letta.righe[k];
    const nomeOk = somiglianza(t.descrizione, r.descrizione) >= SOGLIA_NOME;
    const prezzoOk = stessoPrezzo(t.prezzo, r.prezzo);
    if (nomeOk && prezzoOk) v.righe.ok++;
    else {
      if (!prezzoOk) {
        if (r.senzaPrezzo || r.corretta) v.righe.prezzoSegnalato++;
        else v.righe.prezzoSilenzioso++;
      } else v.righe.nome++;
      const cosa = [!prezzoOk ? `prezzo ${euro(r.prezzo)} invece di ${euro(t.prezzo)}${r.senzaPrezzo ? ' (segnalato: senza prezzo)' : r.corretta ? ' (segnalato: corretto)' : ''}` : '', !nomeOk ? `nome «${r.descrizione}»` : ''].filter(Boolean);
      errori.push(`riga ${i + 1} «${t.descrizione}»: ${cosa.join(', ')}`);
    }
    if (t.pezzi !== undefined) {
      v.pezzi.misurate++;
      if (r.pezzi === t.pezzi) v.pezzi.ok++;
      else errori.push(`riga ${i + 1} «${t.descrizione}»: pezzi ${r.pezzi ?? 'non letti'} invece di ${t.pezzi}`);
    }
    if (t.formato) {
      v.formato.misurate++;
      if (stessoCarico(t.formato, r.formato)) v.formato.ok++;
      else errori.push(`riga ${i + 1} «${t.descrizione}»: formato ${testoCarico(r.formato ?? null)} invece di ${testoCarico(t.formato)}`);
    }
    if (t.ingrediente !== undefined) {
      v.ingrediente.misurate++;
      if (r.ingrediente === t.ingrediente) v.ingrediente.ok++;
      else errori.push(`riga ${i + 1} «${t.descrizione}»: ingrediente ${r.ingrediente ?? 'nessuno'} invece di ${t.ingrediente ?? 'nessuno'}`);
    }
    if (misuraCarico) {
      v.giacenza.misurate++;
      const attesa = t.carico ?? null;
      if (stessoCarico(attesa, r.carico)) v.giacenza.ok++;
      else if (attesa && !r.carico) v.giacenza.mancata++; // si scrive dopo, in «Da completare»
      else {
        v.giacenza.sbagliata++;
        errori.push(`riga ${i + 1} «${t.descrizione}»: in casa ${testoCarico(r.carico)} invece di ${testoCarico(attesa)}`);
      }
    }
    if (t.abbina !== undefined) {
      v.abbinamenti.misurate++;
      if ((r.abbina ?? null) === t.abbina) v.abbinamenti.ok++;
      else {
        v.abbinamenti.sbagliati++;
        errori.push(`riga ${i + 1} «${t.descrizione}»: abbinata a ${r.abbina ?? 'nessuna'} invece di ${t.abbina ?? 'nessuna'}`);
      }
    }
  }
  for (const [j, r] of letta.righe.entries()) {
    if (usate.has(j)) continue;
    v.righe.inPiu++;
    errori.push(`riga in più «${r.descrizione}» ${euro(r.prezzo)}`);
    // Una riga in più con un ingrediente suggerito va in casa (anche senza quantità: «da completare»).
    if (r.ingrediente) v.giacenza.inPiu++;
    if (r.abbina) v.abbinamenti.sbagliati++;
  }

  v.campi.data = letta.data === verita.data;
  if (!v.campi.data) errori.push(`data ${letta.data ?? 'non letta'} invece di ${verita.data}`);
  v.campi.totale = letta.totale !== null && stessoPrezzo(letta.totale, verita.totale);
  if (!v.campi.totale) errori.push(`totale ${letta.totale === null ? 'non letto' : euro(letta.totale)} invece di ${euro(verita.totale)}`);
  if (verita.ora) {
    v.campi.ora = letta.ora === verita.ora;
    if (!v.campi.ora) errori.push(`ora ${letta.ora ?? 'non letta'} invece di ${verita.ora}`);
  }
  if (verita.negozio) {
    v.campi.negozio = letta.negozio !== null && somiglianza(verita.negozio, letta.negozio) >= 0.8;
    if (!v.campi.negozio) errori.push(`negozio «${letta.negozio ?? 'non letto'}» invece di «${verita.negozio}»`);
  }

  v.perfetta = v.righe.ok === v.righe.vere && v.righe.inPiu === 0 && v.campi.data && v.campi.totale && v.campi.ora !== false;
  v.falsoQuadra = letta.quadra && (v.righe.ok < v.righe.vere || v.righe.inPiu > 0);
  v.sicura = v.giacenza.sbagliata === 0 && v.giacenza.inPiu === 0 && v.abbinamenti.sbagliati === 0;
  v.firma = JSON.stringify([letta.data, letta.ora, letta.totale, letta.righe.map((r) => [compatto(r.descrizione), r.prezzo, r.pezzi ?? null, r.carico, r.abbina])]);
  return v;
}

// ───────────────────────── Sintesi ─────────────────────────

/** Una misura: `valore` su `su` (percentuale) oppure un conteggio; `verso` dice se meglio è di più o di meno. */
export interface Metrica {
  etichetta: string;
  valore: number;
  su?: number;
  verso: 'piu' | 'meno';
}
export type Sintesi = Record<string, Metrica>;

export interface Esito {
  caso: string;
  lettura: string;
  valutazione: Valutazione;
  /** Il lettore ha dato un errore al posto del testo (nessuna lettura da valutare). */
  fallita?: boolean;
}

const somma = <T,>(v: T[], f: (x: T) => number) => v.reduce((s, x) => s + f(x), 0);

/** I numeri che si confrontano tra una fase e l'altra. */
export function riassumi(esiti: Esito[]): Sintesi {
  const V = esiti.map((e) => e.valutazione);
  const n = V.length;
  const righeVere = somma(V, (x) => x.righe.vere);
  const percentuale = (etichetta: string, valore: number, su: number): Metrica => ({ etichetta, valore, su, verso: 'piu' });
  const conteggio = (etichetta: string, valore: number): Metrica => ({ etichetta, valore, verso: 'meno' });
  const su = (f: (x: Valutazione) => Conta) => [somma(V, (x) => f(x).ok), somma(V, (x) => f(x).misurate)] as const;
  const campo = (f: (x: Valutazione) => boolean | null) => {
    const misurate = V.filter((x) => f(x) !== null);
    return [misurate.filter((x) => f(x)).length, misurate.length] as const;
  };
  const [pz, pzSu] = su((x) => x.pezzi);
  const [fo, foSu] = su((x) => x.formato);
  const [ing, ingSu] = su((x) => x.ingrediente);
  const [ab, abSu] = su((x) => x.abbinamenti);
  const [da, daSu] = campo((x) => x.campi.data);
  const [or, orSu] = campo((x) => x.campi.ora);
  const [to, toSu] = campo((x) => x.campi.totale);
  const quadrate = V.filter((x) => x.quadra).length;
  // Stabilità: per ogni scontrino con più letture, quante hanno lo stesso esito della più frequente.
  const perCaso = new Map<string, string[]>();
  for (const e of esiti) perCaso.set(e.caso, [...(perCaso.get(e.caso) ?? []), e.valutazione.firma]);
  const gruppi = [...perCaso.values()].filter((f) => f.length > 1);
  const uguali = somma(gruppi, (f) => Math.max(...[...new Set(f)].map((x) => f.filter((y) => y === x).length)));
  const lette = somma(gruppi, (f) => f.length);
  return {
    perfette: percentuale('Letture perfette (al primo tentativo)', V.filter((x) => x.perfetta).length, n),
    sicure: percentuale('Letture sicure per la giacenza', V.filter((x) => x.sicura).length, n),
    righeOk: percentuale('Righe giuste (nome e prezzo)', somma(V, (x) => x.righe.ok), righeVere),
    data: percentuale('Data giusta', da, daSu),
    ora: percentuale('Ora giusta', or, orSu),
    totale: percentuale('Totale giusto', to, toSu),
    pezzi: percentuale('Pezzi letti', pz, pzSu),
    formato: percentuale('Formato letto (peso o volume)', fo, foSu),
    ingrediente: percentuale('Ingrediente giusto', ing, ingSu),
    giacenzaOk: percentuale('Quantità in casa giusta', somma(V, (x) => x.giacenza.ok), somma(V, (x) => x.giacenza.misurate)),
    abbinamentiOk: percentuale('Abbinamenti alle spunte giusti', ab, abSu),
    stabilita: percentuale('Stesso esito tra letture dello stesso scontrino', uguali, lette),
    prezzoSilenzioso: conteggio('Prezzi sbagliati senza avviso', somma(V, (x) => x.righe.prezzoSilenzioso)),
    righeMancanti: conteggio('Righe perse', somma(V, (x) => x.righe.mancanti)),
    righeInPiu: conteggio('Righe in più', somma(V, (x) => x.righe.inPiu)),
    nomiSbagliati: conteggio('Nomi letti male (prezzo giusto)', somma(V, (x) => x.righe.nome)),
    falsiQuadra: conteggio(`«Il conto torna» ma la lettura è sbagliata (su ${quadrate} che tornano)`, V.filter((x) => x.falsoQuadra).length),
    giacenzaSbagliata: conteggio('Quantità sbagliate che entrerebbero in casa', somma(V, (x) => x.giacenza.sbagliata)),
    giacenzaInPiu: conteggio('Righe in più che entrerebbero in casa', somma(V, (x) => x.giacenza.inPiu)),
    giacenzaPersa: conteggio('Righe di casa perse', somma(V, (x) => x.giacenza.persa)),
    abbinamentiSbagliati: conteggio('Abbinamenti alle spunte sbagliati', somma(V, (x) => x.abbinamenti.sbagliati)),
    lettureFallite: conteggio('Letture fallite (errore al posto del testo)', esiti.filter((e) => e.fallita).length),
  };
}

export interface Rapporto {
  versione: 1;
  /** Come è stato prodotto: `testo` (testi congelati, deterministico) o `foto` (foto lette sul momento). */
  livello: 'testo' | 'foto';
  /** Il nome del lettore o della fase che si sta misurando («fase-0-base»). */
  etichetta: string;
  creato: string;
  ambiente?: Record<string, string>;
  sintesi: Sintesi;
  casi: { caso: string; lettura: string; perfetta: boolean; sicura: boolean; fallita?: boolean; righeOk: number; righeVere: number; errori: string[] }[];
}

export function creaRapporto(livello: Rapporto['livello'], etichetta: string, esiti: Esito[], ambiente?: Record<string, string>): Rapporto {
  return {
    versione: 1,
    livello,
    etichetta,
    creato: new Date().toISOString(),
    ...(ambiente ? { ambiente } : {}),
    sintesi: riassumi(esiti),
    casi: esiti.map((e) => ({ caso: e.caso, lettura: e.lettura, perfetta: e.valutazione.perfetta, sicura: e.valutazione.sicura, ...(e.fallita ? { fallita: true } : {}), righeOk: e.valutazione.righe.ok, righeVere: e.valutazione.righe.vere, errori: e.valutazione.errori })),
  };
}

/** Le metriche peggiorate da `prima` a `dopo` (per bloccare i passi indietro). */
export function peggiorate(prima: Sintesi, dopo: Sintesi): string[] {
  const out: string[] = [];
  for (const [k, p] of Object.entries(prima)) {
    const d = dopo[k];
    if (!d) continue;
    const rapporto = (m: Metrica) => (m.su === undefined ? m.valore : m.su ? m.valore / m.su : null);
    const [a, b] = [rapporto(p), rapporto(d)];
    if (a === null || b === null) continue;
    if (p.verso === 'piu' ? b < a - 1e-9 : b > a + 1e-9) out.push(`${p.etichetta}: da ${testoMetrica(p)} a ${testoMetrica(d)}`);
  }
  return out;
}

export const testoMetrica = (m: Metrica) => (m.su === undefined ? String(m.valore) : m.su ? `${Math.round((m.valore / m.su) * 1000) / 10}% (${m.valore}/${m.su})` : '—');
