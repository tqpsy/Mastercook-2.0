// Edge Function «foto-frigo»: riceve una foto (JPEG in base64) da un membro della famiglia e restituisce
// gli alimenti che Gemini riconosce. La chiave Gemini è un segreto del server (GEMINI_API_KEY): non arriva
// mai sui telefoni. La foto non si salva: passa a Google e basta.
import { riconosci } from './nucleo.ts';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const rispondi = (stato: number, dati: unknown) => new Response(JSON.stringify(dati), { status: stato, headers: { ...CORS, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return rispondi(405, { errore: 'metodo' });
  const chiave = Deno.env.get('GEMINI_API_KEY');
  if (!chiave) return rispondi(503, { errore: 'non_configurata' });

  let d: { famiglia_id?: string; immagine?: string };
  try {
    d = await req.json();
  } catch {
    return rispondi(400, { errore: 'dati_non_validi' });
  }
  if (!d.famiglia_id || !/^[0-9a-f-]{36}$/.test(d.famiglia_id) || typeof d.immagine !== 'string' || d.immagine.length > 2_000_000) {
    return rispondi(400, { errore: 'dati_non_validi' });
  }

  // Solo chi fa parte della famiglia: la famiglia si legge con il suo accesso (RLS), come nell'app.
  // La chiave pubblica arriva dall'app con la richiesta; il token dell'utente lo verifica il database.
  const url = Deno.env.get('SUPABASE_URL')!;
  const pubblica = req.headers.get('apikey') || Deno.env.get('SUPABASE_ANON_KEY') || '';
  const famiglia = await fetch(`${url}/rest/v1/famiglia?select=id&id=eq.${d.famiglia_id}`, {
    headers: { apikey: pubblica, authorization: req.headers.get('authorization') ?? '' },
  });
  const righe = famiglia.ok ? ((await famiglia.json()) as unknown[]) : [];
  if (!righe.length) return rispondi(403, { errore: 'non_autorizzato' });

  const esito = await riconosci(d.immagine, chiave);
  return rispondi('errore' in esito ? (esito.errore === 'quota' ? 429 : 502) : 200, esito);
});
