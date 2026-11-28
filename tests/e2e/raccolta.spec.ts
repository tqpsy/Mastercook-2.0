/**
 * Raccolta differenziata: i giorni scelti in Impostazioni si vedono come promemoria in Oggi
 * (il giorno stesso, oppure la sera prima per il giorno dopo); si possono anche leggere da un
 * calendario del comune (PDF o foto) con Gemini, da confermare prima di salvarli.
 */
import { expect, test } from '@playwright/test';
import { apri, apriSezione, creaFamiglia, nuovoUtente } from './aiuti';

const NOMI_GIORNO = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

test('scelgo i giorni della raccolta e Oggi mi ricorda cosa portare fuori', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Raccolta');
  const adesso = new Date();
  const oggiNome = NOMI_GIORNO[adesso.getDay()];
  const domaniNome = NOMI_GIORNO[(adesso.getDay() + 1) % 7];

  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await apriSezione(page, 'Raccolta differenziata');
  const sezione = page.getByRole('region', { name: 'Raccolta differenziata' });
  const organico = sezione.getByRole('group', { name: 'Giorni di raccolta: Organico' });
  await organico.getByRole('button', { name: oggiNome, exact: true }).click();
  await expect(organico.getByRole('button', { name: oggiNome, exact: true })).toHaveAttribute('aria-pressed', 'true');
  const vetro = sezione.getByRole('group', { name: 'Giorni di raccolta: Vetro' });
  await vetro.getByRole('button', { name: domaniNome, exact: true }).click();

  await page.getByRole('button', { name: 'Oggi', exact: true }).click();
  await expect(page.getByText('organico oggi')).toBeVisible();
  await expect(page.getByText('vetro stasera, per domani')).toBeVisible();

  // Spengo l'organico: resta solo il vetro di domani.
  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await apriSezione(page, 'Raccolta differenziata');
  await organico.getByRole('button', { name: oggiNome, exact: true }).click();
  await page.getByRole('button', { name: 'Oggi', exact: true }).click();
  await expect(page.getByText('organico oggi')).not.toBeVisible();
  await expect(page.getByText('vetro stasera, per domani')).toBeVisible();
});

test('calendario della raccolta da un PDF: lo legge Gemini, si conferma e compila la griglia in un colpo', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Raccolta PDF');
  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await apriSezione(page, 'Raccolta differenziata');
  const sezione = page.getByRole('region', { name: 'Raccolta differenziata' });
  const pdf = { name: 'calendario raccolta.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 prova') };
  const domande: string[] = [];
  page.on('dialog', (d) => {
    domande.push(d.message());
    void d.accept();
  });

  // Senza chiave Gemini l'app dice dove metterla.
  await sezione.getByLabel('File della raccolta').setInputFiles(pdf);
  await expect(sezione.getByRole('status')).toContainText('serve la chiave Gemini della famiglia');

  await apriSezione(page, 'Foto del frigo');
  await page.getByLabel('Chiave Gemini della famiglia').fill('AIzaProva_chiave-della-famiglia-1234');
  await page.getByRole('button', { name: 'Salva la chiave' }).click();
  await expect(page.getByLabel('Chiave Gemini', { exact: true })).toContainText('finisce con …1234');

  await sezione.getByLabel('File della raccolta').setInputFiles(pdf);
  await expect(sezione.getByRole('status')).toHaveText('Calendario aggiornato.');
  expect(domande.at(-1)).toContain('organico di lunedì e giovedì');
  expect(domande.at(-1)).toContain('plastica e metalli di mercoledì e sabato');
  expect(domande.at(-1)).toContain('Non ho trovato giorni fissi per carta e cartone, vetro, indifferenziato');

  // La griglia si è compilata da sola, senza toccare ogni giorno a mano.
  await expect(sezione.getByRole('group', { name: 'Giorni di raccolta: Organico' }).getByRole('button', { name: 'lunedì', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(sezione.getByRole('group', { name: 'Giorni di raccolta: Organico' }).getByRole('button', { name: 'giovedì', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(sezione.getByRole('group', { name: 'Giorni di raccolta: Plastica e metalli' }).getByRole('button', { name: 'sabato', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
