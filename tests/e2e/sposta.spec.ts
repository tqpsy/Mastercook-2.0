/**
 * «Sposta» sul flusso reale: dal frigo alla dispensa, tutto o una parte.
 */
import { expect, test } from '@playwright/test';
import { apri, creaFamiglia, nuovoUtente, sql } from './aiuti';

const fra = (giorni: number) => new Date(Date.now() + giorni * 86_400_000).toISOString().slice(0, 10);

test('sposta: dal freezer alla dispensa, con la data della confezione', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Sposta');
  await page.getByRole('button', { name: 'Casa', exact: true }).click();

  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  const nuovo = page.getByRole('dialog', { name: 'Aggiungi in casa' });
  await nuovo.getByLabel('Cosa aggiungi?').fill('lievito di birra');
  await nuovo.getByRole('button', { name: /Lievito di birra$/ }).first().click();
  await nuovo.getByLabel('Quantità').fill('21');
  await nuovo.getByRole('button', { name: 'Freezer' }).click();
  await nuovo.getByRole('button', { name: 'Preferibilmente entro' }).click();
  await nuovo.getByLabel('Data').fill(fra(669));
  await nuovo.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();

  await page.getByRole('tab', { name: /Freezer/ }).click();
  await page.getByRole('button', { name: /Apri Lievito/ }).first().click();
  const lotto = page.getByRole('dialog', { name: /Lievito/ });
  await lotto.getByRole('button', { name: 'Sposta' }).click();
  await lotto.getByRole('button', { name: 'Dispensa' }).click();
  await lotto.getByRole('button', { name: 'Conferma' }).click();
  await expect(lotto.getByText(/in dispensa/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();

  const righe = await sql<{ luogo: string; fonte_data: string }>(
    `select luogo, fonte_data from lotto where famiglia_id in (select famiglia_id from utente_famiglia where utente_id = $1)`,
    [luca.id],
  );
  expect(righe).toEqual([{ luogo: 'dispensa', fonte_data: 'confezione' }]);
});

test('sposta solo sul telefono: dal freezer alla dispensa', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  test.setTimeout(180_000);
  await page.getByLabel('Nome della famiglia').fill('Casa Locale');
  await page.getByRole('radio', { name: /Solo su questo telefono/ }).check();
  await page.getByRole('button', { name: 'Crea la famiglia' }).click();
  await expect(page.getByText('Casa Locale', { exact: true })).toBeVisible({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Casa', exact: true }).click();

  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  const nuovo = page.getByRole('dialog', { name: 'Aggiungi in casa' });
  await nuovo.getByLabel('Cosa aggiungi?').fill('lievito di birra');
  await nuovo.getByRole('button', { name: /Lievito di birra$/ }).first().click();
  await nuovo.getByLabel('Quantità').fill('21');
  await nuovo.getByRole('button', { name: 'Freezer' }).click();
  await nuovo.getByRole('button', { name: 'Preferibilmente entro' }).click();
  await nuovo.getByLabel('Data').fill(fra(669));
  await nuovo.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();

  await page.getByRole('tab', { name: /Freezer/ }).click();
  await page.getByRole('button', { name: /Apri Lievito/ }).first().click();
  const lotto = page.getByRole('dialog', { name: /Lievito/ });
  await lotto.getByRole('button', { name: 'Sposta' }).click();
  await lotto.getByRole('button', { name: 'Dispensa' }).click();
  await lotto.getByRole('button', { name: 'Conferma' }).click();
  await expect(lotto.getByText(/in dispensa/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();

});
