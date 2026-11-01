/**
 * Conferma dei pasti sul flusso reale, telefono e tablet: un tocco da Oggi, correzione a differenza,
 * avanzi, pasti dei giorni prima da confermare.
 */
import { expect, type Page, test } from '@playwright/test';
import { dataLunga } from '../../src/dominio/menu';
import { oggi, piuGiorni } from '../../src/dominio/scadenze';
import { apri, creaFamiglia, nuovoUtente, scegliGiorno, sql } from './aiuti';

const famigliaDi = '(select famiglia_id from utente_famiglia where utente_id = $1)';
const salvato = (page: Page) => expect(page.getByRole('button', { name: 'Impostazioni' })).toHaveAccessibleDescription('Stato del salvataggio: Tutto salvato');
const CARBONARA = 'Spaghetti alla carbonara';
// Un'immagine PNG di 1×1 pixel.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

test('pasti: «mangiato» con le porzioni avanzate, correzione a differenza, avanzi e pasti arretrati', async ({ browser }, info) => {
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

  // «✓ Mangiato» da Oggi chiede se è avanzato qualcosa: 1 porzione di carbonara = 80 g di spaghetti, ne avanza 1.
  await page.getByRole('button', { name: 'Oggi', exact: true }).click();
  await page.getByRole('button', { name: `Mangiato come previsto: ${CARBONARA}` }).click();
  const avanzi = page.getByRole('dialog', { name: 'È avanzato qualcosa?' });
  await expect(avanzi.getByLabel(`Porzioni avanzate: ${CARBONARA}`, { exact: true })).toHaveValue('0');
  await expect(avanzi.getByRole('button', { name: '✓ Mangiato, niente avanzi' })).toBeVisible();
  await avanzi.getByRole('button', { name: `Una porzione in più: ${CARBONARA}` }).click();
  await expect(avanzi.getByText(/In frigo: da mangiare entro domani/)).toBeVisible();
  await avanzi.getByRole('button', { name: '✓ Mangiato · 1 porzione avanzata' }).click();
  await expect(page.getByRole('region', { name: 'Oggi si mangia' })).toContainText('Mangiato come previsto');
  await expect.poll(spaghetti).toBe(420);

  // Correzione: in realtà 100 g. Si toglie solo la differenza. Correggi sta nel dettaglio del pasto («⋯»).
  await page.getByRole('region', { name: 'Cena' }).getByRole('button', { name: /^Dettagli di cena/ }).click();
  await page.getByRole('dialog', { name: 'Cena di oggi' }).getByRole('button', { name: `Correggi: ${CARBONARA}` }).click();
  const foglio = page.getByRole('dialog', { name: 'Correggi il pasto' });
  await foglio.getByRole('radio', { name: 'Quantità diverse' }).click();
  await foglio.getByLabel('Quanto Spaghetti hai usato').fill('100');
  // Gli avanzi segnati prima sono già scritti; correggerli li sostituisce.
  await expect(foglio.getByLabel('Porzioni avanzate', { exact: true })).toHaveValue('1');
  await foglio.getByRole('button', { name: 'Una porzione in più' }).click();
  await expect(foglio.getByText(/In frigo: da mangiare entro domani/)).toBeVisible();
  await foglio.getByRole('button', { name: 'Salva la correzione' }).click();
  await expect(page.getByRole('region', { name: 'Oggi si mangia' })).toContainText('Mangiato, quantità diverse');
  await expect.poll(spaghetti).toBe(400);
  expect(
    await sql(`select causale, variazione::float as v from movimento where famiglia_id = ${famigliaDi} and causale not in ('carico', 'annullo') order by seq`, [luca.id]),
  ).toEqual([
    { causale: 'consumo', v: -80 },
    { causale: 'consumo', v: -20 },
  ]);
  await expect
    .poll(() => sql(`select nome, quantita::float as q, tipo_data from lotto where origine = 'avanzo' and quantita > 0 and famiglia_id = ${famigliaDi}`, [luca.id]))
    .toEqual([{ nome: CARBONARA, q: 2, tipo_data: 'stimata' }]);

  // L'avanzo compare in Oggi tra le cose da usare presto, con il nome del piatto e le porzioni.
  await page.getByRole('dialog', { name: 'Cena di oggi' }).getByRole('button', { name: 'Chiudi' }).click();
  await page.getByRole('region', { name: 'Da usare presto' }).locator('summary').click();
  await expect(page.getByRole('region', { name: 'Da usare presto' }).getByRole('button', { name: new RegExp(CARBONARA) })).toContainText('avanzo, 2 porzioni');

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

  // Dopo la conferma, la foto del piatto è facoltativa: si carica dal dettaglio del pasto e la conferma la cita.
  await page.getByRole('region', { name: 'Cena' }).getByRole('button', { name: /^Dettagli di cena/ }).click();
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

test('ciò che scade: in Casa le ricette che lo usano, «stasera» in un tocco, avviso sulla scheda Casa', async ({ browser }, info) => {
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

  // L'elenco di ciò che scade e le ricette che lo usano stanno in Casa; Oggi ne mostra solo le prime mattonelle.
  await page.getByRole('region', { name: 'Da usare presto' }).locator('summary').click();
  const ricette = page.getByRole('region', { name: 'Da usare presto' }).getByRole('list', { name: 'Ricette che li usano' });
  await expect(ricette.getByRole('listitem').first()).toContainText('usa guanciale');
  await ricette.getByRole('button', { name: /Metti a cena stasera/ }).first().click();
  await page.getByRole('button', { name: 'Oggi', exact: true }).click();
  // In Oggi «Da usare presto» è una tendina chiusa che dice quanti sono e i primi nomi.
  await expect(page.getByRole('region', { name: 'Da usare presto' }).locator('summary')).toContainText('Da usare presto 1guanciale');
  await page.getByRole('region', { name: 'Da usare presto' }).locator('summary').click();
  await expect(page.getByRole('region', { name: 'Da usare presto' }).getByRole('button', { name: /Guanciale/ })).toContainText('oggi');
  await expect(page.getByRole('region', { name: 'Oggi si mangia' }).getByRole('button', { name: /Mangiato come previsto/ })).toBeVisible();
  await salvato(page);
  await expect
    .poll(async () => (await sql<{ n: number }>(`select count(*)::int as n from portata where categoria = 'cena' and data = current_date and famiglia_id = ${famigliaDi}`, [luca.id]))[0].n)
    .toBe(1);
});

test('l’avanzo di ieri, in casa, si mette nel menu di domani da «Aggiungi»', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Avanzi');
  await sql(
    `insert into portata (id, famiglia_id, data, categoria, ricetta_id, porzioni) select gen_random_uuid(), famiglia_id, current_date - 1, 'pranzo', 'sys:lasagne', 4
       from utente_famiglia where utente_id = $1`,
    [luca.id],
  );
  await page.reload();
  // Il pranzo di ieri si conferma oggi: avanzano 2 porzioni, in frigo.
  await page.getByRole('region', { name: 'Pasti da confermare' }).getByRole('button', { name: /Com’è andato: Lasagne/ }).click();
  const foglio = page.getByRole('dialog', { name: 'Com’è andato il pasto?' });
  await foglio.getByRole('button', { name: 'Una porzione in più' }).click();
  await foglio.getByRole('button', { name: 'Una porzione in più' }).click();
  await foglio.getByRole('button', { name: 'Conferma' }).click();
  await salvato(page);

  // Domani a cena: in «Aggiungi» c'è l'avanzo in casa, un tocco e il pasto lo prende.
  const domani = piuGiorni(oggi(), 1);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Giorni' }).click();
  await scegliGiorno(page, domani);
  await page.getByRole('button', { name: `Aggiungi a cena di ${dataLunga(domani)}` }).click();
  const avanzi = page.getByRole('dialog').getByRole('group', { name: 'Avanzi in casa' });
  await expect(avanzi).toContainText('2 porzioni in frigo');
  await avanzi.getByRole('button', { name: /Mangia l’avanzo: Lasagne/ }).click();
  await salvato(page);
  await expect
    .poll(() =>
      sql(
        `select a.categoria, a.data = current_date + 1 as domani, o.data = current_date - 1 as da_ieri from portata a join portata o on o.id = a.avanzo_di
          where a.famiglia_id = ${famigliaDi} and a.eliminato_il is null`,
        [luca.id],
      ),
    )
    .toEqual([{ categoria: 'cena', domani: true, da_ieri: true }]);
});
