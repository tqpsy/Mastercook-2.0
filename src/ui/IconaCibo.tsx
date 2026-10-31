import { eDisegno, PREFISSO_DISEGNO } from '../dominio/iconeCibo';
import { DISEGNO_PER_ID } from './disegniCibo';

/**
 * Un'icona di cibo: un'emoji o un disegno di Mastercook («mc:lasagna»). Il disegno è grande quanto il testo
 * intorno (1em), come un'emoji. Un disegno sconosciuto (di una versione più nuova dell'app) mostra 🍽️.
 */
export function IconaCibo({ valore, titolo }: { valore: string | null | undefined; titolo?: string }) {
  if (!valore) return null;
  if (!eDisegno(valore)) return <>{valore}</>;
  const d = DISEGNO_PER_ID.get(valore.slice(PREFISSO_DISEGNO.length));
  if (!d) return <>🍽️</>;
  return (
    <svg
      className="icona-cibo"
      viewBox="0 0 48 48"
      fill="none"
      stroke="#2B2C2E"
      strokeWidth={2}
      strokeLinejoin="round"
      strokeLinecap="round"
      role={titolo ? 'img' : undefined}
      aria-label={titolo}
      aria-hidden={titolo ? undefined : true}
      dangerouslySetInnerHTML={{ __html: d.svg }}
    />
  );
}
