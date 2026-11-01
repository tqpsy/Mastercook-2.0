/** Modalità cucina: un passaggio per volta, ciò che serve per quel passaggio, Indietro del telefono la chiude. */
import { expect, test } from '@playwright/test';
import { apri, creaFamiglia, nuovoUtente } from './aiuti';

test('modalità cucina: passo passo con gli ingredienti del passaggio', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Cucina');
  await page.getByRole('button', { name: 'Ricette' }).click();
  await page.getByLabel('Cerca', { exact: true }).fill('carbonara');
  await page.getByRole('button', { name: 'Apri Spaghetti alla carbonara' }).click();
  await page.getByRole('dialog', { name: 'Spaghetti alla carbonara' }).getByRole('button', { name: /Cucina passo passo/ }).click();

  const cucina = page.getByRole('dialog', { name: 'Modalità cucina: Spaghetti alla carbonara' });
  await expect(cucina.getByText('Passaggio 1 di 4')).toBeVisible();
  await expect(cucina.getByText(/Taglia il guanciale/)).toBeVisible();
  await expect(cucina.locator('.cucina-serve')).toContainText('Guanciale');
  await expect(cucina.getByRole('button', { name: 'Indietro' })).toBeDisabled();

  await cucina.getByRole('button', { name: 'Avanti' }).click();
  await expect(cucina.getByText('Passaggio 2 di 4')).toBeVisible();
  await expect(cucina.locator('.cucina-serve')).toContainText('Pecorino');
  await cucina.getByRole('button', { name: 'Indietro' }).click();
  await expect(cucina.getByText('Passaggio 1 di 4')).toBeVisible();

  // Indietro del telefono chiude la modalità cucina e lascia aperta la ricetta.
  await page.goBack();
  await expect(cucina).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Spaghetti alla carbonara' })).toBeVisible();
});
