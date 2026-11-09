/**
 * Riconoscere gli alimenti in una foto di frigo o dispensa con Gemini (chiave gratuita della famiglia).
 * Modulo puro, senza API di Deno: lo usa la Edge Function e lo provano i test.
 *
 * Il risultato è solo una proposta: l'app la mostra e in casa entra solo ciò che la persona conferma.
 */

/**
 * Modelli gratuiti in ordine: la quota gratuita è per modello, a fine quota (o se un modello non è disponibile
 * per questa chiave) si passa al successivo. Da ottobre 2026 Google dà i modelli 2.5 solo a chi li usava già:
 * con una chiave nuova rispondono «non disponibile», quindi vengono per ultimi.
 */
export const MODELLI = [
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

/** La chiave stessa è sbagliata, scaduta o bloccata (non solo il modello che non va per lei). */
const CHIAVE_SBAGLIATA = /API_KEY_INVALID|API key not valid|API key expired|API_KEY_SERVICE_BLOCKED|API key.*(leaked|revoked|blocked)|has been suspended|CONSUMER_SUSPENDED/i;

export interface Riconosciuto {
  nome: string;
  quantita: number | null;
  unita: 'g' | 'ml' | 'pz' | null;
  /** In quale parte del frigo l'ha visto (r1, s2, c1, f3…), solo se la famiglia ha configurato il frigo. */
  posto?: string | null;
}

export type Esito = { alimenti: Riconosciuto[]; modello: string } | { errore: 'quota' | 'chiave' | 'gemini'; dettaglio?: string };

export const ISTRUZIONI = `Sei l'aiuto di un'app di cucina italiana. Nella foto c'è un frigo, un freezer o una dispensa.
Guarda la foto con calma, parte per parte (ripiani, cassetti, porta, confezioni dietro o in parte coperte) e leggi le etichette visibili: elenca TUTTI gli alimenti che si riconoscono, senza fermarti ai primi e senza saltare quelli piccoli.
Distingui i prodotti simili (latte e panna, yogurt e formaggio fresco, burro e margarina, passata e polpa) dall'etichetta o dall'aspetto: se non si capisce quale sia, non scegliere a caso e non metterlo. Elenca una sola volta lo stesso alimento. Per ognuno:
- nome: nome generico in italiano, al singolare e minuscolo, come lo cercheresti in un ricettario (es. "latte", "uova", "zucchina", "mozzarella", "prosciutto cotto"); niente marche;
- quantita e unita: quanto ce n'è, contando con attenzione ciò che si vede (uova nella scatola, vasetti, bottiglie), solo se si capisce dalla foto. "pz" per le cose che si contano (uova, zucchine, vasetti), "g" o "ml" per le confezioni con un peso o volume tipico (una bottiglia di latte da un litro = 1000 ml). Se non lo capisci, null.
Non inventare: se non sei sicuro di cosa sia, non metterlo. Ignora persone, documenti e oggetti che non sono cibo.`;

const SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      nome: { type: 'STRING' },
      quantita: { type: 'NUMBER', nullable: true },
      unita: { type: 'STRING', enum: ['g', 'ml', 'pz'], nullable: true },
      posto: { type: 'STRING', nullable: true },
    },
    required: ['nome'],
  },
};

/** Il messaggio d'errore di Google, breve: si mostra in app per capire cosa non va. Mai la chiave. */
export function messaggioGoogle(testo: string): string {
  let m = testo;
  try {
    const j = JSON.parse(testo) as { error?: { message?: string; status?: string } };
    if (j.error?.message) m = `${j.error.status ? `${j.error.status}: ` : ''}${j.error.message}`;
  } catch {
    // non è JSON: si tiene il testo
  }
  return m.replace(/AIza[0-9A-Za-z_-]+/g, '…').replace(/\s+/g, ' ').trim().slice(0, 200);
}

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
    const posto = typeof r.posto === 'string' && /^[rcsf][1-9]$/.test(r.posto) ? r.posto : null;
    esito.push({ nome, quantita: q !== null && unita ? q : null, unita: q !== null ? unita : null, ...(posto ? { posto } : {}) });
    if (esito.length >= 40) break;
  }
  return esito;
}

/** La descrizione del frigo della famiglia (src/dominio/frigo.ts, descriviPerFoto): solo testo, breve. */
export function testoFrigo(frigo: unknown): string | null {
  return typeof frigo === 'string' && frigo.trim() ? frigo.slice(0, 1500) : null;
}

/** Una parte della richiesta a Gemini: un file (in base64) o del testo. */
export type Parte = { inline_data: { mime_type: string; data: string } } | { text: string };

/** Opzioni di una richiesta: `preciso` guarda le foto alla massima risoluzione, `suTesto` riceve la risposta man mano. */
export interface OpzioniGemini {
  /** Per riconoscere esattamente: foto alla massima risoluzione e ragionamento libero (la risposta è più lenta). */
  preciso?: boolean;
  /** Con questa funzione la risposta arriva a pezzi (streaming): riceve tutto il testo arrivato finora. */
  suTesto?: (finora: string) => void;
}

/** Il testo di un pezzo della risposta di Gemini. */
function testoDi(json: unknown): string {
  const j = json as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
  return j.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('') ?? '';
}

/** Legge una risposta in streaming (righe «data: {…}») e passa il testo man mano. */
async function leggiFlusso(r: Response, suTesto: (finora: string) => void): Promise<string> {
  let testo = '';
  let resto = '';
  const riga = (l: string) => {
    const t = l.trim();
    if (!t.startsWith('data:')) return;
    try {
      const pezzo = testoDi(JSON.parse(t.slice(5)));
      if (pezzo) {
        testo += pezzo;
        suTesto(testo);
      }
    } catch {
      // riga incompleta o non JSON: si ignora
    }
  };
  if (!r.body) {
    for (const l of (await r.text()).split('\n')) riga(l);
    return testo;
  }
  const lettore = r.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { value, done } = await lettore.read();
    if (done) break;
    resto += dec.decode(value, { stream: true });
    const righe = resto.split('\n');
    resto = righe.pop() ?? '';
    righe.forEach(riga);
  }
  riga(resto);
  return testo;
}

/** Il modello che ha risposto per ultimo: per qualche minuto si riparte da lui, senza ritentare quelli senza quota. */
let ultimoBuono: { modello: string; quando: number } | null = null;
const DURATA_MEMORIA_MS = 10 * 60 * 1000;

function ordineModelli(modelli: string[]): string[] {
  if (modelli !== MODELLI || !ultimoBuono || Date.now() - ultimoBuono.quando > DURATA_MEMORIA_MS) return modelli;
  return [ultimoBuono.modello, ...modelli.filter((m) => m !== ultimoBuono!.modello)];
}

/**
 * Chiede a Gemini una risposta JSON con lo schema dato, passando al modello dopo quando la quota gratuita di uno
 * è finita o il modello non è disponibile per questa chiave.
 */
export async function chiediGemini(
  parti: Parte[],
  schema: unknown,
  chiave: string,
  chiama: typeof fetch = fetch,
  modelli = MODELLI,
  opzioni: OpzioniGemini = {},
): Promise<{ testo: string; modello: string } | { errore: 'quota' | 'chiave' | 'gemini'; dettaglio?: string }> {
  const corpo = (preciso: boolean) =>
    JSON.stringify({
      contents: [{ parts: parti }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0.1,
        ...(preciso ? { mediaResolution: 'MEDIA_RESOLUTION_HIGH' } : {}),
      },
    });
  const metodo = opzioni.suTesto ? 'streamGenerateContent?alt=sse' : 'generateContent';
  let quota = false;
  let ultimo = '';
  for (const modello of ordineModelli(modelli)) {
    const manda = (preciso: boolean) =>
      chiama(`https://generativelanguage.googleapis.com/v1beta/models/${modello}:${metodo}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': chiave },
        body: corpo(preciso),
      });
    let r = await manda(!!opzioni.preciso);
    if (r.status === 400 && opzioni.preciso) {
      // Un modello che non accetta la risoluzione richiesta: si riprova com'era prima.
      const testo = await r.clone().text().catch(() => '');
      if (/media|resolution/i.test(testo)) r = await manda(false);
    }
    if (r.status === 429) {
      quota = true; // quota di questo modello finita: il prossimo
      continue;
    }
    if (!r.ok) {
      const testo = await r.text().catch(() => '');
      if ((r.status === 400 || r.status === 401 || r.status === 403) && CHIAVE_SBAGLIATA.test(testo)) return { errore: 'chiave', dettaglio: messaggioGoogle(testo) };
      // Modello sparito, non dato a questa chiave o momentaneamente giù: si prova il prossimo.
      ultimo = `${modello}: ${r.status} ${messaggioGoogle(testo)}`;
      continue;
    }
    if (modelli === MODELLI) ultimoBuono = { modello, quando: Date.now() };
    if (opzioni.suTesto) return { testo: await leggiFlusso(r, opzioni.suTesto), modello };
    return { testo: testoDi(await r.json()), modello };
  }
  return quota ? { errore: 'quota', ...(ultimo ? { dettaglio: ultimo } : {}) } : { errore: 'gemini', dettaglio: ultimo };
}

/**
 * Gli oggetti già completi di un array JSON che sta ancora arrivando (`[{…}, {…}, {…` → i primi due).
 * Serve a mostrare gli alimenti riconosciuti man mano, prima che Gemini abbia finito.
 */
export function oggettiCompleti(testo: string): unknown[] {
  const esito: unknown[] = [];
  let profondita = 0;
  let inStringa = false;
  let escape = false;
  let inizio = -1;
  for (let i = 0; i < testo.length; i++) {
    const c = testo[i];
    if (inStringa) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inStringa = false;
      continue;
    }
    if (c === '"') inStringa = true;
    else if (c === '{' || c === '[') {
      if (c === '{' && profondita === 1) inizio = i;
      profondita++;
    } else if (c === '}' || c === ']') {
      profondita--;
      if (c === '}' && profondita === 1 && inizio >= 0) {
        try {
          esito.push(JSON.parse(testo.slice(inizio, i + 1)));
        } catch {
          // oggetto rotto: si salta
        }
        inizio = -1;
      }
    }
  }
  return esito;
}

/**
 * Riconosce gli alimenti nella foto. Con il frigo descritto, Gemini dice anche in quale parte vede ogni alimento.
 */
export async function riconosci(
  immagine: string,
  chiave: string,
  chiama: typeof fetch = fetch,
  modelli = MODELLI,
  frigo: string | null = null,
  suAlimenti?: (finora: Riconosciuto[]) => void,
): Promise<Esito> {
  const parti: Parte[] = [{ inline_data: { mime_type: 'image/jpeg', data: immagine } }, { text: frigo ? `${ISTRUZIONI}\n\n${frigo}` : ISTRUZIONI }];
  let quanti = 0;
  const suTesto = suAlimenti
    ? (finora: string) => {
        const alimenti = leggiAlimenti(JSON.stringify(oggettiCompleti(finora)));
        if (alimenti.length === quanti) return;
        quanti = alimenti.length;
        suAlimenti(alimenti);
      }
    : undefined;
  const r = await chiediGemini(parti, SCHEMA, chiave, chiama, modelli, { preciso: true, suTesto });
  return 'errore' in r ? r : { alimenti: leggiAlimenti(r.testo), modello: r.modello };
}

// ───────────────────────── Verifica dell'inventario ─────────────────────────

export const MAX_FOTO_VERIFICA = 4;

export const ISTRUZIONI_VERIFICA = `Sei l'aiuto di un'app di cucina italiana. La famiglia controlla se ciò che ha registrato in casa corrisponde a ciò che c'è davvero.
Nelle foto c'è una zona del frigo, del freezer o della dispensa. Elenca gli alimenti che vedi. Per ognuno:
- nome: nome generico in italiano, al singolare e minuscolo (es. "latte", "uova", "zucchina"); niente marche;
- codice: se è uno dei prodotti registrati elencati sotto, il suo codice (es. "p3"); altrimenti null. Non dare un codice solo perché il prodotto è nell'elenco o nel menu: deve vedersi nella foto;
- quantita e unita: quanto se ne vede, solo se si capisce ("pz" per ciò che si conta, "g" o "ml" per confezioni con peso o volume tipico); altrimenti null;
- certezza: "sicuro" se lo riconosci senza dubbi, "probabile" se è molto verosimile, "incerto" se è solo un'ipotesi (confezione chiusa, coperta, poco visibile);
- foto e riquadro: in quale foto lo vedi meglio (1 = la prima) e dove, come [ymin, xmin, ymax, xmax] da 0 a 1000.
Elenca gli alimenti nell'ordine in cui li trovi, da sinistra a destra e dall'alto in basso. Non inventare. Ignora persone, documenti e oggetti che non sono cibo.`;

const SCHEMA_VERIFICA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      nome: { type: 'STRING' },
      codice: { type: 'STRING', nullable: true },
      quantita: { type: 'NUMBER', nullable: true },
      unita: { type: 'STRING', enum: ['g', 'ml', 'pz'], nullable: true },
      certezza: { type: 'STRING', enum: ['sicuro', 'probabile', 'incerto'] },
      foto: { type: 'INTEGER', nullable: true },
      riquadro: { type: 'ARRAY', items: { type: 'NUMBER' }, nullable: true },
    },
    required: ['nome', 'certezza'],
  },
};

export interface VistoInZona {
  nome: string;
  codice: string | null;
  quantita: number | null;
  unita: 'g' | 'ml' | 'pz' | null;
  certezza: 'sicuro' | 'probabile' | 'incerto';
  /** Solo per mostrare dove l'ha visto mentre guarda: la foto (da 0) e il riquadro [ymin, xmin, ymax, xmax] da 0 a 1000. */
  foto?: number;
  riquadro?: [number, number, number, number];
}

/** Il riquadro di Gemini, se ha senso: quattro numeri tra 0 e 1000, con l'alto sopra il basso e la sinistra prima della destra. */
function riquadroValido(x: unknown): [number, number, number, number] | null {
  if (!Array.isArray(x) || x.length !== 4 || !x.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000)) return null;
  const [y0, x0, y1, x1] = x as number[];
  return y1 > y0 && x1 > x0 ? [y0, x0, y1, x1] : null;
}

/** Legge la risposta della verifica: righe sensate, al più 60; certezza sconosciuta = incerto. Accetta anche una risposta a metà. */
export function leggiVisti(testo: string, aMeta = false): VistoInZona[] {
  let dati: unknown[] = [];
  try {
    const j = JSON.parse(testo);
    if (Array.isArray(j)) dati = j;
  } catch {
    if (!aMeta) return [];
    dati = oggettiCompleti(testo);
  }
  const base = leggiAlimenti(JSON.stringify(dati));
  const perNome = new Map<string, Record<string, unknown>>();
  for (const x of dati) if (x && typeof x === 'object' && typeof (x as { nome?: unknown }).nome === 'string') {
    const k = ((x as { nome: string }).nome).trim().toLowerCase().slice(0, 60);
    if (!perNome.has(k)) perNome.set(k, x as Record<string, unknown>);
  }
  return base.map((a) => {
    const r = perNome.get(a.nome) ?? {};
    const certezza = r.certezza === 'sicuro' || r.certezza === 'probabile' ? r.certezza : 'incerto';
    const codice = typeof r.codice === 'string' && /^p\d{1,3}$/.test(r.codice) ? r.codice : null;
    const riquadro = riquadroValido(r.riquadro);
    const foto = typeof r.foto === 'number' && Number.isInteger(r.foto) && r.foto >= 1 && r.foto <= MAX_FOTO_VERIFICA ? r.foto - 1 : 0;
    return { nome: a.nome, codice, quantita: a.quantita, unita: a.unita, certezza, ...(riquadro ? { foto, riquadro } : {}) };
  });
}

/** Il testo che l'app manda con le foto (src/dominio/verifica.ts, contestoPerGemini): solo testo, breve. */
export function testoContesto(x: unknown): string | null {
  return typeof x === 'string' && x.trim() ? x.slice(0, 6000) : null;
}

/**
 * Riconosce gli alimenti in una zona: più foto della stessa zona insieme, con il contesto della famiglia.
 * Con `suVisti` la risposta arriva man mano e riceve ogni volta tutti gli alimenti trovati finora.
 */
export async function riconosciZona(
  immagini: string[],
  chiave: string,
  contesto: string | null,
  chiama: typeof fetch = fetch,
  modelli = MODELLI,
  suVisti?: (finora: VistoInZona[]) => void,
): Promise<{ visti: VistoInZona[]; modello: string } | { errore: 'quota' | 'chiave' | 'gemini'; dettaglio?: string }> {
  const parti: Parte[] = [
    ...immagini.slice(0, MAX_FOTO_VERIFICA).map((data) => ({ inline_data: { mime_type: 'image/jpeg', data } })),
    { text: contesto ? `${ISTRUZIONI_VERIFICA}\n\n${contesto}` : ISTRUZIONI_VERIFICA },
  ];
  let quanti = 0;
  const suTesto = suVisti
    ? (finora: string) => {
        const visti = leggiVisti(finora, true);
        if (visti.length === quanti) return;
        quanti = visti.length;
        suVisti(visti);
      }
    : undefined;
  const r = await chiediGemini(parti, SCHEMA_VERIFICA, chiave, chiama, modelli, { preciso: true, suTesto });
  return 'errore' in r ? r : { visti: leggiVisti(r.testo, true), modello: r.modello };
}
