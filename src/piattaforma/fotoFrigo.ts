/**
 * Manda la foto del frigo alla funzione del server, che la passa a Gemini con la chiave della famiglia.
 * Per una famiglia tenuta solo sul telefono la chiave resta sul telefono e la foto va da qui a Gemini.
 * La foto non si salva da nessuna parte.
 */
import { riconosci, riconosciZona as riconosciZonaGemini, testoFrigo, type VistoInZona } from '../../supabase/functions/foto-frigo/nucleo';
import { leggiPianoDocumento, MIME_PIANO, type PianoLetto } from '../../supabase/functions/foto-frigo/piano';
import type { Riconosciuto } from '../dominio/fotoFrigo';
import { chiamaLocale, chiaveGeminiLocale } from './locale/motore';
import { SUPABASE_CHIAVE, SUPABASE_URL } from '../config';
import { type Dove, supabase } from './supabase';

/** Dove sta la famiglia: serve per sapere a chi chiedere chiave e riconoscimento. */
export interface Luogo {
  dove: Dove;
  utenteId: string;
}

export type ErroreFoto = 'quota' | 'chiave' | 'non_configurata' | 'rete' | 'gemini' | 'non_autorizzato';

async function base64(file: Blob): Promise<string> {
  const byte = new Uint8Array(await file.arrayBuffer());
  let s = '';
  for (let i = 0; i < byte.length; i += 0x8000) s += String.fromCharCode(...byte.subarray(i, i + 0x8000));
  return btoa(s);
}

/** `frigo`: il frigo della famiglia descritto a parole, perché Gemini dica anche dove vede ogni alimento. */
export async function riconosciFoto(famiglia_id: string, foto: Blob, luogo?: Luogo, frigo: string | null = null): Promise<{ alimenti: Riconosciuto[] } | { errore: ErroreFoto; dettaglio?: string }> {
  if (!navigator.onLine) return { errore: 'rete' };
  if (luogo?.dove === 'locale') {
    try {
      const chiave = await chiaveGeminiLocale(luogo.utenteId, famiglia_id);
      if (!chiave) return { errore: 'non_configurata' };
      const esito = await riconosci(await base64(foto), chiave, fetch, undefined, testoFrigo(frigo));
      return 'errore' in esito ? { errore: esito.errore, dettaglio: esito.dettaglio } : { alimenti: esito.alimenti };
    } catch {
      return { errore: 'rete' };
    }
  }
  try {
    const { data, error } = await supabase().functions.invoke('foto-frigo', { body: { famiglia_id, immagine: await base64(foto), ...(frigo ? { frigo } : {}) } });
    if (error) {
      const risposta = (error as { context?: Response }).context;
      const corpo = risposta && typeof risposta.json === 'function' ? await risposta.json().catch(() => null) : null;
      const e = corpo?.errore as ErroreFoto | undefined;
      const dettaglio = typeof corpo?.dettaglio === 'string' ? corpo.dettaglio.slice(0, 200) : undefined;
      return { errore: e && ['quota', 'chiave', 'non_configurata', 'gemini', 'non_autorizzato'].includes(e) ? e : 'rete', dettaglio };
    }
    return { alimenti: (data?.alimenti ?? []) as Riconosciuto[] };
  } catch {
    return { errore: 'rete' };
  }
}

/** A che punto è la lettura di una zona: le fasi vere della richiesta e gli alimenti trovati finora. */
export type FaseLettura = 'preparo' | 'invio' | 'guarda';
export type Avanzamento = (fase: FaseLettura, visti: VistoInZona[]) => void;

type EsitoZona = { visti: VistoInZona[] } | { errore: ErroreFoto; dettaglio?: string };

const ERRORI_FOTO: ErroreFoto[] = ['quota', 'chiave', 'non_configurata', 'gemini', 'non_autorizzato'];
const erroreNoto = (e: unknown): ErroreFoto => (ERRORI_FOTO.includes(e as ErroreFoto) ? (e as ErroreFoto) : 'rete');

/** Le righe JSON della funzione (una per riga): passa gli alimenti man mano e restituisce l'ultima, con l'esito. */
async function leggiRighe(r: Response, avanza: Avanzamento): Promise<EsitoZona> {
  const lettore = r.body!.getReader();
  const dec = new TextDecoder();
  let resto = '';
  let esito: EsitoZona = { errore: 'rete' };
  const riga = (l: string) => {
    if (!l.trim()) return;
    try {
      const x = JSON.parse(l) as { visti?: VistoInZona[]; fine?: boolean; errore?: string; dettaglio?: string };
      if (x.errore) esito = { errore: erroreNoto(x.errore), dettaglio: typeof x.dettaglio === 'string' ? x.dettaglio.slice(0, 200) : undefined };
      else if (x.fine) esito = { visti: x.visti ?? [] };
      else if (x.visti) avanza('guarda', x.visti);
    } catch {
      // riga rotta: si ignora
    }
  };
  for (;;) {
    const { value, done } = await lettore.read();
    if (done) break;
    resto += dec.decode(value, { stream: true });
    const righe = resto.split('\n');
    resto = righe.pop() ?? '';
    righe.forEach(riga);
  }
  riga(resto);
  return esito;
}

/**
 * Verifica dell'inventario: le foto di una zona (fino a 4, la stessa zona da più lati) e il contesto della famiglia
 * (src/dominio/verifica.ts). Le foto non si salvano: passano a Google e basta.
 * `avanza` riceve la fase e gli alimenti trovati finora, mentre Gemini guarda.
 */
export async function riconosciZona(famiglia_id: string, foto: Blob[], contesto: string, luogo?: Luogo, avanza: Avanzamento = () => {}): Promise<EsitoZona> {
  if (!navigator.onLine) return { errore: 'rete' };
  avanza('preparo', []);
  const immagini = await Promise.all(foto.slice(0, 4).map(base64));
  avanza('invio', []);
  if (luogo?.dove === 'locale') {
    try {
      const chiave = await chiaveGeminiLocale(luogo.utenteId, famiglia_id);
      if (!chiave) return { errore: 'non_configurata' };
      avanza('guarda', []);
      const esito = await riconosciZonaGemini(immagini, chiave, contesto, fetch, undefined, (visti) => avanza('guarda', visti));
      return 'errore' in esito ? { errore: esito.errore, dettaglio: esito.dettaglio } : { visti: esito.visti };
    } catch {
      return { errore: 'rete' };
    }
  }
  try {
    const token = (await supabase().auth.getSession()).data.session?.access_token ?? SUPABASE_CHIAVE;
    const r = await fetch(`${SUPABASE_URL}/functions/v1/foto-frigo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: SUPABASE_CHIAVE, authorization: `Bearer ${token}` },
      body: JSON.stringify({ famiglia_id, tipo: 'verifica', immagini, contesto, flusso: true }),
    });
    if (r.ok && r.body && (r.headers.get('content-type') ?? '').includes('ndjson')) {
      avanza('guarda', []);
      return await leggiRighe(r, avanza);
    }
    // Una funzione di prima (risponde tutto insieme) o un errore.
    const corpo = (await r.json().catch(() => null)) as { visti?: VistoInZona[]; errore?: string; dettaglio?: unknown } | null;
    if (r.ok) return { visti: corpo?.visti ?? [] };
    return { errore: erroreNoto(corpo?.errore), dettaglio: typeof corpo?.dettaglio === 'string' ? corpo.dettaglio.slice(0, 200) : undefined };
  } catch {
    return { errore: 'rete' };
  }
}

export interface StatoChiave {
  /** La famiglia ha una chiave sua (se ne vedono solo le ultime 4 cifre). */
  propria: boolean;
  finale: string | null;
  /** La famiglia può usare la chiave del progetto (le famiglie di chi gestisce l'app). */
  condivisa: boolean;
}

/** Com'è messa la chiave Gemini della famiglia. Null senza rete. */
export async function statoChiave(famiglia: string, luogo?: Luogo): Promise<StatoChiave | null> {
  try {
    if (luogo?.dove === 'locale') return await chiamaLocale<StatoChiave | null>(luogo.utenteId, 'stato_chiave_gemini', [famiglia]);
    const { data, error } = await supabase().rpc('stato_chiave_gemini', { p_famiglia: famiglia });
    return error ? null : ((data as StatoChiave | null) ?? null);
  } catch {
    return null;
  }
}

/** Scrive (o toglie, con testo vuoto) la chiave della famiglia. Solo chi amministra. */
export async function impostaChiave(famiglia: string, chiave: string, luogo?: Luogo): Promise<{ stato: StatoChiave } | { motivo: string }> {
  try {
    let r: { esito: string; dettaglio: StatoChiave & { motivo?: string } };
    if (luogo?.dove === 'locale') r = await chiamaLocale(luogo.utenteId, 'imposta_chiave_gemini', [famiglia, chiave]);
    else {
      const { data, error } = await supabase().rpc('imposta_chiave_gemini', { p_famiglia: famiglia, p_chiave: chiave });
      if (error) return { motivo: 'rete' };
      r = data as typeof r;
    }
    return r.esito === 'applicato' ? { stato: r.dettaglio } : { motivo: r.dettaglio.motivo ?? 'dati_non_validi' };
  } catch {
    return { motivo: 'rete' };
  }
}

export type ErrorePiano = ErroreFoto | 'illeggibile' | 'formato';

/**
 * Il piano del nutrizionista (PDF o foto) letto da Gemini con la chiave della famiglia, come la foto del frigo.
 * Il file non si salva: passa a Google e basta.
 */
export async function leggiPianoConGemini(famiglia_id: string, file: Blob, mime: string, luogo?: Luogo): Promise<{ piano: PianoLetto } | { errore: ErrorePiano; dettaglio?: string }> {
  if (!MIME_PIANO.includes(mime)) return { errore: 'formato' };
  if (!navigator.onLine) return { errore: 'rete' };
  if (luogo?.dove === 'locale') {
    try {
      const chiave = await chiaveGeminiLocale(luogo.utenteId, famiglia_id);
      if (!chiave) return { errore: 'non_configurata' };
      const esito = await leggiPianoDocumento(await base64(file), mime, chiave);
      return 'errore' in esito ? { errore: esito.errore, dettaglio: esito.dettaglio } : { piano: esito.piano };
    } catch {
      return { errore: 'rete' };
    }
  }
  try {
    const { data, error } = await supabase().functions.invoke('foto-frigo', { body: { famiglia_id, tipo: 'piano', documento: await base64(file), mime } });
    if (error) {
      const risposta = (error as { context?: Response }).context;
      const corpo = risposta && typeof risposta.json === 'function' ? await risposta.json().catch(() => null) : null;
      const e = corpo?.errore as ErrorePiano | undefined;
      const dettaglio = typeof corpo?.dettaglio === 'string' ? corpo.dettaglio.slice(0, 200) : undefined;
      return { errore: e && ['quota', 'chiave', 'non_configurata', 'gemini', 'non_autorizzato', 'illeggibile'].includes(e) ? e : 'rete', dettaglio };
    }
    return data?.piano ? { piano: data.piano as PianoLetto } : { errore: 'illeggibile' };
  } catch {
    return { errore: 'rete' };
  }
}
