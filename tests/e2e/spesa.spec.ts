/**
 * Spesa sul flusso reale: lista dal menu, carrello, conferma in due tocchi, annullo. Telefono e tablet.
 */
import { expect, test } from '@playwright/test';
import { dataLunga } from '../../src/dominio/menu';
import { oggi, piuGiorni } from '../../src/dominio/scadenze';
import { formattaGiorno } from '../../src/dominio/unita';
import { apri, creaFamiglia, nuovoUtente, scegliGiorno, sql } from './aiuti';

const famigliaDi = '(select famiglia_id from utente_famiglia where utente_id = $1)';

test('spesa: la lista nasce dal menu, il carrello non tocca la casa, la conferma sì (due tocchi)', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Spesa');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Giorni' }).click();
  await page.getByRole('button', { name: `Aggiungi a cena di ${dataLunga(oggi())}` }).click();
  await page.getByRole('dialog').getByLabel('Cosa si mangia').fill('carbonara');
  await page.getByRole('dialog').getByRole('button', { name: /Spaghetti alla carbonara/ }).click();

  await page.getByRole('button', { name: 'Spesa', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apri Guanciale' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apri Spaghetti' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apri Sale' })).toHaveCount(0);

  const guanciale = page.getByRole('checkbox', { name: 'Metti Guanciale nel carrello' });
  await guanciale.click();
  await expect(page.getByRole('region', { name: 'Nel carrello' }).getByRole('button', { name: 'Apri Guanciale' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();
  expect((await sql<{ n: number }>(`select count(*)::int as n from lotto where famiglia_id = ${famigliaDi}`, [luca.id]))[0].n).toBe(0);

  // Due tocchi: «Conferma la spesa», poi «Conferma». Il prezzo è facoltativo: qui lo scriviamo.
  await page.getByRole('button', { name: 'Conferma la spesa' }).click();
  const conferma = page.getByRole('dialog', { name: 'Conferma la spesa' });
  await conferma.getByLabel('Prezzo di Guanciale').fill('3,50');
  await conferma.getByRole('button', { name: 'Conferma', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Acquisti recenti' })).toContainText('Guanciale');
  await expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();

  const [r] = await sql<{ origine: string; q: string; prezzo: string; stato: string }>(
    `select l.origine, l.quantita::text as q, ar.prezzo::text as prezzo, v.stato
       from acquisto_riga ar join lotto l on l.id = ar.lotto_id join voce_spesa v on v.id = ar.voce_id
      where ar.famiglia_id = ${famigliaDi}`,
    [luca.id],
  );
  expect(r).toEqual({ origine: 'acquisto', q: '37.5', prezzo: '3.50', stato: 'acquistata' });

  // Il guanciale ora è in casa: aggiornando la lista non serve più.
  await page.getByRole('button', { name: 'Aggiorna dal menu' }).click();
  await expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apri Guanciale' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Apri Spaghetti' })).toBeVisible();
});

test('spesa: voci a mano, spesa senza lista e annullo con la cronologia', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Annullo');
  await page.getByRole('button', { name: 'Spesa', exact: true }).click();
  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  await page.getByRole('button', { name: '✏️ Scrivi qualcosa che non è un alimento' }).click();
  await page.getByLabel('Cosa', { exact: true }).fill('Detersivo piatti');
  await page.getByRole('dialog').getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apri Detersivo piatti' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apri Detersivo piatti' })).toContainText('aggiunta a mano');

  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  await page.getByLabel('Cosa serve?').fill('latte');
  await page.getByRole('dialog').getByRole('button', { name: 'Latte', exact: true }).click();
  await page.getByLabel('Quantità (facoltativa)').fill('2');
  await page.getByRole('dialog').getByLabel('Unità').selectOption('l');
  await page.getByRole('dialog').getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Metti Latte nel carrello' }).click();
  await page.getByRole('checkbox', { name: 'Metti Detersivo piatti nel carrello' }).click();
  await page.getByRole('button', { name: 'Conferma la spesa' }).click();
  const conferma = page.getByRole('dialog', { name: 'Conferma la spesa' });
  await expect(conferma.getByLabel('Quantità di Latte')).toHaveValue('2000');
  await conferma.getByLabel('Prezzo di Detersivo piatti').fill('2,10');
  await conferma.getByRole('button', { name: 'Conferma', exact: true }).click();
  await expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /Apri l’acquisto di/ }).click();
  await page.getByRole('button', { name: 'Annulla l’acquisto' }).click();
  await expect(page.getByRole('region', { name: 'Acquisti recenti' })).toContainText('annullato');
  await expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();
  const storia = await sql<{ causale: string; v: string }>(
    `select causale, variazione::text as v from movimento where famiglia_id = ${famigliaDi} order by seq`,
    [luca.id],
  );
  expect(storia).toEqual([
    { causale: 'carico', v: '2000' },
    { causale: 'annullo', v: '-2000' },
  ]);
  // Sul telefono la pagina non scorre di lato.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('spesa per giorni scelti: con il menu su più giorni si compra solo per i prossimi tre', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Giorni');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Giorni' }).click();
  for (const [giorno, cerca, piatto] of [
    [oggi(), 'carbonara', /Spaghetti alla carbonara/],
    [piuGiorni(oggi(), 4), 'aglio', /Spaghetti aglio, olio/],
  ] as const) {
    await scegliGiorno(page, giorno);
    await page.getByRole('button', { name: `Aggiungi a cena di ${dataLunga(giorno)}` }).click();
    await page.getByRole('dialog').getByLabel('Cosa si mangia').fill(cerca);
    await page.getByRole('dialog').getByRole('button', { name: piatto }).first().click();
  }

  await page.getByRole('button', { name: 'Spesa', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apri Guanciale' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apri Aglio' })).toBeVisible();

  await page.getByRole('group', { name: 'Spesa per i giorni' }).getByRole('button', { name: 'Prossimi 3 giorni' }).click();
  await expect(page.getByRole('button', { name: 'Apri Aglio' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Apri Guanciale' })).toBeVisible();
  await expect(page.getByText(/^Solo per /)).toBeVisible();
  await expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();

  // La scelta resta: riaprendo la lista si ritrovano i tre giorni; un giorno in più si accende al tocco.
  await page.reload();
  await page.getByRole('button', { name: 'Spesa', exact: true }).click();
  const giorni = page.getByRole('group', { name: 'Giorni della spesa' });
  await expect(giorni.getByRole('button', { pressed: true })).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Apri Aglio' })).toHaveCount(0);
  await giorni.getByRole('button', { name: new RegExp(`^${formattaGiorno(piuGiorni(oggi(), 4))},`) }).click();
  await expect(page.getByRole('button', { name: 'Apri Aglio' })).toBeVisible();
});
