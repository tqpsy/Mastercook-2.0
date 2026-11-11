/**
 * Manda la foto del frigo alla funzione del server, che la passa a Gemini con la chiave della famiglia.
 * Per una famiglia tenuta solo sul telefono la chiave resta sul telefono e la foto va da qui a Gemini.
 * La foto non si salva da nessuna parte.
 */
import { riconosci, riconosciZona as riconosciZonaGemini, testoFrigo, type VistoInZona } from '../../supabase/functions/foto-frigo/nucleo';
import { type DataGemini, leggiDataDocumento } from '../../supabase/functions/foto-frigo/data';
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

export type EsitoLettura = { alimenti: Riconosciuto[] } | { errore: ErroreFoto; dettaglio?: string };

/**
 * Famiglia «solo su questo telefono»: la foto va da qui a Gemini, quindi la lettura vive solo finché l'app è in
 * primo piano. `frigo`: il frigo della famiglia descritto a parole, perché Gemini dica anche dove vede ogni alimento.
 * `avanza` riceve gli alimenti trovati finora, mentre Gemini guarda.
 */
export async function riconosciFotoLocale(
  luogo: Luogo,
  famiglia_id: string,
  foto: Blob,
  frigo: string | null,
  avanza?: (trovati: Riconosciuto[]) => void,
): Promise<EsitoLettura> {
  if (!navigator.onLine) return { errore: 'rete' };
  try {
    const chiave = await chiaveGeminiLocale(luogo.utenteId, famiglia_id);
    if (!chiave) return { errore: 'non_configurata' };
    const esito = await riconosci(await base64(foto), chiave, fetch, undefined, testoFrigo(frigo), avanza);
    return 'errore' in esito ? { errore: esito.errore, dettaglio: esito.dettaglio } : { alimenti: esito.alimenti };
  } catch {
    return { errore: 'rete' };
  }
}

/**
 * Famiglia sul server: manda la foto (o le foto di una zona) con l'id della lettura e basta. La funzione risponde
 * subito (202) e lavora da sola anche con l'app in tasca. Rimandare lo stesso id non fa doppi effetti.
 * `'rete'`: non si sa se è arrivata.
 */
export async function mandaAlServer(famiglia_id: string, lettura_id: string, corpo: () => Promise<Record<string, unknown>>): Promise<'ok' | 'rete' | { errore: ErroreFoto; dettaglio?: string }> {
  if (!navigator.onLine) return 'rete';
  try {
    const token = (await supabase().auth.getSession()).data.session?.access_token ?? SUPABASE_CHIAVE;
    const r = await fetch(`${SUPABASE_URL}/functions/v1/foto-frigo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: SUPABASE_CHIAVE, authorization: `Bearer ${token}` },
      body: JSON.stringify({ famiglia_id, lettura_id, ...(await corpo()) }),
    });
    if (r.status === 202) return 'ok';
    const risposta = (await r.json().catch(() => null)) as { errore?: string; dettaglio?: unknown } | null;
    return { errore: erroreNoto(risposta?.errore), dettaglio: typeof risposta?.dettaglio === 'string' ? risposta.dettaglio.slice(0, 200) : undefined };
  } catch {
    return 'rete';
  }
}

/** Il corpo della richiesta per la foto singola del frigo. */
export async function corpoFotoFrigo(foto: Blob, frigo: string | null) {
  return { immagine: await base64(foto), ...(frigo ? { frigo } : {}) };
}

/** Il corpo della richiesta per una zona della verifica (le sue foto e il contesto della famiglia). */
export async function corpoZona(foto: Blob[], contesto: string, ritardo: number) {
  return { tipo: 'verifica', immagini: await Promise.all(foto.slice(0, 4).map(base64)), contesto, ...(ritardo ? { ritardo } : {}) };
}

/** Com'è andata la lettura sul server: `assente` se la foto non è mai arrivata, `rete` se non si è potuto chiedere. */
export type StatoServer =
  | { stato: 'in_corso' }
  | { stato: 'pronta'; alimenti: Riconosciuto[]; visti: VistoInZona[] }
  | { stato: 'errore'; errore: ErroreFoto; dettaglio?: string }
  | { stato: 'assente' }
  | { stato: 'rete' };

export async function chiediLettura(lettura_id: string): Promise<StatoServer> {
  try {
    const { data, error } = await supabase().rpc('leggi_lettura_foto', { p_id: lettura_id });
    if (error) return { stato: 'rete' };
    if (!data) return { stato: 'assente' };
    const r = data as { stato: string; risultato: { alimenti?: Riconosciuto[]; visti?: VistoInZona[]; errore?: string; dettaglio?: unknown } | null };
    if (r.stato === 'pronta') return { stato: 'pronta', alimenti: r.risultato?.alimenti ?? [], visti: r.risultato?.visti ?? [] };
    if (r.stato === 'errore') return { stato: 'errore', errore: erroreNoto(r.risultato?.errore), dettaglio: typeof r.risultato?.dettaglio === 'string' ? r.risultato.dettaglio.slice(0, 200) : undefined };
    return { stato: 'in_corso' };
  } catch {
    return { stato: 'rete' };
  }
}

/** A che punto è la lettura di una zona: le fasi vere della richiesta e gli alimenti trovati finora. */
export type FaseLettura = 'preparo' | 'invio' | 'guarda';
export type Avanzamento = (fase: FaseLettura, visti: VistoInZona[]) => void;

export type EsitoZona = { visti: VistoInZona[] } | { errore: ErroreFoto; dettaglio?: string };

const ERRORI_FOTO: ErroreFoto[] = ['quota', 'chiave', 'non_configurata', 'gemini', 'non_autorizzato'];
const erroreNoto = (e: unknown): ErroreFoto => (ERRORI_FOTO.includes(e as ErroreFoto) ? (e as ErroreFoto) : 'rete');

/**
 * Verifica dell'inventario, famiglia «solo su questo telefono»: le foto di una zona (fino a 4, la stessa zona da più
 * lati) e il contesto della famiglia (src/dominio/verifica.ts) vanno da qui a Gemini. Le foto non si salvano.
 * `avanza` riceve la fase e gli alimenti trovati finora, mentre Gemini guarda.
 * (Per le famiglie sul server la zona parte con `mandaAlServer` e si legge in background.)
 */
export async function riconosciZonaLocale(luogo: Luogo, famiglia_id: string, foto: Blob[], contesto: string, avanza: Avanzamento = () => {}): Promise<EsitoZona> {
  if (!navigator.onLine) return { errore: 'rete' };
  avanza('preparo', []);
  const immagini = await Promise.all(foto.slice(0, 4).map(base64));
  avanza('invio', []);
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

/**
 * La data di scadenza stampata su una confezione, letta da Gemini con la chiave della famiglia (foto JPEG).
 * La foto non si salva: passa a Google e basta. `data: null` se Gemini non la legge.
 */
export async function leggiDataConGemini(famiglia_id: string, foto: Blob, luogo: Luogo, attesaMs = 12_000): Promise<{ data: DataGemini | null } | { errore: ErroreFoto; dettaglio?: string }> {
  if (!navigator.onLine) return { errore: 'rete' };
  // Una foto di data deve dare risposta in pochi secondi: oltre il limite si passa alla lettura sul telefono.
  const scaduto = new Promise<{ errore: ErroreFoto }>((ok) => setTimeout(() => ok({ errore: 'rete' }), attesaMs));
  return Promise.race([leggiDataConGeminiSenzaLimite(famiglia_id, foto, luogo), scaduto]);
}

async function leggiDataConGeminiSenzaLimite(famiglia_id: string, foto: Blob, luogo: Luogo): Promise<{ data: DataGemini | null } | { errore: ErroreFoto; dettaglio?: string }> {
  try {
    if (luogo.dove === 'locale') {
      const chiave = await chiaveGeminiLocale(luogo.utenteId, famiglia_id);
      if (!chiave) return { errore: 'non_configurata' };
      const esito = await leggiDataDocumento(await base64(foto), chiave);
      return 'errore' in esito ? { errore: esito.errore, dettaglio: esito.dettaglio } : { data: esito.data };
    }
    const { data, error } = await supabase().functions.invoke('foto-frigo', { body: { famiglia_id, tipo: 'data', immagine: await base64(foto) } });
    if (error) {
      const risposta = (error as { context?: Response }).context;
      const corpo = risposta && typeof risposta.json === 'function' ? await risposta.json().catch(() => null) : null;
      return { errore: erroreNoto(corpo?.errore), dettaglio: typeof corpo?.dettaglio === 'string' ? corpo.dettaglio.slice(0, 200) : undefined };
    }
    return { data: (data?.data as DataGemini | null | undefined) ?? null };
  } catch {
    return { errore: 'rete' };
  }
}
