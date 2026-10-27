import { daOpenFoodFacts, type ProdottoEsterno } from '../dominio/scontrini';

/**
 * Chiede a Open Food Facts (banca dati libera e gratuita) nome e formato di un codice a barre.
 * Parte solo il numero del codice: niente account, niente dati della famiglia. Senza rete, o se
 * il servizio non risponde in pochi secondi, non propone nulla e si sceglie a mano.
 */
export async function cercaSuOpenFoodFacts(codice: string): Promise<ProdottoEsterno | undefined> {
  if (!/^\d{8,14}$/.test(codice) || !navigator.onLine) return undefined;
  const controllo = new AbortController();
  const timer = setTimeout(() => controllo.abort(), 5000);
  try {
    const r = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${codice}.json?fields=product_name,product_name_it,generic_name_it,brands,quantity,product_quantity,product_quantity_unit`,
      { signal: controllo.signal, credentials: 'omit', referrerPolicy: 'no-referrer' },
    );
    if (!r.ok) return undefined;
    return daOpenFoodFacts(await r.json());
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
