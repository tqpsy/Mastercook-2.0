import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { type DaServire, ingredientiNelTesto, minutiNelTesto } from '../dominio/cucina';
import { aggiungiPasso, togliPasso } from './indietro';
import { Icona } from './Icona';

type StatoSchermo = 'acceso' | 'non_disponibile' | 'in_attesa';

/** Tiene lo schermo acceso finché la modalità cucina è aperta, dove il telefono lo permette. */
function useSchermoAcceso(): StatoSchermo {
  const [stato, setStato] = useState<StatoSchermo>(() => ('wakeLock' in navigator ? 'in_attesa' : 'non_disponibile'));
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let blocco: WakeLockSentinel | null = null;
    let attivo = true;
    const chiedi = async () => {
      try {
        blocco = await navigator.wakeLock.request('screen');
        if (!attivo) return void blocco.release();
        setStato('acceso');
        blocco.addEventListener('release', () => attivo && setStato('in_attesa'));
      } catch {
        if (attivo) setStato('non_disponibile');
      }
    };
    // Tornando all'app il telefono toglie il blocco: lo si richiede.
    const visibile = () => document.visibilityState === 'visible' && void chiedi();
    void chiedi();
    document.addEventListener('visibilitychange', visibile);
    return () => {
      attivo = false;
      document.removeEventListener('visibilitychange', visibile);
      void blocco?.release().catch(() => {});
    };
  }, []);
  return stato;
}

/** Il timer resta acceso anche passando ai passaggi dopo (la pasta cuoce mentre si prepara il sugo). */
function TimerInCorso({ fine, ferma }: { fine: number; ferma: () => void }) {
  const [adesso, setAdesso] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAdesso(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const resto = Math.max(0, Math.ceil((fine - adesso) / 1000));
  useEffect(() => {
    if (resto === 0) navigator.vibrate?.([300, 150, 300, 150, 300]);
  }, [resto]);
  const mm = String(Math.floor(resto / 60)).padStart(2, '0');
  const ss = String(resto % 60).padStart(2, '0');
  return (
    <button className={`cucina-timer ${resto === 0 ? 'finito' : 'in-corso'}`} onClick={ferma} aria-label={resto === 0 ? 'Tempo scaduto: tocca per chiudere il timer' : `Timer: mancano ${mm}:${ss}. Tocca per fermarlo`}>
      <span role="timer" aria-live={resto === 0 ? 'assertive' : 'off'}>
        {resto === 0 ? '⏰ Tempo!' : `⏱ ${mm}:${ss}`}
      </span>
    </button>
  );
}

/**
 * Modalità cucina: un passaggio per volta, a tutto schermo e sempre scura, con testi e tasti grandi
 * (si usa con le mani sporche), ciò che serve per quel passaggio, un timer se il passaggio dice i minuti
 * e lo schermo che resta acceso. Indietro del telefono la chiude.
 */
export function ModalitaCucina({ titolo, passi, ingredienti, chiudi }: { titolo: string; passi: string[]; ingredienti: DaServire[]; chiudi: () => void }) {
  const [n, setN] = useState(0);
  const [timer, setTimer] = useState<number | null>(null);
  const schermo = useSchermoAcceso();
  const ultimo = n === passi.length - 1;
  const avanti = useCallback(() => (ultimo ? chiudi() : setN((x) => x + 1)), [ultimo, chiudi]);
  const indietro = useCallback(() => setN((x) => Math.max(0, x - 1)), []);

  useEffect(() => {
    const id = aggiungiPasso(chiudi);
    document.documentElement.classList.add('foglio-aperto');
    return () => {
      togliPasso(id);
      document.documentElement.classList.remove('foglio-aperto');
    };
  }, [chiudi]);
  useEffect(() => {
    const tasto = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') avanti();
      else if (e.key === 'ArrowLeft') indietro();
      else if (e.key === 'Escape') chiudi();
    };
    window.addEventListener('keydown', tasto);
    return () => window.removeEventListener('keydown', tasto);
  }, [avanti, indietro, chiudi]);

  const testo = passi[n] ?? '';
  const servono = ingredientiNelTesto(testo, ingredienti);
  const minuti = minutiNelTesto(testo);

  return createPortal(
    <div className="modalita-cucina" role="dialog" aria-modal="true" aria-label={`Modalità cucina: ${titolo}`}>
      <div className="riga cucina-testa">
        <button className="cucina-chiudi" aria-label="Chiudi la modalità cucina" onClick={chiudi}>
          ✕
        </button>
        <strong className="cresce">{titolo}</strong>
        <span className="cucina-schermo">
          {schermo === 'acceso' ? (
            <>
              <Icona nome="oggi" grandezza={18} /> Schermo acceso
            </>
          ) : schermo === 'non_disponibile' ? (
            'Lo schermo può spegnersi'
          ) : null}
        </span>
      </div>
      <div className="cucina-progresso" aria-hidden>
        {passi.map((_, i) => (
          <span key={i} className={i < n ? 'fatto' : i === n ? 'ora' : undefined} />
        ))}
      </div>
      <p className="cucina-numero">
        Passaggio {n + 1} di {passi.length}
      </p>
      <p className="cucina-passo" aria-live="polite">
        {testo}
      </p>
      {servono.length > 0 && (
        <div className="cucina-serve">
          <span className="tenue">Ti serve</span>
          <ul>
            {servono.map((i) => (
              <li key={i.nome}>
                {i.nome} {i.quantita}
              </li>
            ))}
          </ul>
        </div>
      )}
      {timer !== null ? (
        <TimerInCorso fine={timer} ferma={() => setTimer(null)} />
      ) : (
        minuti && (
          <button className="cucina-timer" onClick={() => setTimer(Date.now() + minuti * 60_000)}>
            ⏱ Timer {minuti} {minuti === 1 ? 'minuto' : 'minuti'}
          </button>
        )
      )}
      <div className="cucina-comandi">
        <button className="cucina-indietro" onClick={indietro} disabled={n === 0}>
          <Icona nome="indietro" grandezza={28} /> Indietro
        </button>
        <button className="cucina-avanti" onClick={avanti}>
          {ultimo ? 'Fine' : 'Avanti'} {!ultimo && <Icona nome="avanti" grandezza={28} />}
        </button>
      </div>
    </div>,
    document.body,
  );
}
