/**
 * Raccolta differenziata: i giorni della settimana in cui passa ogni tipo di raccolta, per ricordare
 * quando portare fuori i sacchetti. Si salva in famiglia.impostazioni.raccolta (comando imposta_raccolta):
 * per ogni tipo attivo, i giorni della settimana in cui passa (0 = domenica … 6 = sabato, come Date.getUTCDay()).
 */
import { piuGiorni } from './scadenze';

export type TipoRaccolta = 'organico' | 'carta' | 'plastica' | 'vetro' | 'indifferenziato';

export const TIPI_RACCOLTA: { valore: TipoRaccolta; nome: string; emoji: string }[] = [
  { valore: 'organico', nome: 'Organico', emoji: '🥬' },
  { valore: 'carta', nome: 'Carta e cartone', emoji: '📦' },
  { valore: 'plastica', nome: 'Plastica e metalli', emoji: '♻️' },
  { valore: 'vetro', nome: 'Vetro', emoji: '🍾' },
  { valore: 'indifferenziato', nome: 'Indifferenziato', emoji: '🗑️' },
];

const VALORI = TIPI_RACCOLTA.map((t) => t.valore);
const giornoValido = (g: unknown): g is number => typeof g === 'number' && Number.isInteger(g) && g >= 0 && g <= 6;

export type GiorniRaccolta = Partial<Record<TipoRaccolta, number[]>>;

/** I giorni salvati nelle impostazioni della famiglia: solo i tipi conosciuti, con giorni (0–6) validi e ordinati. */
export function raccoltaDa(impostazioni: unknown): GiorniRaccolta {
  const r = ((impostazioni ?? {}) as Record<string, unknown>).raccolta as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') return {};
  const risultato: GiorniRaccolta = {};
  for (const tipo of VALORI) {
    const v = r[tipo];
    if (!Array.isArray(v)) continue;
    const giorni = [...new Set(v.filter(giornoValido))].sort((a, b) => a - b);
    if (giorni.length > 0) risultato[tipo] = giorni;
  }
  return risultato;
}

export interface PromemoriaRaccolta {
  tipo: TipoRaccolta;
  /** Se passano oggi (da portare fuori la mattina) o domani (da preparare stasera). */
  quando: 'oggi' | 'domani';
}

/** Cosa portare fuori oggi, e cosa preparare stasera per domani: prima oggi, nell'ordine dei tipi. */
export function promemoriaRaccolta(giorni: GiorniRaccolta, data: string): PromemoriaRaccolta[] {
  const oggi = new Date(`${data}T00:00:00Z`).getUTCDay();
  const domani = new Date(`${piuGiorni(data, 1)}T00:00:00Z`).getUTCDay();
  const risultato: PromemoriaRaccolta[] = [];
  for (const tipo of VALORI) {
    const g = giorni[tipo];
    if (!g) continue;
    if (g.includes(oggi)) risultato.push({ tipo, quando: 'oggi' });
    else if (g.includes(domani)) risultato.push({ tipo, quando: 'domani' });
  }
  return risultato.sort((a, b) => (a.quando === b.quando ? 0 : a.quando === 'oggi' ? -1 : 1));
}
