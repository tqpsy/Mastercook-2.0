/**
 * Misura la velocità dell'app su un telefono Android economico simulato (Pixel 7 con CPU rallentata).
 *   node scripts/velocita/misura.mjs <indirizzo app> <utente.json> [rallentamento=6] [ripetizioni=3]
 * Tempi in ms: «pronto» = da quando parte l'azione a quando lo schermo smette di essere occupato;
 * «blocco» = somma dei compiti lunghi (> 50 ms) in cui lo schermo non risponde ai tocchi.
 */
import { readFileSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const [, , URL_APP, FILE_UTENTE, RALLENTA = '6', RIPETI = '3'] = process.argv;
const { utente } = JSON.parse(readFileSync(FILE_UTENTE, 'utf8'));
const LENTA = Number(process.env.MC_RETE_LENTA ?? 0);

const browser = await chromium.launch();

/** Nel browser: registra i compiti lunghi e dà una funzione che aspetta la quiete. */
function sonda() {
  window.__lunghi = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__lunghi.push({ inizio: e.startTime, durata: e.duration });
  }).observe({ type: 'longtask', buffered: true });
  /** Aspetta che per `quiete` ms non ci siano compiti lunghi; dà la fine dell'ultimo dopo `dal`. */
  window.__quiete = async (dal, quiete = 1500) => {
    const fine = () => window.__lunghi.filter((x) => x.inizio + x.durata > dal).reduce((m, x) => Math.max(m, x.inizio + x.durata), 0);
    for (;;) {
      const prima = window.__lunghi.length;
      await new Promise((r) => setTimeout(r, quiete));
      if (window.__lunghi.length === prima) break;
    }
    const lunghi = window.__lunghi.filter((x) => x.inizio + x.durata > dal);
    return { fine: fine(), blocco: Math.round(lunghi.reduce((s, x) => s + x.durata, 0)) };
  };
}

async function contesto() {
  const c = await browser.newContext({ ...devices['Pixel 7'], locale: 'it-IT', serviceWorkers: 'block' });
  await c.addInitScript((u) => {
    const sessione = {
      access_token: u.token,
      refresh_token: 'prova',
      token_type: 'bearer',
      expires_in: 86400,
      // Con MC_RETE_LENTA la sessione è scaduta, come riaprendo l'app dopo più di un'ora.
      expires_at: Math.floor(Date.now() / 1000) + (u.scaduta ? -60 : 86400),
      user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', user_metadata: { name: u.nome, given_name: u.nome } },
    };
    localStorage.setItem('sb-localhost-auth-token', JSON.stringify(sessione));
  }, { ...utente, scaduta: !!LENTA });
  await c.addInitScript(sonda);
  if (LENTA) {
    // Rete del telefono verso Supabase: ogni richiesta al server arriva dopo LENTA ms.
    await c.route(/localhost:14400/, async (route) => {
      await new Promise((r) => setTimeout(r, LENTA));
      if (route.request().url().includes('/auth/v1/token'))
        return route.fulfill({
          json: { access_token: utente.token, refresh_token: 'prova2', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: utente.id, email: utente.email, aud: 'authenticated', role: 'authenticated', user_metadata: { name: utente.nome } } },
        });
      return route.continue();
    });
  }
  const page = await c.newPage();
  const cdp = await c.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(RALLENTA) });
  return { c, page };
}

/** Apertura: dalla navigazione a quando l'app mostra Oggi e lo schermo è libero. */
async function apertura(page, ricarica) {
  if (ricarica) await page.reload();
  else await page.goto(URL_APP);
  await page.locator('nav.schede').waitFor({ timeout: 120000 });
  const visibile = await page.evaluate(() => performance.now());
  const q = await page.evaluate(() => window.__quiete(0));
  return { visibile: Math.round(visibile), pronto: Math.round(Math.max(q.fine, visibile)), blocco: q.blocco };
}

/** Tocco su un elemento: tempo fino al primo disegno dopo il tocco, e blocco nei 1,5 s dopo. */
async function tocco(page, locator) {
  // Solo ciò che si vede: le schede nascoste restano nella pagina.
  const visibile = locator.filter({ visible: true }).first();
  await visibile.waitFor();
  const h = await visibile.elementHandle();
  return page.evaluate(async (el) => {
    let ultimo = 0;
    const mo = new MutationObserver(() => (ultimo = performance.now()));
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    const t0 = performance.now();
    el.click();
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
    const disegno = performance.now() - t0;
    const q = await window.__quiete(t0);
    mo.disconnect();
    // «finito»: l'ultimo cambiamento dello schermo (anche quelli che arrivano dopo, come la spunta salvata).
    return { disegno: Math.round(disegno), finito: Math.round(Math.max(ultimo - t0, disegno)), pronto: Math.round(Math.max(q.fine - t0, disegno)), blocco: q.blocco };
  }, h);
}

const risultati = {};
const metti = (nome, v) => (risultati[nome] ??= []).push(v);

for (let i = 0; i < Number(RIPETI); i++) {
  const { c, page } = await contesto();
  metti('primo avvio (scarica tutto)', await apertura(page, false));
  metti('riapertura', await apertura(page, true));
  for (const scheda of ['Menu', 'Spesa', 'Casa', 'Ricette', 'Oggi', 'Menu', 'Ricette']) {
    metti(`scheda ${scheda}`, await tocco(page, page.locator('nav.schede').getByRole('button', { name: scheda, exact: true })));
  }
  // Dentro le schermate: aggiungere un piatto (scelta tra le ricette), aprire un piatto, aprire una ricetta.
  const schede = page.locator('nav.schede');
  await tocco(page, schede.getByRole('button', { name: 'Menu', exact: true }));
  metti('Menu › aggiungi piatto', await tocco(page, page.locator('main button.piu, main button.aggiungi-riquadro')));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  metti('Menu › apri piatto', await tocco(page, page.locator('main .piatti-riquadro button[aria-label^="Apri"]')));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await tocco(page, schede.getByRole('button', { name: 'Ricette', exact: true }));
  metti('Ricette › apri ricetta', await tocco(page, page.locator('main button[aria-label^="Apri"]')));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  // Un tocco che cambia i dati: spunta nella lista della spesa (comando, invio, scarico).
  await tocco(page, page.locator('nav.schede').getByRole('button', { name: 'Spesa', exact: true }));
  metti('spunta spesa', await tocco(page, page.locator('main input[type=checkbox]')));
  metti('spunta spesa (2)', await tocco(page, page.locator('main input[type=checkbox]')));
  await c.close();
}

const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const tabella = Object.entries(risultati).map(([nome, v]) => ({
  azione: nome,
  ...Object.fromEntries(Object.keys(v[0]).map((k) => [k, med(v.map((x) => x[k]))])),
}));
console.table(tabella);
console.log(JSON.stringify(tabella));
await browser.close();
