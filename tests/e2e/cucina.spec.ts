/** Modalità cucina: un passaggio per volta, ciò che serve per quel passaggio, Indietro del telefono la chiude. */
import { expect, type Page, test } from '@playwright/test';
import { dataLunga } from '../../src/dominio/menu';
import { oggi } from '../../src/dominio/scadenze';
import { apri, creaFamiglia, nuovoUtente, sql } from './aiuti';

const famigliaDi = '(select famiglia_id from utente_famiglia where utente_id = $1)';
const salvato = (page: Page) => expect(page.getByRole('button', { name: 'Impostazioni' })).toHaveAccessibleDescription('Stato del salvataggio: Tutto salvato');
const CARBONARA = 'Spaghetti alla carbonara';

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

async function spaghettiInCasa(page: Page) {
  await page.getByRole('button', { name: 'Casa', exact: true }).click();
  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  const nuovo = page.getByRole('dialog', { name: 'Aggiungi in casa' });
  await nuovo.getByLabel('Cosa aggiungi?').fill('spaghetti');
  await nuovo.getByRole('button', { name: /Spaghetti$/ }).first().click();
  await nuovo.getByLabel('Quantità').fill('500');
  await nuovo.getByRole('button', { name: 'Senza data' }).click();
  await nuovo.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await salvato(page);
}

/** Dalla scheda della carbonara fino a «Fine» della modalità cucina. */
async function cucinaFinoAllaFine(page: Page) {
  await page.getByRole('button', { name: 'Ricette' }).click();
  await page.getByLabel('Cerca', { exact: true }).fill('carbonara');
  await page.getByRole('button', { name: `Apri ${CARBONARA}` }).click();
  await page.getByRole('dialog', { name: CARBONARA }).getByRole('button', { name: /Cucina passo passo/ }).click();
  const cucina = page.getByRole('dialog', { name: `Modalità cucina: ${CARBONARA}` });
  for (let i = 0; i < 3; i++) await cucina.getByRole('button', { name: 'Avanti' }).click();
  await cucina.getByRole('button', { name: 'Fine' }).click();
  await expect(cucina).toHaveCount(0);
}

test('fine della modalità cucina fuori dal menu: toglie dalla casa gli ingredienti per le porzioni cucinate', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Fine');
  await spaghettiInCasa(page);
  await cucinaFinoAllaFine(page);

  const fine = page.getByRole('dialog', { name: 'Hai finito di cucinare' });
  await expect(fine.getByLabel('Porzioni cucinate', { exact: true })).toHaveValue('4');
  await expect(fine).toContainText('Non risultano in casa');
  await fine.getByLabel('Porzioni cucinate', { exact: true }).fill('2');
  await fine.getByRole('button', { name: 'Togli gli ingredienti dalla casa' }).click();
  await expect(fine).toHaveCount(0);
  await salvato(page);
  // 320 g per 4 porzioni → 160 g per 2.
  await expect
    .poll(async () => (await sql<{ q: number }>(`select quantita::float as q from lotto where ingrediente_id = 'ing:spaghetti' and famiglia_id = ${famigliaDi}`, [luca.id]))[0].q)
    .toBe(340);
});

test('fine della modalità cucina per il piatto del menu di oggi: si segna mangiato', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Fine Menu');
  await spaghettiInCasa(page);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Giorni' }).click();
  await page.getByRole('button', { name: `Aggiungi a cena di ${dataLunga(oggi())}` }).click();
  await page.getByRole('dialog').getByLabel('Cosa si mangia').fill('carbonara');
  await page.getByRole('dialog').getByRole('button', { name: /Spaghetti alla carbonara/ }).click();
  await salvato(page);

  await cucinaFinoAllaFine(page);
  const fine = page.getByRole('dialog', { name: 'Hai finito di cucinare' });
  await expect(fine).toContainText('Nel menu: cena di oggi');
  await fine.getByRole('button', { name: '✓ Lo mangiamo adesso' }).click();
  await page.getByRole('dialog', { name: 'È avanzato qualcosa?' }).getByRole('button', { name: '✓ Mangiato, niente avanzi' }).click();
  await salvato(page);
  // Una persona: 80 g di spaghetti.
  await expect
    .poll(async () => (await sql<{ q: number }>(`select quantita::float as q from lotto where ingrediente_id = 'ing:spaghetti' and famiglia_id = ${famigliaDi}`, [luca.id]))[0].q)
    .toBe(420);
  await expect.poll(async () => (await sql<{ n: number }>(`select count(*)::int as n from conferma_pasto where attiva and famiglia_id = ${famigliaDi}`, [luca.id]))[0].n).toBe(1);
});
