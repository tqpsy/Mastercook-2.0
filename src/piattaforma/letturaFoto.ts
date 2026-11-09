/**
 * La lettura della foto del frigo, fuori dalla schermata: continua anche se chiudi il foglio o cambi scheda, e
 * con la famiglia sul server continua anche con l'app in tasca.
 *
 * - Famiglia sul server: la foto parte con un id, la funzione risponde subito e lavora da sola. L'app chiede com'è
 *   andata ogni pochi secondi, e subito appena torna in primo piano. Se la foto non risulta arrivata (il telefono è
 *   passato in secondo piano durante l'invio) la rimanda con lo stesso id: ripetere non fa doppi effetti.
 *   L'id si ricorda sul dispositivo, così anche riaprendo l'app il risultato si ritrova (il server lo tiene due giorni).
 * - Famiglia «solo su questo telefono»: non c'è un server che lavori al posto del telefono, quindi la lettura vive
 *   solo con l'app in primo piano; lo schermo resta acceso finché Gemini guarda, e se si interrompe si riprova
 *   senza rifare la foto.
 */
import { useSyncExternalStore } from 'react';
import type { Riconosciuto } from '../dominio/fotoFrigo';
import { chiediLettura, type ErroreFoto, type Luogo, mandaFotoAlServer, riconosciFotoLocale } from './fotoFrigo';

export interface LetturaFoto {
  id: string;
  famiglia: string;
  /** Dove sta la famiglia (server o solo questo telefono). */
  sede: Luogo;
  /** Cosa si fotografa: 'frigo' | 'freezer' | 'dispensa', e la parte del frigo (id) se è solo una. */
  luogoCasa: string;
  parte: string | null;
  fase: 'invio' | 'attesa' | 'pronta' | 'errore';
  /** I nomi trovati finora (solo famiglia locale: sul server arriva tutto insieme). */
  trovati: string[];
  alimenti: Riconosciuto[] | null;
  errore: ErroreFoto | null;
  dettaglio?: string;
  inizio: number;
}

const CHIAVE = 'mc-lettura-foto';
const INTERVALLO_MS = 2500;
/** Dopo tanto tempo senza risposta la lettura si dà per persa. */
const SCADENZA_MS = 6 * 60 * 1000;
/** Si ricorda la lettura per due ore (il server la tiene due giorni, ma una foto di ieri non serve più). */
const MEMORIA_MS = 2 * 60 * 60 * 1000;

let stato: LetturaFoto | null = null;
let foto: Blob | null = null;
let descrizione: string | null = null;
let aperta = false;
let richiestaApertura = false;
let timer: ReturnType<typeof setInterval> | null = null;
let controllando = false;
let inviando = false;
let ultimoInvio = 0;
let ascolto = false;
let luce: { release(): Promise<void> } | null = null;
const ascoltatori = new Set<() => void>();
let istantanea = { lettura: stato as LetturaFoto | null, aperta, richiestaApertura };

function cambia(nuovo: LetturaFoto | null) {
  stato = nuovo;
  pubblica();
}
function pubblica() {
  istantanea = { lettura: stato, aperta, richiestaApertura };
  ascoltatori.forEach((f) => f());
}
function aggiorna(parziale: Partial<LetturaFoto>) {
  if (stato) cambia({ ...stato, ...parziale });
}

function ricorda() {
  try {
    if (!stato) localStorage.removeItem(CHIAVE);
    else {
      const { id, famiglia, sede, luogoCasa, parte, inizio } = stato;
      localStorage.setItem(CHIAVE, JSON.stringify({ id, famiglia, sede, luogoCasa, parte, inizio }));
    }
  } catch {
    // Senza memoria del dispositivo la lettura funziona lo stesso, ma non si ritrova dopo la chiusura dell'app.
  }
}

async function tieniSchermoAcceso() {
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

function ferma() {
  if (timer) clearInterval(timer);
  timer = null;
  lasciaSchermo();
}

function finisci(parziale: Partial<LetturaFoto>) {
  ferma();
  if (parziale.fase === 'pronta') foto = null; // finché non è pronta si tiene, per riprovare senza rifarla
  aggiorna(parziale);
}

/** Dal server: com'è andata la lettura. */
async function controlla() {
  const l = stato;
  if (!l || l.sede.dove === 'locale' || (l.fase !== 'attesa' && l.fase !== 'invio') || controllando) return;
  controllando = true;
  try {
    const r = await chiediLettura(l.id);
    if (stato?.id !== l.id) return;
    if (r.stato === 'pronta') return finisci({ fase: 'pronta', alimenti: r.alimenti });
    if (r.stato === 'errore') return finisci({ fase: 'errore', errore: r.errore, dettaglio: r.dettaglio });
    if (r.stato === 'assente') {
      // La foto non è mai arrivata: se l'abbiamo ancora, si rimanda (stesso id, nessun doppio effetto).
      if (foto && Date.now() - ultimoInvio > 4000) void invia();
      else if (!foto && Date.now() - l.inizio > 60_000) finisci({ fase: 'errore', errore: 'rete' });
    }
    if (Date.now() - l.inizio > SCADENZA_MS) finisci({ fase: 'errore', errore: 'gemini', dettaglio: 'tempo scaduto' });
  } finally {
    controllando = false;
  }
}

async function invia() {
  const l = stato;
  if (!l || !foto || inviando) return;
  inviando = true;
  ultimoInvio = Date.now();
  try {
    const r = await mandaFotoAlServer(l.famiglia, l.id, foto, descrizione);
    if (stato?.id !== l.id) return;
    if (r === 'ok') aggiorna({ fase: 'attesa' });
    else if (r !== 'rete') finisci({ fase: 'errore', errore: r.errore, dettaglio: r.dettaglio });
    // 'rete': non si sa se è arrivata; resta in attesa, e il controllo rimanda la foto se non risulta.
    else aggiorna({ fase: 'attesa' });
  } finally {
    inviando = false;
  }
}

function inizia() {
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
  if (timer) clearInterval(timer);
  timer = setInterval(() => void controlla(), INTERVALLO_MS);
}

async function leggiInLocale() {
  const l = stato;
  if (!l || !foto) return;
  void tieniSchermoAcceso();
  const r = await riconosciFotoLocale(l.sede, l.famiglia, foto, descrizione, (t) => {
    if (stato?.id === l.id) aggiorna({ trovati: t.map((x) => x.nome) });
  });
  if (stato?.id !== l.id) return;
  if ('errore' in r) finisci({ fase: 'errore', errore: r.errore, dettaglio: r.dettaglio });
  else finisci({ fase: 'pronta', alimenti: r.alimenti });
}

/** Parte la lettura di una foto. Sostituisce quella di prima, se c'era. */
export function avviaLettura(p: { famiglia: string; sede: Luogo; luogoCasa: string; parte: string | null; descrizione: string | null; foto: Blob }) {
  ferma();
  foto = p.foto;
  descrizione = p.descrizione;
  cambia({
    id: crypto.randomUUID(),
    famiglia: p.famiglia,
    sede: p.sede,
    luogoCasa: p.luogoCasa,
    parte: p.parte,
    fase: 'invio',
    trovati: [],
    alimenti: null,
    errore: null,
    inizio: Date.now(),
  });
  ricorda();
  if (p.sede.dove === 'locale') void leggiInLocale();
  else {
    void tieniSchermoAcceso();
    inizia();
    void invia().then(() => lasciaSchermo());
  }
}

/** Dopo un errore, se la foto c'è ancora: si riprova senza rifarla. */
export function riprovaLettura() {
  const l = stato;
  if (!l || !foto) return;
  ferma();
  cambia({ ...l, id: crypto.randomUUID(), fase: 'invio', trovati: [], alimenti: null, errore: null, dettaglio: undefined, inizio: Date.now() });
  ricorda();
  if (l.sede.dove === 'locale') void leggiInLocale();
  else {
    inizia();
    void invia();
  }
}

/** La lettura di adesso (per i test e per chi non è un componente). */
export const letturaCorrente = () => stato;

export const siPuoRiprovare = () => foto !== null;

/** Scarta la lettura (confermata, rifiutata o non più utile). */
export function scartaLettura() {
  ferma();
  foto = null;
  descrizione = null;
  richiestaApertura = false;
  cambia(null);
  ricorda();
}

/**
 * All'apertura dell'app: se c'era una lettura in corso o pronta sul server, la si riprende. La foto non c'è più
 * (non si salva), ma l'id basta per ritrovare il risultato.
 */
export function riprendiLettura(famiglia: string) {
  if (stato) return;
  try {
    const grezzo = localStorage.getItem(CHIAVE);
    if (!grezzo) return;
    const m = JSON.parse(grezzo) as Partial<LetturaFoto>;
    if (!m.id || m.famiglia !== famiglia || !m.sede || m.sede.dove === 'locale' || typeof m.inizio !== 'number' || Date.now() - m.inizio > MEMORIA_MS) {
      localStorage.removeItem(CHIAVE);
      return;
    }
    foto = null;
    cambia({
      id: m.id,
      famiglia,
      sede: m.sede,
      luogoCasa: m.luogoCasa ?? 'frigo',
      parte: m.parte ?? null,
      fase: 'attesa',
      trovati: [],
      alimenti: null,
      errore: null,
      inizio: m.inizio,
    });
    inizia();
    void controlla();
  } catch {
    // memoria illeggibile: si ignora
  }
}

/** Il foglio della foto è aperto: l'avviso in alto non serve. */
export function segnaAperta(si: boolean) {
  if (aperta === si) return;
  aperta = si;
  pubblica();
}

/** Dall'avviso: apri il foglio della foto in Casa. Casa lo consuma appena è in primo piano. */
export function chiediApertura() {
  richiestaApertura = true;
  pubblica();
}
export function consumaApertura() {
  if (!richiestaApertura) return;
  richiestaApertura = false;
  pubblica();
}

function iscriviti(f: () => void) {
  ascoltatori.add(f);
  return () => {
    ascoltatori.delete(f);
  };
}
const leggi = () => istantanea;

export function useLetturaFoto() {
  return useSyncExternalStore(iscriviti, leggi, leggi);
}
