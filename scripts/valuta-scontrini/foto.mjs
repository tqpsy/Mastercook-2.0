/**
 * Misura la lettura degli scontrini DALLA FOTO, con il lettore vero dell'app (PaddleOCR, poi Tesseract), in un
 * Chromium senza interfaccia. Lento (qualche secondo a lettura): si lancia a mano, non fa parte di `npm test`.
 *
 *   npm run valuta:scontrini:foto -- [--etichetta fase-0] [--casi id,id] [--varianti base|tutte|nessuna]
 *                                    [--congela] [--fuori percorso.json] [--porta 5199] [--tesseract-locale cartella]
 *
 * Per ogni scontrino del corpus (`tests/scontrini/casi/*`) si parte da una foto:
 * - scontrini sintetici: la foto si disegna dalla «stampa» del file di verità;
 * - scontrini veri: la foto che sta nella cartella del caso come `foto.jpg` (o .jpeg, .png, .webp).
 * Poi si legge la foto com'è (due volte, per vedere se il lettore è stabile) e con piccole variazioni che capitano
 * davvero in mano a una persona: JPEG più compresso, foto spostata, più piccola o un po' storta, ombra.
 * Ogni lettura si confronta riga per riga con la verità (src/dominio/valutazione.ts) e il rapporto va in
 * `tests/scontrini/rapporti/<etichetta>.json`. Con `--congela` i testi letti si salvano in `casi/<id>/letture/`:
 * da quel momento li misura anche `npm run valuta:scontrini`, senza browser.
 *
 * Il ripiego Tesseract scarica motore e lingua da cdn.jsdelivr.net. Dove la rete è chiusa si possono servire da locale:
 * motore e worker da node_modules, la lingua dal pacchetto npm `@tesseract.js-data/ita` (scaricato fuori dal progetto, per
 * esempio con `npm pack @tesseract.js-data/ita` e `tar xzf`): `--tesseract-locale <cartella «package»>`. Il rapporto dice
 * quale Tesseract c'era (`ambiente.tesseract`): senza, ogni lettura in cui PaddleOCR non basta fallisce.
 *
 * Serve Chromium (come per `npm run test:e2e`: `npx playwright install chromium`). I valori assoluti dipendono dal
 * computer (caratteri disponibili per le foto sintetiche, versione del browser): si confrontano rapporti prodotti
 * sulla stessa macchina. Per confrontare due rapporti: node scripts/valuta-scontrini/confronta.mjs a.json b.json
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '../..');
const CORPUS = join(RADICE, 'tests/scontrini');

const argomenti = process.argv.slice(2);
const opzione = (nome, predefinito) => {
  const i = argomenti.indexOf(`--${nome}`);
  return i >= 0 ? (argomenti[i + 1] ?? true) : predefinito;
};
const etichetta = opzione('etichetta', 'foto');
const porta = Number(opzione('porta', 5199));
const varianti = opzione('varianti', 'base');
const congela = argomenti.includes('--congela');
const fuori = opzione('fuori', join(CORPUS, 'rapporti', `${etichetta}.json`));
const tessLocale = typeof opzione('tesseract-locale', null) === 'string' ? opzione('tesseract-locale') : null;
const soloCasi = typeof opzione('casi', null) === 'string' ? opzione('casi').split(',') : null;

// Le variazioni sono sempre le stesse: due rapporti si confrontano solo se hanno lette le stesse foto.
const VARIANTI = {
  nessuna: [{ nome: 'originale' }],
  base: [{ nome: 'originale' }, { nome: 'originale-bis' }, { nome: 'jpeg60', q: 0.6 }, { nome: 'spostata', dx: 4 }, { nome: 'piu-piccola', scala: 0.9 }, { nome: 'storta-1-5', rot: 1.5 }, { nome: 'ombra', ombra: true }],
  tutte: [
    { nome: 'originale' }, { nome: 'originale-bis' }, { nome: 'jpeg60', q: 0.6 }, { nome: 'jpeg35', q: 0.35 }, { nome: 'spostata', dx: 4 }, { nome: 'piu-piccola', scala: 0.9 },
    { nome: 'piu-grande', scala: 1.1 }, { nome: 'storta-1-5', rot: 1.5 }, { nome: 'storta-3', rot: 3 }, { nome: 'ombra', ombra: true }, { nome: 'ombra-storta', ombra: true, rot: 1 },
  ],
};
if (!VARIANTI[varianti]) throw new Error(`--varianti: base, tutte o nessuna (non «${varianti}»)`);

const TIPI_FOTO = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const casi = readdirSync(join(CORPUS, 'casi'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(CORPUS, 'casi', d.name, 'verita.json')) && (!soloCasi || soloCasi.includes(d.name)))
  .map((d) => {
    const cartella = join(CORPUS, 'casi', d.name);
    const verita = JSON.parse(readFileSync(join(cartella, 'verita.json'), 'utf8'));
    const foto = readdirSync(cartella).find((f) => /^foto\.(jpe?g|png|webp)$/i.test(f));
    const estensione = foto ? foto.slice(foto.lastIndexOf('.')).toLowerCase() : null;
    return { id: d.name, verita, foto: foto ? { tipo: TIPI_FOTO[estensione], base64: readFileSync(join(cartella, foto)).toString('base64') } : null };
  })
  // Si legge solo ciò che ha una foto o si può disegnare.
  .filter((c) => c.foto || c.verita.stampa);
if (!casi.length) throw new Error('Nessun caso da leggere (--casi sbagliato, o nessuno scontrino con foto o stampa).');

// ── Il server di sviluppo di Vite, che serve i sorgenti al browser (modelli e motore OCR compresi) ──
const vite = spawn('npx', ['vite', '--port', String(porta), '--strictPort', '--host', '127.0.0.1'], { cwd: RADICE, stdio: 'ignore' });
const indirizzo = `http://127.0.0.1:${porta}/Mastercook-2.0/`;
async function aspettaServer() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(indirizzo)).ok) return;
    } catch {
      // non ancora pronto
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Il server di Vite non è partito.');
}

/** Nel browser: disegna, varia, legge e valuta. Restituisce il rapporto e i testi letti. */
async function nelBrowser({ casi, varianti, etichetta, base, tesseract }) {
  const { leggiTestoDaFoto } = await import(`${base}src/ui/ocr.ts`);
  const { creaRapporto, leggiPerValutare, valuta } = await import(`${base}src/dominio/valutazione.ts`);
  const { Indice } = await import(`${base}src/dominio/ricette.ts`);
  const catalogo = (await import(`${base}src/catalogo/catalogo.json`)).default;
  const indice = new Indice(catalogo);

  const daBase64 = (b64, tipo) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: tipo });
  const inBlob = (tela, tipo, q) => new Promise((ok) => tela.toBlob(ok, tipo, q));

  /** Lo scontrino sintetico disegnato dalla stampa, su un tavolo scuro. */
  function disegna(stampa) {
    const L = 620;
    const A = 40 + stampa.length * 34 + 30;
    const tela = document.createElement('canvas');
    tela.width = 900;
    tela.height = A + 200;
    const x = tela.getContext('2d');
    x.fillStyle = '#6b5a48';
    x.fillRect(0, 0, tela.width, tela.height);
    x.translate((tela.width - L) / 2, 100);
    x.fillStyle = '#f4f2ec';
    x.fillRect(0, 0, L, A);
    x.fillStyle = '#222';
    x.font = '22px "Courier New", monospace';
    x.textBaseline = 'top';
    let y = 20;
    for (const [sinistra, destra] of stampa) {
      x.textAlign = 'left';
      x.fillText(sinistra, 20, y);
      if (destra) {
        x.textAlign = 'right';
        x.fillText(destra, L - 20, y);
      }
      y += 34;
    }
    return tela;
  }

  /** La stessa foto, un po' diversa: come cambia da uno scatto all'altro. */
  async function varia(blob, v) {
    if (!v.q && !v.dx && !v.scala && !v.rot && !v.ombra) return blob;
    const img = await createImageBitmap(blob);
    const tela = document.createElement('canvas');
    tela.width = img.width;
    tela.height = img.height;
    const x = tela.getContext('2d');
    x.fillStyle = '#6b5a48';
    x.fillRect(0, 0, tela.width, tela.height);
    x.translate(tela.width / 2 + (v.dx ?? 0), tela.height / 2);
    x.rotate(((v.rot ?? 0) * Math.PI) / 180);
    x.scale(v.scala ?? 1, v.scala ?? 1);
    x.drawImage(img, -img.width / 2, -img.height / 2);
    x.setTransform(1, 0, 0, 1, 0, 0);
    if (v.ombra) {
      const g = x.createLinearGradient(0, 0, tela.width, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.35)');
      g.addColorStop(0.6, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, tela.width, tela.height);
    }
    img.close();
    return inBlob(tela, 'image/jpeg', v.q ?? 0.92);
  }

  const esiti = [];
  const letti = [];
  const tempi = [];
  for (const c of casi) {
    const blobBase = c.foto ? daBase64(c.foto.base64, c.foto.tipo) : await inBlob(disegna(c.verita.stampa), 'image/png');
    for (const v of varianti) {
      const nome = `${c.foto ? 'foto' : 'sintetica'}-${v.nome}`;
      const inizio = performance.now();
      let testo = '';
      let errore = null;
      try {
        testo = await leggiTestoDaFoto(await varia(blobBase, v), () => undefined);
      } catch (e) {
        errore = String(e?.message ?? e);
      }
      tempi.push(performance.now() - inizio);
      const valutazione = valuta(c.verita, leggiPerValutare(testo, indice, c.verita.carrello));
      if (errore) valutazione.errori.unshift(`lettura fallita: ${errore}`);
      esiti.push({ caso: c.id, lettura: nome, valutazione, ...(errore ? { fallita: true } : {}) });
      letti.push({ caso: c.id, nome, testo });
      window.progresso?.(`${c.id} / ${nome}: ${valutazione.perfetta ? 'perfetta' : `${valutazione.righe.ok}/${valutazione.righe.vere} righe`}`);
    }
  }
  const ambiente = { browser: navigator.userAgent, tesseract, varianti: String(varianti.length), tempoMedioLetturaMs: String(Math.round(tempi.reduce((s, t) => s + t, 0) / Math.max(1, tempi.length))) };
  return { rapporto: creaRapporto('foto', etichetta, esiti, ambiente), letti };
}

let browser;
try {
  await aspettaServer();
  browser = await chromium.launch();
  const pagina = await browser.newPage({ viewport: { width: 900, height: 900 } });
  pagina.on('pageerror', (e) => console.error('Errore nella pagina:', e.message));
  await pagina.exposeFunction('progresso', (riga) => console.log(`  ${riga}`));
  if (tessLocale) {
    // Il ripiego Tesseract chiede i suoi file a jsdelivr: li serviamo dai file locali.
    const dove = (u) => {
      const m = u.pathname.match(/^\/npm\/(tesseract\.js@[^/]+\/dist|tesseract\.js-core@[^/]+|@tesseract\.js-data\/ita)\/(.+)$/);
      if (!m) return null;
      return m[1].startsWith('tesseract.js@') ? join(RADICE, 'node_modules/tesseract.js/dist', m[2]) : m[1].startsWith('tesseract.js-core') ? join(RADICE, 'node_modules/tesseract.js-core', m[2]) : join(tessLocale, m[2]);
    };
    await pagina.context().route('https://cdn.jsdelivr.net/**', async (rotta) => {
      const file = dove(new URL(rotta.request().url()));
      if (file && existsSync(file)) return rotta.fulfill({ status: 200, body: readFileSync(file), headers: { 'access-control-allow-origin': '*', 'content-type': file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' } });
      console.error(`Tesseract: file non trovato in locale: ${rotta.request().url()}`);
      return rotta.abort();
    });
  }
  await pagina.goto(indirizzo);
  // Tesseract è raggiungibile? (locale, o dalla rete). Il rapporto lo dice: senza, i numeri non sono confrontabili.
  const tesseract = tessLocale ? 'locale' : (await pagina.evaluate(() => fetch('https://cdn.jsdelivr.net/npm/tesseract.js@v7.0.0/dist/worker.min.js', { method: 'HEAD' }).then((r) => (r.ok ? 'rete' : 'non raggiungibile'), () => 'non raggiungibile')));
  console.log(`Tesseract (ripiego): ${tesseract}`);
  console.log(`Leggo ${casi.length} scontrini × ${VARIANTI[varianti].length} varianti (${casi.filter((c) => c.foto).length} con foto vera)…`);
  const { rapporto, letti } = await pagina.evaluate(nelBrowser, { casi, varianti: VARIANTI[varianti], etichetta, base: '/Mastercook-2.0/', tesseract });
  mkdirSync(dirname(fuori), { recursive: true });
  writeFileSync(fuori, JSON.stringify(rapporto, null, 1) + '\n');
  console.log(`\nRapporto: ${fuori}`);
  for (const m of Object.values(rapporto.sintesi)) console.log(`  ${m.etichetta}: ${m.su === undefined ? m.valore : m.su ? `${Math.round((m.valore / m.su) * 1000) / 10}% (${m.valore}/${m.su})` : '—'}`);
  if (congela) {
    for (const { caso, nome, testo } of letti) {
      if (!testo.trim()) continue;
      const cartella = join(CORPUS, 'casi', caso, 'letture');
      mkdirSync(cartella, { recursive: true });
      writeFileSync(join(cartella, `${nome}.txt`), testo.endsWith('\n') ? testo : `${testo}\n`);
    }
    console.log(`Testi congelati in tests/scontrini/casi/*/letture. Controllali (le foto vere possono avere numeri di carta o tessera) e poi: MC_AGGIORNA_BASE=1 npm run valuta:scontrini`);
  }
} finally {
  await browser?.close();
  vite.kill();
}
