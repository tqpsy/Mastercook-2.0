/**
 * Modalità schermo: il logo apre la settimana a tutto schermo e in sola lettura; il logo dentro, toccato di
 * nuovo, torna alla modifica. Doppio tocco su un giorno apre le sue ricette; Indietro del telefono, solo lì,
 * torna alla settimana restando a tutto schermo (mai uscendone per sbaglio mentre si legge).
 */
import { expect, type Page, test } from '@playwright/test';
import { dataLunga } from '../../src/dominio/menu';
import { oggi } from '../../src/dominio/scadenze';
import { apri, creaFamiglia, nuovoUtente } from './aiuti';

const CARBONARA = 'Spaghetti alla carbonara';
const indietro = (page: Page) => page.evaluate(() => history.back());
const salvato = (page: Page) => expect(page.getByRole('button', { name: 'Impostazioni' })).toHaveAccessibleDescription('Stato del salvataggio: Tutto salvato');

/** Dalla scheda iniziale: la carbonara a cena di oggi, nel Menu. */
async function carbonaraStaseraPerCena(page: Page) {
  await page.getByRole('button', { name: 'Calendario', exact: true }).click();
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Giorni' }).click();
  await page.getByRole('button', { name: `Aggiungi a cena di ${dataLunga(oggi())}` }).click();
  await page.getByRole('dialog').getByLabel('Cosa si mangia').fill('carbonara');
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(CARBONARA) }).click();
  await salvato(page);
}

test('il logo entra ed esce dalla modalità schermo; la settimana si vede, sola lettura', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Schermo');
  await carbonaraStaseraPerCena(page);

  const entra = page.getByRole('button', { name: 'Modalità schermo: la settimana a tutto schermo, in sola lettura' });
  await entra.click();

  const schermo = page.getByRole('dialog', { name: 'Modalità schermo: la settimana' });
  await expect(schermo).toBeVisible();
  await expect(schermo).toContainText(CARBONARA);
  // Sola lettura: niente «+ Aggiungi» né altri comandi di modifica dentro la modalità schermo.
  await expect(schermo.getByRole('button', { name: /Aggiungi/ })).toHaveCount(0);

  // Il tasto Indietro, sulla settimana, non chiude la modalità schermo.
  await indietro(page);
  await expect(schermo).toBeVisible();

  // Doppio tocco sul giorno di oggi: si apre il dettaglio con le ricette.
  const cellaOggi = schermo.getByRole('button', { name: new RegExp(`Apri .*${dataLunga(oggi())}`) }).filter({ hasText: CARBONARA });
  await cellaOggi.dblclick();
  const dettaglio = page.getByRole('dialog', { name: dataLunga(oggi()) });
  await expect(dettaglio).toBeVisible();
  await expect(dettaglio).toContainText(CARBONARA);
  await expect(dettaglio).toContainText('Oggi · sola lettura');

  // Indietro chiude solo il dettaglio: si resta nella modalità schermo.
  await indietro(page);
  await expect(dettaglio).toHaveCount(0);
  await expect(schermo).toBeVisible();

  // Il logo dentro la modalità schermo torna alla modifica.
  await schermo.getByRole('button', { name: 'Esci dalla modalità schermo' }).click();
  await expect(schermo).toHaveCount(0);
  await expect(page.getByRole('navigation')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Calendario', exact: true })).toBeVisible();
});
