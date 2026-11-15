/**
 * Confronta due rapporti della valutazione scontrini (fase prima e fase dopo) e dice cosa è cambiato.
 *   node scripts/valuta-scontrini/confronta.mjs <prima.json> <dopo.json>
 * Per ogni metrica: valore prima, valore dopo, e se è meglio o peggio. Poi, per le letture presenti in tutti e due,
 * quali sono diventate perfette e quali hanno smesso di esserlo.
 */
import { readFileSync } from 'node:fs';

const [, , fileA, fileB] = process.argv;
if (!fileA || !fileB) {
  console.error('Uso: node scripts/valuta-scontrini/confronta.mjs <prima.json> <dopo.json>');
  process.exit(2);
}
const [a, b] = [fileA, fileB].map((f) => JSON.parse(readFileSync(f, 'utf8')));
const rapporto = (m) => (m.su === undefined ? m.valore : m.su ? m.valore / m.su : null);
const testo = (m) => (m.su === undefined ? String(m.valore) : m.su ? `${(Math.round((m.valore / m.su) * 1000) / 10).toFixed(1)}% (${m.valore}/${m.su})` : '—');

console.log(`${a.etichetta} (${a.livello}, ${a.casi.length} letture)  →  ${b.etichetta} (${b.livello}, ${b.casi.length} letture)\n`);
if (a.livello !== b.livello) console.log('ATTENZIONE: livelli diversi (testo / foto): i numeri non sono confrontabili.\n');
if (a.ambiente?.tesseract !== b.ambiente?.tesseract) console.log(`ATTENZIONE: il ripiego Tesseract era «${a.ambiente?.tesseract ?? '?'}» prima e «${b.ambiente?.tesseract ?? '?'}» dopo: le letture in cui PaddleOCR non basta non sono confrontabili.\n`);
let meglio = 0;
let peggio = 0;
for (const [k, m] of Object.entries(a.sintesi)) {
  const n = b.sintesi[k];
  if (!n) continue;
  const [x, y] = [rapporto(m), rapporto(n)];
  const verso = x === null || y === null || Math.abs(x - y) < 1e-9 ? '  =' : (m.verso === 'piu' ? y > x : y < x) ? ' ▲ meglio' : ' ▼ PEGGIO';
  if (verso.includes('meglio')) meglio++;
  if (verso.includes('PEGGIO')) peggio++;
  console.log(`${m.etichetta.padEnd(64)} ${testo(m).padStart(16)} → ${testo(n).padEnd(16)}${verso}`);
}
console.log(`\n${meglio} metriche migliorate, ${peggio} peggiorate.`);
const chiave = (c) => `${c.caso}/${c.lettura}`;
const prima = new Map(a.casi.map((c) => [chiave(c), c]));
const comuni = b.casi.filter((c) => prima.has(chiave(c)));
const diventate = comuni.filter((c) => c.perfetta && !prima.get(chiave(c)).perfetta).map(chiave);
const perse = comuni.filter((c) => !c.perfetta && prima.get(chiave(c)).perfetta).map(chiave);
console.log(`Letture in comune: ${comuni.length}. Diventate perfette: ${diventate.length}${diventate.length ? ` (${diventate.join(', ')})` : ''}. Non più perfette: ${perse.length}${perse.length ? ` (${perse.join(', ')})` : ''}.`);
process.exit(peggio ? 1 : 0);
