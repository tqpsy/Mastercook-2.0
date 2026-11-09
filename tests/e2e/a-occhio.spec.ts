/**
 * Prodotti «a occhio» sul flusso reale: il parmigiano entra in casa con pezzi e livello, il livello si cambia con
 * un tocco e quando sta per finire compare in Casa e nella ricetta.
 */
import { expect, test } from '@playwright/test';
import { apri, creaFamiglia, nuovoUtente, sql } from './aiuti';

test('a occhio: pezzi e livello, poi «sta per finire» in Casa e nella ricetta', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Occhio');
  await page.getByRole('button', { name: 'Casa', exact: true }).click();

  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  const nuovo = page.getByRole('dialog', { name: 'Aggiungi in casa' });
  await nuovo.getByLabel('Cosa aggiungi?').fill('parmigiano');
  await nuovo.getByRole('button', { name: /Parmigiano Reggiano$/ }).first().click();
  await nuovo.getByRole('button', { name: 'A occhio' }).click();
  await nuovo.getByRole('button', { name: 'Un pezzo in più' }).click();
  await nuovo.getByRole('button', { name: /Metà/ }).click();
  await nuovo.getByRole('button', { name: 'Senza data' }).click();
  if (process.env.MC_FOTO) await page.screenshot({ path: `${process.env.MC_FOTO}/${info.project.name}-1-aggiungi.png` });
  await nuovo.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Impostazioni' })).toHaveAccessibleDescription('Stato del salvataggio: Tutto salvato');
  await expect(page.getByRole('button', { name: /Apri Parmigiano/ }).first()).toContainText('2 pezzi · metà');

  await page.getByRole('button', { name: /Apri Parmigiano/ }).first().click();
  const scheda = page.getByRole('dialog', { name: /Parmigiano/ });
  await scheda.getByRole('button', { name: 'Finito quello aperto: ne apro un altro' }).click();
  await expect(scheda.getByText('Tanto', { exact: true }).first()).toBeVisible();
  await scheda.getByRole('button', { name: /Sta per finire/ }).click();
  await expect(page.getByRole('button', { name: 'Impostazioni' })).toHaveAccessibleDescription('Stato del salvataggio: Tutto salvato');
  if (process.env.MC_FOTO) await page.screenshot({ path: `${process.env.MC_FOTO}/${info.project.name}-2-scheda.png` });
  await scheda.getByRole('button', { name: 'Chiudi' }).first().click();

  await expect(page.getByRole('region', { name: 'Stanno per finire' })).toContainText('Parmigiano');
  if (process.env.MC_FOTO) await page.screenshot({ path: `${process.env.MC_FOTO}/${info.project.name}-3-casa.png` });

  const righe = await sql<{ quantita: string; unita: string; livello: string }>(
    `select quantita, unita, livello from lotto where famiglia_id in (select famiglia_id from utente_famiglia where utente_id = $1)`,
    [luca.id],
  );
  expect(righe).toEqual([{ quantita: '1', unita: 'pz', livello: 'finendo' }]);

  // Nella ricetta l'ingrediente avvisa invece di dire solo «in casa».
  await page.getByRole('button', { name: 'Ricette', exact: true }).click();
  await page.getByLabel('Cerca').fill('risotto alla parmigiana');
  await page.getByRole('button', { name: /Risotto alla parmigiana/ }).first().click();
  await expect(page.getByText('sta per finire: controlla se basta')).toBeVisible();
  if (process.env.MC_FOTO) await page.screenshot({ path: `${process.env.MC_FOTO}/${info.project.name}-4-ricetta.png` });
});
