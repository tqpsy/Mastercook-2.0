// Edge Function «foto-frigo»: riceve una foto (JPEG in base64) da un membro della famiglia e restituisce
// gli alimenti che Gemini riconosce. La chiave Gemini è quella della famiglia (scritta nelle Impostazioni) oppure,
// per le famiglie di chi gestisce l'app, il segreto del progetto (GEMINI_API_KEY): non arriva mai sui telefoni.
// La foto non si salva: passa a Google e basta.
// Con `tipo: 'piano'` legge invece il piano del nutrizionista (PDF o foto in `documento`, tipo in `mime`).
// Con `lettura_id` (foto singola) risponde subito 202 e lavora in background: il risultato si legge con `leggi_lettura_foto`.
// Con `tipo: 'verifica'` guarda una zona (fino a 4 foto in `immagini`) e la confronta con il `contesto` mandato dall'app.
// Con anche `flusso: true` risponde una riga JSON alla volta: {"visti": [...]} man mano, poi {"fine": true, "visti", "modello"}
// oppure {"errore"}: l'app mostra gli alimenti mentre Gemini li trova. Vale anche per la foto singola (stesse righe, `visti` = alimenti).
import { MAX_FOTO_VERIFICA, riconosci, riconosciZona, testoContesto, testoFrigo } from './nucleo.ts';
import { leggiPianoDocumento, MIME_PIANO } from './piano.ts';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

/** Intestazioni per chiamare il database come servizio: chiave segreta nuova (sb_secret_…) o service_role di prima. */
function accessoServizio(): Record<string, string> {
  try {
    const segrete = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
    const chiave = segrete.default ?? Object.values(segrete)[0];
    if (chiave) return { apikey: chiave };
  } catch {
    // Formato inatteso: si prova la chiave di prima.
  }
  const vecchia = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return { apikey: vecchia, authorization: `Bearer ${vecchia}` };
}

const rispondi = (stato: number, dati: unknown) => new Response(JSON.stringify(dati), { status: stato, headers: { ...CORS, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return rispondi(405, { errore: 'metodo' });
  let d: { lettura_id?: string; famiglia_id?: string; immagine?: string; frigo?: unknown; tipo?: string; documento?: string; mime?: string; immagini?: unknown; contesto?: unknown; flusso?: unknown };
  try {
    d = await req.json();
  } catch {
    return rispondi(400, { errore: 'dati_non_validi' });
  }
  const piano = d.tipo === 'piano';
  const verifica = d.tipo === 'verifica';
  const immagini = verifica && Array.isArray(d.immagini) ? d.immagini : [];
  const fileValido = piano
    ? typeof d.documento === 'string' && d.documento.length <= 8_000_000 && MIME_PIANO.includes(d.mime ?? '')
    : verifica
      ? immagini.length >= 1 && immagini.length <= MAX_FOTO_VERIFICA && immagini.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 2_000_000)
      : typeof d.immagine === 'string' && d.immagine.length <= 2_000_000;
  if (!d.famiglia_id || !/^[0-9a-f-]{36}$/.test(d.famiglia_id) || !fileValido) {
    return rispondi(400, { errore: 'dati_non_validi' });
  }

  // Solo chi fa parte della famiglia: la famiglia si legge con il suo accesso (RLS), come nell'app.
  // La chiave pubblica arriva dall'app con la richiesta; il token dell'utente lo verifica il database.
  const url = Deno.env.get('SUPABASE_URL')!;
  const pubblica = req.headers.get('apikey') || Deno.env.get('SUPABASE_ANON_KEY') || '';
  // I due controlli non dipendono l'uno dall'altro: partono insieme (un viaggio di rete in meno).
  const [famiglia, r] = await Promise.all([
    fetch(`${url}/rest/v1/famiglia?select=id&id=eq.${d.famiglia_id}`, {
      headers: { apikey: pubblica, authorization: req.headers.get('authorization') ?? '' },
    }),
    // La chiave si legge con la chiave segreta del progetto: i telefoni non possono rileggerla.
    fetch(`${url}/rest/v1/rpc/chiave_gemini_per_foto`, {
      method: 'POST',
      headers: { ...accessoServizio(), 'content-type': 'application/json' },
      body: JSON.stringify({ p_famiglia: d.famiglia_id }),
    }),
  ]);
  const righe = famiglia.ok ? ((await famiglia.json()) as unknown[]) : [];
  if (!righe.length) return rispondi(403, { errore: 'non_autorizzato' });

  const scelta = r.ok ? ((await r.json()) as { chiave: string | null; condivisa: boolean }) : { chiave: null, condivisa: false };
  const chiave = scelta.chiave ?? (scelta.condivisa ? Deno.env.get('GEMINI_API_KEY') : undefined);
  if (!chiave) return rispondi(503, { errore: 'non_configurata' });

  // Lettura in background: la funzione risponde subito e finisce il lavoro da sola, anche con l'app in tasca.
  // L'app, tornata in primo piano, chiede com'è andata con `leggi_lettura_foto`. Lo stesso id non parte due volte.
  if (!piano && !verifica && typeof d.lettura_id === 'string' && /^[0-9a-f-]{36}$/.test(d.lettura_id)) {
    const rpc = (nome: string, corpo: unknown) =>
      fetch(`${url}/rest/v1/rpc/${nome}`, { method: 'POST', headers: { ...accessoServizio(), 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
    const nuova = await rpc('nuova_lettura_foto', { p_id: d.lettura_id, p_famiglia: d.famiglia_id });
    if (!nuova.ok) return rispondi(502, { errore: 'gemini', dettaglio: 'lettura non avviata' });
    if ((await nuova.json()) === true) {
      const id = d.lettura_id;
      const lavoro = (async () => {
        let stato = 'errore';
        let risultato: unknown = { errore: 'gemini', dettaglio: 'risposta interrotta' };
        try {
          const esito = await riconosci(d.immagine!, chiave, fetch, undefined, testoFrigo(d.frigo));
          if ('errore' in esito) risultato = { errore: esito.errore, ...(esito.dettaglio ? { dettaglio: esito.dettaglio } : {}) };
          else [stato, risultato] = ['pronta', { alimenti: esito.alimenti, modello: esito.modello }];
        } catch {
          // resta l'errore «risposta interrotta»
        }
        await rpc('chiudi_lettura_foto', { p_id: id, p_stato: stato, p_risultato: risultato }).catch(() => {});
      })();
      // Il lavoro continua dopo la risposta (EdgeRuntime esiste solo sul server di Supabase).
      (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(lavoro);
    }
    return rispondi(202, { lettura_id: d.lettura_id });
  }

  if ((verifica || !piano) && d.flusso === true) {
    const cod = new TextEncoder();
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const scrivi = writable.getWriter();
    const riga = (x: unknown) => scrivi.write(cod.encode(`${JSON.stringify(x)}\n`)).catch(() => {});
    (async () => {
      try {
        const esito = verifica
          ? await riconosciZona(immagini as string[], chiave, testoContesto(d.contesto), fetch, undefined, (visti) => void riga({ visti }))
          : await riconosci(d.immagine!, chiave, fetch, undefined, testoFrigo(d.frigo), (visti) => void riga({ visti }));
        if (!verifica && !('errore' in esito)) return void (await riga({ fine: true, visti: (esito as { alimenti: unknown[] }).alimenti, modello: esito.modello }));
        await riga('errore' in esito ? esito : { fine: true, ...esito });
      } catch {
        await riga({ errore: 'gemini', dettaglio: 'risposta interrotta' });
      }
      await scrivi.close().catch(() => {});
    })();
    return new Response(readable, { headers: { ...CORS, 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' } });
  }

  const esito = piano
    ? await leggiPianoDocumento(d.documento!, d.mime!, chiave)
    : verifica
      ? await riconosciZona(immagini as string[], chiave, testoContesto(d.contesto))
      : await riconosci(d.immagine!, chiave, fetch, undefined, testoFrigo(d.frigo));
  return rispondi('errore' in esito ? (esito.errore === 'quota' ? 429 : 502) : 200, esito);
});
