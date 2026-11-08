/**
 * Serve una build (cartella dist) sotto /Mastercook-2.0/ come GitHub Pages, con gzip.
 *   node scripts/velocita/servi.mjs <cartella> [porta=5190]
 */
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const [, , CARTELLA, PORTA = '5190'] = process.argv;
const TIPI = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
const cache = new Map();
createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/Mastercook-2\.0/, '');
  if (p === '/' || p === '') p = '/index.html';
  let file = join(CARTELLA, p);
  try {
    if (!statSync(file).isFile()) throw new Error();
  } catch {
    file = join(CARTELLA, 'index.html');
  }
  if (!cache.has(file)) {
    const dati = readFileSync(file);
    cache.set(file, /\.(js|css|html|svg|json|wasm)$/.test(file) ? { dati: gzipSync(dati), gzip: true } : { dati, gzip: false });
  }
  const { dati, gzip } = cache.get(file);
  res.writeHead(200, { 'content-type': TIPI[extname(file)] ?? 'application/octet-stream', ...(gzip ? { 'content-encoding': 'gzip' } : {}) });
  res.end(dati);
}).listen(Number(PORTA));
