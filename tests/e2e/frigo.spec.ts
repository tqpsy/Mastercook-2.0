/**
 * «Il mio frigorifero» sul flusso reale, telefono e tablet: si configura in Impostazioni, il disegno dice cosa va
 * in ogni parte, e aggiungendo in casa l'app consiglia il posto preciso (che resta sul lotto).
 */
import { expect, type Page, test } from '@playwright/test';
import { apri, creaFamiglia, nuovoUtente, sql } from './aiuti';

const salvato = (page: Page) => expect(page.getByRole('button', { name: 'Impostazioni' })).toHaveAccessibleDescription('Stato del salvataggio: Tutto salvato');

test('configuro il frigo e aggiungendo il pollo mi dice il ripiano in basso', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Frigo');

  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await page.getByRole('button', { name: /Configura il tuo frigorifero/ }).click();
  const foglio = page.getByRole('dialog', { name: 'Il mio frigorifero' });
  await foglio.getByRole('button', { name: 'Ripiani: uno in più' }).click();
  await foglio.getByRole('radiogroup', { name: 'Da che parte si apre lo sportello' }).getByRole('radio', { name: 'Sinistra' }).click();
  await foglio.getByRole('button', { name: 'Ripiano 5, in basso' }).click();
  await expect(foglio.getByText('Carne e pesce crudi')).toBeVisible();
  await foglio.getByRole('button', { name: 'Salva il frigorifero' }).click();
  await salvato(page);
  await expect(page.getByText('freezer sotto · 5 ripiani · 1 cassetto · sportello a sinistra')).toBeVisible();

  await page.getByRole('button', { name: 'Casa', exact: true }).click();
  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  const nuovo = page.getByRole('dialog', { name: 'Aggiungi in casa' });
  await nuovo.getByLabel('Cosa aggiungi?').fill('petto di pollo');
  await nuovo.getByRole('button', { name: /Petto di pollo/ }).first().click();
  await nuovo.getByLabel('Quantità').fill('400');
  await expect(nuovo.getByLabel('Dove metterlo')).toContainText('Ripiano 5, in basso');
  await nuovo.getByRole('button', { name: 'Senza data' }).click();
  await nuovo.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await salvato(page);
  await expect(page.getByRole('region', { name: 'Frigo' }).getByText(/📍 Ripiano 5, in basso/)).toBeVisible();
  const [r] = await sql<{ posto: string }>(`select posto from lotto where famiglia_id = (select famiglia_id from utente_famiglia where utente_id = $1)`, [luca.id]);
  expect(r.posto).toBe('r5');
});
