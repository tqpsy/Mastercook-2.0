/**
 * Piatto senza un ingrediente sul flusso reale: aggiungendo un piatto ⛔ per Sara (lattosio) si sceglie di
 * toglierle il parmigiano solo a lei o a tutti; l'ingrediente principale invece non si toglie.
 */
import { expect, test } from '@playwright/test';
import { dataLunga } from '../../src/dominio/menu';
import { oggi } from '../../src/dominio/scadenze';
import { aggiungiPersona, apri, creaFamiglia, nuovoUtente, sql } from './aiuti';

test('senza un ingrediente: solo per Sara, poi per tutti; il principale non si toglie', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Senza');
  await aggiungiPersona(page, 'Sara');
  await page.getByRole('button', { name: 'Modifica Sara' }).click();
  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  const pannello = page.getByRole('dialog', { name: 'Allergie, intolleranze ed esigenze' });
  await pannello.getByRole('button', { name: 'Intolleranza', exact: true }).click();
  await pannello.getByRole('button', { name: 'Lattosio' }).click();
  await pannello.getByRole('button', { name: 'Fatto' }).click();
  await page.getByRole('button', { name: 'Chiudi' }).click();

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Giorni' }).click();
  await page.getByRole('button', { name: `Aggiungi a cena di ${dataLunga(oggi())}` }).click();
  const nuovo = page.getByRole('dialog', { name: `Cena di ${dataLunga(oggi())}` });
  await nuovo.getByLabel('Cosa si mangia').fill('pasta con le zucchine');
  const penne = nuovo.getByRole('button', { name: /Pasta con le zucchine/ });
  await expect(penne).toContainText('Si fa senza');
  await expect(penne).toContainText('per Sara');
  await penne.click();

  // Per chi toglierle: di base solo per Sara, con cosa cambia nella spesa.
  const foglio = page.getByRole('dialog', { name: 'Pasta con le zucchine' });
  await expect(foglio.getByText(/Sara.*non può mangiare/)).toBeVisible();
  await expect(foglio.getByRole('radio', { name: /Solo per/ })).toHaveAttribute('aria-checked', 'true');
  await expect(foglio.getByRole('radio', { name: /Solo per/ })).toContainText('metti da parte la porzione di Sara');
  if (process.env.MC_SCHERMATE) await page.screenshot({ path: `${process.env.MC_SCHERMATE}/${info.project.name}-2-per-chi.png` });
  await foglio.getByRole('button', { name: '✓ Aggiungi a cena' }).click();

  const piatto = page.getByRole('button', { name: 'Apri Pasta con le zucchine' });
  await expect(piatto).toBeVisible();
  await expect(page.getByRole('button', { name: 'Impostazioni' })).toHaveAccessibleDescription('Stato del salvataggio: Tutto salvato');
  const famiglia = `(select famiglia_id from utente_famiglia where utente_id = $1)`;
  const senza = async () =>
    (await sql<{ senza: { ingrediente_id: string; membro_id: string | null }[] }>(`select senza from portata where famiglia_id = ${famiglia} and eliminato_il is null and ricetta_id = 'sys:pasta_zucchine'`, [luca.id]))[0]
      .senza;
  const [sara] = await sql<{ id: string }>(`select id from membro where famiglia_id = ${famiglia} and nome = 'Sara'`, [luca.id]);
  expect((await senza()).map((s) => [s.ingrediente_id, s.membro_id])).toEqual([['ing:parmigiano', sara.id]]);

  // Nel piatto: adatto a chi lo mangia, con cosa è tolto; si cambia in «per tutti».
  await piatto.click();
  const scheda = page.getByRole('dialog', { name: 'Pasta con le zucchine' });
  await expect(scheda.getByText('Adatto a chi lo mangia')).toBeVisible();
  await expect(scheda.getByText(/Senza .*per Sara/)).toBeVisible();
  if (process.env.MC_SCHERMATE) await page.screenshot({ path: `${process.env.MC_SCHERMATE}/${info.project.name}-3-nel-menu.png` });
  await scheda.getByRole('button', { name: 'Cambia', exact: true }).click();
  const cambia = page.getByRole('dialog', { name: 'Pasta con le zucchine' }).last();
  await cambia.getByRole('radio', { name: /Per tutti/ }).click();
  await cambia.getByRole('button', { name: '✓ Salva' }).click();
  await expect(scheda.getByText(/Nessuno lo mette/)).toBeVisible();
  await expect.poll(async () => (await senza()).every((s) => s.membro_id === null)).toBe(true);
  await scheda.getByRole('button', { name: 'Chiudi' }).first().click();

  // L'ingrediente principale non si toglie: gnocchi al gorgonzola, Sara mangia altro.
  await page.getByRole('button', { name: `Aggiungi a cena di ${dataLunga(oggi())}` }).click();
  await nuovo.getByLabel('Cosa si mangia').fill('gorgonzola');
  await nuovo.getByRole('button', { name: /Gnocchi al gorgonzola/ }).click();
  await expect(nuovo.getByText(/ingrediente principale/)).toBeVisible();
  if (process.env.MC_SCHERMATE) await page.screenshot({ path: `${process.env.MC_SCHERMATE}/${info.project.name}-4-non-si-toglie.png` });
  await nuovo.getByRole('button', { name: /Sara mangia altro/ }).click();
  await expect(page.getByRole('button', { name: 'Apri Gnocchi al gorgonzola' })).toContainText('per Luca');
});

test('Antonino propone un piatto ⛔ solo se si può togliere l’ingrediente, e chiede per chi', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Antonino');
  await aggiungiPersona(page, 'Sara');
  await page.getByRole('button', { name: 'Modifica Sara' }).click();
  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  const pannello = page.getByRole('dialog', { name: 'Allergie, intolleranze ed esigenze' });
  await pannello.getByRole('button', { name: 'Intolleranza', exact: true }).click();
  await pannello.getByRole('button', { name: 'Lattosio' }).click();
  await pannello.getByRole('button', { name: 'Fatto' }).click();
  await page.getByRole('button', { name: 'Chiudi' }).click();

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Giorni' }).click();
  await page.getByRole('button', { name: `Aggiungi a cena di ${dataLunga(oggi())}` }).click();
  const nuovo = page.getByRole('dialog', { name: `Cena di ${dataLunga(oggi())}` });
  // Ricette con le zucchine, solo primi: tra le idee anche quella da fare senza parmigiano.
  await nuovo.getByLabel('Cosa si mangia').fill('zucchin');
  await nuovo.getByRole('group', { name: 'Ingredienti trovati' }).getByRole('button', { name: /Zucchin/ }).first().click();
  await nuovo.getByRole('group', { name: 'Categoria' }).getByRole('button', { name: /Primo/ }).click();
  const idea = nuovo.getByRole('region', { name: 'Antonino consiglia' });
  // Un'idea alla volta: si va avanti finché arriva quella con ✂️ (prima vengono quelle adatte così come sono).
  for (let i = 0; i < 15 && !(await idea.getByText(/Si fa senza .* per Sara/).isVisible()); i++) await idea.getByRole('button', { name: '🔄 Un’altra' }).click();
  await expect(idea.getByText(/Si fa senza .* per Sara/).first()).toBeVisible();
  if (process.env.MC_SCHERMATE) await page.screenshot({ path: `${process.env.MC_SCHERMATE}/${info.project.name}-1-antonino.png` });
  await idea.getByRole('button', { name: /Metti nel menu/ }).click();
  await expect(page.getByRole('radiogroup', { name: 'Per chi toglierlo' })).toBeVisible();
});
