/**
 * Prove dell'interfaccia sul flusso reale: app vera, funzioni vere del database, utenti di prova.
 * L'accesso con Google è sostituito da una sessione di prova messa nel browser.
 */
import { expect, test } from '@playwright/test';
import { fileVecchio } from '../vecchio-esempio';
import { aggiungiPersona, apri, creaFamiglia, nuovoUtente, sql } from './aiuti';

test('primo accesso: crea la famiglia, aggiunge una persona con un’allergia, tutto resta dopo la riapertura', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page);
  await aggiungiPersona(page, 'Sara');

  await page.getByRole('button', { name: 'Modifica Sara' }).click();
  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  await page.getByRole('button', { name: 'Arachidi' }).click();
  await page.getByRole('button', { name: 'Fatto' }).click();
  await page.getByRole('button', { name: 'Chiudi' }).click();
  await expect(page.getByText('⚠️ Arachidi')).toBeVisible();
  await expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Famiglia' }).click();
  await expect(page.getByText('⚠️ Arachidi')).toBeVisible();
  const [r] = await sql<{ n: number }>(
    `select count(*)::int as n from vincolo_alimentare v join membro m on m.id = v.membro_id where m.nome = 'Sara' and v.oggetto = 'all:arachidi' and m.famiglia_id in (select famiglia_id from utente_famiglia where utente_id = $1)`,
    [luca.id],
  );
  expect(r.n).toBe(1);
});

test('allergie: il pannello non cambia altezza tra le schede, un secondo tocco toglie, nessuna «x» nella scheda della persona', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page);
  await aggiungiPersona(page, 'Sara');

  await page.getByRole('button', { name: 'Modifica Sara' }).click();
  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  const pannello = page.getByRole('dialog', { name: 'Allergie, intolleranze ed esigenze' });
  const alto = async () => (await pannello.boundingBox())!;
  const prima = await alto();
  for (const scheda of ['Intolleranza', 'Esigenza', 'Indicazione medica', 'Allergia']) {
    await pannello.getByRole('button', { name: scheda, exact: true }).click();
    const ora = await alto();
    expect(Math.round(ora.y)).toBe(Math.round(prima.y));
    expect(Math.round(ora.height)).toBe(Math.round(prima.height));
  }

  const arachidi = pannello.getByRole('button', { name: 'Arachidi' });
  await arachidi.click();
  await expect(arachidi).toHaveAttribute('aria-pressed', 'true');
  await arachidi.click();
  await expect(arachidi).toHaveAttribute('aria-pressed', 'false');
  await pannello.getByRole('button', { name: 'Sesamo' }).click();
  await pannello.getByRole('button', { name: 'Fatto' }).click();

  const scheda = page.getByRole('dialog', { name: 'Sara' });
  await expect(scheda.getByText('⚠️ Sesamo')).toBeVisible();
  await expect(scheda.getByText('Arachidi')).toHaveCount(0);
  await expect(scheda.getByRole('button', { name: '✕' })).toHaveCount(0);

  // Con un foglio aperto la pagina sotto non scorre.
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');

  // Porzione cambiata più volte di fila: nessun falso «da sistemare».
  for (const p of ['Adulto', 'Ragazzo', 'Adulto', 'Bambino']) await scheda.getByRole('button', { name: p, exact: true }).click();
  await scheda.getByRole('button', { name: 'Chiudi' }).click();
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
  await expect(page.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();
  const [r] = await sql<{ porzione: string }>(
    `select porzione::text from membro where nome = 'Sara' and famiglia_id in (select famiglia_id from utente_famiglia where utente_id = $1)`,
    [luca.id],
  );
  expect(Number(r.porzione)).toBe(0.6);
});

test('invito: chi apre il link entra con un tocco e vede la famiglia; le modifiche arrivano all’altro dispositivo', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page: telefono } = await apri(browser, luca, info.project.use);
  await creaFamiglia(telefono, 'Casa Invito');
  await telefono.getByRole('button', { name: 'Impostazioni' }).click();
  await telefono.getByRole('button', { name: 'Crea un link d’invito' }).click();
  await expect(telefono.getByRole('button', { name: 'Condividi' })).toBeVisible();
  const [invito] = await sql<{ codice: string }>(`select codice from invito order by creato_il desc limit 1`);

  const sara = await nuovoUtente('Sara');
  const { page: tablet } = await apri(browser, sara, info.project.use, `#invito=${invito.codice}`);
  await expect(tablet.getByLabel('Il tuo nome')).toHaveValue('Sara');
  await tablet.getByRole('button', { name: 'Entra' }).click();
  await expect(tablet.getByRole('heading', { name: 'Ciao, Casa Invito' })).toBeVisible();

  await aggiungiPersona(telefono, 'Nonna');
  // Prima che il tablet chieda gli aggiornamenti, la Nonna deve essere arrivata al server.
  await expect(telefono.getByRole('button', { name: /Stato del salvataggio: Tutto salvato/ })).toBeVisible();
  await tablet.getByRole('button', { name: 'Famiglia' }).click();
  await tablet.getByRole('button', { name: /Stato del salvataggio/ }).click();
  await tablet.getByRole('button', { name: 'Aggiorna adesso' }).click();
  await tablet.getByRole('button', { name: 'Chiudi' }).click();
  await expect(tablet.getByRole('button', { name: 'Modifica Nonna' })).toBeVisible();
});

test('senza rete: la modifica resta in attesa, visibile, e parte al ritorno della rete', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { contesto, page } = await apri(browser, luca, info.project.use);
  const marco = `Marco ${info.project.name} ${luca.id.slice(0, 6)}`;
  await creaFamiglia(page, 'Casa Offline');
  await page.getByRole('button', { name: 'Famiglia' }).click();

  await contesto.setOffline(true);
  await aggiungiPersona(page, marco);
  await expect(page.locator('.etichetta', { hasText: 'in invio' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Senza rete · 1 in attesa/ })).toBeVisible();
  expect((await sql<{ n: number }>(`select count(*)::int as n from membro where nome = $1`, [marco]))[0].n).toBe(0);

  await contesto.setOffline(false);
  await expect(page.getByRole('button', { name: /Tutto salvato/ })).toBeVisible({ timeout: 20_000 });
  expect((await sql<{ n: number }>(`select count(*)::int as n from membro where nome = $1`, [marco]))[0].n).toBe(1);
  await expect(page.locator('.etichetta', { hasText: 'in invio' })).toHaveCount(0);
});

test('importazione dal vecchio Mastercook: rapporto prima, poi famiglia nuova; si può tornare indietro eliminandola', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await page.getByText('Hai un file di esportazione, anche del vecchio Mastercook? Caricalo').click();
  await page.getByLabel('File di esportazione (.json)').setInputFiles({ name: 'masterfood-casa.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fileVecchio())) });

  // Prova a secco: il rapporto, e nulla è ancora scritto.
  const rapporto = page.getByLabel('Importazione dal vecchio Mastercook');
  await expect(rapporto.getByText('Casa Topsidakis', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Tu chi sei nel vecchio Mastercook?')).toHaveValue('m1');
  await expect(page.getByRole('list', { name: 'Cosa entra' })).toContainText('2 persone, con 5 tra allergie, intolleranze ed esigenze');
  await expect(page.getByRole('list', { name: 'Da ricontrollare' })).toContainText('q.b.');
  expect((await sql<{ n: number }>('select count(*)::int as n from utente_famiglia where utente_id = $1', [luca.id]))[0].n).toBe(0);

  await page.getByRole('button', { name: 'Importa in una famiglia nuova' }).click();
  await expect(page.getByRole('heading', { name: 'Ciao, Casa Topsidakis (importata)' })).toBeVisible();
  await page.getByRole('button', { name: 'Famiglia' }).click();
  await expect(page.getByRole('button', { name: 'Modifica Sara' })).toBeVisible();
  const membri = await sql<{ nome: string; mio: boolean }>(
    'select m.nome, m.utente_id is not distinct from $1 as mio from membro m join utente_famiglia u on u.famiglia_id = m.famiglia_id where u.utente_id = $1 order by m.nome',
    [luca.id],
  );
  expect(membri).toEqual([
    { nome: 'Luca', mio: true },
    { nome: 'Sara', mio: false },
  ]);

  // Ritorno indietro: si elimina la famiglia importata riscrivendone il nome.
  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await page.getByText('Elimina questa famiglia').click();
  const elimina = page.getByRole('button', { name: 'Elimina per sempre' });
  await expect(elimina).toBeDisabled();
  await page.getByLabel('Per confermare scrivi il nome della famiglia').fill('Casa Topsidakis (importata)');
  await elimina.click();
  await expect(page.getByRole('heading', { name: 'Crea la tua famiglia' })).toBeVisible();
  expect((await sql<{ n: number }>('select count(*)::int as n from utente_famiglia where utente_id = $1', [luca.id]))[0].n).toBe(0);
});
