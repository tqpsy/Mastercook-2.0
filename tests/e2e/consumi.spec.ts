/**
 * Conferma dei pasti sul flusso reale, telefono e tablet: un tocco da Oggi, correzione a differenza,
 * avanzi, pasti dei giorni prima da confermare.
 */
import { expect, type Page, test } from '@playwright/test';
import { dataLunga } from '../../src/dominio/menu';
import { oggi } from '../../src/dominio/scadenze';
import { apri, creaFamiglia, nuovoUtente, sql } from './aiuti';

const famigliaDi = '(select famiglia_id from utente_famiglia where utente_id = $1)';
const salvato = (page: Page) => expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();
const CARBONARA = 'Spaghetti alla carbonara';
// Un'immagine PNG di 1×1 pixel.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

test('pasti: «mangiato» in un tocco, correzione a differenza, avanzi e pasti arretrati', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Pasti');

  await page.getByRole('button', { name: 'Casa', exact: true }).click();
  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  const nuovo = page.getByRole('dialog', { name: 'Aggiungi in casa' });
  await nuovo.getByLabel('Cosa aggiungi?').fill('spaghetti');
  await nuovo.getByRole('button', { name: /Spaghetti$/ }).first().click();
  await nuovo.getByLabel('Quantità').fill('500');
  await nuovo.getByRole('button', { name: 'Senza data' }).click();
  await nuovo.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await salvato(page);

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Giorni' }).click();
  await page.getByRole('button', { name: `Aggiungi a cena di ${dataLunga(oggi())}` }).click();
  await page.getByRole('dialog').getByLabel('Cosa si mangia').fill('carbonara');
  await page.getByRole('dialog').getByRole('button', { name: /Spaghetti alla carbonara/ }).click();
  await salvato(page);

  const spaghetti = async () =>
    (await sql<{ q: number }>(`select quantita::float as q from lotto where ingrediente_id = 'ing:spaghetti' and famiglia_id = ${famigliaDi}`, [luca.id]))[0].q;

  // Un tocco da Oggi: 1 porzione di carbonara = 80 g di spaghetti.
  await page.getByRole('button', { name: 'Oggi', exact: true }).click();
  await page.getByRole('button', { name: `Mangiato come previsto: ${CARBONARA}` }).click();
  await expect(page.getByRole('region', { name: 'Oggi si mangia' })).toContainText('Mangiato come previsto');
  await expect.poll(spaghetti).toBe(420);

  // Correzione: in realtà 100 g. Si toglie solo la differenza.
  await page.getByRole('button', { name: `Correggi: ${CARBONARA}` }).click();
  const foglio = page.getByRole('dialog', { name: 'Correggi il pasto' });
  await foglio.getByRole('radio', { name: 'Quantità diverse' }).click();
  await foglio.getByLabel('Quanto Spaghetti hai usato').fill('100');
  await foglio.getByLabel('Sono avanzate delle porzioni').click();
  await foglio.getByLabel('Porzioni avanzate').fill('1');
  await expect(foglio.getByText(/Stima indicativa: da consumare entro domani/)).toBeVisible();
  await foglio.getByRole('button', { name: 'Salva la correzione' }).click();
  await expect(page.getByRole('region', { name: 'Oggi si mangia' })).toContainText('Mangiato, quantità diverse');
  await expect.poll(spaghetti).toBe(400);
  expect(
    await sql(`select causale, variazione::float as v from movimento where famiglia_id = ${famigliaDi} and causale <> 'carico' order by seq`, [luca.id]),
  ).toEqual([
    { causale: 'consumo', v: -80 },
    { causale: 'consumo', v: -20 },
  ]);
  await expect
    .poll(() => sql(`select nome, quantita::float as q, tipo_data from lotto where origine = 'avanzo' and famiglia_id = ${famigliaDi}`, [luca.id]))
    .toEqual([{ nome: CARBONARA, q: 1, tipo_data: 'stimata' }]);

  // Il pasto di ieri, mai confermato, compare tra quelli da confermare.
  await sql(
    `insert into portata (id, famiglia_id, data, categoria, testo) select gen_random_uuid(), famiglia_id, current_date - 1, 'pranzo', 'Pizza'
       from utente_famiglia where utente_id = $1`,
    [luca.id],
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Oggi', exact: true })).toHaveAccessibleDescription('1 pasto da confermare');
  const arretrati = page.getByRole('region', { name: 'Pasti da confermare' });
  await arretrati.getByRole('button', { name: 'Com’è andato: Pizza' }).click();
  await page.getByRole('dialog', { name: 'Com’è andato il pasto?' }).getByRole('radio', { name: 'Saltato' }).click();
  await page.getByRole('dialog', { name: 'Com’è andato il pasto?' }).getByRole('button', { name: 'Conferma' }).click();
  await expect(arretrati).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Oggi', exact: true })).toHaveAccessibleDescription('');
  await salvato(page);

  // Dopo la conferma, la foto del piatto è facoltativa: si carica e la conferma la cita.
  await page
    .locator(`label[aria-label="Aggiungi una foto del piatto: ${CARBONARA}"] input`)
    .setInputFiles({ name: 'piatto.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
  await expect(page.getByRole('button', { name: `Foto del piatto: ${CARBONARA}` })).toBeVisible();
  await expect
    .poll(async () => (await sql<{ foto: string | null }>(`select foto from conferma_pasto where attiva and famiglia_id = ${famigliaDi} and esito <> 'saltato'`, [luca.id]))[0]?.foto ?? null)
    .toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/);
  expect(await spaghetti()).toBe(400);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('ciò che scade: ricette che lo usano, «stasera» in un tocco, avviso sulla scheda Casa', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Scadenze');
  await page.getByRole('button', { name: 'Casa', exact: true }).click();
  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  const nuovo = page.getByRole('dialog', { name: 'Aggiungi in casa' });
  await nuovo.getByLabel('Cosa aggiungi?').fill('guanciale');
  await nuovo.getByRole('button', { name: /Guanciale$/ }).first().click();
  await nuovo.getByLabel('Quantità').fill('150');
  await nuovo.getByRole('button', { name: 'Da consumarsi entro' }).click();
  await nuovo.getByLabel('Data').fill(oggi());
  await nuovo.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Casa', exact: true })).toHaveAccessibleDescription('1 prodotto scaduto o da usare oggi');

  await page.getByRole('button', { name: 'Oggi', exact: true }).click();
  const ricette = page.getByRole('list', { name: 'Ricette che li usano' });
  await expect(ricette.getByRole('listitem').first()).toContainText('usa guanciale');
  await ricette.getByRole('button', { name: /Metti a cena stasera/ }).first().click();
  await expect(page.getByRole('region', { name: 'Oggi si mangia' }).getByRole('button', { name: /Mangiato come previsto/ })).toBeVisible();
  await salvato(page);
  await expect
    .poll(async () => (await sql<{ n: number }>(`select count(*)::int as n from portata where categoria = 'cena' and data = current_date and famiglia_id = ${famigliaDi}`, [luca.id]))[0].n)
    .toBe(1);
});
