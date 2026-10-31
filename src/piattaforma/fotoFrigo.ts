/**
 * Manda la foto del frigo alla funzione del server, che la passa a Gemini con la chiave della famiglia.
 * Per una famiglia tenuta solo sul telefono la chiave resta sul telefono e la foto va da qui a Gemini.
 * La foto non si salva da nessuna parte.
 */
import { riconosci } from '../../supabase/functions/foto-frigo/nucleo';
import type { Riconosciuto } from '../dominio/fotoFrigo';
import { chiamaLocale, chiaveGeminiLocale } from './locale/motore';
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

export async function riconosciFoto(famiglia_id: string, foto: Blob, luogo?: Luogo): Promise<{ alimenti: Riconosciuto[] } | { errore: ErroreFoto; dettaglio?: string }> {
  if (!navigator.onLine) return { errore: 'rete' };
  if (luogo?.dove === 'locale') {
    try {
      const chiave = await chiaveGeminiLocale(luogo.utenteId, famiglia_id);
      if (!chiave) return { errore: 'non_configurata' };
      const esito = await riconosci(await base64(foto), chiave);
      return 'errore' in esito ? { errore: esito.errore, dettaglio: esito.dettaglio } : { alimenti: esito.alimenti };
    } catch {
      return { errore: 'rete' };
    }
  }
  try {
    const { data, error } = await supabase().functions.invoke('foto-frigo', { body: { famiglia_id, immagine: await base64(foto) } });
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
