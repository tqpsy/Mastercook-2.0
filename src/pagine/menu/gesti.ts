/** Menu: schermo largo o stretto e gesti col dito (scorrimento, riquadri fino in fondo). */
import { type KeyboardEvent, type RefObject, type TouchEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Tablet e telefono girato: la stessa soglia dei fogli di stile. */
const LARGO = '(min-width: 900px), (orientation: landscape) and (min-width: 560px) and (max-height: 600px)';

export function useLargo() {
  const [largo, setLargo] = useState(() => window.matchMedia(LARGO).matches);
  useEffect(() => {
    const m = window.matchMedia(LARGO);
    const cambia = () => setLargo(m.matches);
    m.addEventListener('change', cambia);
    return () => m.removeEventListener('change', cambia);
  }, []);
  return largo;
}

/** Quanto deve spostarsi il dito, e quanto più di lato che in verticale, perché sia uno scorrimento. */
const SOGLIA_DITO = 50;

/**
 * Scorrimento col dito a sinistra o a destra (e frecce della tastiera): `passo(+1)` va avanti, `passo(-1)` indietro.
 * `zona` dice di che passo si tratta a seconda di dove parte il dito (per esempio la striscia dei giorni = una
 * settimana). Dentro una zona che scorre già di lato, si cambia solo quando è arrivata in fondo.
 */
export function useScorrimento(passo: (verso: 1 | -1, bersaglio: Element) => void) {
  const inizio = useRef<{ x: number; y: number; bersaglio: Element; scorre: HTMLElement | null; sx: number } | null>(null);
  return {
    onTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      if (e.touches.length !== 1 || !t) return void (inizio.current = null);
      const bersaglio = e.target as Element;
      const scorre = bersaglio.closest<HTMLElement>('.scorre');
      inizio.current = { x: t.clientX, y: t.clientY, bersaglio, scorre, sx: scorre?.scrollLeft ?? 0 };
    },
    onTouchEnd(e: TouchEvent) {
      const i = inizio.current;
      inizio.current = null;
      const t = e.changedTouches[0];
      if (!i || !t) return;
      const dx = t.clientX - i.x;
      if (Math.abs(dx) < SOGLIA_DITO || Math.abs(dx) < Math.abs(t.clientY - i.y) * 1.5) return;
      const verso = dx < 0 ? 1 : -1;
      if (i.scorre) {
        // Prima si scorre la griglia; si cambia settimana solo se all'inizio del gesto era già al bordo.
        const max = i.scorre.scrollWidth - i.scorre.clientWidth;
        if (verso === 1 && i.sx < max - 4) return;
        if (verso === -1 && i.sx > 4) return;
      }
      passo(verso, i.bersaglio);
    },
    onTouchCancel() {
      inizio.current = null;
    },
    onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const bersaglio = e.target as Element;
      if (bersaglio.closest('input, textarea, select, [role="dialog"]')) return;
      const scorre = bersaglio.closest<HTMLElement>('.scorre');
      const verso = e.key === 'ArrowRight' ? 1 : -1;
      if (scorre) {
        const max = scorre.scrollWidth - scorre.clientWidth;
        if (verso === 1 && scorre.scrollLeft < max - 4) return;
        if (verso === -1 && scorre.scrollLeft > 4) return;
      }
      e.preventDefault();
      passo(verso, bersaglio);
    },
  };
}

/**
 * Allunga un elemento fino in fondo allo schermo (sopra la barra delle schede, lasciando `riserva` px per ciò che
 * sta sotto), così i riquadri usano tutto lo spazio senza far scorrere la pagina. Se lo spazio è poco resta com'è
 * e la pagina scorre; se invece il contenuto è più alto dello spazio disponibile, è l'elemento stesso a scorrere
 * (gli basta un `overflow-y: auto` nel suo stile): così una riga ancorata in cima (per esempio quella dei giorni,
 * con `position: sticky`) resta sempre in vista.
 */
export function useFinoInFondo(ref: RefObject<HTMLElement | null>, riserva: number, attivo: boolean, chiave: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!attivo) {
      el.style.minHeight = '';
      el.style.maxHeight = '';
      return;
    }
    const calcola = () => {
      const barra = document.querySelector('.schede')?.getBoundingClientRect();
      const sotto = barra && barra.top > window.innerHeight / 2 ? window.innerHeight - barra.top : 0;
      const libera = window.innerHeight - (el.getBoundingClientRect().top + window.scrollY) - sotto - riserva;
      el.style.minHeight = libera > 220 ? `${Math.floor(libera)}px` : '';
      el.style.maxHeight = libera > 220 ? `${Math.floor(libera)}px` : '';
    };
    calcola();
    window.addEventListener('resize', calcola);
    return () => window.removeEventListener('resize', calcola);
  }, [ref, riserva, attivo, chiave]);
}
