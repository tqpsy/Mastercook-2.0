/**
 * Famiglia «sul mio Google Drive»: spiegazione chiara, copia nella cartella Mastercook, ritrovata su un altro
 * telefono, e due telefoni usati insieme che non si sovrascrivono a vicenda. Google e il Drive sono finti.
 */
import { expect, type Page, test } from '@playwright/test';
import { dataLunga } from '../../src/dominio/menu';
import { oggi } from '../../src/dominio/scadenze';
import { apri, nuovoUtente } from './aiuti';
import { DriveFinto } from './google-finto';

async function aggiungiCena(page: Page, cerca: string, titolo: string) {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Giorni' }).click();
  await page.getByRole('button', { name: `Aggiungi a cena di ${dataLunga(oggi())}` }).click();
  await page.getByRole('dialog').getByLabel('Cosa si mangia').fill(cerca);
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(titolo) }).first().click();
  await expect(page.getByRole('button', { name: `Apri ${titolo}` })).toBeVisible();
}

async function salvaOra(page: Page) {
  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await page.getByRole('button', { name: 'Salva ora sul Drive' }).click();
}

test('sul mio Drive: spiegazione, copia automatica, ritrovata su un altro telefono, niente sovrascritture', async ({ browser }, info) => {
  test.setTimeout(240_000);
  const drive = new DriveFinto();
  const marta = await nuovoUtente('Marta');
  const nome = `Casa Marta ${info.project.name}`;

  // Primo telefono: si sceglie il Drive, si legge la spiegazione, si collega.
  const a = (await apri(browser, marta, info.project.use, '', (c) => drive.collega(c))).page;
  await a.getByLabel('Nome della famiglia').fill(nome);
  await a.getByRole('radio', { name: /Sul mio Google Drive/ }).check();
  await a.getByRole('button', { name: 'Crea la famiglia' }).click();
  const spiegazione = a.getByRole('dialog', { name: 'Il tuo Google Drive' });
  await expect(spiegazione.getByText(/Non vede, non legge e non tocca/)).toBeVisible();
  await expect(spiegazione.getByText(/non passa dal server di Mastercook/)).toBeVisible();
  await spiegazione.getByRole('button', { name: 'Ho capito, continua' }).click();
  await expect(a.getByRole('heading', { name: `Ciao, ${nome}` })).toBeVisible({ timeout: 120_000 });

  // La prima copia si salva da sola, nella cartella Mastercook.
  await expect.poll(() => drive.copie().length, { timeout: 30_000 }).toBe(1);
  const cartella = [...drive.file.values()].find((f) => f.mimeType.endsWith('folder'));
  expect(cartella?.name).toBe('Mastercook');
  expect(drive.copie()[0]).toMatchObject({ name: `${nome}.json`, parents: [cartella!.id] });

  await aggiungiCena(a, 'carbonara', 'Spaghetti alla carbonara');
  await salvaOra(a);
  await expect.poll(() => drive.copie()[0].contenuto).toContain('sys:carbonara');

  // Secondo telefono, stesso account: la famiglia si ritrova dal Drive.
  const b = (await apri(browser, marta, info.project.use, '', (c) => drive.collega(c))).page;
  await b.getByText('Hai già salvato la famiglia sul tuo Google Drive? Ritrovala').click();
  await b.getByRole('button', { name: 'Cerca nel mio Google Drive' }).click();
  await b.getByRole('dialog', { name: 'Il tuo Google Drive' }).getByRole('button', { name: 'Ho capito, continua' }).click();
  await b.getByRole('list', { name: 'Famiglie sul Drive' }).getByRole('button', { name: 'Usa questa' }).click();
  await expect(b.getByRole('heading', { name: `Ciao, ${nome}` })).toBeVisible({ timeout: 120_000 });
  await b.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(b.getByRole('button', { name: 'Apri Spaghetti alla carbonara' })).toBeVisible();

  // Il primo telefono salva di nuovo; il secondo, che ha una copia vecchia, non sovrascrive: chiede.
  await aggiungiCena(a, 'minestrone', 'Minestrone di verdure');
  await salvaOra(a);
  await expect.poll(() => drive.copie()[0].contenuto).toContain('sys:minestrone');
  await salvaOra(b);
  await expect(b.getByRole('alert').getByText(/c’è una copia più recente/)).toBeVisible();
  await b.getByRole('button', { name: 'Usa quella del Drive' }).click();
  // Il telefono passa alla copia del Drive (si riapre su «Oggi»): niente più avviso, c'è anche il minestrone.
  await expect(b.getByRole('alert')).toHaveCount(0, { timeout: 60_000 });
  await expect(b.getByRole('region', { name: 'Cena' }).getByText('Minestrone di verdure')).toBeVisible({ timeout: 60_000 });
  expect(drive.copie()).toHaveLength(1);
});
