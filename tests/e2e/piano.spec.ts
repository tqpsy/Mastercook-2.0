/**
 * Il piano del nutrizionista: si carica da un file in Impostazioni › Antonino, vale per tutta la famiglia,
 * porta le regole di pranzo e cena e le ricette del piano (senza doppioni ricaricandolo).
 */
import { expect, test } from '@playwright/test';
import { apri, creaFamiglia, nuovoUtente, sql } from './aiuti';

const piano = {
  formato: 'mastercook-piano',
  versione: 1,
  nome: 'Piano di prova',
  regole: {
    obiettivi: { pesce: { min: 3, max: 3 }, legumi: { min: 2, max: 2 } },
    piano: { cena_senza_carboidrati: true, legumi_senza_cereali: true, preferiti: ['ing:farro'] },
  },
  ricette: [
    {
      titolo: 'Pancake d’avena di prova',
      categoria: 'colazione',
      porzioni: 1,
      minuti_totali: 10,
      ingredienti: [
        { ingrediente_id: 'ing:uova', quantita: 1, unita: 'pz' },
        { ingrediente_id: 'ing:fiocchi_avena', quantita: 30, unita: 'g', testo: 'Farina d’avena' },
      ],
      passi: ['Sbatti l’uovo con la farina d’avena e cuoci in padella.'],
    },
  ],
};

test('piano del nutrizionista: si carica dal file, cambia le regole per tutti e aggiunge le ricette una volta sola', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Piano');
  await page.getByRole('button', { name: 'Impostazioni' }).click();
  const sezione = page.getByRole('region', { name: 'Piano del nutrizionista' });
  await expect(sezione.getByRole('button', { name: '📄 Carica il piano' })).toBeVisible();

  page.on('dialog', (d) => void d.accept());
  const file = { name: 'piano.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(piano)) };
  await sezione.getByLabel('File del piano').setInputFiles(file);
  await expect(sezione.getByRole('status')).toHaveText(/Piano caricato\. 1 ricetta aggiunta\./);
  await expect(sezione.getByText(/Piano di prova · caricato il/)).toBeVisible();
  await expect(sezione.getByRole('checkbox', { name: /A cena niente pasta/ })).toBeChecked();
  await expect(sezione.getByRole('checkbox', { name: /Verdure a pranzo e a cena/ })).not.toBeChecked();
  await expect(sezione.getByText('Da preferire: farro')).toBeVisible();
  if (info.project.name === 'telefono') await sezione.screenshot({ path: 'test-results/piano-nutrizionista.png' });

  const regole = () =>
    sql<{ r: Record<string, unknown> | null }>(
      `select impostazioni -> 'antonino' -> 'regole' as r from famiglia where id in (select famiglia_id from utente_famiglia where utente_id = $1)`,
      [luca.id],
    );
  await expect.poll(async () => (await regole())[0].r?.piano).toMatchObject({ cena_senza_carboidrati: true, legumi_senza_cereali: true, preferiti: ['ing:farro'] });
  expect((await regole())[0].r?.obiettivi).toMatchObject({ pesce: { min: 3, max: 3 }, legumi: { min: 2, max: 2 } });
  const ricette = () =>
    sql<{ n: number }>(
      `select count(*)::int as n from ricetta where titolo = 'Pancake d’avena di prova' and eliminato_il is null
          and famiglia_id in (select famiglia_id from utente_famiglia where utente_id = $1)`,
      [luca.id],
    );
  await expect.poll(async () => (await ricette())[0].n).toBe(1);

  // Ricaricando lo stesso piano la ricetta non si ripete, anche se il telefono lo dà come testo senza estensione.
  await sezione.getByLabel('File del piano').setInputFiles({ name: 'piano (1)', mimeType: 'text/plain', buffer: Buffer.from('\uFEFF' + JSON.stringify(piano)) });
  await expect(sezione.getByRole('status')).toHaveText(/1 ricetta c’era già/);
  await expect.poll(async () => (await ricette())[0].n).toBe(1);

  // Una regola si spegne a mano; togliendo il piano restano le frequenze.
  // La casella cambia quando il comando entra nella vista locale.
  await sezione.getByRole('checkbox', { name: /A cena niente pasta/ }).click();
  await expect(sezione.getByRole('checkbox', { name: /A cena niente pasta/ })).not.toBeChecked();
  await expect.poll(async () => (await regole())[0].r?.piano).not.toHaveProperty('cena_senza_carboidrati');
  await sezione.getByRole('button', { name: 'Togli il piano' }).click();
  await expect.poll(async () => (await regole())[0].r?.piano).toBeUndefined();
  expect((await regole())[0].r?.obiettivi).toMatchObject({ pesce: { min: 3, max: 3 } });
  await expect(sezione.getByRole('button', { name: '📄 Carica il piano' })).toBeVisible();
});

test('piano del nutrizionista da un PDF: lo legge Gemini con la chiave della famiglia, si conferma e si salva', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Piano PDF');
  await page.getByRole('button', { name: 'Impostazioni' }).click();
  const sezione = page.getByRole('region', { name: 'Piano del nutrizionista' });
  const pdf = { name: 'piano nutrizionale.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 prova') };
  const domande: string[] = [];
  page.on('dialog', (d) => {
    domande.push(d.message());
    void d.accept();
  });

  // Senza chiave Gemini l'app dice dove metterla.
  await sezione.getByLabel('File del piano').setInputFiles(pdf);
  await expect(sezione.getByRole('status')).toContainText('serve la chiave Gemini della famiglia');

  await page.getByLabel('Chiave Gemini della famiglia').fill('AIzaProva_chiave-della-famiglia-1234');
  await page.getByRole('button', { name: 'Salva la chiave' }).click();
  await expect(page.getByLabel('Chiave Gemini', { exact: true })).toContainText('finisce con …1234');

  await sezione.getByLabel('File del piano').setInputFiles(pdf);
  await expect(sezione.getByRole('status')).toHaveText(/Piano caricato\. 1 ricetta aggiunta\./);
  expect(domande.at(-1)).toContain('A settimana: pesce 3–4,');
  expect(domande.at(-1)).toContain('Da preferire: farro.');
  expect(domande.at(-1)).toContain('Non riconosco: cosa sconosciuta.');
  await expect(sezione.getByText(/Piano dal PDF · caricato il/)).toBeVisible();
  await expect(sezione.getByRole('checkbox', { name: /A cena niente pasta/ })).toBeChecked();
  const regole = await sql<{ r: Record<string, unknown> }>(
    `select impostazioni -> 'antonino' -> 'regole' as r from famiglia where id in (select famiglia_id from utente_famiglia where utente_id = $1)`,
    [luca.id],
  );
  expect(regole[0].r.piano).toMatchObject({ cena_senza_carboidrati: true, verdure_a_ogni_pasto: true, preferiti: ['ing:farro'] });
});
