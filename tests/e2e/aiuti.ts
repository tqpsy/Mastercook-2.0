/** Aiuti condivisi dalle prove dell'interfaccia: utenti di prova, sessione nel browser, passi ricorrenti. */
import { type Browser, expect, type Page } from '@playwright/test';

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

export async function apri(browser: Browser, u: UtenteProva, opzioni: Parameters<Browser['newContext']>[0] = {}, percorso = '') {
  const contesto = await browser.newContext(opzioni);
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
  await expect(page.getByRole('heading', { name: `Ciao, ${nome}` })).toBeVisible();
}

export async function aggiungiPersona(page: Page, nome: string) {
  await page.getByRole('button', { name: 'Famiglia' }).click();
  await page.getByRole('button', { name: '+ Persona' }).click();
  await page.getByLabel('Nome', { exact: true }).fill(nome);
  await page.getByRole('button', { name: 'Bambino' }).click();
  await page.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await expect(page.getByRole('button', { name: `Modifica ${nome}` })).toBeVisible();
}
