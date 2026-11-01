import { daOpenFoodFacts, type ProdottoEsterno } from '../dominio/scontrini';
import { CAMPI_OFF, type SchedaProdotto, schedaDaOpenFoodFacts } from '../dominio/schedaProdotto';

export interface RispostaOff {
  esterno?: ProdottoEsterno;
  scheda?: SchedaProdotto;
}

/** Una sola richiesta per codice finché l'app resta aperta: la scheda si riapre senza aspettare. */
const giaChiesti = new Map<string, Promise<RispostaOff | undefined>>();

/**
 * Chiede a Open Food Facts (banca dati libera e gratuita, API v3) nome, formato, valori nutrizionali
 * e ingredienti di un codice a barre. Parte solo il numero del codice: niente account, niente dati
 * della famiglia. Senza rete, o se il servizio non risponde in pochi secondi, non propone nulla.
 */
export function chiediAOpenFoodFacts(codice: string): Promise<RispostaOff | undefined> {
  if (!/^\d{8,14}$/.test(codice) || !navigator.onLine) return Promise.resolve(undefined);
  let p = giaChiesti.get(codice);
  if (!p) {
    p = scarica(codice);
    giaChiesti.set(codice, p);
    // Un tentativo fallito (rete, servizio lento) si può rifare alla prossima apertura.
    void p.then((x) => x === undefined && giaChiesti.delete(codice));
  }
  return p;
}

async function scarica(codice: string): Promise<RispostaOff | undefined> {
  const controllo = new AbortController();
  const timer = setTimeout(() => controllo.abort(), 8000);
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v3/product/${codice}?fields=${CAMPI_OFF.join(',')}`, {
      signal: controllo.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    // 404 = prodotto che la banca dati non conosce: risposta valida, solo vuota.
    if (r.status === 404) return {};
    if (!r.ok) return undefined;
    const json: unknown = await r.json();
    const esterno = daOpenFoodFacts(json);
    const scheda = schedaDaOpenFoodFacts(json);
    return { ...(esterno ? { esterno } : {}), ...(scheda ? { scheda } : {}) };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Solo nome e formato, per proporre l'ingrediente di un codice nuovo. */
export async function cercaSuOpenFoodFacts(codice: string): Promise<ProdottoEsterno | undefined> {
  return (await chiediAOpenFoodFacts(codice))?.esterno;
}
