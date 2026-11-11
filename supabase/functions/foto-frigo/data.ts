/**
 * Leggere con Gemini la data di scadenza stampata su una confezione (foto in base64).
 * Modulo puro, senza API di Deno: lo usano la Edge Function (e la famiglia «solo su questo telefono») e i test.
 * Il risultato è una proposta: l'app la mette nel campo data e la persona la controlla.
 */
import { chiediGemini, MODELLI, type Parte } from './nucleo.ts';

export interface DataGemini {
  /** AAAA-MM-GG */
  data: string;
  /** «scadenza» (da consumarsi entro) o «tmc» (preferibilmente entro); null se non si capisce. */
  tipo: 'scadenza' | 'tmc' | null;
}

export const ISTRUZIONI_DATA = `Sei l'aiuto di un'app di cucina italiana. Nella foto c'è una confezione di un alimento (scatola, lattina, vasetto, tappo, busta) con una data di scadenza stampata, spesso a puntini o con inchiostro sbiadito, magari su metallo o plastica, un po' sfocata o storta.
Leggi la data di scadenza o il termine minimo di conservazione («da consumarsi entro», «da consumarsi preferibilmente entro», «scad.», «TMC», «EXP», «best before»).
- Sulle confezioni c'è spesso anche altro: la data di produzione, il lotto (es. L 5330 001 32, LR6128A), l'ora (14:54), codici e numeri. Non confonderli con la scadenza: se ci sono più date, la scadenza è di solito la più lontana nel tempo.
- Le stampe a puntini usano «.», «/», «:» o «-» tra giorno, mese e anno: sono la stessa cosa. Anno a due cifre = 20xx. Con solo mese e anno (es. 05/2030) vale l'ultimo giorno di quel mese.
- Rispondi con la data come AAAA-MM-GG e, se il testo lo dice, il tipo ("scadenza" per «da consumarsi entro», "tmc" per «preferibilmente entro»), altrimenti tipo null.
Non inventare: se la data non si legge davvero (cifre coperte, troppo sfocata) rispondi con data null.`;

export const SCHEMA_DATA = {
  type: 'OBJECT',
  properties: {
    data: { type: 'STRING', nullable: true },
    tipo: { type: 'STRING', enum: ['scadenza', 'tmc'], nullable: true },
  },
  required: ['data'],
};

/** Legge la risposta di Gemini: una data vera nel calendario e tra il 2000 e il 2100, altrimenti null. */
export function leggiDataGemini(testo: string): DataGemini | null {
  let d: { data?: unknown; tipo?: unknown };
  try {
    d = JSON.parse(testo);
  } catch {
    return null;
  }
  if (!d || typeof d.data !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.data.trim());
  if (!m) return null;
  const [anno, mese, giorno] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (anno < 2000 || anno > 2100 || mese < 1 || mese > 12 || giorno < 1 || giorno > new Date(Date.UTC(anno, mese, 0)).getUTCDate()) return null;
  return { data: `${m[1]}-${m[2]}-${m[3]}`, tipo: d.tipo === 'scadenza' || d.tipo === 'tmc' ? d.tipo : null };
}

/** Chiede a Gemini la data di scadenza. `data: null` se non si legge. */
export async function leggiDataDocumento(
  immagine: string,
  chiave: string,
  chiama: typeof fetch = fetch,
  modelli = MODELLI,
): Promise<{ data: DataGemini | null; modello: string } | { errore: 'quota' | 'chiave' | 'gemini'; dettaglio?: string }> {
  const parti: Parte[] = [{ inline_data: { mime_type: 'image/jpeg', data: immagine } }, { text: ISTRUZIONI_DATA }];
  const r = await chiediGemini(parti, SCHEMA_DATA, chiave, chiama, modelli, { preciso: true });
  if ('errore' in r) return r;
  return { data: leggiDataGemini(r.testo), modello: r.modello };
}
