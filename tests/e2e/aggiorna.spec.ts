/**
 * «Aggiorna l’app» in Impostazioni: si vede con la data della versione e, toccato, ricarica l'app.
 */
import { expect, test } from '@playwright/test';
import { apri, creaFamiglia, nuovoUtente } from './aiuti';

test('impostazioni: «Aggiorna l’app» ricarica e si torna nell’app', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Aggiorna');
  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await expect(page.getByText(/Versione dell’app \d+ · del /)).toBeVisible();
  const ricarica = page.waitForEvent('load');
  await page.getByRole('button', { name: /Aggiorna l’app/ }).click();
  await ricarica;
  await expect(page.getByText('Casa Aggiorna', { exact: true })).toBeVisible({ timeout: 30_000 });
});
