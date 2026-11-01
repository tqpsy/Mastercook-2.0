import type { Ripiano } from '../dominio/cucinato';

/** Il fondo del ripiano (la «base» su cui si appoggia il contenitore), davanti e dietro, nel frigo visto aperto. */
const BASE = { alto: { davanti: 58, dietro: 60 }, centrale: { davanti: 100, dietro: 94 } } as const;
const SOPRA = { alto: { davanti: 14, dietro: 24 }, centrale: { davanti: 58, dietro: 60 } } as const;
const FRONTE = { sx: 10, dx: 98 };
const FONDO = { sx: 28, dx: 80 };

/** Un punto del ripiano: t = 0 davanti, 1 in fondo. */
const x = (lato: 'sx' | 'dx', t: number) => FRONTE[lato] + (FONDO[lato] - FRONTE[lato]) * t;
const y = (b: { davanti: number; dietro: number }, t: number) => b.davanti + (b.dietro - b.davanti) * t;

/**
 * Il frigo aperto, visto da davanti in prospettiva: i ripiani, il cassetto delle verdure e la porta. Il posto
 * consigliato è in senape, con il contenitore appoggiato dove va (in fondo per i piatti delicati).
 */
export function DisegnoFrigo({ ripiano }: { ripiano: Ripiano }) {
  const b = BASE[ripiano.posto];
  const s = SOPRA[ripiano.posto];
  const zona = [
    [x('sx', 0), s.davanti],
    [x('dx', 0), s.davanti],
    [x('dx', 0), b.davanti],
    [x('sx', 0), b.davanti],
  ];
  const zonaFondo = [
    [x('sx', 1), s.dietro],
    [x('dx', 1), s.dietro],
    [x('dx', 1), b.dietro],
    [x('sx', 1), b.dietro],
  ];
  const t = ripiano.posto === 'centrale' ? 0.78 : 0.45;
  const cx = (x('sx', t) + x('dx', t)) / 2;
  const cy = y(b, t);
  const largo = 30 - t * 8;
  const alto = 12 - t * 3;
  const piano = (bb: { davanti: number; dietro: number }) =>
    `${x('sx', 0)},${bb.davanti} ${x('dx', 0)},${bb.davanti} ${x('dx', 1)},${bb.dietro} ${x('sx', 1)},${bb.dietro}`;
  return (
    <svg className="frigo" viewBox="0 0 132 176" aria-hidden>
      {/* Mobile del frigo e cavità */}
      <rect x="2" y="2" width="128" height="172" rx="10" fill="var(--superficie)" stroke="var(--testo-tenue)" strokeWidth="2.5" />
      <rect x={FRONTE.sx} y="10" width={FRONTE.dx - FRONTE.sx} height="156" rx="4" fill="var(--superficie-2)" />
      <rect x={FONDO.sx} y="24" width={FONDO.dx - FONDO.sx} height="114" fill="var(--sfondo)" stroke="var(--bordo)" strokeWidth="1.5" />
      {[
        [FRONTE.sx, 10, FONDO.sx, 24],
        [FRONTE.dx, 10, FONDO.dx, 24],
      ].map(([a, b1, c, d]) => (
        <line key={a} x1={a} y1={b1} x2={c} y2={d} stroke="var(--bordo)" strokeWidth="1.5" />
      ))}
      {/* Il posto consigliato */}
      <polygon points={`${zona[0]} ${zona[1]} ${zonaFondo[1]} ${zonaFondo[0]}`} fill="var(--senape)" opacity="0.28" />
      <polygon points={`${zonaFondo.map((p) => p.join(',')).join(' ')}`} fill="var(--senape)" opacity="0.35" />
      {/* Ripiani di vetro */}
      {[BASE.alto, BASE.centrale, { davanti: 132, dietro: 122 }].map((bb) => (
        <polygon key={bb.davanti} points={piano(bb)} fill="var(--salvia-tenue)" stroke="var(--testo-tenue)" strokeWidth="1.5" strokeLinejoin="round" />
      ))}
      {/* Cassetto delle verdure */}
      <rect x="14" y="138" width="80" height="24" rx="4" fill="var(--superficie)" stroke="var(--testo-tenue)" strokeWidth="1.5" />
      <line x1="44" y1="150" x2="64" y2="150" stroke="var(--testo-tenue)" strokeWidth="2" strokeLinecap="round" />
      {/* Porta con i balconcini, da non usare */}
      <rect x="104" y="10" width="20" height="156" rx="3" fill="var(--superficie-2)" stroke="var(--bordo)" strokeWidth="1.5" />
      {[44, 88, 132].map((yy) => (
        <rect key={yy} x="106" y={yy} width="16" height="8" rx="2" fill="none" stroke="var(--testo-tenue)" strokeWidth="1.2" />
      ))}
      <line x1="107" y1="20" x2="121" y2="34" stroke="var(--errore)" strokeWidth="2" strokeLinecap="round" />
      <line x1="121" y1="20" x2="107" y2="34" stroke="var(--errore)" strokeWidth="2" strokeLinecap="round" />
      {/* Il contenitore, appoggiato dove va */}
      <rect x={cx - largo / 2} y={cy - alto - 1} width={largo} height={alto} rx="2.5" fill="var(--senape)" stroke="var(--testo)" strokeWidth="1.8" />
      <line x1={cx - largo / 2 - 1} y1={cy - alto - 1} x2={cx + largo / 2 + 1} y2={cy - alto - 1} stroke="var(--testo)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

/** Il riquadro «Ripiano consigliato»: il frigo disegnato e il posto, in parole. */
export function ConsiglioRipiano({ ripiano, compatto }: { ripiano: Ripiano; compatto?: boolean }) {
  return (
    <div className={`consiglio-ripiano${compatto ? ' compatto' : ''}`}>
      <DisegnoFrigo ripiano={ripiano} />
      <span>
        <span className="tenue piccolo">Ripiano consigliato</span>
        <strong>{ripiano.nome}</strong>
        <span className="tenue">{ripiano.perche}</span>
      </span>
    </div>
  );
}
