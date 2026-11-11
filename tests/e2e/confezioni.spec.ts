/**
 * Confezioni uguali in una riga: 2 confezioni da 500 g sono «500 g × 2», con quelle già in casa della stessa data.
 * «Usata una confezione» ne toglie una intera.
 */
import { expect, type Page, test } from '@playwright/test';
import { apri, creaFamiglia, nuovoUtente, sql } from './aiuti';

const salvato = (page: Page) => expect(page.getByRole('button', { name: 'Impostazioni' })).toHaveAccessibleDescription('Stato del salvataggio: Tutto salvato');

async function aggiungiSpaghetti(page: Page, confezioni: number) {
  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  const nuovo = page.getByRole('dialog', { name: 'Aggiungi in casa' });
  await nuovo.getByLabel('Cosa aggiungi?').fill('spaghetti');
  await nuovo.getByRole('button', { name: /Spaghetti$/ }).first().click();
  await nuovo.getByLabel('Quantità').fill('500');
  for (let i = 1; i < confezioni; i++) await nuovo.getByRole('button', { name: /Una confezione in più/ }).click();
  await nuovo.getByRole('button', { name: 'Senza data' }).click();
  await nuovo.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await salvato(page);
}

test('confezioni uguali: una riga «500 g × 3», poi una confezione usata', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Confezioni');
  await page.getByRole('button', { name: 'Casa', exact: true }).click();

  await aggiungiSpaghetti(page, 2);
  // Sul telefono si vede un luogo alla volta (sul tablet tutti affiancati).
  const dispensa = page.getByRole('tab', { name: /Dispensa/ });
  if (await dispensa.isVisible()) await dispensa.click();
  const riga = page.getByRole('button', { name: /Apri Spaghetti/ });
  await expect(riga).toHaveCount(1);
  await expect(riga).toContainText('500 g × 2');
  // Un'altra confezione uguale, aggiunta a parte: sta nella stessa riga.
  await aggiungiSpaghetti(page, 1);
  await expect(riga).toHaveCount(1);
  await expect(riga).toContainText('500 g × 3');
  await expect(page.getByRole('region', { name: 'Dispensa' }).locator('.titolo-luogo')).toHaveText('Dispensa 1');
  if (process.env.MC_FOTO) await page.screenshot({ path: `${process.env.MC_FOTO}/${info.project.name}-1-casa.png` });

  await riga.click();
  const scheda = page.getByRole('dialog', { name: /Spaghetti/ });
  await expect(scheda).toContainText('in tutto 1,5 kg');
  if (process.env.MC_FOTO) await page.screenshot({ path: `${process.env.MC_FOTO}/${info.project.name}-2-scheda.png` });
  await scheda.getByRole('button', { name: 'Usata una confezione' }).click();
  await salvato(page);
  await expect(scheda).toContainText('500 g × 2');
  await scheda.getByRole('button', { name: 'Chiudi' }).first().click();
  await expect(riga).toContainText('500 g × 2');

  const lotti = await sql<{ q: number; confezione: string | null }>(
    `select quantita::float as q, confezione from lotto where chiuso_il is null and famiglia_id in (select famiglia_id from utente_famiglia where utente_id = $1) order by quantita`,
    [luca.id],
  );
  expect(lotti.reduce((s, l) => s + l.q, 0)).toBe(1000);
});
