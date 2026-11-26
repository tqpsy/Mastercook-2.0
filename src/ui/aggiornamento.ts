/**
 * «Aggiorna l'app»: chiede subito al server se c'è una versione nuova e, se c'è, la installa e ricarica.
 * Senza questo tasto la versione nuova arriva solo chiudendo e riaprendo del tutto l'app.
 *
 * Attenzione: l'app si aggiorna da sola (autoUpdate, con skipWaiting e clientsClaim). Ogni volta che si apre, il browser
 * controlla il service worker e, se ce n'è uno nuovo, lo installa e lo attiva in pochi secondi; la pagina però resta
 * quella vecchia finché non si ricarica. Quando poi si preme il tasto, `update()` non trova più niente di nuovo
 * (il nuovo è già attivo): per questo si confronta anche la versione della pagina con quella pubblicata.
 */

export type EsitoAggiornamento = 'aggiornata' | 'gia_ultima' | 'senza_rete';

/** Quando è stata preparata la versione che si sta usando (scritta durante la costruzione dell'app). */
export const COSTRUITA_IL: string = typeof __COSTRUITA_IL__ === 'string' ? __COSTRUITA_IL__ : '';

/** Indirizzo del file con la data della versione pubblicata (scritto da vite.config.ts, fuori dalla cache del service worker). */
const FILE_VERSIONE = 'versione.json';

/** Un service worker nuovo ha preso il controllo di questa pagina dopo che si è aperta: la pagina è rimasta indietro. */
let controlloCambiato = false;
if (typeof navigator !== 'undefined' && navigator.serviceWorker?.addEventListener) {
  const iniziale = navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // La prima installazione prende il controllo di una pagina che non ne aveva: quella non è una versione nuova.
    if (iniziale) controlloCambiato = true;
  });
}

/** Aspetta che il service worker nuovo prenda il posto del vecchio (al massimo `attesa` ms). */
function attivato(sw: ServiceWorker, attesa: number): Promise<void> {
  return new Promise((risolvi) => {
    if (sw.state === 'activated' || sw.state === 'redundant') return risolvi();
    const fine = setTimeout(risolvi, attesa);
    sw.addEventListener('statechange', () => {
      if (sw.state === 'activated' || sw.state === 'redundant') {
        clearTimeout(fine);
        risolvi();
      }
    });
  });
}

/** Data della versione pubblicata sul sito, chiesta al server senza passare da nessuna cache; null se non si sa. */
async function versionePubblicata(): Promise<string | null> {
  try {
    const risposta = await fetch(`${import.meta.env.BASE_URL}${FILE_VERSIONE}?t=${Date.now()}`, { cache: 'no-store' });
    if (!risposta.ok) return null;
    const dati = (await risposta.json()) as { costruita_il?: unknown };
    return typeof dati.costruita_il === 'string' ? dati.costruita_il : null;
  } catch {
    return null;
  }
}

/** La pagina aperta è più vecchia di quella pubblicata (o di quella che il service worker ha già preso). */
async function paginaIndietro(): Promise<boolean> {
  if (controlloCambiato) return true;
  if (!COSTRUITA_IL) return false;
  const pubblicata = await versionePubblicata();
  return pubblicata !== null && pubblicata !== COSTRUITA_IL;
}

export async function cercaAggiornamento(ricarica: () => void = () => location.reload()): Promise<EsitoAggiornamento> {
  if (!('serviceWorker' in navigator)) {
    ricarica();
    return 'aggiornata';
  }
  const registrazione = await navigator.serviceWorker.getRegistration();
  if (!registrazione) {
    ricarica();
    return 'aggiornata';
  }
  try {
    await registrazione.update();
  } catch {
    if (!navigator.onLine) return 'senza_rete';
    // Il controllo del service worker non è riuscito, ma la pagina può essere comunque rimasta indietro.
    if (!(await paginaIndietro())) return 'gia_ultima';
  }
  const nuovo = registrazione.installing ?? registrazione.waiting;
  if (nuovo) {
    // L'app si aggiorna da sola (autoUpdate): il nuovo non resta in attesa. Se per caso ci resta, glielo chiediamo.
    if (nuovo.state === 'installed') nuovo.postMessage({ type: 'SKIP_WAITING' });
    await attivato(nuovo, 30_000);
    ricarica();
    return 'aggiornata';
  }
  // Nessun service worker in arrivo: il nuovo può essersi già attivato all'apertura, con la pagina ancora vecchia.
  if (!(await paginaIndietro())) return 'gia_ultima';
  if (registrazione.active) await attivato(registrazione.active, 10_000);
  ricarica();
  return 'aggiornata';
}
