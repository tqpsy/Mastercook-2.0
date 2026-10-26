/**
 * Prove dell'interfaccia sul flusso reale: app vera, funzioni vere del database, utenti di prova.
 * L'accesso con Google è sostituito da una sessione di prova messa nel browser.
 */
import { type Browser, expect, type Page, test } from '@playwright/test';

const SERVER = 'http://localhost:54400';

interface UtenteProva {
  id: string;
  token: string;
  email: string;
  nome: string;
}

async function nuovoUtente(nome: string): Promise<UtenteProva> {
  const r = await fetch(`${SERVER}/prova/utente`, { method: 'POST', body: JSON.stringify({ nome }) });
  return r.json();
}

async function sql<T>(testo: string, valori: unknown[] = []): Promise<T[]> {
  const r = await fetch(`${SERVER}/prova/sql`, { method: 'POST', body: JSON.stringify({ testo, valori }) });
  return r.json();
}

async function apri(browser: Browser, u: UtenteProva, opzioni: Parameters<Browser['newContext']>[0] = {}, percorso = '') {
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

async function creaFamiglia(page: Page, nome = 'Casa Prova') {
  await page.getByLabel('Nome della famiglia').fill(nome);
  await page.getByRole('button', { name: 'Crea la famiglia' }).click();
  await expect(page.getByRole('heading', { name: `Ciao, ${nome}` })).toBeVisible();
}

async function aggiungiPersona(page: Page, nome: string) {
  await page.getByRole('button', { name: 'Famiglia' }).click();
  await page.getByRole('button', { name: '+ Persona' }).click();
  await page.getByLabel('Nome', { exact: true }).fill(nome);
  await page.getByRole('button', { name: 'Bambino' }).click();
  await page.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await expect(page.getByRole('button', { name: `Modifica ${nome}` })).toBeVisible();
}

test('primo accesso: crea la famiglia, aggiunge una persona con un’allergia, tutto resta dopo la riapertura', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page);
  await aggiungiPersona(page, 'Sara');

  await page.getByRole('button', { name: 'Modifica Sara' }).click();
  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  await page.getByRole('button', { name: 'Arachidi' }).click();
  await page.getByRole('button', { name: 'Fatto' }).click();
  await page.getByRole('button', { name: 'Chiudi' }).click();
  await expect(page.getByText('⚠️ Arachidi')).toBeVisible();
  await expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Famiglia' }).click();
  await expect(page.getByText('⚠️ Arachidi')).toBeVisible();
  const [r] = await sql<{ n: number }>(
    `select count(*)::int as n from vincolo_alimentare v join membro m on m.id = v.membro_id where m.nome = 'Sara' and v.oggetto = 'all:arachidi' and m.famiglia_id in (select famiglia_id from utente_famiglia where utente_id = $1)`,
    [luca.id],
  );
  expect(r.n).toBe(1);
});

test('invito: chi apre il link entra con un tocco e vede la famiglia; le modifiche arrivano all’altro dispositivo', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page: telefono } = await apri(browser, luca, info.project.use);
  await creaFamiglia(telefono, 'Casa Invito');
  await telefono.getByRole('button', { name: 'Impostazioni' }).click();
  await telefono.getByRole('button', { name: 'Crea un link d’invito' }).click();
  await expect(telefono.getByRole('button', { name: 'Condividi' })).toBeVisible();
  const [invito] = await sql<{ codice: string }>(`select codice from invito order by creato_il desc limit 1`);

  const sara = await nuovoUtente('Sara');
  const { page: tablet } = await apri(browser, sara, info.project.use, `#invito=${invito.codice}`);
  await expect(tablet.getByLabel('Il tuo nome')).toHaveValue('Sara');
  await tablet.getByRole('button', { name: 'Entra' }).click();
  await expect(tablet.getByRole('heading', { name: 'Ciao, Casa Invito' })).toBeVisible();

  await aggiungiPersona(telefono, 'Nonna');
  await tablet.getByRole('button', { name: 'Famiglia' }).click();
  await tablet.getByRole('button', { name: /Stato del salvataggio/ }).click();
  await tablet.getByRole('button', { name: 'Aggiorna adesso' }).click();
  await tablet.getByRole('button', { name: 'Chiudi' }).click();
  await expect(tablet.getByRole('button', { name: 'Modifica Nonna' })).toBeVisible();
});

test('senza rete: la modifica resta in attesa, visibile, e parte al ritorno della rete', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { contesto, page } = await apri(browser, luca, info.project.use);
  const marco = `Marco ${info.project.name}`;
  await creaFamiglia(page, 'Casa Offline');
  await page.getByRole('button', { name: 'Famiglia' }).click();

  await contesto.setOffline(true);
  await aggiungiPersona(page, marco);
  await expect(page.locator('.etichetta', { hasText: 'in invio' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Senza rete · 1 in attesa/ })).toBeVisible();
  expect((await sql<{ n: number }>(`select count(*)::int as n from membro where nome = $1`, [marco]))[0].n).toBe(0);

  await contesto.setOffline(false);
  await expect(page.getByRole('button', { name: /Tutto salvato/ })).toBeVisible({ timeout: 20_000 });
  expect((await sql<{ n: number }>(`select count(*)::int as n from membro where nome = $1`, [marco]))[0].n).toBe(1);
  await expect(page.locator('.etichetta', { hasText: 'in invio' })).toHaveCount(0);
});
