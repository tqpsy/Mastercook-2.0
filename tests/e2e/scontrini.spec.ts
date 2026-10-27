/**
 * Scontrini e codici a barre sul flusso reale, telefono e tablet. Il testo dello scontrino si incolla
 * (la foto passa dallo stesso controllo); il codice si scrive a mano, come quando la fotocamera manca.
 */
import { expect, type Page, test } from '@playwright/test';
import { apri, creaFamiglia, nuovoUtente, sql } from './aiuti';

const famigliaDi = '(select famiglia_id from utente_famiglia where utente_id = $1)';
const salvato = (page: Page) => expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();

function scontrino(data: string) {
  const [a, m, g] = data.split('-');
  return `SUPERMERCATO ROSSI
DESCRIZIONE   IVA   Prezzo(€)
LATTE INTERO 1L   10%   1,29
BANANE
0,856 kg x 1,99 €/kg   4%   1,70
SHOPPER   22%   0,10
TOTALE COMPLESSIVO   3,09
PAGAMENTO CONTANTE   5,00
${g}-${m}-${a} 18:30`;
}

test('scontrino: la riga del carrello prende il prezzo, il resto entra in casa una volta sola', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Scontrino');
  await page.getByRole('button', { name: 'Spesa', exact: true }).click();

  // Il latte è già stato confermato dal carrello, senza prezzo.
  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  await page.getByLabel('Cosa serve?').fill('latte');
  await page.getByRole('dialog').getByRole('button', { name: 'Latte', exact: true }).click();
  await page.getByLabel('Quantità (facoltativa)').fill('1');
  await page.getByRole('dialog').getByLabel('Unità').selectOption('l');
  await page.getByRole('dialog').getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Metti Latte nel carrello' }).click();
  await page.getByRole('button', { name: 'Conferma la spesa' }).click();
  await page.getByRole('dialog', { name: 'Conferma la spesa' }).getByRole('button', { name: 'Conferma', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Acquisti recenti' })).toContainText('Latte');
  await salvato(page);
  const [{ oggi }] = await sql<{ oggi: string }>(`select data::text as oggi from acquisto where famiglia_id = ${famigliaDi}`, [luca.id]);

  await page.getByRole('button', { name: 'Aggiungi uno scontrino' }).click();
  await page.getByLabel('Oppure incolla il testo dello scontrino').fill(scontrino(oggi));
  await page.getByRole('button', { name: 'Leggi le righe' }).click();
  const foglio = page.getByRole('dialog', { name: 'Controlla lo scontrino' });
  await expect(foglio.getByLabel('Negozio')).toHaveValue('Supermercato Rossi');
  await expect(foglio.getByLabel('Totale €')).toHaveValue('3,09');
  await expect(foglio.getByLabel('Cosa fare di LATTE INTERO 1L')).toHaveValue(/^abbina:/);
  await expect(foglio.getByLabel('Cosa fare di BANANE')).toHaveValue('casa');
  await expect(foglio.getByLabel('Quantità di BANANE')).toHaveValue('856');
  await foglio.getByLabel('Cosa fare di SHOPPER').selectOption('ignora');
  await foglio.getByRole('button', { name: 'Importa lo scontrino' }).click();
  await expect(page.getByRole('region', { name: 'Acquisti recenti' })).toContainText('Banane');
  await salvato(page);

  const righe = await sql<{ cosa: string; prezzo: string; fonte: string; origine: string | null; q: string | null }>(
    `select coalesce(r.ingrediente_id, r.nome) as cosa, r.prezzo::text as prezzo, a.fonte, l.origine, l.quantita::text as q
       from acquisto_riga r join acquisto a on a.id = r.acquisto_id left join lotto l on l.id = r.lotto_id
      where r.famiglia_id = ${famigliaDi} order by coalesce(r.ingrediente_id, r.nome) collate "C"`,
    [luca.id],
  );
  expect(righe).toEqual([
    { cosa: 'ing:banana', prezzo: '1.70', fonte: 'scontrino', origine: 'scontrino', q: '856' },
    { cosa: 'ing:latte', prezzo: '1.29', fonte: 'carrello', origine: 'acquisto', q: '1000' },
  ]);

  // Lo stesso scontrino una seconda volta: l'app avvisa e il server non carica di nuovo.
  await page.getByRole('button', { name: 'Aggiungi uno scontrino' }).click();
  await page.getByLabel('Oppure incolla il testo dello scontrino').fill(scontrino(oggi));
  await page.getByRole('button', { name: 'Leggi le righe' }).click();
  await expect(page.getByText(/Sembra uno scontrino già importato/)).toBeVisible();
  await page.getByRole('button', { name: 'Importa lo scontrino' }).click();
  await expect.poll(async () => (await sql<{ n: number }>(`select count(*)::int as n from comando where tipo = 'importa_scontrino' and famiglia_id = ${famigliaDi}`, [luca.id]))[0].n).toBe(2);
  await salvato(page);
  expect((await sql<{ n: number }>(`select count(*)::int as n from lotto where famiglia_id = ${famigliaDi}`, [luca.id]))[0].n).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('codice a barre: la prima volta si sceglie (con Open Food Facts), poi si riconosce in casa e al supermercato', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  let richieste = 0;
  await page.route('https://world.openfoodfacts.org/**', (r) => {
    richieste++;
    return r.fulfill({ json: { status: 1, product: { product_name_it: 'Latte intero', brands: 'Stalla', product_quantity: 1000, product_quantity_unit: 'ml' } } });
  });
  await creaFamiglia(page, 'Casa Codici');
  await page.getByRole('button', { name: 'Casa', exact: true }).click();
  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  await page.getByRole('button', { name: 'Scansiona il codice a barre' }).click();
  await page.getByLabel('Oppure scrivi le cifre sotto il codice').fill('8001234567890');
  await page.getByRole('button', { name: 'Usa questo codice' }).click();
  await expect(page.getByRole('dialog', { name: 'Codice nuovo' })).toContainText('Latte intero Stalla');
  await page.getByRole('button', { name: 'È Latte' }).click();
  await expect(page.getByLabel('Quantità', { exact: true })).toHaveValue('1000');
  await expect(page.getByLabel('Nome sulla confezione (facoltativo)')).toHaveValue('Latte intero Stalla');
  await page.getByRole('button', { name: 'Senza data' }).click();
  await page.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await salvato(page);
  // In sviluppo React ripete gli effetti una volta: conta che ci sia stata la richiesta, non quante.
  const chieste = richieste;
  expect(chieste).toBeGreaterThan(0);
  await expect.poll(() => sql(`select codice, ingrediente_id, quantita::float as q, unita from prodotto where famiglia_id = ${famigliaDi}`, [luca.id])).toEqual([
    { codice: '8001234567890', ingrediente_id: 'ing:latte', q: 1000, unita: 'ml' },
  ]);

  // Al supermercato lo stesso codice va dritto nel carrello, senza chiedere niente a nessuno.
  await page.getByRole('button', { name: 'Spesa', exact: true }).click();
  await page.getByRole('button', { name: 'Scansiona un prodotto nel carrello' }).click();
  await page.getByLabel('Oppure scrivi le cifre sotto il codice').fill('8001234567890');
  await page.getByRole('button', { name: 'Usa questo codice' }).click();
  await expect(page.getByRole('region', { name: 'Nel carrello' }).getByRole('button', { name: 'Apri Latte' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Nel carrello' })).toContainText('1 l');
  await salvato(page);
  expect(richieste).toBe(chieste);
});
