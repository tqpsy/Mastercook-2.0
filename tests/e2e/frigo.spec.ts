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
  // Un piano in più in basso: il quinto diventa ripiano, il sesto cassetto (si possono impilare i cassetti).
  await foglio.getByRole('button', { name: 'Aggiungi un piano in basso' }).click();
  await foglio.getByRole('radiogroup', { name: /^Piano 5/ }).getByRole('radio', { name: 'Ripiano' }).click();
  await foglio.getByRole('radiogroup', { name: /^Piano 6/ }).getByRole('radio', { name: 'Cassetto' }).click();
  await foglio.getByRole('radiogroup', { name: 'Da che parte si apre lo sportello' }).getByRole('radio', { name: 'Sinistra' }).click();
  await foglio.getByRole('button', { name: 'Ripiano 5, in basso' }).click();
  await expect(foglio.getByText('Carne e pesce crudi', { exact: true })).toBeVisible();
  await expect(foglio.getByText('0–2 °C, il più freddo').first()).toBeVisible();
  // La guida: zone con le temperature, etilene e confezioni.
  await foglio.getByText('Come sistemare il frigo').click();
  await expect(foglio.getByRole('heading', { name: 'Etilene: frutta e verdura separate' })).toBeVisible();
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
  await expect(nuovo.getByLabel('Dove metterlo')).toContainText('contenitore ermetico');
  // Carne fresca: la scadenza la calcola l'app, già scelta; in freezer diventa di mesi.
  await expect(nuovo.getByText(/Scadenza automatica: .*, cioè 1 giorno in frigo/)).toBeVisible();
  await nuovo.getByRole('button', { name: 'Freezer', exact: true }).click();
  await expect(nuovo.getByText(/Scadenza automatica: .*, cioè 9 mesi in freezer/)).toBeVisible();
  await nuovo.getByRole('button', { name: 'Frigo', exact: true }).click();
  await nuovo.getByRole('button', { name: 'Senza data' }).click();
  await nuovo.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Frigo' }).getByText(/📍 Ripiano 5, in basso/)).toBeVisible();
  await salvato(page);
  // Il lotto si vede subito (copia locale): sul server arriva appena il comando è inviato.
  const posto = async () =>
    (await sql<{ posto: string }>(`select posto from lotto where famiglia_id = (select famiglia_id from utente_famiglia where utente_id = $1)`, [luca.id]))[0]?.posto;
  await expect.poll(posto).toBe('r5');
});
