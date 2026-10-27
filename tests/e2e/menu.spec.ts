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

test('colazione fissa: ogni giorno da oggi, cambiata da un giorno in poi, poi fermata', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Colazione');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Giorni' }).click();
  await page.getByRole('button', { name: `Aggiungi a colazione di ${dataLunga(oggi())}` }).click();
  await page.getByRole('dialog').getByLabel('Cosa si mangia').fill('Latte e caffè');
  await page.getByRole('dialog').getByRole('button', { name: 'Scrivi «Latte e caffè» senza ricetta' }).click();
  await page.getByRole('button', { name: 'Apri Latte e caffè' }).first().click();
  await page.getByRole('dialog', { name: 'Latte e caffè' }).getByRole('button', { name: '🔁 Ogni giorno da qui' }).click();
  await expect(page.getByRole('dialog', { name: 'Latte e caffè' })).toContainText('🔁 ogni giorno');
  await page.getByRole('button', { name: 'Chiudi' }).click();

  const colazioni = () =>
    sql<{ data: string; testo: string }>(
      `select data::text, testo from portata where categoria = 'colazione' and eliminato_il is null
          and famiglia_id in (select famiglia_id from utente_famiglia where utente_id = $1) order by data`,
      [luca.id],
    );
  await expect.poll(async () => (await colazioni()).length).toBeGreaterThanOrEqual(14);

  // Da dopodomani si cambia: il cappuccino prende il posto del latte e caffè nei giorni dopo.
  const dopodomani = piuGiorni(oggi(), 2);
  const [{ id }] = await sql<{ id: string }>(
    `select id from portata where categoria = 'colazione' and data = $2 and famiglia_id in (select famiglia_id from utente_famiglia where utente_id = $1)`,
    [luca.id, dopodomani],
  );
  if (lunedi(dopodomani) !== lunedi(oggi())) await page.getByRole('button', { name: 'Settimana dopo' }).click();
  await page.getByRole('region', { name: dataLunga(dopodomani) }).getByRole('button', { name: 'Apri Latte e caffè' }).click();
  const scheda = page.getByRole('dialog', { name: 'Latte e caffè' });
  await expect(scheda).toContainText(dataLunga(dopodomani));
  await scheda.getByRole('button', { name: 'Cambia piatto' }).click();
  await scheda.getByLabel('Nuovo piatto').fill('Cappuccino');
  page.once('dialog', (d) => void d.accept());
  await scheda.getByRole('button', { name: 'Scrivi «Cappuccino» senza ricetta' }).click();
  await expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();
  await expect
    .poll(async () => (await colazioni()).slice(0, 4).map((r) => r.testo))
    .toEqual(['Latte e caffè', 'Latte e caffè', 'Cappuccino', 'Cappuccino']);
  expect((await sql<{ id: string }>(`select id from portata where id = $1 and testo = 'Cappuccino' and eliminato_il is null`, [id])).length).toBe(1);
});

test('torta che dura più giorni: avanzo domani, la conferma la mette in casa', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Torta');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Giorni' }).click();
  await page.getByRole('button', { name: `Aggiungi a cena di ${dataLunga(oggi())}` }).click();
  await page.getByRole('dialog').getByLabel('Cosa si mangia').fill('torta di mele');
  await page.getByRole('dialog').getByRole('button', { name: /Torta di mele/ }).first().click();
  await page.getByRole('button', { name: 'Apri Torta di mele' }).first().click();
  const scheda = page.getByRole('dialog', { name: 'Torta di mele' });
  const domani = piuGiorni(oggi(), 1);
  await expect(scheda.getByLabel('Giorno dell’avanzo')).toHaveValue(domani);
  await scheda.getByRole('button', { name: '🍰 Avanza anche qui' }).click();
  await expect(scheda.getByRole('list', { name: 'Avanzi nei giorni dopo' })).toContainText(dataLunga(domani));
  await expect(scheda).toContainText('Si cucinano 2 porzioni');
  await page.getByRole('button', { name: 'Chiudi' }).click();
  if (lunedi(domani) === lunedi(oggi())) {
    await expect(page.getByRole('region', { name: dataLunga(domani) }).getByRole('button', { name: 'Apri Torta di mele' })).toContainText('avanzo');
  }

  await page.getByRole('button', { name: 'Oggi', exact: true }).click();
  await page.getByRole('button', { name: 'Mangiato come previsto: Torta di mele' }).click();
  await expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();
  await expect
    .poll(async () =>
      sql<{ nome: string; q: number }>(
        `select nome, quantita::float as q from lotto where ingrediente_id = 'ing:avanzo' and eliminato_il is null
            and famiglia_id in (select famiglia_id from utente_famiglia where utente_id = $1)`,
        [luca.id],
      ),
    )
    .toEqual([{ nome: 'Torta di mele', q: 1 }]);
});

test('proposte: l’app propone i pasti vuoti, si cambia o si toglie, entra solo ciò che si conferma', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Proposte');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: '✨ Proponi la settimana' }).click();
  const foglio = page.getByRole('dialog', { name: 'Proposte per la settimana' });
  const voci = foglio.getByRole('list', { name: 'Proposte' }).getByRole('listitem');
  const quante = await voci.count();
  expect(quante).toBeGreaterThan(0);
  const prima = (await voci.first().textContent()) ?? '';
  await voci.first().getByRole('button', { name: /Un’altra/ }).click();
  await expect(voci.first()).not.toHaveText(prima);
  await voci.nth(0).getByRole('checkbox').uncheck();
  await foglio.getByRole('button', { name: `Metti nel menu (${quante - 1})` }).click();
  await expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();
  const proposte = () =>
    sql<{ n: number }>(
      `select count(*)::int as n from portata where origine = 'automatica' and eliminato_il is null
          and famiglia_id in (select famiglia_id from utente_famiglia where utente_id = $1)`,
      [luca.id],
    );
  await expect.poll(async () => (await proposte())[0].n).toBe(quante - 1);
  // Riaprendo, resta da proporre solo il pasto tolto.
  await page.getByRole('button', { name: '✨ Proponi la settimana' }).click();
  await expect(foglio.getByRole('list', { name: 'Proposte' }).getByRole('listitem')).toHaveCount(1);
});
