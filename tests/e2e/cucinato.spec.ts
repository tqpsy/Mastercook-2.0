/**
 * «Cucinato» sul flusso reale, telefono e tablet: il piatto preparato in anticipo toglie subito gli
 * ingredienti, va in frigo con la data (modificabile) e il ripiano consigliato; oltre 2 giorni l'app
 * consiglia il freezer. Quando si mangia gli ingredienti non escono di nuovo.
 */
import { expect, type Page, test } from '@playwright/test';
import { dataLunga } from '../../src/dominio/menu';
import { oggi, piuGiorni } from '../../src/dominio/scadenze';
import { apri, creaFamiglia, nuovoUtente, scegliGiorno, sql } from './aiuti';

const famigliaDi = '(select famiglia_id from utente_famiglia where utente_id = $1)';
const salvato = (page: Page) => expect(page.getByRole('button', { name: 'Impostazioni' })).toHaveAccessibleDescription('Stato del salvataggio: Tutto salvato');
const CARBONARA = 'Spaghetti alla carbonara';

async function preparaCasa(page: Page) {
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

test('cucinato oggi: ingredienti tolti subito, in frigo con il ripiano, poi mangiato senza toglierli di nuovo', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Cucina');
  await preparaCasa(page);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Giorni' }).click();
  await page.getByRole('button', { name: `Aggiungi a cena di ${dataLunga(oggi())}` }).click();
  await page.getByRole('dialog').getByLabel('Cosa si mangia').fill('carbonara');
  await page.getByRole('dialog').getByRole('button', { name: /Spaghetti alla carbonara/ }).click();
  await salvato(page);

  const spaghetti = async () =>
    (await sql<{ q: number }>(`select quantita::float as q from lotto where ingrediente_id = 'ing:spaghetti' and famiglia_id = ${famigliaDi}`, [luca.id]))[0].q;
  const pronto = () =>
    sql<{ q: number; luogo: string; tipo_data: string; data_limite: string }>(
      `select quantita::float as q, luogo, tipo_data, to_char(data_limite, 'YYYY-MM-DD') as data_limite from lotto where portata_id is not null and famiglia_id = ${famigliaDi}`,
      [luca.id],
    );

  await page.getByRole('button', { name: 'Oggi', exact: true }).click();
  await page.getByRole('region', { name: 'Cena' }).getByRole('button', { name: /^Dettagli di cena/ }).click();
  await page.getByRole('dialog', { name: 'Cena di oggi' }).getByRole('button', { name: `Cucinato: ${CARBONARA}` }).click();
  const foglio = page.getByRole('dialog', { name: 'Cucinato' });
  await expect(foglio).toContainText('Ripiano consigliato');
  await expect(foglio.getByLabel('Porzioni cucinate', { exact: true })).toHaveValue('1');
  await expect(foglio.getByText(/Calcolata da oggi/)).toBeVisible();
  // La data è automatica ma si può cambiare.
  await foglio.getByLabel('Da mangiare entro').fill(oggi());
  await expect(foglio.getByText('Data scritta da te.')).toBeVisible();
  await foglio.getByRole('button', { name: '🍳 Cucinato, metti in frigo' }).click();
  await expect(page.getByRole('dialog', { name: 'Cena di oggi' })).toContainText('🍳 Cucinato · in frigo');
  await salvato(page);
  await expect.poll(spaghetti).toBe(420);
  expect(await pronto()).toEqual([{ q: 1, luogo: 'frigo', tipo_data: 'scadenza', data_limite: oggi() }]);
  await page.getByRole('dialog', { name: 'Cena di oggi' }).getByRole('button', { name: 'Chiudi' }).click();
  await expect(page.getByRole('region', { name: 'Cena' })).toContainText('cucinato');

  // Mangiato: niente avanzi, gli spaghetti non escono di nuovo, il piatto pronto è finito.
  await page.getByRole('button', { name: `Mangiato come previsto: ${CARBONARA}` }).click();
  const avanzi = page.getByRole('dialog', { name: 'È avanzato qualcosa?' });
  await expect(avanzi).toContainText('🍳 Cucinato: in frigo ce ne sono 1');
  await avanzi.getByRole('button', { name: '✓ Mangiato, niente avanzi' }).click();
  await salvato(page);
  await expect.poll(async () => (await pronto())[0]?.q).toBe(0);
  expect(await spaghetti()).toBe(420);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('cucinato 3 giorni prima: l’avviso consiglia il freezer', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Freezer');
  const giorno = piuGiorni(oggi(), 3);
  await sql(
    `insert into portata (id, famiglia_id, data, categoria, ricetta_id, porzioni) select gen_random_uuid(), famiglia_id, $2, 'cena', 'sys:carbonara', 2
       from utente_famiglia where utente_id = $1`,
    [luca.id, giorno],
  );
  await page.reload();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Giorni' }).click();
  await scegliGiorno(page, giorno);
  await page.getByRole('region', { name: dataLunga(giorno) }).getByRole('button', { name: `Apri ${CARBONARA}` }).click();
  await page.getByRole('dialog', { name: CARBONARA }).getByRole('button', { name: `Cucinato: ${CARBONARA}` }).click();
  const avviso = page.getByRole('dialog', { name: 'Meglio congelarlo' });
  await expect(avviso).toContainText('fra 3 giorni');
  await avviso.getByRole('button', { name: '❄️ Va in freezer' }).click();
  const foglio = page.getByRole('dialog', { name: 'Cucinato' });
  await expect(foglio.getByRole('radio', { name: 'In freezer' })).toHaveAttribute('aria-checked', 'true');
  await expect(foglio.getByLabel('Da mangiare entro')).toHaveValue(piuGiorni(oggi(), 90));
  await foglio.getByRole('button', { name: '🍳 Cucinato, metti in freezer' }).click();
  await expect(page.getByRole('dialog', { name: CARBONARA })).toContainText('🍳 Cucinato: in freezer ci sono 2 porzioni');
  await salvato(page);
  await expect
    .poll(() => sql(`select quantita::float as q, luogo, tipo_data from lotto where portata_id is not null and famiglia_id = ${famigliaDi}`, [luca.id]))
    .toEqual([{ q: 2, luogo: 'freezer', tipo_data: 'stimata' }]);
});
