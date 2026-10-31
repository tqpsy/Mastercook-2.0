/**
 * Icone del cibo disegnate per Mastercook, nello stile «La cucina di Luca»: contorno antracite, colori pieni,
 * piatti e ciotole petrolio. Servono dove le emoji non bastano (la lasagna, il risotto, il prosciutto crudo…).
 *
 * Ogni disegno è il contenuto di un <svg viewBox="0 0 48 48"> che ha già contorno antracite da 2: un elemento
 * senza contorno dice stroke="none". Il valore salvato per un'icona è `mc:<id>` (vedi dominio/iconeCibo.ts).
 */

// ─── Colori ───
const PET = '#12656F';
const PET2 = '#1F8592';
const CREMA = '#FBF3E2';
const BIANCO = '#FFFFFF';
const PASTA = '#F2C76B';
const PASTA_SCURA = '#C9932E';
const DORATO = '#D9973A';
const BRUNO = '#9A5A2E';
const POM = '#D2482E';
const POM_SCURO = '#A8361F';
const BASILICO = '#5E9B57';
const VERDE = '#8DBB6A';
const ARANCIO = '#D9772F';
const ROVERE = '#B07D52';
const ROVERE_CHIARO = '#D8AE7E';
const CIOCC = '#6B4429';
const ROSA = '#F2A6A0';
const CARNE = '#C24E45';
const GRASSO = '#FFF4EA';
const ARGENTO = '#C9D3D6';
const VAPORE = '#9AA6A8';

// ─── Pezzi comuni ───
const piatto = (cy = 36, rx = 20, ry = 7) =>
  `<ellipse cx="24" cy="${cy}" rx="${rx}" ry="${ry}" fill="${PET}"/><ellipse cx="24" cy="${cy - 1}" rx="${rx - 6}" ry="${ry - 2.6}" fill="${PET2}" stroke="none"/>`;
const ciotola = (brodo: string) =>
  `<path d="M18 40h12v3H18z" fill="${PET}"/><path d="M5 24h38c0 10-8 17-19 17S5 34 5 24z" fill="${PET}"/><ellipse cx="24" cy="24" rx="19" ry="5" fill="${brodo}"/>`;
const vapore = () =>
  `<path d="M17 15q-2-3 0-6M24 14q-2-3 0-6M31 15q-2-3 0-6" stroke="${VAPORE}" fill="none"/>`;
const foglia = (x: number, y: number, r = 0, s = 1) =>
  `<path transform="translate(${x} ${y}) rotate(${r}) scale(${s})" d="M-3.5 0q3.5-3.5 7 0q-3.5 3.5-7 0z" fill="${BASILICO}" stroke-width="1.3"/>`;
const punti = (pos: [number, number][], colore: string, r = 0.9) =>
  pos.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${colore}" stroke="none"/>`).join('');
/** Fasce orizzontali (y da, y a, colore) dentro un rettangolo largo da x a x+l, poi il contorno. */
const strati = (x: number, l: number, fasce: [number, number, string][]) =>
  fasce.map(([a, b, c]) => `<rect x="${x}" y="${a}" width="${l}" height="${b - a}" fill="${c}" stroke="none"/>`).join('') +
  `<rect x="${x}" y="${fasce[0][0]}" width="${l}" height="${fasce[fasce.length - 1][1] - fasce[0][0]}" fill="none"/>`;
/** Fasce sulla faccia di lato (da x a x+5, inclinata di 5 verso l'alto). */
const latoStrati = (x: number, fasce: [number, number, string][]) =>
  fasce.map(([a, b, c]) => `<path d="M${x} ${a}l5-5v${b - a}l-5 5z" fill="${c}" stroke="none"/>`).join('') +
  `<path d="M${x} ${fasce[0][0]}l5-5v${fasce[fasce.length - 1][1] - fasce[0][0]}l-5 5z" fill="none"/>`;

// ─── Piatti ───
const lasagna = () => {
  const f: [number, number, string][] = [[21, 24, DORATO], [24, 26, PASTA], [26, 28.5, POM], [28.5, 30, CREMA], [30, 32, PASTA], [32, 35, POM]];
  return (
    piatto(37, 20, 6) +
    strati(10, 22, f) +
    latoStrati(32, f.map(([a, b, c]) => [a, b, c === POM ? POM_SCURO : c === PASTA ? PASTA_SCURA : c])) +
    `<path d="M10 21l6-5h22l-6 5z" fill="${DORATO}"/>` +
    punti([[18, 18.6], [26, 18], [31.5, 19], [22, 19.6]], BRUNO, 1.1) +
    foglia(26, 18.3, -10, 0.9)
  );
};

const risotto = () => {
  const chicchi: [number, number, number][] = [[16, 29, 20], [21, 26, -20], [27, 27, 30], [32, 30, -10], [20, 31, 10], [26, 31, -30], [13, 32, 0], [35, 32, 20], [24, 23.5, 0], [30, 25, 15], [18, 26.5, 40], [29, 29, 60]];
  return (
    piatto(34, 20, 8) +
    `<path d="M8 33C9 21 39 21 40 33c-7 3-25 3-32 0z" fill="#F3CF6E"/>` +
    chicchi.map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="1.7" ry="0.85" transform="rotate(${r} ${x} ${y})" fill="${CREMA}" stroke="#D9A93A" stroke-width="0.7"/>`).join('') +
    punti([[23, 28], [28, 32], [17, 30], [32, 27]], BASILICO, 1)
  );
};

const parmigiana = () =>
  `<ellipse cx="24" cy="26" rx="21.5" ry="15" fill="#C4673A"/><ellipse cx="24" cy="26" rx="17" ry="11.2" fill="${POM}"/>` +
  [[16, 23], [29, 21.5], [22, 30.5], [33, 29]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="5" ry="3.5" fill="#E9C98F" stroke="#5B3A5E" stroke-width="2"/>`).join('') +
  [[22, 22.5, 2.8], [27, 27.5, 2.6], [14, 29, 2.4], [34.5, 24, 2.3], [17.5, 18.5, 1.8]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${BIANCO}" stroke="none"/>`).join('') +
  foglia(28, 33, 20) +
  foglia(31, 19, -30, 0.8);

const gnocchi = () => {
  const g = (x: number, y: number) =>
    `<ellipse cx="${x}" cy="${y}" rx="3.8" ry="2.7" fill="${PASTA}" stroke-width="1.5"/><path d="M${x - 1.5} ${y - 1.9}v3.8M${x} ${y - 2.3}v4.6M${x + 1.5} ${y - 1.9}v3.8" stroke="${PASTA_SCURA}" stroke-width="0.9"/>`;
  return (
    piatto(33, 20, 9) +
    `<path d="M10 31c-2-7 10-9 16-8 10-1 15 5 11 10-6 4-22 4-27-2z" fill="${POM}" stroke="none"/>` +
    g(17, 27) + g(25, 25.5) + g(32, 28) + g(20, 32) + g(29, 32.5) +
    foglia(24, 29.5, 15, 0.9)
  );
};

const tortellini = () => {
  const t = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="3.4" fill="${PASTA}" stroke-width="1.5"/><circle cx="${x}" cy="${y}" r="1.2" fill="#E8B54A" stroke-width="1"/>`;
  return ciotola('#E8B54A') + t(15, 24) + t(22.5, 25.5) + t(30, 23.5) + t(35, 25.5) + t(22, 21.8) + punti([[18, 21.5], [27, 26.5], [33, 21.5]], BASILICO) + vapore();
};

const cotoletta = () =>
  piatto(34, 20, 8) +
  `<path d="M9 30c-2-9 8-14 17-12 9-2 15 5 12 12-3 6-24 7-29 0z" fill="#D99A3E"/>` +
  punti([[14, 27], [18, 23], [22, 29], [26, 22], [29, 27], [33, 24], [17, 31], [31, 31], [24, 25.5], [35, 28.5]], '#A8692A', 0.8) +
  `<path d="M30 21a6 6 0 0 0 10 5z" fill="#F4D03F" stroke-width="1.6"/><path d="M35 23.6l2.6-3.4M35 23.6l4.2 0.6" stroke="#E0B020" stroke-width="1"/>`;

const polpette = () => {
  const p = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="5.2" fill="#8A4B2E"/><circle cx="${x - 1.8}" cy="${y - 1.8}" r="1.6" fill="#B06A44" stroke="none"/>`;
  return piatto(34, 20, 8) + `<path d="M8 32c-1-6 9-9 16-9 9 0 17 3 16 9-5 4-27 4-32 0z" fill="${POM}" stroke="none"/>` + p(17, 29) + p(31, 29) + p(24, 23.5) + foglia(24, 31, 0, 0.9);
};

const zuppa = () =>
  ciotola('#D98A3E') +
  [[14, 24], [26, 22.5], [33, 25]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2" fill="${ARANCIO}" stroke-width="1.2"/>`).join('') +
  [[19, 25.5], [30, 22], [23, 26]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="2.2" ry="1.3" fill="${CREMA}" stroke-width="1.2"/>`).join('') +
  punti([[17, 22.5], [21, 22], [28, 26], [36, 22.5], [11, 23.5]], VERDE, 1.4) +
  vapore();

const vellutata = () =>
  ciotola('#E8893A') +
  `<path d="M16 24c2-3 10-3.5 12-1 2 2.6-4 4-7 2.4" stroke="${CREMA}" stroke-width="1.8" fill="none"/>` +
  [[30, 25], [32, 23], [34, 25.4]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="1.2" ry="0.7" fill="#4E6B3A" stroke="none"/>`).join('') +
  foglia(13, 23.5, -20, 0.8);

const frittata = () =>
  `<path d="M36 27.5l9-5 1.6 2.6-9 5z" fill="${ROVERE}"/>` +
  `<ellipse cx="22" cy="30" rx="18.5" ry="10.5" fill="#3A3B3E"/><ellipse cx="22" cy="29" rx="15" ry="7.6" fill="#F2C24E"/>` +
  punti([[14, 27], [19, 32], [27, 26], [30, 31], [17, 25]], '#C98A2E', 1.1) +
  [[12, 30], [22, 25], [25, 33], [33, 28], [18, 29]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" fill="${VERDE}" stroke="#4E7A3E" stroke-width="0.9"/>`).join('') +
  `<path d="M22 29l13-4M22 29l9 6.8" stroke="#C98A2E" stroke-width="1.2"/>`;

const tiramisu = () => {
  const f: [number, number, string][] = [[20, 23, CIOCC], [23, 27, CREMA], [27, 29.5, '#C99A5B'], [29.5, 32.5, CREMA], [32.5, 35, '#C99A5B']];
  return (
    piatto(37, 20, 6) +
    strati(10, 23, f) +
    latoStrati(33, f.map(([a, b, c]) => [a, b, c === CREMA ? '#E8DCC4' : c === CIOCC ? '#55341F' : '#A87C45'])) +
    `<path d="M10 20l5-5h23l-5 5z" fill="${CIOCC}"/>` +
    punti([[17, 17.5], [21, 18.6], [25, 16.8], [29, 18], [33, 16.6], [14, 19]], '#8C5A36', 0.7) +
    `<ellipse cx="25" cy="17.8" rx="2" ry="1.3" fill="#3B2415" stroke-width="1"/>`
  );
};

const pannaCotta = () =>
  piatto(37, 18, 6) +
  `<path d="M14 36l3-16c0-3 14-3 14 0l3 16z" fill="${CREMA}"/>` +
  `<ellipse cx="24" cy="20" rx="7" ry="2.4" fill="#B8323A"/>` +
  `<path d="M17.1 20.6L17 25q1.2 3 2.4 0l.3-3.8zM28.4 21.5l.2 2.8q1.1 2.6 2.2 0l-.2-3.5z" fill="#B8323A" stroke-width="1.2"/>` +
  `<circle cx="24" cy="16.4" r="2.6" fill="#C83A4A" stroke-width="1.5"/>` +
  punti([[23.2, 15.8], [24.8, 16.8], [24, 15.2]], '#F09AA4', 0.5) +
  foglia(27.5, 14.8, -35, 0.7);

const arancino = () =>
  piatto(38, 16, 5) +
  `<path d="M24 7c6 6 11 14 10 22s-19 7-20 0S18 13 24 7z" fill="#D98B33"/>` +
  `<path d="M19 18c1-4 3-7 5-9" stroke="#F0B565" stroke-width="2.2" fill="none"/>` +
  punti([[21, 24], [26, 21], [29, 27], [24, 30], [19, 30], [27, 15], [22, 17], [31, 31], [17, 26]], '#A85F22', 0.8);

const bruschetta = () => {
  const fetta = `<path d="M6 26q0-5 6-5l18 2q4 1 3 5l-1 5q-1 3-5 3l-18-1q-4-1-3-5z" fill="#D6A260"/><path d="M9 27q0-3 4-3l15 1.6q3 .6 2.4 3.4l-.6 3q-.6 2-3.4 2l-14-.8q-3-.4-3.4-3z" fill="#EBC88E" stroke="none"/>`;
  const dadi = (pos: [number, number][]) => pos.map(([x, y]) => `<rect x="${x}" y="${y}" width="3.2" height="3.2" rx=".6" fill="${POM}" stroke-width="1"/>`).join('');
  return (
    `<g transform="translate(9 -10)">${fetta}${dadi([[12, 24.5], [17, 25.5], [22, 25], [15, 28.6], [24, 29]])}</g>` +
    fetta + dadi([[11, 25], [16, 26.5], [21, 25.5], [25, 27.5], [14, 29.5], [19, 30]]) + foglia(21, 29.5, 15, 0.9)
  );
};

const focaccia = () =>
  `<path d="M6 16q0-5 6-5h24q6 0 6 5v16q0 5-6 5H12q-6 0-6-5z" fill="#E2A848"/>` +
  `<path d="M9 17q0-3 4-3h22q4 0 4 3v13q0 4-4 4H13q-4 0-4-4z" fill="#EDBE62" stroke="none"/>` +
  [13, 20, 27, 34].flatMap((x) => [18, 25, 31].map((y) => `<circle cx="${x + (y === 25 ? 3 : 0)}" cy="${y}" r="1.6" fill="#C4832E" stroke="none"/>`)).join('') +
  `<path d="M15 21.5l2.4-1.4M24 19l1.6 2M30 27l2.5-.8M18 28.6l1.4 2M33 20.6l1.6 1.8M25 31.5l2.4-.6" stroke="${BASILICO}" stroke-width="1.6"/>` +
  punti([[12, 25], [22, 23], [36, 27], [28, 18], [17, 33]], BIANCO, 0.7);

const polenta = () =>
  `<ellipse cx="24" cy="34" rx="21" ry="8" fill="${ROVERE}"/><path d="M41 36.4l5 1.5" stroke="${ROVERE}" stroke-width="4"/>` +
  `<path d="M9 32c1-14 29-14 30 0-7 3-23 3-30 0z" fill="#F2BE3A"/>` +
  punti([[16, 27], [21, 24], [27, 25], [32, 28], [24, 29], [18, 31]], '#D99B22', 0.9) +
  `<rect x="21" y="18.5" width="7" height="4" rx="1" transform="rotate(-12 24.5 20.5)" fill="#FFE9A8" stroke-width="1.4"/>`;

const cannelloni = () =>
  `<rect x="4" y="11" width="40" height="28" rx="5" fill="${PET}"/><rect x="8" y="15" width="32" height="20" rx="3" fill="#F5E3B8" stroke="none"/>` +
  [16, 22.4, 28.8].map((y) => `<rect x="8" y="${y}" width="32" height="5.6" rx="2.8" fill="${CREMA}" stroke-width="1.4"/><ellipse cx="10.6" cy="${y + 2.8}" rx="1.6" ry="2.2" fill="${VERDE}" stroke-width="1"/>`).join('') +
  `<path d="M17 15c4 7 0 13 4 20h5c-4-7 0-13-4-20zM30 15c4 7 0 13 4 20h4c-4-7 0-13-4-20z" fill="${POM}" stroke="none"/>` +
  foglia(25, 25, 30, 0.9);

const crostata = () => {
  const r = 13.5;
  const linee = [-6, 0, 6].map((d) => {
    const h = Math.sqrt(r * r - d * d).toFixed(2);
    return `M${24 + d} ${(25 - +h).toFixed(2)}V${(25 + +h).toFixed(2)}M${(24 - +h).toFixed(2)} ${25 + d}H${(24 + +h).toFixed(2)}`;
  }).join('');
  return (
    `<circle cx="24" cy="25" r="19" fill="#D9A24E"/><circle cx="24" cy="25" r="${r}" fill="#D2562E"/>` +
    `<path d="${linee}" stroke="#2B2C2E" stroke-width="5.4"/><path d="${linee}" stroke="#E8B860" stroke-width="3.2"/>` +
    `<circle cx="24" cy="25" r="${r}" fill="none" stroke-width="1.6"/>`
  );
};

const ciambellone = () =>
  piatto(38, 20, 6) +
  `<path d="M7 22v10c0 7 34 7 34 0V22z" fill="#C98436"/>` +
  `<path d="M13 28v6M19 29v6.5M29 29v6.5M35 28v6" stroke="#A86A28" stroke-width="1.2"/>` +
  `<ellipse cx="24" cy="22" rx="17" ry="6" fill="#E0A85A"/><ellipse cx="24" cy="22" rx="5" ry="1.8" fill="#7A4A1E"/>` +
  punti([[12, 21], [16, 24.5], [21, 18], [30, 18.2], [34, 24], [36, 20], [25, 25.8], [17, 19.4]], BIANCO, 0.9);

const tortaSalata = () =>
  `<path d="M5 25v6c0 9 38 9 38 0v-6z" fill="#D9A24E"/>` +
  `<path d="M10 31v5M17 33v5M24 33.4v5M31 33v5M38 31v5" stroke="#B57E2E" stroke-width="1.2"/>` +
  `<ellipse cx="24" cy="25" rx="19" ry="8" fill="#E6B460"/><ellipse cx="24" cy="25" rx="15" ry="5.6" fill="#C9DDB0"/>` +
  punti([[15, 24], [19, 27], [23, 22.5], [27, 26.5], [31, 23.5], [34, 26], [21, 25], [28, 21.6]], '#4E7A3E', 1);

const pastaForno = () => {
  const pen = (x: number, y: number, r: number) =>
    `<g transform="translate(${x} ${y}) rotate(${r})"><path d="M-4.5-1.6h7l2 3.2h-7z" fill="${PASTA}" stroke-width="1.1"/><ellipse cx="-3.5" cy="0" rx=".8" ry="1.6" fill="${PASTA_SCURA}" stroke="none"/></g>`;
  return (
    `<rect x="1" y="21" width="5" height="8" rx="2" fill="${ROVERE}"/><rect x="42" y="21" width="5" height="8" rx="2" fill="${ROVERE}"/>` +
    `<rect x="4" y="11" width="40" height="28" rx="5" fill="${ROVERE}"/><rect x="8" y="15" width="32" height="20" rx="3" fill="#E29A3C"/>` +
    pen(14, 20, 20) + pen(24, 19, -15) + pen(33, 21, 35) + pen(16, 29, -30) + pen(26, 27, 10) + pen(34, 31, -20) + pen(20, 24, 70) +
    punti([[12, 25], [21, 31], [30, 25], [36, 17.5], [26, 33]], BRUNO, 1.3)
  );
};

const spezzatino = () =>
  `<ellipse cx="6" cy="25" rx="3" ry="2" fill="${PET}"/><ellipse cx="42" cy="25" rx="3" ry="2" fill="${PET}"/>` +
  `<path d="M7 22h34v12c0 6-34 6-34 0z" fill="${PET}"/><ellipse cx="24" cy="22" rx="17" ry="5" fill="#8A4A2A"/>` +
  [[15, 21], [27, 23], [33, 20.5]].map(([x, y]) => `<rect x="${x - 2.4}" y="${y - 2}" width="4.8" height="4" rx="1.2" fill="#5E301B" stroke-width="1.2"/>`).join('') +
  [[21, 21], [31, 24]].map(([x, y]) => `<rect x="${x - 2}" y="${y - 1.8}" width="4" height="3.6" rx="1" fill="${PASTA}" stroke-width="1.2"/>`).join('') +
  `<circle cx="11" cy="22.5" r="1.8" fill="${ARANCIO}" stroke-width="1"/><circle cx="36.5" cy="23" r="1.8" fill="${ARANCIO}" stroke-width="1"/>` +
  vapore();

// ─── Pasta ───
const spaghetti = () =>
  piatto(35, 20, 8) +
  `<ellipse cx="22" cy="29" rx="14" ry="7" fill="${PASTA}"/>` +
  `<path d="M11 29c3-5 18-6 22-1M12 31c5 3 16 3 20-1M14 27c4-4 14-4 17 0M15 30c3 2 11 2 13-1M18 27.6c3-1.6 7-1.6 9 .4" stroke="${PASTA_SCURA}" stroke-width="1.2" fill="none"/>` +
  `<path d="M28 27l11-18" stroke="${VAPORE}" stroke-width="3"/><path d="M37 11.5l3.6-6.2M39 12.7l3.6-6.2M35 10.3l3.6-6.2" stroke="${VAPORE}" stroke-width="1.6"/>` +
  `<path d="M26 24c2 2 4 3 6 2" stroke="${PASTA}" stroke-width="2.4" fill="none"/>`;

const penne = () => {
  const p = (x: number, y: number, r: number) =>
    `<g transform="translate(${x} ${y}) rotate(${r})"><path d="M-11-4h17l5 8h-17z" fill="${PASTA}"/><path d="M-6-4l5 8M-1-4l5 8M4-4l3.4 5.4" stroke="${PASTA_SCURA}" stroke-width="1"/><ellipse cx="8.6" cy="0" rx="1.6" ry="4" transform="rotate(-30 8.6 0)" fill="${PASTA_SCURA}" stroke-width="1.4"/></g>`;
  return `<g transform="scale(1.15) translate(-3 -3)">${p(22, 16, -25) + p(24, 32, 15)}</g>`;
};

const fusilli = () => {
  const f = (x: number, y: number, r: number) =>
    `<g transform="translate(${x} ${y}) rotate(${r})">` +
    [-10, -5, 0, 5, 10].map((d) => `<ellipse cx="${d}" cy="0" rx="3.4" ry="6" transform="rotate(30 ${d} 0)" fill="${PASTA}" stroke-width="1.6"/>`).join('') +
    `</g>`;
  return f(20, 17, -20) + f(27, 32, 10);
};

const farfalle = () =>
  `<path d="M7 11q-5 13 0 26l15-9q2-4 0-8z" fill="${PASTA}"/><path d="M41 11q5 13 0 26l-15-9q-2-4 0-8z" fill="${PASTA}"/>` +
  `<path d="M8 15l9 6M7 24h10M8 33l9-6M40 15l-9 6M41 24H31M40 33l-9-6" stroke="${PASTA_SCURA}" stroke-width="1.1"/>` +
  `<rect x="20" y="18.5" width="8" height="11" rx="3" fill="#E3A530"/><path d="M22 20v8M26 20v8" stroke="${PASTA_SCURA}" stroke-width="1"/>`;

const rigatoni = () => {
  const r = (x: number) =>
    `<path d="M${x - 6} 14v20c0 3 12 3 12 0V14z" fill="${PASTA}"/>` +
    `<path d="M${x - 3} 16v19.4M${x} 16.4v19.6M${x + 3} 16v19.4" stroke="${PASTA_SCURA}" stroke-width="1"/>` +
    `<ellipse cx="${x}" cy="14" rx="6" ry="2.6" fill="${PASTA}"/><ellipse cx="${x}" cy="14" rx="3.6" ry="1.4" fill="#9C6B1E" stroke-width="1.2"/>`;
  return r(15) + r(31);
};

const orecchiette = () =>
  [[14, 17], [32, 15], [23, 27], [12, 34], [35, 33]].map(([x, y]) =>
    `<ellipse cx="${x}" cy="${y}" rx="7.4" ry="6" fill="${PASTA}"/><ellipse cx="${x + 0.5}" cy="${y + 0.5}" rx="4.4" ry="3.4" fill="#E6B44E" stroke="${PASTA_SCURA}" stroke-width="1"/>`).join('');

const tagliatelle = () =>
  `<circle cx="24" cy="25" r="17" fill="${PASTA}"/>` +
  [`M10 22c4-10 22-12 28-2`, `M9 28c4 9 24 10 30-2`, `M13 25c3-7 18-8 22 0`, `M14 29c4 5 16 5 20-2`, `M17 24c4-4 11-4 14 1`, `M18 28c3 2 9 2 11-1`].map((d) => `<path d="${d}" stroke="${PASTA_SCURA}" stroke-width="1.3" fill="none"/>`).join('') +
  `<path d="M38 20q5 2 6 7" stroke="${PASTA}" stroke-width="3.6" fill="none"/><path d="M38 20q5 2 6 7" stroke="${PASTA_SCURA}" stroke-width="1" fill="none"/>`;

const ravioli = () => {
  const r = (x: number, y: number, a: number) =>
    `<g transform="translate(${x} ${y}) rotate(${a})"><rect x="-8" y="-8" width="16" height="16" rx="2" fill="${PASTA}"/><rect x="-5.4" y="-5.4" width="10.8" height="10.8" rx="4" fill="#F7DA92" stroke="none"/><rect x="-6.4" y="-6.4" width="12.8" height="12.8" rx="1.4" fill="none" stroke="${PASTA_SCURA}" stroke-width="1" stroke-dasharray="1.4 1.4"/></g>`;
  return r(16, 16, -10) + r(32, 18, 12) + r(23, 33, 4);
};

// ─── Pesce ───
const salmone = () =>
  `<path d="M6 30c2-9 10-15 20-16 9-1 16 4 16 10 0 7-8 11-19 11C14 35 6 34 6 30z" fill="#F08A5D"/>` +
  `<path d="M6 30c2 3 8 5 17 5 11 0 19-4 19-11 0 4-6 9-19 9-9 0-14-1-17-3z" fill="#7D8A93" stroke-width="1.4"/>` +
  `<path d="M14 21c3 3 4 7 3 11M21 17c3 4 4 9 3 15M29 15.5c2 4 3 9 1 15M36 18c1 3 1 7-1 11" stroke="${GRASSO}" stroke-width="1.6" fill="none"/>`;

const tonno = () =>
  `<path d="M7 24v10c0 5 34 5 34 0V24z" fill="${PET}"/><path d="M7 29c0 4 34 4 34 0" stroke="${BIANCO}" stroke-width="1.6" fill="none"/>` +
  `<ellipse cx="24" cy="24" rx="17" ry="5.4" fill="${ARGENTO}"/><ellipse cx="24" cy="24" rx="14.4" ry="4" fill="#D9A38A" stroke-width="1.4"/>` +
  `<path d="M14 23.5c3-1 5 1 8 0M23 25.4c3-1 6 .6 9-.6M26 22.4c2 .6 4-.4 6 .2" stroke="#B57B62" stroke-width="1.1" fill="none"/>` +
  `<path d="M33 19c4-9 10-8 10-4 0 3-5 6-9 7" fill="${ARGENTO}"/><circle cx="40" cy="14.6" r="1.6" fill="none" stroke-width="1.4"/>`;

const orata = () =>
  `<path d="M4 25c5-9 16-12 26-8l7 4 7-6v20l-7-6-7 4C20 37 9 34 4 25z" fill="${ARGENTO}"/>` +
  `<path d="M30 17l7 4M30 33l7-4" stroke="none"/>` +
  `<path d="M18 16c3-4 8-4 10 0" fill="#9FB0B6"/><path d="M17 34c3 3 7 3 9 0" fill="#9FB0B6"/>` +
  `<path d="M14 18c-1 5-1 9 0 14" stroke="#7F9198" stroke-width="1.6" fill="none"/>` +
  `<path d="M9 21.5c1.5-1 3-1 4.4 0" stroke="#E3A530" stroke-width="2.4" fill="none"/>` +
  `<circle cx="10" cy="24" r="1.7" fill="#2B2C2E" stroke="none"/><path d="M5.5 27.5q2 1 4 0" stroke-width="1.4" fill="none"/>` +
  `<path d="M20 24h10M22 28h8" stroke="#9FB0B6" stroke-width="1.2"/>`;

const acciughe = () => {
  const a = (y: number, x: number) =>
    `<g transform="translate(${x} ${y})"><path d="M-17 0c6-4 20-4 28-1l5-3v8l-5-3c-8 3-22 3-28-1z" fill="#8FA8B8" stroke-width="1.5"/><path d="M-14 1c6 1.6 16 1.6 24 0" stroke="#4F6F86" stroke-width="1.2" fill="none"/><circle cx="-13.4" cy="-.8" r="1" fill="#2B2C2E" stroke="none"/></g>`;
  return a(14, 23) + a(24, 26) + a(34, 22);
};

const cozze = () =>
  `<path d="M8 36C6 28 14 12 22 9c4-1 6 2 5 6-2 9-9 20-15 23-2 1-3 0-4-2z" fill="#2F3A4A"/>` +
  `<path d="M12 31c3-6 7-13 12-18" stroke="#5D6F86" stroke-width="1.6" fill="none"/>` +
  `<path d="M21 40c-1-7 6-19 14-23 4-2 7 0 6 4-1 8-9 18-16 21-2 1-4 0-4-2z" fill="#2F3A4A"/>` +
  `<path d="M24 37c2-6 7-12 14-17" stroke="#5D6F86" stroke-width="1.6" fill="none"/>` +
  `<path d="M27.5 34c2-4 6-9 10-11-1 5-5 10-10 11z" fill="#E8893A" stroke-width="1.2"/>`;

const vongole = () => {
  const v = (x: number, y: number, s: number) =>
    `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-12 4c0-9 6-14 12-14S12-5 12 4c-4 3-20 3-24 0z" fill="#E6D3B3"/><path d="M0 5.5V-9M-6 5L-3-8.5M6 5L3-8.5M-10 3.5L-7-5M10 3.5L7-5" stroke="#B09370" stroke-width="1.1"/><path d="M-4 6.4c2 2 6 2 8 0" fill="#B09370" stroke-width="1.2"/></g>`;
  return v(15, 20, 0.95) + v(33, 22, 0.85) + v(23, 34, 1);
};

const calamari = () => {
  const a = (x: number, y: number, r: number) =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill="#E8B05A"/><circle cx="${x}" cy="${y}" r="${r * 0.48}" fill="${CREMA}"/>` +
    punti([[x - r * 0.7, y - r * 0.3], [x + r * 0.5, y - r * 0.6], [x + r * 0.6, y + r * 0.5], [x - r * 0.3, y + r * 0.72]], '#B97A2A', 0.7);
  return piatto(37, 20, 6) + a(16, 25, 7) + a(31, 24, 6.4) + a(24, 31, 6.4) + `<path d="M34 34a5 5 0 0 0 8-4z" fill="#F4D03F" stroke-width="1.5"/>`;
};

const pesceSpada = () =>
  `<ellipse cx="24" cy="25" rx="19" ry="15" fill="#6E7B85"/><ellipse cx="24" cy="25" rx="16.4" ry="12.6" fill="#F2D7C9" stroke="none"/>` +
  `<path d="M24 13v24M8 25h32M13 16l22 18M35 16L13 34" stroke="#E0B5A4" stroke-width="1.2"/>` +
  `<ellipse cx="24" cy="25" rx="3.4" ry="2.6" fill="#B04E4E" stroke-width="1.2"/>`;

// ─── Carne ───
const bistecca = () =>
  `<path d="M7 24C6 14 16 9 26 10s17 7 16 16c-1 8-9 13-19 12C14 37 8 32 7 24z" fill="${GRASSO}"/>` +
  `<path d="M11 24c-1-8 7-11 15-11s13 5 12 12c-1 6-7 9-15 9-7 0-11-4-12-10z" fill="${CARNE}" stroke="none"/>` +
  `<path d="M14 18.5c6 1.4 14 1.4 20-.6l.8 3c-3 1-5.6 1.6-8.2 1.9L26 34.6l-3.4.2.2-11.6c-3-.2-6-.6-9.2-1.4z" fill="${BIANCO}" stroke-width="1.4"/>` +
  `<path d="M14 21c2 1 4 1 6 0M30 31c2 0 3-1 4-2" stroke="#E07A6E" stroke-width="1.1" fill="none"/>`;

const pettoPollo = () =>
  `<path d="M6 30C5 21 13 13 22 14c5 1 6 5 4 9-3 7-9 12-15 12-3 0-5-2-5-5z" fill="#F2B8A8"/>` +
  `<path d="M11 27c3-4 7-7 11-9M12 31c3-1 6-3 8-5" stroke="#E0948A" stroke-width="1.2" fill="none"/>` +
  `<path d="M22 34c-1-9 7-17 16-16 5 1 6 5 4 9-3 7-9 12-15 12-3 0-5-2-5-5z" fill="#F2B8A8"/>` +
  `<path d="M27 31c3-4 7-7 11-9M28 35c3-1 6-3 8-5" stroke="#E0948A" stroke-width="1.2" fill="none"/>`;

const salsiccia = () => {
  const s = (x: number, y: number, r: number) =>
    `<g transform="translate(${x} ${y}) rotate(${r})"><rect x="-8" y="-4.6" width="16" height="9.2" rx="4.6" fill="#C0704A"/>` +
    punti([[-4, -1.5], [0, 1.8], [3.6, -1.8], [-1.4, -2.4], [5, 1.4]], '#F1C3A6', 0.8) + `</g>`;
  return s(11, 30, -40) + s(24, 22, 0) + s(37, 30, 40) + `<path d="M16 24.4l1.4 1.4M30.6 24.4l-1.4 1.4" stroke-width="3"/>`;
};

const macinato = () =>
  `<rect x="4" y="16" width="40" height="22" rx="5" fill="${BIANCO}"/><rect x="7" y="19" width="34" height="16" rx="3" fill="#EDEFF0" stroke="none"/>` +
  `<path d="M9 30c0-8 6-11 15-11s15 3 15 11c-4 4-26 4-30 0z" fill="#C95C4F"/>` +
  `<path d="M13 27c1-2 3-1 4-3s3-1 4 0M22 23c2-1 3 1 5 0s3 0 4 1M26 28c1-2 3-1 4-2s3 0 4 1M15 31c2-1 3 0 5-1M27 31.4c2 0 3-1 5 0M19 26.6c1 .6 2 .6 3 0" stroke="#EE9C90" stroke-width="1.2" fill="none"/>`;

const arrosto = () =>
  `<rect x="3" y="30" width="42" height="8" rx="3" fill="${ROVERE}"/>` +
  `<path d="M8 22c0-6 4-9 9-9h14c5 0 9 3 9 9s-4 9-9 9H17c-5 0-9-3-9-9z" fill="#9A5532"/>` +
  `<ellipse cx="34" cy="22" rx="6" ry="9" fill="#D98A7A"/><ellipse cx="34" cy="22" rx="3" ry="5" fill="#C25E52" stroke="none"/>` +
  `<path d="M14 13.4v17.2M20 13v18M26 13v18" stroke="${CREMA}" stroke-width="1.8"/>` +
  foglia(17, 11.6, -15, 0.8);

const costine = () =>
  `<path d="M6 22h36v10c0 4-3 6-7 6H13c-4 0-7-2-7-6z" fill="#9A4A2A"/>` +
  [11, 18, 25, 32, 39].map((x) => `<rect x="${x - 2}" y="12" width="4" height="12" rx="2" fill="${GRASSO}"/>`).join('') +
  `<path d="M6 22h36" stroke-width="2"/><path d="M10 28c4 2 8-1 12 1s8 2 12 0 6 0 7 .6" stroke="#C26A3E" stroke-width="1.6" fill="none"/>`;

// ─── Formaggi ───
const parmigiano = () =>
  `<path d="M4 30L30 12l14 10v10L18 40z" fill="#EBC86A"/>` +
  `<path d="M4 30L30 12l14 10L18 32z" fill="#F3D88A"/><path d="M4 30l14 2v8L4 38z" fill="#EBC86A"/>` +
  `<path d="M30 12l14 10v10l-3-2V22z" fill="#C9922E" stroke-width="1.4"/><path d="M18 32l26-10" stroke-width="1.4"/>` +
  punti([[16, 26], [22, 23], [27, 19], [24, 28], [31, 23], [36, 21], [11, 28], [20, 36], [28, 33], [34, 30], [9, 33]], '#D4A94A', 0.7);

const mozzarella = () =>
  piatto(36, 20, 7) +
  `<circle cx="20" cy="25" r="11" fill="${BIANCO}"/><path d="M15 18c2-2 5-3 7-2" stroke="#E2E6E8" stroke-width="2" fill="none"/>` +
  `<circle cx="33" cy="29" r="5.6" fill="${BIANCO}"/>` +
  foglia(31, 19.5, -30, 1.1) + foglia(36, 22, 20, 0.9);

const gorgonzola = () =>
  `<path d="M5 30L30 13l13 9v10L18 40z" fill="#EFE4C6"/>` +
  `<path d="M5 30L30 13l13 9L18 32z" fill="#F7F0DA"/><path d="M5 30l13 2v8L5 38z" fill="#EFE4C6"/>` +
  `<path d="M30 13l13 9v10l-2.6-1.6V22.4z" fill="#C9B07E" stroke-width="1.4"/><path d="M18 32l25-10" stroke-width="1.4"/>` +
  `<path d="M13 28c2-2 4 1 6-1s3-3 5-2M22 22c2 0 3-2 5-2M27 27c2-1 4 0 5-2M8 34c2 0 3-1 4 1M22 36c1-2 3-1 4-2M33 31c1-1 3-1 4-2" stroke="#4E7F8A" stroke-width="1.6" fill="none"/>`;

const ricotta = () =>
  `<path d="M8 30h32l-4 9H12z" fill="${ROVERE_CHIARO}"/>` +
  `<path d="M9 30c0-11 7-17 15-17s15 6 15 17z" fill="${BIANCO}"/>` +
  `<path d="M13 24l6 6M18 18l11 12M24 14l12 15M15 30l12-14M21 30l11-13M28 30l8-9M10 27l5 3" stroke="#E2DED4" stroke-width="1.1"/>` +
  `<path d="M9 30c0-11 7-17 15-17s15 6 15 17z" fill="none"/><path d="M15 34h18" stroke="#9C7448" stroke-width="1.2"/>`;

const pecorino = () =>
  `<path d="M5 20v12c0 7 38 7 38 0V20z" fill="#8A6A3A"/>` +
  `<path d="M9 26l3 4M15 27l3 4M21 28l3 4M27 28l3 4M33 27l3 4" stroke="#6B4E26" stroke-width="1.1"/>` +
  `<ellipse cx="24" cy="20" rx="19" ry="7" fill="#F2E3B9"/>` +
  `<path d="M24 20l13.4-5V27.4L24 32z" fill="#E6D3A2"/><path d="M24 20l13.4-5" stroke-width="1.6"/><ellipse cx="24" cy="20" rx="19" ry="7" fill="none"/>` +
  punti([[16, 19], [20, 22], [13, 21], [28, 23.6]], '#D9C38E', 0.8);

const burrata = () =>
  `<path d="M24 16c-7 0-15 5-15 13s7 11 15 11 15-3 15-11-8-13-15-13z" fill="${BIANCO}"/>` +
  `<path d="M20 16.6c1-4 2-8 1-10 2 1 3 2 3 4 0-2 1-3 3-4-1 2 0 6 1 10" fill="${BIANCO}" stroke-width="1.6"/>` +
  `<path d="M20 16.6c2 1 6 1 8 0" stroke-width="1.6" fill="none"/>` +
  `<path d="M15 26c2-3 5-4 7-4" stroke="#E2E6E8" stroke-width="2" fill="none"/>` +
  foglia(8, 37, 30, 1.2) + foglia(40, 37, -30, 1.2);

const provolone = () =>
  `<path d="M24 4v6" stroke="${ROVERE}" stroke-width="1.8"/>` +
  `<path d="M24 10c-6 0-9 4-9 9 0 3 1 5 1 7-2 2-4 5-4 8 0 6 6 9 12 9s12-3 12-9c0-3-2-6-4-8 0-2 1-4 1-7 0-5-3-9-9-9z" fill="#E8B850"/>` +
  `<path d="M15.6 19h16.8M16 26.4h16M13 33h22" stroke="${ROVERE}" stroke-width="1.6"/><path d="M24 10v33" stroke="${ROVERE}" stroke-width="1.4"/>`;

// ─── Salumi ───
const prosciuttoCrudo = () =>
  `<path d="M38 8c3 1 4 4 2 6L30 26" stroke="${CREMA}" stroke-width="4"/>` +
  `<path d="M28 13C17 10 6 18 5 28c-1 7 5 12 14 12 12 0 19-8 19-16 0-5-4-10-10-11z" fill="#C98A52"/>` +
  `<ellipse cx="19" cy="30" rx="11" ry="7.6" transform="rotate(-20 19 30)" fill="${GRASSO}"/>` +
  `<ellipse cx="18.6" cy="30.6" rx="8.4" ry="5.6" transform="rotate(-20 18.6 30.6)" fill="#D9746E" stroke="none"/>` +
  `<circle cx="22" cy="29" r="1.6" fill="${BIANCO}" stroke-width="1.1"/>` +
  `<path d="M14 28c2 1 3 3 3 5M17 26c3 0 5 1 6 2" stroke="#E79A93" stroke-width="1" fill="none"/>`;

const prosciuttoCotto = () =>
  `<path d="M8 22c0-8 7-12 16-12s16 4 16 12-7 13-16 13S8 30 8 22z" fill="#F7C2BA" transform="translate(4 -3)"/>` +
  `<path d="M6 27c0-8 7-12 16-12s16 4 16 12-7 13-16 13S6 35 6 27z" fill="${GRASSO}"/>` +
  `<path d="M9 27c0-6 6-9.4 13-9.4S35 21 35 27s-6 10-13 10S9 33 9 27z" fill="${ROSA}" stroke="none"/>` +
  `<path d="M14 24c3-2 7-2 10 0M18 31c3 1 7 1 10-1" stroke="#E08A84" stroke-width="1.1" fill="none"/>`;

const mortadella = () =>
  `<path d="M22 10h16c5 0 8 7 8 15s-3 15-8 15H22z" fill="#E8949A"/>` +
  `<circle cx="20" cy="25" r="16" fill="#F4B1B3"/>` +
  punti([[13, 19], [22, 16], [27, 22], [15, 29], [24, 31], [20, 23], [11, 25], [28, 29], [18, 35], [25, 17.5]], GRASSO, 1.6) +
  punti([[18, 18.6], [26, 26], [13, 33], [22, 28]], '#7DAA4E', 1);

const salame = () =>
  `<path d="M14 12h24c5 0 8 6 8 13s-3 13-8 13H14z" fill="#8A3A35"/>` +
  punti([[20, 15], [27, 16], [34, 15], [24, 35], [31, 34.6], [38, 34], [41, 18]], '#E9E1D6', 1.3) +
  `<ellipse cx="14" cy="25" rx="9" ry="13" fill="#B8434A"/>` +
  punti([[11, 18], [16, 20], [12, 25], [17, 27], [11, 31], [15, 33.6], [18, 22.6]], GRASSO, 1.2) +
  `<circle cx="34" cy="38" r="0" stroke="none"/>`;

const guanciale = () =>
  `<path d="M6 18l6-6h30l-6 6z" fill="#6E5A3E"/>` +
  punti([[14, 14.4], [20, 15.4], [26, 13.8], [33, 15], [38, 13.6], [17, 16.8], [30, 17]], '#2B2C2E', 0.6) +
  strati(6, 30, [[18, 22, GRASSO], [22, 26, '#D9746E'], [26, 29, GRASSO], [29, 33, '#C95C55'], [33, 36, GRASSO]]) +
  `<path d="M36 18l6-6v18l-6 6z" fill="#E8CFC2"/>`;

const bresaola = () =>
  [[13, 30, -20], [22, 26, 0], [32, 22, 20]].map(([x, y, r]) =>
    `<g transform="translate(${x} ${y}) rotate(${r})"><ellipse cx="0" cy="0" rx="10" ry="12" fill="#8E2E35"/><path d="M-5-6c3-2 7-1 8 2M-4 5c3 1 6 0 7-2" stroke="#B4505A" stroke-width="1.1" fill="none"/></g>`).join('') +
  foglia(38, 38, -20, 1.3);

export type GruppoCibo = 'Piatti' | 'Pasta' | 'Pesce' | 'Carne' | 'Formaggi' | 'Salumi';

export interface DisegnoCibo {
  id: string;
  nome: string;
  gruppo: GruppoCibo;
  svg: string;
}

const d = (id: string, nome: string, gruppo: GruppoCibo, fn: () => string): DisegnoCibo => ({ id, nome, gruppo, svg: fn() });

export const DISEGNI_CIBO: readonly DisegnoCibo[] = [
  d('lasagna', 'Lasagna', 'Piatti', lasagna),
  d('risotto', 'Risotto', 'Piatti', risotto),
  d('parmigiana', 'Parmigiana', 'Piatti', parmigiana),
  d('gnocchi', 'Gnocchi', 'Piatti', gnocchi),
  d('tortellini', 'Tortellini in brodo', 'Piatti', tortellini),
  d('pasta_forno', 'Pasta al forno', 'Piatti', pastaForno),
  d('cannelloni', 'Cannelloni', 'Piatti', cannelloni),
  d('zuppa', 'Zuppa', 'Piatti', zuppa),
  d('vellutata', 'Vellutata', 'Piatti', vellutata),
  d('polenta', 'Polenta', 'Piatti', polenta),
  d('cotoletta', 'Cotoletta', 'Piatti', cotoletta),
  d('polpette', 'Polpette al sugo', 'Piatti', polpette),
  d('spezzatino', 'Spezzatino', 'Piatti', spezzatino),
  d('frittata', 'Frittata', 'Piatti', frittata),
  d('torta_salata', 'Torta salata', 'Piatti', tortaSalata),
  d('arancino', 'Arancino', 'Piatti', arancino),
  d('bruschetta', 'Bruschetta', 'Piatti', bruschetta),
  d('focaccia', 'Focaccia', 'Piatti', focaccia),
  d('tiramisu', 'Tiramisù', 'Piatti', tiramisu),
  d('panna_cotta', 'Panna cotta', 'Piatti', pannaCotta),
  d('crostata', 'Crostata', 'Piatti', crostata),
  d('ciambellone', 'Ciambellone', 'Piatti', ciambellone),

  d('spaghetti', 'Spaghetti', 'Pasta', spaghetti),
  d('penne', 'Penne', 'Pasta', penne),
  d('fusilli', 'Fusilli', 'Pasta', fusilli),
  d('farfalle', 'Farfalle', 'Pasta', farfalle),
  d('rigatoni', 'Rigatoni', 'Pasta', rigatoni),
  d('orecchiette', 'Orecchiette', 'Pasta', orecchiette),
  d('tagliatelle', 'Tagliatelle', 'Pasta', tagliatelle),
  d('ravioli', 'Ravioli', 'Pasta', ravioli),

  d('salmone', 'Salmone', 'Pesce', salmone),
  d('tonno', 'Tonno in scatola', 'Pesce', tonno),
  d('orata', 'Orata, branzino', 'Pesce', orata),
  d('acciughe', 'Acciughe, sardine', 'Pesce', acciughe),
  d('cozze', 'Cozze', 'Pesce', cozze),
  d('vongole', 'Vongole', 'Pesce', vongole),
  d('calamari', 'Anelli di calamaro', 'Pesce', calamari),
  d('pesce_spada', 'Pesce spada', 'Pesce', pesceSpada),

  d('bistecca', 'Bistecca', 'Carne', bistecca),
  d('petto_pollo', 'Petto di pollo', 'Carne', pettoPollo),
  d('salsiccia', 'Salsiccia', 'Carne', salsiccia),
  d('macinato', 'Carne macinata', 'Carne', macinato),
  d('arrosto', 'Arrosto', 'Carne', arrosto),
  d('costine', 'Costine', 'Carne', costine),

  d('parmigiano', 'Parmigiano, grana', 'Formaggi', parmigiano),
  d('mozzarella', 'Mozzarella', 'Formaggi', mozzarella),
  d('gorgonzola', 'Gorgonzola', 'Formaggi', gorgonzola),
  d('ricotta', 'Ricotta', 'Formaggi', ricotta),
  d('pecorino', 'Pecorino', 'Formaggi', pecorino),
  d('burrata', 'Burrata', 'Formaggi', burrata),
  d('provolone', 'Provolone', 'Formaggi', provolone),

  d('prosciutto_crudo', 'Prosciutto crudo', 'Salumi', prosciuttoCrudo),
  d('prosciutto_cotto', 'Prosciutto cotto', 'Salumi', prosciuttoCotto),
  d('mortadella', 'Mortadella', 'Salumi', mortadella),
  d('salame', 'Salame', 'Salumi', salame),
  d('guanciale', 'Pancetta, guanciale', 'Salumi', guanciale),
  d('bresaola', 'Bresaola', 'Salumi', bresaola),
];

export const DISEGNO_PER_ID: ReadonlyMap<string, DisegnoCibo> = new Map(DISEGNI_CIBO.map((x) => [x.id, x]));
