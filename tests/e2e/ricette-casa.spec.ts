/**
 * Ricette e casa sul flusso reale: catalogo dal database, comandi veri, telefono e tablet.
 */
import { expect, test } from '@playwright/test';
import { aggiungiPersona, apri, creaFamiglia, nuovoUtente, sql } from './aiuti';

const domani = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

test('ricette: cerca, scala le porzioni, segnala l’allergia e crea la propria versione', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Ricette');
  await aggiungiPersona(page, 'Sara');
  await page.getByRole('button', { name: 'Modifica Sara' }).click();
  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  await page.getByRole('button', { name: 'Uova' }).click();
  await page.getByRole('button', { name: 'Fatto' }).click();
  await page.getByRole('button', { name: 'Chiudi' }).click();

  await page.getByRole('button', { name: 'Ricette' }).click();
  await page.getByLabel('Cerca').fill('carbonara');
  await page.getByRole('button', { name: 'Apri Spaghetti alla carbonara' }).click();
  const scheda = page.getByRole('dialog', { name: 'Spaghetti alla carbonara' });
  await expect(scheda.getByText('Non adatta a tutti')).toBeVisible();
  await expect(scheda.getByText(/Sara: ⛔/)).toBeVisible();
  await expect(scheda.getByText('150 g')).toBeVisible();
  await scheda.getByRole('button', { name: 'Una porzione in più' }).click();
  await scheda.getByRole('button', { name: 'Una porzione in più' }).click();
  await expect(scheda.getByText('6 porzioni')).toBeVisible();
  await expect(scheda.getByText('225 g')).toBeVisible();
  await expect(scheda.getByText('6 pz')).toBeVisible();

  await scheda.getByRole('button', { name: 'Crea la mia versione' }).click();
  const editor = page.getByRole('dialog', { name: 'Nuova ricetta' });
  await editor.getByLabel('Titolo').fill('Carbonara di casa');
  await editor.getByLabel('Quantità di Guanciale').fill('200');
  await editor.getByRole('button', { name: 'Salva ricetta' }).click();
  await expect(page.getByRole('dialog', { name: 'Carbonara di casa' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();

  const [r] = await sql<{ derivata_da: string; n: number; guanciale: string }>(
    `select r.derivata_da, (select count(*)::int from ricetta_ingrediente where ricetta_id = r.id) as n,
            (select quantita::text from ricetta_ingrediente where ricetta_id = r.id and ingrediente_id = 'ing:guanciale') as guanciale
       from ricetta r where r.titolo = 'Carbonara di casa' and r.famiglia_id in (select famiglia_id from utente_famiglia where utente_id = $1)`,
    [luca.id],
  );
  expect(r).toEqual({ derivata_da: 'sys:carbonara', n: 6, guanciale: '200' });
});

test('editor: una quantità senza numero non si salva, «q.b.» sì', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Editor');
  await page.getByRole('button', { name: 'Ricette' }).click();
  await page.getByRole('button', { name: '+ Ricetta' }).click();
  const editor = page.getByRole('dialog', { name: 'Nuova ricetta' });
  await editor.getByLabel('Titolo').fill('Pane e olio');
  await editor.getByRole('button', { name: /Antipasto/ }).click();
  await editor.getByRole('button', { name: '+ Ingrediente' }).click();
  await editor.getByLabel('Ingrediente').fill('pane');
  await editor.getByRole('button', { name: 'Pane', exact: true }).click();
  await editor.getByRole('button', { name: '+ Ingrediente' }).click();
  await editor.getByLabel('Ingrediente').fill('olio extra');
  await editor.getByRole('button', { name: /Olio extravergine/ }).first().click();
  await editor.getByRole('textbox', { name: 'Passaggio 1' }).fill('Taglia il pane e condiscilo con l’olio.');
  await editor.getByRole('button', { name: 'Salva ricetta' }).click();
  await expect(editor.getByRole('alert')).toContainText('scrivi la quantità oppure scegli «q.b.»');

  await editor.getByLabel('Quantità di Pane', { exact: true }).fill('200');
  await editor.getByRole('checkbox', { name: 'q.b.' }).nth(1).check();
  await editor.getByRole('button', { name: 'Salva ricetta' }).click();
  await expect(page.getByRole('dialog', { name: 'Pane e olio' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Pane e olio' }).getByText('q.b.')).toBeVisible();
});

test('casa: aggiunge, mostra cosa usare presto, scala la quantità usata e stima la data dello sfuso', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Dispensa');
  await page.getByRole('button', { name: 'Casa', exact: true }).click();

  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  const nuovo = page.getByRole('dialog', { name: 'Aggiungi in casa' });
  await nuovo.getByLabel('Cosa aggiungi?').fill('yogurt');
  await nuovo.getByRole('button', { name: /Yogurt$/ }).first().click();
  await nuovo.getByLabel('Quantità').fill('500');
  await nuovo.getByRole('button', { name: 'Da consumarsi entro' }).click();
  await nuovo.getByLabel('Data').fill(domani());
  await nuovo.getByRole('button', { name: 'Aggiungi', exact: true }).click();

  const presto = page.getByRole('region', { name: 'Da usare presto' });
  await expect(presto.getByText('Entro 1 giorno')).toBeVisible();
  await presto.getByRole('button', { name: /Apri Yogurt/ }).click();
  const lotto = page.getByRole('dialog', { name: /Yogurt/ });
  await lotto.getByRole('button', { name: 'Usato' }).click();
  await lotto.getByRole('button', { name: 'Una parte' }).click();
  await lotto.getByLabel('Quantità').fill('200');
  await lotto.getByRole('button', { name: 'Conferma' }).click();
  await expect(lotto.getByText('300 g', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();
  await lotto.getByRole('button', { name: 'Chiudi' }).click();

  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  await nuovo.getByLabel('Cosa aggiungi?').fill('insalata');
  await nuovo.getByRole('button', { name: /Insalata$/ }).first().click();
  await nuovo.getByLabel('Quantità').fill('250');
  await nuovo.getByRole('button', { name: 'Senza data' }).click();
  await expect(nuovo.getByText(/Stima indicativa: entro 5 giorni in frigo/)).toBeVisible();
  await nuovo.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await expect(page.getByText('Entro 5 giorni (stima)').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();

  const righe = await sql<{ ingrediente_id: string; quantita: string; tipo_data: string; movimenti: number }>(
    `select l.ingrediente_id, l.quantita::text, l.tipo_data, (select count(*)::int from movimento m where m.lotto_id = l.id) as movimenti
       from lotto l where l.famiglia_id in (select famiglia_id from utente_famiglia where utente_id = $1) order by l.ingrediente_id`,
    [luca.id],
  );
  expect(righe).toEqual([
    { ingrediente_id: 'ing:insalata', quantita: '250', tipo_data: 'stimata', movimenti: 1 },
    { ingrediente_id: 'ing:yogurt', quantita: '300', tipo_data: 'scadenza', movimenti: 2 },
  ]);

  await page.getByRole('button', { name: 'Oggi' }).click();
  await expect(page.getByRole('region', { name: 'Da usare presto' }).getByText('Entro 1 giorno')).toBeVisible();
});
