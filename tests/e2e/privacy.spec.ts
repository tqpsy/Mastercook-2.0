/**
 * Privacy: l'informativa e il consenso al primo accesso, l'eliminazione del proprio account.
 */
import { expect, test } from '@playwright/test';
import { apri, creaFamiglia, nuovoUtente, sql } from './aiuti';

test('primo accesso: si legge l’informativa e si acconsente, poi si crea la famiglia', async ({ browser }, info) => {
  const anna = await nuovoUtente('Anna', { consenso: false });
  const { page } = await apri(browser, anna, info.project.use);
  await expect(page.getByRole('heading', { name: 'I tuoi dati' })).toBeVisible();
  await expect(page.getByText(/Allergie, intolleranze ed esigenze alimentari/)).toBeVisible();
  const accetto = page.getByRole('button', { name: 'Accetto e continuo' });
  await expect(accetto).toBeDisabled();
  await page.getByLabel('Ho almeno 14 anni.').check();
  await page.getByLabel(/acconsento al trattamento/).check();
  await accetto.click();
  await creaFamiglia(page, 'Casa Anna');
  expect(await sql('select versione from interno.consenso where utente_id = $1', [anna.id])).toEqual([{ versione: 1 }]);
});

test('elimina il mio account: si vede cosa sparisce, si conferma con ELIMINA', async ({ browser }, info) => {
  const marco = await nuovoUtente('Marco');
  const { page } = await apri(browser, marco, info.project.use);
  const nome = `Casa Marco ${info.project.name}`;
  await creaFamiglia(page, nome);
  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await page.getByRole('button', { name: 'Come trattiamo i tuoi dati' }).click();
  await expect(page.getByRole('dialog', { name: 'Privacy' }).getByText(/Garante/)).toBeVisible();
  await page.getByRole('dialog', { name: 'Privacy' }).getByRole('button', { name: 'Chiudi' }).click();

  await page.getByRole('button', { name: 'Elimina il mio account' }).click();
  const scheda = page.getByLabel('Privacy e account');
  await expect(scheda.getByText(/Si cancellano per sempre/)).toContainText(nome);
  const conferma = scheda.getByRole('button', { name: 'Elimina il mio account' });
  await expect(conferma).toBeDisabled();
  await scheda.getByLabel('Scrivi ELIMINA per confermare').fill('ELIMINA');
  await conferma.click();

  await expect.poll(async () => sql('select 1 from auth.users where id = $1', [marco.id])).toEqual([]);
  expect(await sql('select 1 from famiglia where nome = $1', [nome])).toEqual([]);
});
