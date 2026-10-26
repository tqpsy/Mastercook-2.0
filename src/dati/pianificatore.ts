/**
 * Quando sincronizzare: all'avvio, al ritorno della rete, quando l'app torna in primo piano,
 * subito dopo una modifica, all'arrivo di un avviso dal server e ogni minuto in primo piano.
 * Se la rete fallisce si ritenta con attese crescenti (2 s, 4 s, 8 s… fino a 1 minuto).
 */
import type { Sincronizzatore } from './sincronizzatore';

export interface Pianificatore {
  /** Chiede una sincronizzazione appena possibile. */
  subito(): void;
  ferma(): void;
}

export function pianifica(sync: Sincronizzatore, opzioni: { intervallo?: number; ascoltaServer?: (avviso: () => void) => () => void } = {}): Pianificatore {
  const intervallo = opzioni.intervallo ?? 60_000;
  let attesa = 2_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inCorso = false;
  let ancora = false;
  let fermo = false;

  async function giro() {
    if (fermo) return;
    if (inCorso) {
      ancora = true;
      return;
    }
    inCorso = true;
    clearTimeout(timer);
    try {
      await sync.sincronizza();
    } catch {
      // Un errore inatteso non deve fermare il ciclo: si ritenta più tardi.
    }
    inCorso = false;
    const s = sync.leggiStato();
    if (s.senza_rete) {
      timer = setTimeout(giro, attesa);
      attesa = Math.min(attesa * 2, 60_000);
    } else {
      attesa = 2_000;
      timer = setTimeout(giro, intervallo);
    }
    if (ancora) {
      ancora = false;
      void giro();
    }
  }

  const online = () => void giro();
  const visibile = () => {
    if (document.visibilityState === 'visible') void giro();
  };
  window.addEventListener('online', online);
  document.addEventListener('visibilitychange', visibile);
  const smetti = opzioni.ascoltaServer?.(() => void giro());
  void giro();

  return {
    subito: () => void giro(),
    ferma() {
      fermo = true;
      clearTimeout(timer);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visibile);
      smetti?.();
    },
  };
}
