import { type KeyboardEvent, type RefObject, type TouchEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Tablet e telefono girato: la stessa soglia dei fogli di stile. */
export const LARGO = '(min-width: 900px), (orientation: landscape) and (min-width: 560px) and (max-height: 600px)';

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
export const SOGLIA_DITO = 50;

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

/** Molla del carosello: rigida quanto basta per essere svelta, smorzata poco sotto il critico per un leggero rimbalzo. */
export const MOLLA = { rigidita: 420, smorzamento: 0.72 };

/**
 * I giorni come carosello: ieri, oggi e domani affiancati; il binario segue il dito in tempo reale e al rilascio una
 * molla lo aggancia al giorno nuovo (o lo riporta indietro), con un piccolo rimbalzo. `cambia(±1)` arriva a molla ferma;
 * `chiave` è il giorno mostrato: quando cambia il binario torna al centro prima che si veda.
 */
export function useCarosello(cambia: (verso: 1 | -1) => void, chiave: string) {
  const finestra = useRef<HTMLDivElement>(null);
  const binario = useRef<HTMLDivElement>(null);
  const stato = useRef<{ x: number; y: number; asse: 'x' | 'y' | null; dx: number; v: number; t: number } | null>(null);
  const molla = useRef(0);
  const posa = (dx: number) => {
    if (binario.current) binario.current.style.transform = `translate3d(calc(-100% + ${dx}px), 0, 0)`;
  };
  useLayoutEffect(() => {
    cancelAnimationFrame(molla.current);
    posa(0);
  }, [chiave]);
  useEffect(() => () => cancelAnimationFrame(molla.current), []);

  function lancia(da: number, a: number, velocita: number, fine: () => void) {
    const k = MOLLA.rigidita;
    const c = 2 * Math.sqrt(k) * MOLLA.smorzamento;
    let x = da;
    let v = velocita;
    let prima = performance.now();
    cancelAnimationFrame(molla.current);
    const passo = (ora: number) => {
      // Passi piccoli e fissi: la molla resta stabile anche se un fotogramma arriva in ritardo.
      let dt = Math.min(0.064, (ora - prima) / 1000);
      prima = ora;
      while (dt > 0) {
        const h = Math.min(dt, 1 / 240);
        v += (-k * (x - a) - c * v) * h;
        x += v * h;
        dt -= h;
      }
      if (Math.abs(x - a) < 0.5 && Math.abs(v) < 20) {
        posa(a);
        return fine();
      }
      posa(x);
      molla.current = requestAnimationFrame(passo);
    };
    molla.current = requestAnimationFrame(passo);
  }

  return {
    finestra,
    binario,
    gesti: {
      onTouchStart(e: TouchEvent) {
        e.stopPropagation();
        const t = e.touches[0];
        if (e.touches.length !== 1 || !t) return void (stato.current = null);
        cancelAnimationFrame(molla.current);
        // Se una molla era in corsa si riparte da dove si trova il binario.
        const m = binario.current ? new DOMMatrixReadOnly(getComputedStyle(binario.current).transform) : null;
        const da = m && finestra.current ? m.m41 + finestra.current.clientWidth : 0;
        stato.current = { x: t.clientX - da, y: t.clientY, asse: null, dx: da, v: 0, t: e.timeStamp };
      },
      onTouchMove(e: TouchEvent) {
        e.stopPropagation();
        const s = stato.current;
        const t = e.touches[0];
        if (!s || !t) return;
        const dx = t.clientX - s.x;
        if (!s.asse) {
          if (Math.abs(dx - s.dx) < 8 && Math.abs(t.clientY - s.y) < 8) return;
          s.asse = Math.abs(dx - s.dx) > Math.abs(t.clientY - s.y) ? 'x' : 'y';
        }
        if (s.asse !== 'x') return;
        const dt = e.timeStamp - s.t;
        if (dt > 0) s.v = ((dx - s.dx) / dt) * 1000;
        s.dx = dx;
        s.t = e.timeStamp;
        posa(dx);
      },
      onTouchEnd(e: TouchEvent) {
        e.stopPropagation();
        const s = stato.current;
        stato.current = null;
        const larghezza = finestra.current?.clientWidth ?? 0;
        if (!s || !larghezza) return;
        if (s.asse !== 'x') {
          if (s.dx) lancia(s.dx, 0, 0, () => undefined);
          return;
        }
        // Si cambia giorno se il dito è andato oltre un quarto dello schermo o è stato lanciato con decisione.
        const lancio = Math.abs(s.v) > 450 ? Math.sign(s.v) : 0;
        const verso = s.dx < -larghezza / 4 || lancio < 0 ? 1 : s.dx > larghezza / 4 || lancio > 0 ? -1 : 0;
        if (!verso) return lancia(s.dx, 0, s.v, () => undefined);
        lancia(s.dx, -verso * larghezza, s.v, () => cambia(verso));
      },
      onTouchCancel(e: TouchEvent) {
        e.stopPropagation();
        const s = stato.current;
        stato.current = null;
        if (s?.dx) lancia(s.dx, 0, 0, () => undefined);
      },
    },
  };
}

/**
 * Allunga un elemento fino in fondo allo schermo (sopra la barra delle schede, lasciando `riserva` px per ciò che
 * sta sotto), così i riquadri usano tutto lo spazio. Se lo spazio è poco resta com'è e la pagina scorre.
 */
export function useFinoInFondo(ref: RefObject<HTMLElement | null>, riserva: number, attivo: boolean, chiave: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!attivo) {
      el.style.minHeight = '';
      return;
    }
    const calcola = () => {
      const barra = document.querySelector('.schede')?.getBoundingClientRect();
      const sotto = barra && barra.top > window.innerHeight / 2 ? window.innerHeight - barra.top : 0;
      const libera = window.innerHeight - (el.getBoundingClientRect().top + window.scrollY) - sotto - riserva;
      el.style.minHeight = libera > 220 ? `${Math.floor(libera)}px` : '';
    };
    calcola();
    window.addEventListener('resize', calcola);
    return () => window.removeEventListener('resize', calcola);
  }, [ref, riserva, attivo, chiave]);
}
