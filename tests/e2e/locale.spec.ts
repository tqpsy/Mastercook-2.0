/**
 * Famiglia tenuta solo sul telefono: nasce, lavora e resta dopo la ricarica senza mai toccare il server.
 */
import { expect, test } from '@playwright/test';
import { dataLunga } from '../../src/dominio/menu';
import { oggi } from '../../src/dominio/scadenze';
import { apri, nuovoUtente, sql } from './aiuti';

test('solo su questo telefono: i dati restano qui e il server non ne sa nulla', async ({ browser }, info) => {
  test.setTimeout(180_000);
  const giulia = await nuovoUtente('Giulia');
  const { page } = await apri(browser, giulia, info.project.use);
  const nome = `Casa Giulia ${info.project.name}`;
  await page.getByLabel('Nome della famiglia').fill(nome);
  await page.getByRole('radio', { name: /Solo su questo telefono/ }).check();
  await page.getByRole('button', { name: 'Crea la famiglia' }).click();
  await expect(page.getByRole('heading', { name: `Ciao, ${nome}` })).toBeVisible({ timeout: 120_000 });

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Giorni' }).click();
  await page.getByRole('button', { name: `Aggiungi a cena di ${dataLunga(oggi())}` }).click();
  await page.getByRole('dialog').getByLabel('Cosa si mangia').fill('carbonara');
  await page.getByRole('dialog').getByRole('button', { name: /Spaghetti alla carbonara/ }).click();
  await expect(page.getByRole('button', { name: 'Apri Spaghetti alla carbonara' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();

  // Il server non ha né la famiglia né il piatto.
  expect(await sql('select 1 from famiglia where nome = $1', [nome])).toEqual([]);
  expect(await sql('select 1 from utente_famiglia where utente_id = $1', [giulia.id])).toEqual([]);

  // Dopo la ricarica la famiglia e il piatto ci sono ancora.
  await page.reload();
  await expect(page.getByRole('heading', { name: `Ciao, ${nome}` })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apri Spaghetti alla carbonara' })).toBeVisible();

  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await expect(page.getByText(/stanno solo su questo telefono: non escono da qui/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Inviti' })).toHaveCount(0);
});
