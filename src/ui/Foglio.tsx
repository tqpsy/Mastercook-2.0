import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

/** Pannello che sale dal basso sul telefono e si apre al centro sul tablet. */
export function Foglio({ titolo, chiudi, children }: { titolo: string; chiudi: () => void; children: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && chiudi();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [chiudi]);
  // Nel body: un genitore con backdrop-filter (la testata) altrimenti farebbe da riferimento al position: fixed.
  return createPortal(
    <div className="foglio-sfondo" onClick={chiudi}>
      <div className="foglio" role="dialog" aria-modal="true" aria-label={titolo} onClick={(e) => e.stopPropagation()}>
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
