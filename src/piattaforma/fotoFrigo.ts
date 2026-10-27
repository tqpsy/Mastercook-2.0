/**
 * Manda la foto del frigo alla funzione del server, che la passa a Gemini con la chiave della famiglia.
 * La foto non si salva da nessuna parte.
 */
import type { Riconosciuto } from '../dominio/fotoFrigo';
import { supabase } from './supabase';

export type ErroreFoto = 'quota' | 'chiave' | 'non_configurata' | 'rete' | 'gemini' | 'non_autorizzato';

async function base64(file: Blob): Promise<string> {
  const byte = new Uint8Array(await file.arrayBuffer());
  let s = '';
  for (let i = 0; i < byte.length; i += 0x8000) s += String.fromCharCode(...byte.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function riconosciFoto(famiglia_id: string, foto: Blob): Promise<{ alimenti: Riconosciuto[] } | { errore: ErroreFoto }> {
  if (!navigator.onLine) return { errore: 'rete' };
  try {
    const { data, error } = await supabase().functions.invoke('foto-frigo', { body: { famiglia_id, immagine: await base64(foto) } });
    if (error) {
      const risposta = (error as { context?: Response }).context;
      const corpo = risposta && typeof risposta.json === 'function' ? await risposta.json().catch(() => null) : null;
      const e = corpo?.errore as ErroreFoto | undefined;
      return { errore: e && ['quota', 'chiave', 'non_configurata', 'gemini', 'non_autorizzato'].includes(e) ? e : 'rete' };
    }
    return { alimenti: (data?.alimenti ?? []) as Riconosciuto[] };
  } catch {
    return { errore: 'rete' };
  }
}
