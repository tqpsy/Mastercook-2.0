/**
 * «Aggiorna l'app»: chiede subito al server se c'è una versione nuova e, se c'è, la installa e ricarica.
 * Senza questo tasto la versione nuova arriva solo chiudendo e riaprendo del tutto l'app.
 */

export type EsitoAggiornamento = 'aggiornata' | 'gia_ultima' | 'senza_rete';

/** Quando è stata preparata la versione che si sta usando (scritta durante la costruzione dell'app). */
export const COSTRUITA_IL: string = typeof __COSTRUITA_IL__ === 'string' ? __COSTRUITA_IL__ : '';

/** Aspetta che il service worker nuovo prenda il posto del vecchio (al massimo `attesa` ms). */
function attivato(sw: ServiceWorker, attesa: number): Promise<void> {
  return new Promise((risolvi) => {
    if (sw.state === 'activated') return risolvi();
    const fine = setTimeout(risolvi, attesa);
    sw.addEventListener('statechange', () => {
      if (sw.state === 'activated' || sw.state === 'redundant') {
        clearTimeout(fine);
        risolvi();
      }
    });
  });
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
    return navigator.onLine ? 'gia_ultima' : 'senza_rete';
  }
  const nuovo = registrazione.installing ?? registrazione.waiting;
  if (!nuovo) return 'gia_ultima';
  // L'app si aggiorna da sola (autoUpdate): il nuovo non resta in attesa. Se per caso ci resta, glielo chiediamo.
  if (nuovo.state === 'installed') nuovo.postMessage({ type: 'SKIP_WAITING' });
  await attivato(nuovo, 30_000);
  ricarica();
  return 'aggiornata';
}
