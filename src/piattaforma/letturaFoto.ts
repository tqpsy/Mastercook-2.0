/**
 * Le letture delle foto (foto del frigo e verifica con le foto), fuori dalla schermata: continuano anche se chiudi il
 * foglio o cambi scheda, e con la famiglia sul server continuano anche con l'app in tasca.
 *
 * - Famiglia sul server: ogni lettura (la foto del frigo, o una zona della verifica) parte con un id, la funzione
 *   risponde subito e lavora da sola. L'app chiede com'è andata ogni pochi secondi, e subito appena torna in primo
 *   piano. Se la foto non risulta arrivata (il telefono è passato in secondo piano durante l'invio) la rimanda con
 *   lo stesso id: ripetere non fa doppi effetti. Gli id si ricordano sul dispositivo, così anche riaprendo l'app il
 *   risultato si ritrova (il server lo tiene due giorni).
 * - Famiglia «solo su questo telefono»: non c'è un server che lavori al posto del telefono, quindi la lettura vive
 *   solo con l'app in primo piano; lo schermo resta acceso finché Gemini guarda, e se si interrompe si riprova
 *   senza rifare le foto.
 */
import { useSyncExternalStore } from 'react';
import type { VistoInZona } from '../../supabase/functions/foto-frigo/nucleo';
import type { Riconosciuto } from '../dominio/fotoFrigo';
import { chiediLettura, corpoFotoFrigo, corpoZona, type ErroreFoto, type Luogo, mandaAlServer, riconosciFotoLocale, riconosciZonaLocale } from './fotoFrigo';

export interface Lettura {
  id: string;
  /** Le zone di una stessa verifica hanno lo stesso gruppo. */
  gruppo: string;
  tipo: 'frigo' | 'zona';
  famiglia: string;
  /** Dove sta la famiglia (server o solo questo telefono). */
  sede: Luogo;
  /** Foto del frigo: cosa si fotografa ('frigo' | 'freezer' | 'dispensa') e la parte del frigo (id) se è solo una. */
  luogoCasa: string;
  parte: string | null;
  /** Verifica: la zona. */
  zonaId: string | null;
  /** `coda`: solo in locale, aspetta il suo turno (due zone alla volta). */
  fase: 'coda' | 'invio' | 'attesa' | 'pronta' | 'errore';
  /** I nomi trovati finora (solo famiglia locale: sul server arriva tutto insieme). */
  trovati: string[];
  alimenti: Riconosciuto[] | null;
  visti: VistoInZona[] | null;
  errore: ErroreFoto | null;
  dettaglio?: string;
  inizio: number;
}

/** Quello che serve per (ri)mandare una lettura: resta solo in memoria, le foto non si salvano. */
type Carico = { tipo: 'frigo'; foto: Blob; descrizione: string | null } | { tipo: 'zona'; foto: Blob[]; contesto: string; ritardo: number };

const CHIAVE = 'mc-lettura-foto';
const INTERVALLO_MS = 2500;
/** Dopo tanto tempo senza risposta la lettura si dà per persa. */
const SCADENZA_MS = 6 * 60 * 1000;
/** Si ricorda la lettura per due ore (il server la tiene due giorni, ma una foto di ieri non serve più). */
const MEMORIA_MS = 2 * 60 * 60 * 1000;
/** Zone lette insieme: Gemini risponde prima e la quota gratuita (richieste al minuto) regge. */
const ZONE_INSIEME = 2;
/** Sul server le zone partono tutte subito, ma Gemini le guarda a gruppi di due, a questa distanza (secondi). */
const SECONDI_TRA_GRUPPI = 20;

let letture: Lettura[] = [];
const carichi = new Map<string, Carico>();
const inviando = new Set<string>();
const ultimoInvio = new Map<string, number>();
const aperte = { frigo: false, verifica: false };
let richiestaApertura = null as 'foto' | 'verifica' | null;
let timer: ReturnType<typeof setInterval> | null = null;
let controllando = false;
let ascolto = false;
let luce: { release(): Promise<void> } | null = null;
const ascoltatori = new Set<() => void>();
let istantanea = { letture, aperte: { ...aperte }, richiestaApertura };

function pubblica() {
  istantanea = { letture, aperte: { ...aperte }, richiestaApertura };
  ascoltatori.forEach((f) => f());
}
function imposta(nuove: Lettura[]) {
  letture = nuove;
  pubblica();
}
function aggiorna(id: string, parziale: Partial<Lettura>) {
  if (letture.some((l) => l.id === id)) imposta(letture.map((l) => (l.id === id ? { ...l, ...parziale } : l)));
}
const trova = (id: string) => letture.find((l) => l.id === id);
const inLocale = (l: Lettura) => l.sede.dove === 'locale';
const inCorso = (l: Lettura) => l.fase === 'invio' || l.fase === 'attesa' || l.fase === 'coda';

function ricorda() {
  try {
    const dalServer = letture.filter((l) => !inLocale(l));
    if (!dalServer.length) localStorage.removeItem(CHIAVE);
    else
      localStorage.setItem(
        CHIAVE,
        JSON.stringify(dalServer.map(({ id, gruppo, tipo, famiglia, sede, luogoCasa, parte, zonaId, inizio }) => ({ id, gruppo, tipo, famiglia, sede, luogoCasa, parte, zonaId, inizio }))),
      );
  } catch {
    // Senza memoria del dispositivo la lettura funziona lo stesso, ma non si ritrova dopo la chiusura dell'app.
  }
}

async function tieniSchermoAcceso() {
  if (luce) return;
  try {
    luce = (await (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen')) ?? null;
  } catch {
    luce = null;
  }
}
function lasciaSchermo() {
  void luce?.release().catch(() => {});
  luce = null;
}

function fermaSeFinito() {
  if (letture.some(inCorso)) return;
  if (timer) clearInterval(timer);
  timer = null;
  lasciaSchermo();
}

function finisci(id: string, parziale: Partial<Lettura>) {
  if (parziale.fase === 'pronta') carichi.delete(id); // finché non è pronta si tiene, per riprovare senza rifarla
  aggiorna(id, parziale);
  fermaSeFinito();
}

/** Dal server: com'è andata ogni lettura ancora in corso. */
async function controlla() {
  if (controllando) return;
  const daVedere = letture.filter((l) => !inLocale(l) && (l.fase === 'invio' || l.fase === 'attesa'));
  if (!daVedere.length) return;
  controllando = true;
  try {
    await Promise.all(
      daVedere.map(async (l) => {
        const r = await chiediLettura(l.id);
        if (!trova(l.id)) return;
        if (r.stato === 'pronta') return finisci(l.id, { fase: 'pronta', alimenti: r.alimenti, visti: r.visti });
        if (r.stato === 'errore') return finisci(l.id, { fase: 'errore', errore: r.errore, dettaglio: r.dettaglio });
        if (r.stato === 'assente') {
          // La foto non è mai arrivata: se l'abbiamo ancora, si rimanda (stesso id, nessun doppio effetto).
          if (carichi.has(l.id) && Date.now() - (ultimoInvio.get(l.id) ?? 0) > 4000) void invia(l.id);
          else if (!carichi.has(l.id) && Date.now() - l.inizio > 60_000) return finisci(l.id, { fase: 'errore', errore: 'rete' });
        }
        if (Date.now() - l.inizio > SCADENZA_MS) finisci(l.id, { fase: 'errore', errore: 'gemini', dettaglio: 'tempo scaduto' });
      }),
    );
  } finally {
    controllando = false;
  }
}

async function invia(id: string) {
  const l = trova(id);
  const c = carichi.get(id);
  if (!l || !c || inviando.has(id)) return;
  inviando.add(id);
  ultimoInvio.set(id, Date.now());
  try {
    const r = await mandaAlServer(l.famiglia, id, () => (c.tipo === 'frigo' ? corpoFotoFrigo(c.foto, c.descrizione) : corpoZona(c.foto, c.contesto, c.ritardo)));
    if (!trova(id)) return;
    if (r === 'ok' || r === 'rete') aggiorna(id, { fase: 'attesa' }); // 'rete': non si sa se è arrivata, il controllo rimanda se serve
    else finisci(id, { fase: 'errore', errore: r.errore, dettaglio: r.dettaglio });
  } finally {
    inviando.delete(id);
  }
}

function seguiDalServer() {
  if (!ascolto) {
    ascolto = true;
    // Appena l'app torna in primo piano (o torna la rete) si chiede subito com'è andata, senza aspettare il giro.
    const subito = () => {
      if (document.visibilityState === 'visible') void controlla();
    };
    document.addEventListener('visibilitychange', subito);
    window.addEventListener('online', subito);
    window.addEventListener('pageshow', subito);
  }
  if (!timer) timer = setInterval(() => void controlla(), INTERVALLO_MS);
}

function nuova(p: Pick<Lettura, 'gruppo' | 'tipo' | 'famiglia' | 'sede'> & Partial<Pick<Lettura, 'luogoCasa' | 'parte' | 'zonaId'>>, fase: Lettura['fase']): Lettura {
  return { id: crypto.randomUUID(), luogoCasa: 'frigo', parte: null, zonaId: null, fase, trovati: [], alimenti: null, visti: null, errore: null, inizio: Date.now(), ...p };
}

function scarta(quali: (l: Lettura) => boolean) {
  for (const l of letture.filter(quali)) {
    carichi.delete(l.id);
    inviando.delete(l.id);
    ultimoInvio.delete(l.id);
  }
  imposta(letture.filter((l) => !quali(l)));
  fermaSeFinito();
  ricorda();
}

// ───────────────────────── Foto del frigo ─────────────────────────

async function leggiFrigoInLocale(id: string) {
  const l = trova(id);
  const c = carichi.get(id);
  if (!l || c?.tipo !== 'frigo') return;
  void tieniSchermoAcceso();
  const r = await riconosciFotoLocale(l.sede, l.famiglia, c.foto, c.descrizione, (t) => aggiorna(id, { trovati: t.map((x) => x.nome) }));
  if (!trova(id)) return;
  if ('errore' in r) finisci(id, { fase: 'errore', errore: r.errore, dettaglio: r.dettaglio });
  else finisci(id, { fase: 'pronta', alimenti: r.alimenti });
}

/** Parte la lettura di una foto del frigo. Sostituisce quella di prima, se c'era. */
export function avviaLettura(p: { famiglia: string; sede: Luogo; luogoCasa: string; parte: string | null; descrizione: string | null; foto: Blob }) {
  scartaLettura();
  const l = nuova({ gruppo: crypto.randomUUID(), tipo: 'frigo', famiglia: p.famiglia, sede: p.sede, luogoCasa: p.luogoCasa, parte: p.parte }, 'invio');
  carichi.set(l.id, { tipo: 'frigo', foto: p.foto, descrizione: p.descrizione });
  imposta([...letture, l]);
  ricorda();
  if (inLocale(l)) void leggiFrigoInLocale(l.id);
  else {
    void tieniSchermoAcceso();
    seguiDalServer();
    void invia(l.id).then(() => lasciaSchermo());
  }
}

/** Dopo un errore, se la foto c'è ancora: si riprova senza rifarla. */
export function riprovaLettura() {
  const l = letture.find((x) => x.tipo === 'frigo');
  const c = l && carichi.get(l.id);
  if (!l || c?.tipo !== 'frigo') return;
  carichi.delete(l.id);
  const n = nuova({ gruppo: l.gruppo, tipo: 'frigo', famiglia: l.famiglia, sede: l.sede, luogoCasa: l.luogoCasa, parte: l.parte }, 'invio');
  carichi.set(n.id, c);
  imposta(letture.map((x) => (x.id === l.id ? n : x)));
  ricorda();
  if (inLocale(n)) void leggiFrigoInLocale(n.id);
  else {
    seguiDalServer();
    void invia(n.id);
  }
}

/** Scarta la lettura della foto del frigo (confermata, rifiutata o non più utile). */
export function scartaLettura() {
  scarta((l) => l.tipo === 'frigo');
  if (richiestaApertura === 'foto') {
    richiestaApertura = null;
    pubblica();
  }
}

// ───────────────────────── Verifica con le foto ─────────────────────────

export interface ZonaDaLeggere {
  zonaId: string;
  foto: Blob[];
  /** Il contesto della famiglia mandato a Gemini (src/dominio/verifica.ts, contestoPerGemini). */
  contesto: string;
}

async function leggiZonaInLocale(id: string) {
  const l = trova(id);
  const c = carichi.get(id);
  if (!l || c?.tipo !== 'zona') return;
  void tieniSchermoAcceso();
  const r = await riconosciZonaLocale(l.sede, l.famiglia, c.foto, c.contesto, (fase, visti) =>
    aggiorna(id, { fase: fase === 'guarda' ? 'attesa' : 'invio', visti, trovati: visti.map((x) => x.nome) }),
  );
  if (!trova(id)) return;
  if ('errore' in r) finisci(id, { fase: 'errore', errore: r.errore, dettaglio: r.dettaglio });
  else finisci(id, { fase: 'pronta', visti: r.visti });
}

/** In locale: le zone si leggono due alla volta; quando una finisce parte la prossima in coda. */
function avanzaCodaLocale() {
  const l = letture.filter((x) => x.tipo === 'zona' && inLocale(x));
  const guasta = l.find((x) => x.fase === 'errore');
  if (guasta) {
    // Una zona è fallita: le altre in coda non partono (come prima) e finiscono con lo stesso errore, così la verifica
    // non resta ferma su «leggo» e lo schermo non resta acceso. Le foto restano per riprovare.
    for (const x of l) if (x.fase === 'coda') finisci(x.id, { fase: 'errore', errore: guasta.errore, dettaglio: guasta.dettaglio });
    return;
  }
  let attive = l.filter((x) => x.fase === 'invio' || x.fase === 'attesa').length;
  for (const x of l) {
    if (attive >= ZONE_INSIEME) break;
    if (x.fase !== 'coda') continue;
    attive++;
    aggiorna(x.id, { fase: 'invio' });
    void leggiZonaInLocale(x.id).then(avanzaCodaLocale);
  }
}

function avviaZoneDa(zone: ZonaDaLeggere[], p: { famiglia: string; sede: Luogo }, gruppo: string) {
  const locale = p.sede.dove === 'locale';
  const nuove = zone.map((z, i) => {
    const l = nuova({ gruppo, tipo: 'zona', famiglia: p.famiglia, sede: p.sede, zonaId: z.zonaId }, locale ? 'coda' : 'invio');
    carichi.set(l.id, { tipo: 'zona', foto: z.foto, contesto: z.contesto, ritardo: Math.floor(i / ZONE_INSIEME) * SECONDI_TRA_GRUPPI });
    return l;
  });
  imposta([...letture, ...nuove]);
  ricorda();
  if (locale) avanzaCodaLocale();
  else {
    void tieniSchermoAcceso();
    seguiDalServer();
    void Promise.all(nuove.map((l) => invia(l.id))).then(() => lasciaSchermo());
  }
}

/** Parte la lettura delle zone della verifica (una per zona). Sostituisce la verifica di prima, se c'era. */
export function avviaVerifica(p: { famiglia: string; sede: Luogo; zone: ZonaDaLeggere[] }) {
  scartaVerifica();
  avviaZoneDa(p.zone, p, crypto.randomUUID());
}

/** Scarta la verifica (conclusa, rifiutata o non più utile). */
export function scartaVerifica() {
  scarta((l) => l.tipo === 'zona');
  if (richiestaApertura === 'verifica') {
    richiestaApertura = null;
    pubblica();
  }
}

/** Le foto di una zona che si sta leggendo (per mostrarle mentre Gemini guarda). */
export function fotoDellaZona(zonaId: string): Blob[] {
  const l = letture.find((x) => x.tipo === 'zona' && x.zonaId === zonaId);
  const c = l && carichi.get(l.id);
  return c?.tipo === 'zona' ? c.foto : [];
}

// ───────────────────────── Ripresa, avvisi, hook ─────────────────────────

/**
 * All'apertura dell'app: se c'erano letture in corso o pronte sul server, le si riprende. Le foto non ci sono più
 * (non si salvano), ma gli id bastano per ritrovare i risultati.
 */
export function riprendiLettura(famiglia: string) {
  if (letture.length) return;
  try {
    const grezzo = localStorage.getItem(CHIAVE);
    if (!grezzo) return;
    const m = JSON.parse(grezzo) as Partial<Lettura>[];
    const buone = (Array.isArray(m) ? m : []).filter(
      (x): x is Lettura =>
        !!x &&
        typeof x.id === 'string' &&
        x.famiglia === famiglia &&
        !!x.sede &&
        x.sede.dove !== 'locale' &&
        typeof x.inizio === 'number' &&
        Date.now() - x.inizio <= MEMORIA_MS &&
        (x.tipo === 'frigo' || x.tipo === 'zona'),
    );
    if (!buone.length) {
      localStorage.removeItem(CHIAVE);
      return;
    }
    imposta(
      buone.map((x) => ({
        ...nuova({ gruppo: x.gruppo ?? x.id, tipo: x.tipo, famiglia, sede: x.sede }, 'attesa'),
        id: x.id,
        luogoCasa: x.luogoCasa ?? 'frigo',
        parte: x.parte ?? null,
        zonaId: x.zonaId ?? null,
        inizio: x.inizio,
      })),
    );
    seguiDalServer();
    void controlla();
  } catch {
    // memoria illeggibile: si ignora
  }
}

/** Il foglio della foto del frigo (o della verifica) è aperto: l'avviso in alto non serve. */
export function segnaAperta(cosa: 'frigo' | 'verifica', si: boolean) {
  if (aperte[cosa] === si) return;
  aperte[cosa] = si;
  pubblica();
}

/** Dall'avviso: apri il foglio giusto in Casa. Casa lo consuma appena è in primo piano. */
export function chiediApertura(cosa: 'foto' | 'verifica') {
  richiestaApertura = cosa;
  pubblica();
}
export function consumaApertura() {
  if (!richiestaApertura) return;
  richiestaApertura = null;
  pubblica();
}

/** C'è ancora la foto per riprovare senza rifarla? */
export const siPuoRiprovare = (tipo: 'frigo' | 'zona' = 'frigo') => letture.some((l) => l.tipo === tipo && l.fase === 'errore' && carichi.has(l.id));

/** Le letture di adesso (per i test e per chi non è un componente). */
export const lettureCorrenti = () => letture;

function iscriviti(f: () => void) {
  ascoltatori.add(f);
  return () => {
    ascoltatori.delete(f);
  };
}
const leggi = () => istantanea;

/** `frigo`: la lettura della foto del frigo; `zone`: quelle della verifica (una per zona). */
export function useLetture() {
  const s = useSyncExternalStore(iscriviti, leggi, leggi);
  return { frigo: s.letture.find((l) => l.tipo === 'frigo') ?? null, zone: s.letture.filter((l) => l.tipo === 'zona'), aperte: s.aperte, richiestaApertura: s.richiestaApertura };
}
