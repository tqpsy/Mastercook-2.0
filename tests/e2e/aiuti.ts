/** Aiuti condivisi dalle prove dell'interfaccia: utenti di prova, sessione nel browser, passi ricorrenti. */
import { type Browser, type BrowserContext, expect, type Locator, type Page } from '@playwright/test';
import { dataLunga } from '../../src/dominio/menu';

export const SERVER = `http://localhost:${process.env.MC_PORTA_SERVER ?? '14400'}`;

export interface UtenteProva {
  id: string;
  token: string;
  email: string;
  nome: string;
}

export async function nuovoUtente(nome: string, { consenso = true } = {}): Promise<UtenteProva> {
  const r = await fetch(`${SERVER}/prova/utente`, { method: 'POST', body: JSON.stringify({ nome, consenso }) });
  return r.json();
}

export async function sql<T>(testo: string, valori: unknown[] = []): Promise<T[]> {
  const r = await fetch(`${SERVER}/prova/sql`, { method: 'POST', body: JSON.stringify({ testo, valori }) });
  return r.json();
}

export async function apri(
  browser: Browser,
  u: UtenteProva,
  opzioni: Parameters<Browser['newContext']>[0] = {},
  percorso = '',
  prima?: (contesto: BrowserContext) => Promise<void>,
) {
  const contesto = await browser.newContext(opzioni);
  await prima?.(contesto);
  await contesto.addInitScript((utente) => {
    const sessione = {
      access_token: utente.token,
      refresh_token: 'prova',
      token_type: 'bearer',
      expires_in: 86400,
      expires_at: Math.floor(Date.now() / 1000) + 86400,
      user: { id: utente.id, email: utente.email, aud: 'authenticated', role: 'authenticated', user_metadata: { name: utente.nome, given_name: utente.nome } },
    };
    localStorage.setItem('sb-localhost-auth-token', JSON.stringify(sessione));
  }, u);
  const page = await contesto.newPage();
  await page.goto(percorso);
  return { contesto, page };
}

export async function creaFamiglia(page: Page, nome = 'Casa Prova') {
  await page.getByLabel('Nome della famiglia').fill(nome);
  await page.getByRole('button', { name: 'Crea la famiglia' }).click();
  await expect(page.getByText(nome, { exact: true })).toBeVisible();
}

/** Uno scorrimento col dito sull'elemento: `avanti` = dito verso sinistra (giorno o settimana dopo), `indietro` = verso destra. */
export async function scorri(elemento: Locator, verso: 'avanti' | 'indietro') {
  await elemento.evaluate((el, verso) => {
    const r = el.getBoundingClientRect();
    const y = r.top + Math.min(r.height / 2, 30);
    const x = r.left + r.width / 2;
    const dx = verso === 'avanti' ? -120 : 120;
    const tocco = (cx: number) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: y });
    const evento = (tipo: string, cx: number, attivo: boolean) =>
      el.dispatchEvent(new TouchEvent(tipo, { touches: attivo ? [tocco(cx)] : [], changedTouches: [tocco(cx)], bubbles: true, cancelable: true }));
    evento('touchstart', x, true);
    evento('touchmove', x + dx / 2, true);
    evento('touchend', x + dx, false);
  }, verso);
}

/** Menu, vista «Giorni»: si mostra un giorno alla volta, scelto dalla striscia (scorrendola alla settimana dopo o prima se serve). */
export async function scegliGiorno(page: Page, data: string) {
  const giorno = page.getByRole('button', { name: `Mostra ${dataLunga(data)}` });
  const striscia = page.locator('.striscia-giorni').first();
  if (!(await giorno.count())) await scorri(striscia, 'avanti');
  if (!(await giorno.count())) await scorri(striscia, 'indietro');
  if (!(await giorno.count())) await scorri(striscia, 'indietro');
  await giorno.click();
}

/** Famiglia sta dentro Impostazioni (la barra in basso ha cinque schede). */
export async function vaiAFamiglia(page: Page) {
  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await page.getByRole('button', { name: /^Famiglia/ }).click();
}

export async function aggiungiPersona(page: Page, nome: string) {
  await vaiAFamiglia(page);
  await page.getByRole('button', { name: '+ Persona' }).click();
  await page.getByLabel('Nome', { exact: true }).fill(nome);
  await page.getByRole('button', { name: 'Bambino' }).click();
  await page.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await expect(page.getByRole('button', { name: `Modifica ${nome}` })).toBeVisible();
}
