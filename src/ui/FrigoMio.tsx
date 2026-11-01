import type { KeyboardEvent, ReactNode } from 'react';
import { type Frigo, posti } from '../dominio/frigo';

/** Un rettangolo del disegno: una parte del frigo che si può evidenziare o toccare. */
interface Area {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const L = 196; // larghezza del disegno
const A = 300; // altezza
const PORTA = 40;

/**
 * Le parti del frigo nel disegno, visto da davanti con lo sportello aperto: ripiani (lo spazio sopra ogni vetro),
 * cassetti in basso, balconcini dello sportello sul lato delle cerniere, ripiani o cassetti del freezer.
 */
export function aree(frigo: Frigo) {
  const portaSx = frigo.sportello === 'sx';
  const mx0 = portaSx ? PORTA + 6 : 4;
  const mx1 = portaSx ? L - 4 : L - PORTA - 6;
  const pos = frigo.freezer.posizione;
  // Mobile del frigo e del freezer.
  let frigoBox = { x: mx0, y: 4, w: mx1 - mx0, h: A - 8 };
  let freezerBox: typeof frigoBox | null = null;
  if (pos === 'sotto') {
    frigoBox = { x: mx0, y: 4, w: mx1 - mx0, h: 186 };
    freezerBox = { x: mx0, y: 196, w: mx1 - mx0, h: A - 200 };
  } else if (pos === 'sopra') {
    freezerBox = { x: mx0, y: 4, w: mx1 - mx0, h: 84 };
    frigoBox = { x: mx0, y: 94, w: mx1 - mx0, h: A - 98 };
  } else if (pos === 'fianco') {
    // Il freezer sta dal lato opposto allo sportello del frigo.
    const wz = Math.round((mx1 - mx0) * 0.4);
    freezerBox = portaSx ? { x: mx1 - wz, y: 4, w: wz, h: A - 8 } : { x: mx0, y: 4, w: wz, h: A - 8 };
    frigoBox = portaSx ? { x: mx0, y: 4, w: mx1 - mx0 - wz - 6, h: A - 8 } : { x: mx0 + wz + 6, y: 4, w: mx1 - mx0 - wz - 6, h: A - 8 };
  }
  const dentro = { x: frigoBox.x + 6, y: frigoBox.y + 6, w: frigoBox.w - 12, h: frigoBox.h - 12 };
  const hCassetti = frigo.cassetti ? Math.min(46, dentro.h * 0.28) : 0;
  const hRipiani = dentro.h - hCassetti;
  const ripiani: Area[] = Array.from({ length: frigo.ripiani }, (_, i) => ({
    id: `r${i + 1}`,
    x: dentro.x,
    y: dentro.y + (hRipiani / frigo.ripiani) * i,
    w: dentro.w,
    h: hRipiani / frigo.ripiani,
  }));
  const wC = (dentro.w - 4 * (frigo.cassetti - 1)) / Math.max(1, frigo.cassetti);
  const cassetti: Area[] = Array.from({ length: frigo.cassetti }, (_, i) => ({
    id: `c${i + 1}`,
    x: dentro.x + i * (wC + 4),
    y: dentro.y + hRipiani + 3,
    w: wC,
    h: hCassetti - 3,
  }));
  const porta = { x: portaSx ? 2 : L - PORTA - 2, y: frigoBox.y, w: PORTA, h: frigoBox.h };
  const hB = (porta.h - 16) / Math.max(1, frigo.balconcini);
  const sportello: Area[] = Array.from({ length: frigo.balconcini }, (_, i) => ({
    id: `s${i + 1}`,
    x: porta.x + 4,
    y: porta.y + 8 + hB * i,
    w: porta.w - 8,
    h: hB,
  }));
  const freezer: Area[] = freezerBox
    ? Array.from({ length: frigo.freezer.parti }, (_, i) => {
        const d = { x: freezerBox!.x + 5, y: freezerBox!.y + 5, w: freezerBox!.w - 10, h: freezerBox!.h - 10 };
        const h = d.h / frigo.freezer.parti;
        return { id: `f${i + 1}`, x: d.x, y: d.y + h * i, w: d.w, h };
      })
    : [];
  return { frigoBox, freezerBox, porta, ripiani, cassetti, sportello, freezer };
}

/**
 * Il frigo della famiglia disegnato com'è configurato. `evidenzia` colora una parte in senape con il contenitore
 * appoggiato (più piccolo e più in alto se va in fondo); `scegli` rende le parti toccabili; `segni` mette un
 * numero sulle parti (quanti alimenti la foto ha visto lì).
 */
export function DisegnoFrigoMio({
  frigo,
  evidenzia,
  inFondo,
  scelto,
  scegli,
  segni,
  grande,
}: {
  frigo: Frigo;
  evidenzia?: string | null;
  inFondo?: boolean;
  scelto?: string | null;
  scegli?: (id: string) => void;
  segni?: Record<string, number>;
  grande?: boolean;
}) {
  const a = aree(frigo);
  const nomi = Object.fromEntries(posti(frigo).map((p) => [p.id, p.nome]));
  const tocca = (r: Area, figura: ReactNode) => {
    const acceso = r.id === evidenzia || r.id === scelto;
    return (
      <g
        key={r.id}
        className={`parte-frigo${acceso ? ' accesa' : ''}`}
        {...(scegli
          ? {
              role: 'button',
              tabIndex: 0,
              'aria-label': nomi[r.id],
              'aria-pressed': r.id === scelto,
              onClick: () => scegli(r.id),
              onKeyDown: (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  scegli(r.id);
                }
              },
            }
          : {})}
      >
        <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="3" fill={acceso ? 'var(--senape)' : 'transparent'} opacity={acceso ? 0.4 : 1} />
        {figura}
        {segni?.[r.id] ? (
          <g>
            <circle cx={r.x + r.w - 9} cy={r.y + 10} r="8" fill="var(--petrolio)" />
            <text x={r.x + r.w - 9} y={r.y + 13.5} textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">
              {segni[r.id]}
            </text>
          </g>
        ) : null}
      </g>
    );
  };

  const contenitore = (() => {
    const r = [...a.ripiani, ...a.cassetti, ...a.sportello, ...a.freezer].find((x) => x.id === evidenzia);
    if (!r) return null;
    const largo = Math.min(r.w * (inFondo ? 0.38 : 0.5), 60);
    const alto = Math.min(r.h * (inFondo ? 0.32 : 0.42), 18);
    const cx = r.x + r.w / 2;
    const base = r.y + r.h - (inFondo ? Math.min(10, r.h * 0.25) : 4);
    return (
      <g aria-hidden>
        <rect x={cx - largo / 2} y={base - alto} width={largo} height={alto} rx="3" fill="var(--senape)" stroke="var(--testo)" strokeWidth="1.8" />
        <line x1={cx - largo / 2 - 1.5} y1={base - alto} x2={cx + largo / 2 + 1.5} y2={base - alto} stroke="var(--testo)" strokeWidth="2.6" strokeLinecap="round" />
      </g>
    );
  })();

  return (
    <svg className={`frigo-mio${grande ? ' grande' : ''}${scegli ? ' toccabile' : ''}`} viewBox={`0 0 ${L} ${A}`} role={scegli ? 'group' : 'img'} aria-label="Il tuo frigorifero">
      {/* Mobile */}
      <rect x={a.frigoBox.x} y={a.frigoBox.y} width={a.frigoBox.w} height={a.frigoBox.h} rx="8" fill="var(--superficie-2)" stroke="var(--testo-tenue)" strokeWidth="2.5" />
      <rect x={a.frigoBox.x + 6} y={a.frigoBox.y + 6} width={a.frigoBox.w - 12} height={a.frigoBox.h - 12} rx="4" fill="var(--superficie)" />
      {/* Ripiani: lo spazio e il vetro sotto */}
      {a.ripiani.map((r) =>
        tocca(
          r,
          <rect x={r.x + 2} y={r.y + r.h - 3} width={r.w - 4} height="3" rx="1.5" fill="var(--salvia)" stroke="var(--testo-tenue)" strokeWidth="0.8" />,
        ),
      )}
      {/* Cassetti */}
      {a.cassetti.map((r) =>
        tocca(
          r,
          <>
            <rect x={r.x + 2} y={r.y + 2} width={r.w - 4} height={r.h - 4} rx="4" fill="none" stroke="var(--testo-tenue)" strokeWidth="1.5" />
            <line x1={r.x + r.w / 2 - 10} y1={r.y + 10} x2={r.x + r.w / 2 + 10} y2={r.y + 10} stroke="var(--testo-tenue)" strokeWidth="2" strokeLinecap="round" />
          </>,
        ),
      )}
      {/* Sportello aperto con i balconcini */}
      <rect x={a.porta.x} y={a.porta.y} width={a.porta.w} height={a.porta.h} rx="5" fill="var(--superficie-2)" stroke="var(--testo-tenue)" strokeWidth="2" />
      {a.sportello.map((r) =>
        tocca(r, <rect x={r.x + 1} y={r.y + r.h - Math.min(12, r.h * 0.4)} width={r.w - 2} height={Math.min(12, r.h * 0.4)} rx="2" fill="none" stroke="var(--testo-tenue)" strokeWidth="1.3" />),
      )}
      {/* Freezer */}
      {a.freezerBox && (
        <>
          <rect x={a.freezerBox.x} y={a.freezerBox.y} width={a.freezerBox.w} height={a.freezerBox.h} rx="8" fill="var(--primario-tenue)" stroke="var(--testo-tenue)" strokeWidth="2.5" />
          {a.freezer.map((r) =>
            tocca(
              r,
              frigo.freezer.tipo === 'cassetti' ? (
                <>
                  <rect x={r.x + 2} y={r.y + 2} width={r.w - 4} height={r.h - 4} rx="4" fill="none" stroke="var(--testo-tenue)" strokeWidth="1.5" />
                  <line x1={r.x + r.w / 2 - 10} y1={r.y + 9} x2={r.x + r.w / 2 + 10} y2={r.y + 9} stroke="var(--testo-tenue)" strokeWidth="2" strokeLinecap="round" />
                </>
              ) : (
                <rect x={r.x + 2} y={r.y + r.h - 3} width={r.w - 4} height="3" rx="1.5" fill="var(--salvia)" stroke="var(--testo-tenue)" strokeWidth="0.8" />
              ),
            ),
          )}
        </>
      )}
      {contenitore}
    </svg>
  );
}
