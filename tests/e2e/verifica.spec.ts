/**
 * Verifica con le foto sul flusso reale: zone, foto, confronto con la casa, decisioni, riepilogo e conferma.
 * In casa cambia solo ciò che si conferma; la cronologia del lotto dice com'era e com'è.
 */
import { expect, type Page, test } from '@playwright/test';
import { apri, creaFamiglia, nuovoUtente, sql } from './aiuti';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const foto = { name: 'frigo.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') };

async function aggiungi(page: Page, cerca: string, nome: RegExp, quantita: string) {
  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  const nuovo = page.getByRole('dialog', { name: 'Aggiungi in casa' });
  await nuovo.getByLabel('Cosa aggiungi?').fill(cerca);
  await nuovo.getByRole('button', { name: nome }).first().click();
  await nuovo.getByLabel('Quantità').fill(quantita);
  await nuovo.getByRole('button', { name: 'Senza data' }).click();
  await nuovo.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await expect(nuovo).toBeHidden();
}

test('verifica con le foto: solo le anomalie, decido io, riepilogo e poi la casa cambia', async ({ browser }, info) => {
  test.setTimeout(90_000);
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Verifica');
  const salvato = () => expect(page.getByRole('button', { name: 'Impostazioni' })).toHaveAccessibleDescription('Stato del salvataggio: Tutto salvato');

  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await page.getByLabel('Chiave Gemini della famiglia').fill('AIzaProva_chiave-della-famiglia-1234');
  await page.getByRole('button', { name: 'Salva la chiave' }).click();
  await expect(page.getByLabel('Chiave Gemini', { exact: true })).toContainText('…1234');

  await page.getByRole('button', { name: 'Casa', exact: true }).click();
  await aggiungi(page, 'uova', /^Uova$/, '6');
  await aggiungi(page, 'burro', /^Burro$/, '250');
  await aggiungi(page, 'yogurt', /^Yogurt$/, '2');
  await salvato();
  const famiglia = `famiglia_id in (select famiglia_id from utente_famiglia where utente_id = $1)`;
  // Uova e burro sul ripiano 1, lo yogurt sul 3 (che non si fotografa).
  await sql(`update lotto set posto = case when ingrediente_id = 'ing:yogurt' then 'r3' else 'r1' end where ${famiglia}`, [luca.id]);
  await page.reload();
  await page.getByRole('button', { name: 'Casa', exact: true }).click();

  await page.getByRole('button', { name: /Verifica con le foto/ }).click();
  const foglio = page.getByRole('dialog', { name: 'Verifica con le foto' });
  await expect(foglio.getByRole('note')).toContainText('non le usa per addestrare');
  await foglio.getByRole('button', { name: 'Ho capito, continua' }).click();

  // Zone: rinomino il ripiano 1 e ne aggiungo una; si salvano per la famiglia.
  await foglio.getByRole('button', { name: '✎ Modifica zone' }).click();
  await foglio.getByLabel('Nome della zona 1').fill('Ripiano alto');
  await foglio.getByRole('button', { name: '+ Aggiungi zona' }).click();
  await foglio.getByRole('button', { name: 'Salva le zone' }).click();
  await expect(foglio.getByRole('button', { name: /Ripiano alto/ })).toBeVisible();
  await expect(foglio.getByRole('button', { name: /Zona 7/ })).toBeVisible();

  // Guidata: due zone, foto solo nella prima (due angolazioni), la seconda si salta.
  await foglio.getByRole('button', { name: /Ripiano alto/ }).click();
  await foglio.getByRole('button', { name: /Ripiano 2/ }).click();
  await foglio.getByRole('button', { name: 'Inizia (2 zone)' }).click();
  await expect(foglio.getByText('Zona 1 di 2')).toBeVisible();
  await foglio.getByLabel('Foto di Ripiano alto').setInputFiles(foto);
  await expect(foglio.getByRole('img', { name: 'Foto della zona' })).toHaveCount(1);
  await foglio.getByLabel('Foto di Ripiano alto').setInputFiles(foto);
  await expect(foglio.getByRole('img', { name: 'Foto della zona' })).toHaveCount(2);
  await foglio.getByRole('button', { name: 'Avanti' }).click();
  await foglio.getByRole('button', { name: 'Confronta con la casa' }).click();

  // Rapida: le uova sono meno, il burro non si vede, le zucchine sono nuove, il barattolo non si sa. Lo yogurt (ripiano 3) non c'entra.
  await expect(foglio.getByRole('button', { name: /Rapida \(4\)/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(foglio.getByRole('region', { name: 'In casa ma non visti' })).toContainText('Burro');
  await expect(foglio.getByRole('region', { name: 'Quantità diverse' })).toContainText('In casa 6 pz · ne vedo 2 pz');
  await expect(foglio.getByRole('region', { name: 'Nuovi' })).toContainText('Zucchine');
  await expect(foglio.getByRole('region', { name: 'Da controllare' })).toContainText('«barattolo scuro»');
  await expect(foglio.getByText('Yogurt')).toHaveCount(0);
  if (info.project.name === 'telefono') await foglio.screenshot({ path: 'test-results/verifica-rapida.png' });

  await foglio.getByRole('group', { name: 'Cosa fare con Uova' }).getByRole('button', { name: 'Sono 2 pz' }).click();
  await foglio.getByRole('group', { name: 'Cosa fare con Burro' }).getByRole('button', { name: 'Finito' }).click();
  await foglio.getByRole('group', { name: 'Cosa fare con Zucchine' }).getByRole('button', { name: /^Aggiungi/ }).click();
  await foglio.getByRole('group', { name: 'Cosa fare con «barattolo scuro»' }).getByRole('button', { name: 'Non c’è' }).click();

  // La verifica completa mostra anche ciò che torna (qui niente in più).
  await foglio.getByRole('button', { name: /Completa/ }).click();
  await expect(foglio.getByRole('button', { name: /Completa \(4\)/ })).toHaveAttribute('aria-pressed', 'true');

  // Fino al riepilogo la casa non cambia.
  const lotti = () =>
    sql<{ ingrediente_id: string; q: number; origine: string }>(
      `select ingrediente_id, quantita::float as q, origine from lotto where ${famiglia} and chiuso_il is null order by ingrediente_id collate "C"`,
      [luca.id],
    );
  expect((await lotti()).map((l) => [l.ingrediente_id, l.q])).toEqual([
    ['ing:burro', 250],
    ['ing:uova', 6],
    ['ing:yogurt', 2],
  ]);

  await foglio.getByRole('button', { name: 'Rivedi e conferma (4)' }).click();
  const modifiche = foglio.getByRole('list', { name: 'Modifiche' });
  await expect(modifiche).toContainText('Uova');
  await expect(modifiche).toContainText('Burro');
  await expect(modifiche.getByRole('listitem')).toHaveCount(3);
  await foglio.getByRole('button', { name: 'Conferma e aggiorna (3)' }).click();
  await expect(foglio.getByRole('status')).toContainText('3 modifiche');
  await salvato();

  await expect.poll(async () => (await lotti()).map((l) => [l.ingrediente_id, l.origine])).toEqual([
    ['ing:uova', 'manuale'],
    ['ing:yogurt', 'manuale'],
    ['ing:zucchina', 'foto'],
  ]);
  expect((await lotti())[0].q).toBe(2);
  const [{ v }] = await sql<{ v: { memoria: { errori: Record<string, unknown>; posizioni: Record<string, { z: string }> }; zone: { nome: string }[] } }>(
    `select impostazioni -> 'verifica' as v from famiglia where id in (select famiglia_id from utente_famiglia where utente_id = $1)`,
    [luca.id],
  );
  expect(Object.keys(v.memoria.errori)).toEqual(['barattolo scuro']);
  expect(v.memoria.posizioni['ing:uova'].z).toBe('r1');
  expect(v.zone[0].nome).toBe('Ripiano alto');

  // Nella cronologia delle uova: com'era, com'è e da dove viene.
  await foglio.getByRole('button', { name: 'Chiudi' }).last().click();
  await page.getByRole('button', { name: /Apri Uova/ }).first().click();
  await expect(page.getByRole('dialog', { name: /Uova/ })).toContainText('Verifica con foto: da 6 pz a 2 pz');
  await expect(page.getByRole('button', { name: /Verifica con le foto/ })).toContainText('verificata oggi');
});
