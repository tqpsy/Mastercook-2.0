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

export const ISTRUZIONI_RACCOLTA = `Sei l'aiuto di un'app di cucina italiana. Nel documento c'è il calendario della raccolta differenziata di un comune italiano: di solito un calendario annuale con un riquadro per ogni mese, dove ogni giorno porta un colore o un simbolo (spesso con una legenda a parte che dice quale colore o simbolo corrisponde a quale tipo). I tipi possibili: organico, carta e cartone, plastica e metalli (anche "multimateriale leggero"), vetro, indifferenziato (anche "secco" o "secco residuo").

Leggilo con questo metodo, con calma, mese per mese:
1. Primo giro: per ogni mese, guarda ogni giorno uno per uno e annota il colore o il simbolo che porta, e a quale tipo corrisponde secondo la legenda.
2. Secondo giro: per ogni mese, ricontrolla di aver guardato davvero tutti i giorni e tutti i colori o simboli diversi che compaiono nel calendario; se in un mese ne hai saltato uno, tornaci e leggilo.
3. Terzo giro: confronta i mesi fra loro, giorno della settimana per giorno della settimana (tutti i lunedì, tutti i martedì…). Se un giorno della settimana porta sempre lo stesso tipo in tutti i mesi, è uno schema fisso. Se invece cambia da un mese all'altro (una festività, un cambio di stagione), non è uno schema fisso.

Alla fine scrivi, solo per i tipi che hanno davvero uno schema fisso dopo il terzo giro, i giorni della settimana in cui passano sempre: 0 = domenica, 1 = lunedì, 2 = martedì, 3 = mercoledì, 4 = giovedì, 5 = venerdì, 6 = sabato.
- Se vetro e metalli vengono raccolti insieme, in un unico giorno, usa il tipo vetro per quel giorno.
- È meglio omettere un tipo che scriverlo sbagliato: mettilo solo se sei sicuro dello schema fisso.
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

/** Chiede a Gemini di leggere il calendario (PDF o immagine in base64): alla massima risoluzione, per distinguere bene colori e simboli piccoli. */
export async function leggiRaccoltaDocumento(
  dati: string,
  mime: string,
  chiave: string,
  chiama: typeof fetch = fetch,
  modelli = MODELLI,
): Promise<{ raccolta: RaccoltaLetta[]; modello: string } | { errore: 'quota' | 'chiave' | 'gemini' | 'illeggibile'; dettaglio?: string }> {
  const parti: Parte[] = [{ inline_data: { mime_type: mime, data: dati } }, { text: ISTRUZIONI_RACCOLTA }];
  const r = await chiediGemini(parti, SCHEMA_RACCOLTA, chiave, chiama, modelli, { preciso: true });
  if ('errore' in r) return r;
  const raccolta = leggiRaccoltaGemini(r.testo);
  return raccolta ? { raccolta, modello: r.modello } : { errore: 'illeggibile' };
}
