/**
 * Raccolta differenziata: i giorni scelti in Impostazioni si vedono come promemoria in Oggi
 * (il giorno stesso, oppure la sera prima per il giorno dopo).
 */
import { expect, test } from '@playwright/test';
import { apri, creaFamiglia, nuovoUtente } from './aiuti';

const NOMI_GIORNO = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

test('scelgo i giorni della raccolta e Oggi mi ricorda cosa portare fuori', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Raccolta');
  const adesso = new Date();
  const oggiNome = NOMI_GIORNO[adesso.getDay()];
  const domaniNome = NOMI_GIORNO[(adesso.getDay() + 1) % 7];

  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await page.getByRole('heading', { name: 'Raccolta differenziata' }).click();
  const organico = page.getByRole('group', { name: 'Giorni di raccolta: Organico' });
  await organico.getByRole('button', { name: oggiNome, exact: true }).click();
  await expect(organico.getByRole('button', { name: oggiNome, exact: true })).toHaveAttribute('aria-pressed', 'true');
  const vetro = page.getByRole('group', { name: 'Giorni di raccolta: Vetro' });
  await vetro.getByRole('button', { name: domaniNome, exact: true }).click();

  await page.getByRole('button', { name: 'Oggi', exact: true }).click();
  await expect(page.getByText('organico oggi')).toBeVisible();
  await expect(page.getByText('vetro stasera, per domani')).toBeVisible();

  // Spengo l'organico: resta solo il vetro di domani.
  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await page.getByRole('heading', { name: 'Raccolta differenziata' }).click();
  await organico.getByRole('button', { name: oggiNome, exact: true }).click();
  await page.getByRole('button', { name: 'Oggi', exact: true }).click();
  await expect(page.getByText('organico oggi')).not.toBeVisible();
  await expect(page.getByText('vetro stasera, per domani')).toBeVisible();
});
