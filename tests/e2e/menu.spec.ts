/**
 * Menu della settimana sul flusso reale: piatti, chi mangia cosa, settimane ripetute, telefono e tablet.
 */
import { expect, test } from '@playwright/test';
import { dataLunga, lunedi } from '../../src/dominio/menu';
import { oggi, piuGiorni } from '../../src/dominio/scadenze';
import { aggiungiPersona, apri, creaFamiglia, nuovoUtente, sql } from './aiuti';

test('menu: un piatto per cena, Sara mangia altro, nessun movimento in casa', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Menu');
  await aggiungiPersona(page, 'Sara');
  await page.getByRole('button', { name: 'Modifica Sara' }).click();
  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  await page.getByRole('button', { name: 'Uova' }).click();
  await page.getByRole('button', { name: 'Fatto' }).click();
  await page.getByRole('button', { name: 'Chiudi' }).click();

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Giorni' }).click();
  await page.getByRole('button', { name: `Aggiungi a cena di ${dataLunga(oggi())}` }).click();
  const nuovo = page.getByRole('dialog');
  await nuovo.getByLabel('Cosa si mangia').fill('carbonara');
  await expect(nuovo.getByText('Non adatta a tutti')).toBeVisible();
  await nuovo.getByRole('button', { name: /Spaghetti alla carbonara/ }).click();

  await page.getByRole('button', { name: 'Apri Spaghetti alla carbonara' }).click();
  const scheda = page.getByRole('dialog', { name: 'Spaghetti alla carbonara' });
  await expect(scheda.getByText(/Non adatta a tutti/)).toBeVisible();
  await scheda.getByRole('group', { name: 'Cosa mangia Sara' }).getByRole('button', { name: 'Altro' }).click();
  await scheda.getByRole('searchbox', { name: 'Cosa mangia Sara' }).fill('aglio');
  await scheda.getByRole('button', { name: /Spaghetti aglio, olio e peperoncino/ }).click();
  await expect(scheda.getByText('Adatto a chi lo mangia')).toBeVisible();
  await expect(scheda.getByText('Mangia: Spaghetti aglio, olio e peperoncino')).toBeVisible();
  await expect(scheda.getByRole('button', { name: 'Automatiche (1)' })).toHaveAttribute('aria-pressed', 'true');
  await scheda.getByRole('button', { name: 'Chiudi' }).click();
  await expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();

  const famiglia = `(select famiglia_id from utente_famiglia where utente_id = $1)`;
  const [r] = await sql<{ portate: number; eccezioni: string; movimenti: number }>(
    `select (select count(*)::int from portata where famiglia_id = ${famiglia} and eliminato_il is null) as portate,
            (select string_agg(tipo || ':' || ricetta_id, ',') from eccezione_membro where famiglia_id = ${famiglia} and eliminato_il is null) as eccezioni,
            (select count(*)::int from movimento where famiglia_id = ${famiglia}) as movimenti`,
    [luca.id],
  );
  expect(r).toEqual({ portate: 1, eccezioni: 'alternativa:sys:spaghetti_aglio_olio', movimenti: 0 });

  await page.getByRole('button', { name: 'Oggi', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Oggi si mangia' }).getByText('Spaghetti alla carbonara')).toBeVisible();
});

test('menu: ripeti la settimana prima, accendi la merenda, la vista scelta resta', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Settimane');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Griglia' }).click();
  const lun = lunedi(oggi());
  await page.getByRole('button', { name: `Aggiungi a pranzo di ${dataLunga(lun)}` }).click();
  await page.getByRole('dialog').getByLabel('Cosa si mangia').fill('Pizza da asporto');
  await page.getByRole('dialog').getByRole('button', { name: 'Scrivi «Pizza da asporto» senza ricetta' }).click();
  await expect(page.getByRole('button', { name: 'Apri Pizza da asporto' })).toBeVisible();

  await page.getByRole('button', { name: 'Settimana dopo' }).click();
  await expect(page.getByRole('button', { name: 'Apri Pizza da asporto' })).toHaveCount(0);
  await page.getByRole('button', { name: '↻ Ripeti la settimana prima' }).click();
  await expect(page.getByRole('button', { name: 'Apri Pizza da asporto' })).toBeVisible();

  await page.getByRole('button', { name: 'Pasti' }).click();
  const merenda = page.getByRole('dialog', { name: 'Pasti della famiglia' }).getByLabel('Merenda');
  await merenda.click();
  await expect(merenda).toBeChecked();
  await page.getByRole('button', { name: 'Chiudi' }).click();
  await expect(page.getByRole('button', { name: `Aggiungi a merenda di ${dataLunga(piuGiorni(lun, 7))}` })).toBeVisible();
  await expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();

  const righe = await sql<{ data: string; origine: string }>(
    `select data::text, origine from portata where famiglia_id = (select famiglia_id from utente_famiglia where utente_id = $1) order by data`,
    [luca.id],
  );
  expect(righe).toEqual([
    { data: lun, origine: 'manuale' },
    { data: piuGiorni(lun, 7), origine: 'ripetuta' },
  ]);

  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Panoramica' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Panoramica' })).toHaveAttribute('aria-pressed', 'true');
  // Sul telefono la pagina non scorre di lato.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
