/**
 * Riconoscere gli alimenti in una foto di frigo o dispensa con Gemini (chiave gratuita della famiglia).
 * Modulo puro, senza API di Deno: lo usa la Edge Function e lo provano i test.
 *
 * Il risultato è solo una proposta: l'app la mostra e in casa entra solo ciò che la persona conferma.
 */

/** Modelli gratuiti in ordine: la quota gratuita è per modello, a fine quota si passa al successivo. */
export const MODELLI = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-flash-lite-latest'];

export interface Riconosciuto {
  nome: string;
  quantita: number | null;
  unita: 'g' | 'ml' | 'pz' | null;
}

export type Esito = { alimenti: Riconosciuto[]; modello: string } | { errore: 'quota' | 'chiave' | 'gemini'; dettaglio?: string };

export const ISTRUZIONI = `Sei l'aiuto di un'app di cucina italiana. Nella foto c'è un frigo, un freezer o una dispensa.
Elenca gli alimenti che vedi con certezza. Per ognuno:
- nome: nome generico in italiano, al singolare e minuscolo, come lo cercheresti in un ricettario (es. "latte", "uova", "zucchina", "mozzarella", "prosciutto cotto"); niente marche;
- quantita e unita: quanto ce n'è, solo se si capisce dalla foto. "pz" per le cose che si contano (uova, zucchine, vasetti), "g" o "ml" per le confezioni con un peso o volume tipico (una bottiglia di latte da un litro = 1000 ml). Se non lo capisci, null.
Non inventare: se non sei sicuro di cosa sia, non metterlo. Ignora persone, documenti e oggetti che non sono cibo.`;

const SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      nome: { type: 'STRING' },
      quantita: { type: 'NUMBER', nullable: true },
      unita: { type: 'STRING', enum: ['g', 'ml', 'pz'], nullable: true },
    },
    required: ['nome'],
  },
};

/** Legge la risposta di Gemini e tiene solo righe sensate (nomi brevi, quantità positive, al più 40). */
export function leggiAlimenti(testo: string): Riconosciuto[] {
  let dati: unknown;
  try {
    dati = JSON.parse(testo);
  } catch {
    return [];
  }
  if (!Array.isArray(dati)) return [];
  const visti = new Set<string>();
  const esito: Riconosciuto[] = [];
  for (const x of dati) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    const nome = typeof r.nome === 'string' ? r.nome.trim().toLowerCase().slice(0, 60) : '';
    if (!nome || visti.has(nome)) continue;
    visti.add(nome);
    const unita = r.unita === 'g' || r.unita === 'ml' || r.unita === 'pz' ? r.unita : null;
    const q = typeof r.quantita === 'number' && Number.isFinite(r.quantita) && r.quantita > 0 && r.quantita < 100_000 ? r.quantita : null;
    esito.push({ nome, quantita: q !== null && unita ? q : null, unita: q !== null ? unita : null });
    if (esito.length >= 40) break;
  }
  return esito;
}

/** Chiede a Gemini, passando al modello dopo quando la quota gratuita di uno è finita. */
export async function riconosci(immagine: string, chiave: string, chiama: typeof fetch = fetch, modelli = MODELLI): Promise<Esito> {
  const corpo = JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: immagine } }, { text: ISTRUZIONI }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.1 },
  });
  for (const modello of modelli) {
    const r = await chiama(`https://generativelanguage.googleapis.com/v1beta/models/${modello}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': chiave },
      body: corpo,
    });
    if (r.status === 429 || r.status === 404) continue; // quota finita o modello non disponibile: il prossimo
    if (r.status === 400 || r.status === 401 || r.status === 403) {
      const testo = await r.text();
      if (/api key|API_KEY|permission/i.test(testo)) return { errore: 'chiave' };
      return { errore: 'gemini', dettaglio: testo.slice(0, 200) };
    }
    if (!r.ok) return { errore: 'gemini', dettaglio: `HTTP ${r.status}` };
    const json = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const testo = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    return { alimenti: leggiAlimenti(testo), modello };
  }
  return { errore: 'quota' };
}
