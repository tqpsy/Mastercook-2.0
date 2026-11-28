/**
 * Leggere con Gemini il calendario della raccolta differenziata del proprio comune (PDF o foto): i giorni della
 * settimana di ogni tipo, solo quando è uno schema fisso che si ripete ogni settimana. Modulo puro, senza API di
 * Deno: lo usano la Edge Function, l'app per le famiglie tenute solo sul telefono e i test.
 *
 * Il risultato è solo una proposta: l'app la mostra nella griglia dei giorni (src/dominio/raccolta.ts) e la
 * persona la rivede, la corregge se serve, e solo allora la salva.
 */
import { chiediGemini, MODELLI, type Parte } from './nucleo.ts';

export const MIME_RACCOLTA = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const TIPI = ['organico', 'carta', 'plastica', 'vetro', 'indifferenziato'] as const;

export interface RaccoltaLetta {
  tipo: (typeof TIPI)[number];
  /** 0 = domenica … 6 = sabato. */
  giorni: number[];
}

export const ISTRUZIONI_RACCOLTA = `Sei l'aiuto di un'app di cucina italiana. Nel documento c'è il calendario della raccolta differenziata di un comune italiano, con i tipi: organico, carta e cartone, plastica e metalli (anche "multimateriale leggero"), vetro, indifferenziato (anche "secco" o "secco residuo").
Per ogni tipo che riconosci, scrivi i giorni della settimana in cui passa di solito: 0 = domenica, 1 = lunedì, 2 = martedì, 3 = mercoledì, 4 = giovedì, 5 = venerdì, 6 = sabato.
- Se vetro e metalli vengono raccolti insieme, in un unico giorno, usa il tipo vetro per quel giorno.
- Metti un tipo nel risultato solo se i suoi giorni sono uno schema fisso uguale ogni settimana. Se il calendario alterna settimane diverse, cambia con le festività o con la stagione (estate/inverno), o non riesci a capire uno schema fisso per quel tipo, non metterlo: è meglio ometterlo che sbagliare.
Non inventare nulla che non sia scritto nel documento.`;

const SCHEMA_RACCOLTA = {
  type: 'OBJECT',
  properties: {
    raccolta: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          tipo: { type: 'STRING', enum: [...TIPI] },
          giorni: { type: 'ARRAY', items: { type: 'INTEGER' } },
        },
        required: ['tipo', 'giorni'],
      },
    },
  },
  required: ['raccolta'],
};

const giornoValido = (g: unknown): g is number => typeof g === 'number' && Number.isInteger(g) && g >= 0 && g <= 6;

/** Legge la risposta di Gemini: solo tipi conosciuti (una volta ciascuno) con giorni (0–6) validi. Nessuno schema fisso trovato → elenco vuoto. */
export function leggiRaccoltaGemini(testo: string): RaccoltaLetta[] | null {
  let d: { raccolta?: unknown };
  try {
    d = JSON.parse(testo);
  } catch {
    return null;
  }
  if (!d || !Array.isArray(d.raccolta)) return null;
  const risultato: RaccoltaLetta[] = [];
  for (const x of d.raccolta) {
    const r = (x ?? {}) as Record<string, unknown>;
    if (!TIPI.includes(r.tipo as never) || risultato.some((y) => y.tipo === r.tipo)) continue;
    const giorni = [...new Set((Array.isArray(r.giorni) ? r.giorni : []).filter(giornoValido))].sort((a, b) => a - b);
    if (giorni.length) risultato.push({ tipo: r.tipo as RaccoltaLetta['tipo'], giorni });
  }
  return risultato;
}

/** Chiede a Gemini di leggere il calendario (PDF o immagine in base64). */
export async function leggiRaccoltaDocumento(
  dati: string,
  mime: string,
  chiave: string,
  chiama: typeof fetch = fetch,
  modelli = MODELLI,
): Promise<{ raccolta: RaccoltaLetta[]; modello: string } | { errore: 'quota' | 'chiave' | 'gemini' | 'illeggibile'; dettaglio?: string }> {
  const parti: Parte[] = [{ inline_data: { mime_type: mime, data: dati } }, { text: ISTRUZIONI_RACCOLTA }];
  const r = await chiediGemini(parti, SCHEMA_RACCOLTA, chiave, chiama, modelli);
  if ('errore' in r) return r;
  const raccolta = leggiRaccoltaGemini(r.testo);
  return raccolta ? { raccolta, modello: r.modello } : { errore: 'illeggibile' };
}
