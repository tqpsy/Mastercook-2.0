import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

/** Fogli aperti uno sopra l'altro: la pagina sotto resta ferma finché ce n'è almeno uno. */
let aperti = 0;

/**
 * Pannello che sale dal basso sul telefono e si apre al centro sul tablet.
 * `alto`: altezza fissa, per i pannelli il cui contenuto cambia (schede con elenchi di lunghezza diversa)
 * che altrimenti salirebbero e scenderebbero a ogni tocco.
 */
export function Foglio({ titolo, chiudi, alto, children }: { titolo: string; chiudi: () => void; alto?: boolean; children: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && chiudi();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [chiudi]);
  useEffect(() => {
    if (aperti++ === 0) document.documentElement.classList.add('foglio-aperto');
    return () => {
      if (--aperti === 0) document.documentElement.classList.remove('foglio-aperto');
    };
  }, []);
  // Nel body: un genitore con backdrop-filter (la testata) altrimenti farebbe da riferimento al position: fixed.
  return createPortal(
    <div className="foglio-sfondo" onClick={chiudi}>
      <div className={`foglio${alto ? ' alto' : ''}`} role="dialog" aria-modal="true" aria-label={titolo} onClick={(e) => e.stopPropagation()}>
        <div className="riga spazio" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{titolo}</h2>
          <button className="bottone piccolo" onClick={chiudi} aria-label="Chiudi">
            Chiudi
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
