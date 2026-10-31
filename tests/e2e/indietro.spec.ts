/**
 * Il tasto Indietro del telefono: torna indietro nell'ordine visitato dentro l'app, chiude i pannelli,
 * e alla schermata iniziale chiede una seconda pressione prima di uscire.
 */
import { expect, type Page, test } from '@playwright/test';
import { apri, creaFamiglia, nuovoUtente } from './aiuti';

const indietro = (page: Page) => page.evaluate(() => history.back());
const titolo = (page: Page, nome: string) => expect(page.locator('main h1')).toHaveText(nome);

test('Indietro segue la navigazione, chiude i pannelli e alla fine chiede conferma per uscire', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Indietro');
  const nav = page.getByRole('navigation');

  await nav.getByRole('button', { name: 'Spesa' }).click();
  await titolo(page, 'Spesa');
  await nav.getByRole('button', { name: 'Ricette' }).click();
  await titolo(page, 'Ricette');

  // Un pannello aperto si chiude con Indietro, e si resta sulla scheda.
  await page.getByLabel('Cerca').fill('carbonara');
  await page.getByRole('button', { name: 'Apri Spaghetti alla carbonara' }).click();
  await expect(page.getByRole('dialog', { name: 'Spaghetti alla carbonara' })).toBeVisible();
  await indietro(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await titolo(page, 'Ricette');

  // Chiuso col suo bottone, il pannello non lascia una pressione «a vuoto».
  await page.getByRole('button', { name: 'Apri Spaghetti alla carbonara' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Chiudi' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await indietro(page);
  await titolo(page, 'Spesa');
  await indietro(page);
  await titolo(page, 'Oggi');

  // Alla schermata iniziale: prima l'avviso, si resta nell'app.
  await indietro(page);
  await expect(page.getByText('Premi di nuovo Indietro per uscire')).toBeVisible();
  await titolo(page, 'Oggi');
  // Non c'è più nulla dell'app nella cronologia: la seconda pressione esce.
  expect(await page.evaluate(() => (history.state as { mc?: number } | null)?.mc ?? 0)).toBe(0);
});
