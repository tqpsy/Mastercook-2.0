/**
 * Scontrini e codici a barre sul flusso reale, telefono e tablet. Il testo dello scontrino si incolla
 * (la foto passa dallo stesso controllo); il codice si scrive a mano, come quando la fotocamera manca.
 */
import { expect, type Page, test } from '@playwright/test';
import { apri, creaFamiglia, nuovoUtente, sql } from './aiuti';

const famigliaDi = '(select famiglia_id from utente_famiglia where utente_id = $1)';
const salvato = (page: Page) => expect(page.getByRole('button', { name: 'Impostazioni' })).toHaveAccessibleDescription('Stato del salvataggio: Tutto salvato');

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

  // Quanto ho speso: vale il totale dello scontrino (lo shopper lasciato fuori va a parte), una volta sola.
  const speso = page.getByRole('region', { name: 'Quanto ho speso' });
  await expect(speso).toContainText('3,09 €');
  await speso.getByRole('button').click();
  const dettaglio = page.getByRole('dialog', { name: 'Quanto ho speso' });
  await expect(dettaglio.getByRole('list', { name: 'Per tipo di cibo' })).toContainText('Frutta e verdura');
  await expect(dettaglio.getByRole('list', { name: 'Per tipo di cibo' })).toContainText('1,70 €');
  await expect(dettaglio.getByRole('list', { name: 'Per tipo di cibo' })).toContainText('0,10 €');
  await expect(dettaglio).toContainText('1 spesa');
  if (process.env.MC_SCHERMATE) await page.screenshot({ path: `${process.env.MC_SCHERMATE}/${info.project.name}-dettaglio.png` });
  await dettaglio.getByRole('button', { name: 'Chiudi' }).click();
  if (process.env.MC_SCHERMATE) {
    await speso.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.MC_SCHERMATE}/${info.project.name}-riquadro.png` });
  }

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

test('spesa con le spunte e poi lo scontrino: due confezioni uguali, niente doppioni in casa', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Spunte');
  await page.getByRole('button', { name: 'Spesa', exact: true }).click();

  // Al supermercato: petto di pollo spuntato e confermato, senza prezzo.
  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  await page.getByLabel('Cosa serve?').fill('petto di pollo');
  await page.getByRole('dialog').getByRole('button', { name: 'Petto di pollo', exact: true }).click();
  await page.getByLabel('Quantità (facoltativa)').fill('500');
  await page.getByRole('dialog').getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Metti Petto di pollo nel carrello' }).click();
  await page.getByRole('button', { name: 'Conferma la spesa' }).click();
  await page.getByRole('dialog', { name: 'Conferma la spesa' }).getByRole('button', { name: 'Conferma', exact: true }).click();
  await salvato(page);

  // A casa lo scontrino: due confezioni passate una alla volta.
  await page.getByRole('button', { name: 'Aggiungi uno scontrino' }).click();
  await page.getByLabel('Oppure incolla il testo dello scontrino').fill('IPER\nPETTO POLLO FETTE   3,10\nPETTO POLLO FETTE   3,20\nTOTALE   6,30');
  await page.getByRole('button', { name: 'Leggi le righe' }).click();
  const foglio = page.getByRole('dialog', { name: 'Controlla lo scontrino' });
  await expect(foglio.getByLabel('Cosa fare di PETTO POLLO FETTE').first()).toHaveValue(/^abbina:/);
  await expect(foglio.getByLabel('Cosa fare di PETTO POLLO FETTE').last()).toHaveValue(/^abbina:/);
  await expect(foglio.getByText(/Hai già messo in casa con le spunte/)).toHaveCount(0);
  await foglio.getByRole('button', { name: 'Importa lo scontrino' }).click();
  await expect(foglio).toHaveCount(0);
  await salvato(page);

  const righe = await sql<{ cosa: string; prezzo: string }>(
    `select r.ingrediente_id as cosa, r.prezzo::text as prezzo from acquisto_riga r where r.famiglia_id = ${famigliaDi}`,
    [luca.id],
  );
  expect(righe).toEqual([{ cosa: 'ing:petto_pollo', prezzo: '6.30' }]);
  expect((await sql<{ n: number }>(`select count(*)::int as n from lotto where famiglia_id = ${famigliaDi}`, [luca.id]))[0].n).toBe(1);
});

test('scontrino scritto a mano: ciò che entra in casa esce subito dalla lista, il macinato di pollo resta pollo', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Macinato');
  // Polpette al sugo oggi, per 4: servono 500 g di carne macinata.
  await sql(
    `insert into portata (id, famiglia_id, data, categoria, ricetta_id, porzioni) select gen_random_uuid(), famiglia_id, current_date, 'cena', 'sys:polpette_sugo', 4
       from utente_famiglia where utente_id = $1`,
    [luca.id],
  );
  await page.reload();
  await page.getByRole('button', { name: 'Spesa', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Apri Carne macinata/ })).toBeVisible();
  await salvato(page);

  await page.getByRole('button', { name: 'Aggiungi uno scontrino' }).click();
  await page.getByLabel('Oppure incolla il testo dello scontrino').fill('MACINATO TACCHINO E POLLO 400G 4,50\nMACINATO 500G 5,20\nTOTALE 9,70');
  await page.getByRole('button', { name: 'Leggi le righe' }).click();
  const foglio = page.getByRole('dialog', { name: 'Controlla lo scontrino' });
  await expect(foglio.getByRole('button', { name: 'Cambia l’ingrediente di MACINATO TACCHINO E POLLO 400G' })).toContainText('Macinato di pollo o tacchino');
  await expect(foglio.getByRole('button', { name: 'Cambia l’ingrediente di MACINATO 500G' })).toContainText('Carne macinata');
  await foglio.getByRole('button', { name: 'Importa lo scontrino' }).click();

  // Senza chiudere e riaprire la lista: il macinato comprato copre le polpette.
  await expect(page.getByRole('button', { name: /^Apri Carne macinata/ })).toHaveCount(0);
  await salvato(page);
  const lotti = await sql<{ ing: string; q: string }>(
    `select ingrediente_id as ing, quantita::text as q from lotto where famiglia_id = ${famigliaDi} order by ingrediente_id collate "C"`,
    [luca.id],
  );
  expect(lotti).toEqual([
    { ing: 'ing:carne_macinata', q: '500' },
    { ing: 'ing:macinato_pollo', q: '400' },
  ]);
});

test('scontrino senza quantità: si salta, entra lo stesso e la quantità si scrive dopo in Casa', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Senza Quantità');
  await page.getByRole('button', { name: 'Spesa', exact: true }).click();
  await page.getByRole('button', { name: 'Aggiungi uno scontrino' }).click();
  await page.getByLabel('Oppure incolla il testo dello scontrino').fill('SUPERMERCATO ROSSI\nZUCCHINE 1,80\nLATTE INTERO 1L 1,29\nTOTALE 3,09');
  await page.getByRole('button', { name: 'Leggi le righe' }).click();
  const foglio = page.getByRole('dialog', { name: 'Controlla lo scontrino' });
  await expect(foglio.getByLabel('Quantità di ZUCCHINE')).toHaveValue('');
  await foglio.getByRole('button', { name: 'Importa lo scontrino' }).click();
  await expect(foglio.getByRole('alert')).toContainText('Manca la quantità di zucchine');
  await foglio.getByRole('button', { name: 'Salta, la metto dopo' }).click();
  await expect(page.getByRole('region', { name: 'Acquisti recenti' })).toContainText('Zucchine');
  await salvato(page);
  expect(await sql(`select ingrediente_id from lotto where famiglia_id = ${famigliaDi}`, [luca.id])).toEqual([{ ingrediente_id: 'ing:latte' }]);

  await page.getByRole('button', { name: 'Casa', exact: true }).click();
  const daCompletare = page.getByRole('region', { name: 'Da completare' });
  await daCompletare.getByRole('button', { name: 'Scrivi la quantità di Zucchine' }).click();
  const quanto = page.getByRole('dialog', { name: 'Quanto zucchine?' });
  // Le zucchine si contano: si propongono a pezzi (200 g l'una) e non serve pesarle.
  await expect(quanto.getByLabel('Unità')).toHaveValue('pz');
  await quanto.getByLabel('Quantità').fill('3');
  await expect(quanto).toContainText('In tutto circa 600 g');
  await quanto.getByRole('button', { name: 'Metti in casa' }).click();
  await expect(daCompletare).toHaveCount(0);
  await salvato(page);
  const lotti = await sql<{ ing: string; q: string; origine: string }>(
    `select ingrediente_id as ing, quantita::text as q, origine from lotto where famiglia_id = ${famigliaDi} order by ingrediente_id collate "C"`,
    [luca.id],
  );
  expect(lotti).toEqual([
    { ing: 'ing:latte', q: '1000', origine: 'scontrino' },
    { ing: 'ing:zucchina', q: '600', origine: 'scontrino' },
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('codice a barre: la prima volta si sceglie (con Open Food Facts), poi si riconosce in casa e al supermercato', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  let richieste = 0;
  await page.route('https://world.openfoodfacts.org/**', (r) => {
    richieste++;
    // Risposta dell'API v3: oltre a nome e formato, valori nutrizionali, ingredienti e indicatori ufficiali.
    expect(r.request().url()).toContain('/api/v3/product/8001234567890');
    return r.fulfill({
      json: {
        code: '8001234567890',
        status: 'success',
        product: {
          product_name_it: 'Latte intero',
          brands: 'Stalla',
          product_quantity: 1000,
          product_quantity_unit: 'ml',
          nutriments: { 'energy-kcal_100g': 64, fat_100g: 3.6, 'saturated-fat_100g': 2.4, sugars_100g: 4.9, proteins_100g: 3.3, salt_100g: 0.1, calcium_100g: 0.12 },
          ingredients_text_it: '_Latte_ intero',
          allergens_tags: ['en:milk'],
          nova_group: 1,
          nutriscore_grade: 'b',
        },
      },
    });
  });
  await creaFamiglia(page, 'Casa Codici');
  await page.getByRole('button', { name: 'Casa', exact: true }).click();
  await page.getByRole('button', { name: '+ Aggiungi' }).click();
  await page.getByRole('button', { name: 'Scansiona il codice a barre' }).click();
  await page.getByLabel('Oppure scrivi le cifre sotto il codice').fill('8001234567890');
  await page.getByRole('button', { name: 'Usa questo codice' }).click();
  await expect(page.getByRole('dialog', { name: 'Codice nuovo' })).toContainText('Latte intero Stalla');
  await page.getByRole('button', { name: 'Valori e ingredienti' }).click();
  const scheda = page.getByRole('dialog', { name: 'Latte intero Stalla' });
  await expect(scheda.getByRole('row', { name: /di cui saturi/ })).toContainText('2,4 g');
  await expect(scheda.getByRole('row', { name: /Calcio/ })).toContainText('120 mg');
  await expect(scheda).toContainText('Latte intero');
  await expect(scheda).toContainText('Nutri-Score');
  await expect(scheda).toContainText('NOVA · alimento non lavorato');
  if (info.project.name === 'telefono') await scheda.screenshot({ path: 'test-results/scheda-prodotto-telefono.png' });
  await scheda.getByRole('button', { name: 'Chiudi' }).click();
  await page.getByRole('button', { name: 'È Latte' }).click();
  await expect(page.getByLabel('Quantità', { exact: true })).toHaveValue('1000');
  await page.getByRole('button', { name: 'Valori e ingredienti' }).click();
  await expect(page.getByRole('dialog', { name: 'Latte intero Stalla' })).toContainText('Proteine');
  await page.getByRole('dialog', { name: 'Latte intero Stalla' }).getByRole('button', { name: 'Chiudi' }).click();
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
  // Valori e ingredienti si guardano anche al supermercato, senza una nuova richiesta.
  await page.getByRole('status').getByRole('button', { name: 'Valori e ingredienti' }).click();
  await expect(page.getByRole('dialog', { name: 'Latte intero Stalla' })).toContainText('64 kcal');
  if (info.project.name === 'tablet') await page.screenshot({ path: 'test-results/scheda-prodotto-tablet.png' });
  await page.getByRole('dialog', { name: 'Latte intero Stalla' }).getByRole('button', { name: 'Chiudi' }).click();
  await salvato(page);
  expect(richieste).toBe(chieste);
});

test('dopo la conferma: si cambia l’alimento di una riga guardando il testo letto, si annulla e si riattiva l’acquisto', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Correzioni');
  await page.getByRole('button', { name: 'Spesa', exact: true }).click();
  await page.getByRole('button', { name: 'Aggiungi uno scontrino' }).click();
  await page.getByLabel('Oppure incolla il testo dello scontrino').fill('SUPERMERCATO ROSSI\nDESCRIZIONE   Prezzo\nLATTE INTERO 1L   1,29\nTOTALE   1,29\n05-11-2026 18:30');
  await page.getByRole('button', { name: 'Leggi le righe' }).click();
  await page.getByRole('dialog', { name: 'Controlla lo scontrino' }).getByRole('button', { name: 'Importa lo scontrino' }).click();
  await expect(page.getByRole('region', { name: 'Acquisti recenti' })).toContainText('Latte');
  await salvato(page);
  const lotti = () => sql<{ ing: string; q: string }>(`select ingrediente_id as ing, quantita::text as q from lotto where famiglia_id = ${famigliaDi}`, [luca.id]);
  expect(await lotti()).toEqual([{ ing: 'ing:latte', q: '1000' }]);

  // «Se sfugge all'inizio si può sempre correggere»: la riga mostra cosa c'era scritto sullo scontrino.
  await page.getByRole('button', { name: /Apri l’acquisto di/ }).click();
  const foglio = page.getByRole('dialog', { name: /Spesa di/ });
  await expect(foglio).toContainText('Letto sullo scontrino: «LATTE INTERO 1L»');
  await foglio.getByRole('button', { name: 'Cambia l’alimento di Latte' }).click();
  // Un alimento che si conta a pezzi non va (il lotto è in ml): lo dice, senza cambiare niente.
  await foglio.getByLabel('Cos’è «LATTE INTERO 1L»?').fill('uova');
  await foglio.getByRole('button', { name: /^.*Uova/ }).first().click();
  await expect(foglio.getByRole('alert')).toContainText('non va bene');
  await foglio.getByLabel('Cos’è «LATTE INTERO 1L»?').fill('panna da cucina');
  await foglio.getByRole('button', { name: /Panna da cucina/ }).click();
  await expect(foglio.getByText('Panna da cucina').first()).toBeVisible();
  await expect(foglio.getByRole('button', { name: 'Cambia l’alimento di Panna da cucina' })).toBeVisible();
  await salvato(page);
  expect(await lotti()).toEqual([{ ing: 'ing:panna', q: '1000' }]);

  // Annullato per errore: si riattiva e le quantità tornano.
  page.once('dialog', (d) => d.accept());
  await foglio.getByRole('button', { name: 'Annulla l’acquisto' }).click();
  await expect(page.getByRole('region', { name: 'Acquisti recenti' })).toContainText('annullato');
  await salvato(page);
  expect(await lotti()).toEqual([{ ing: 'ing:panna', q: '0' }]);
  await page.getByRole('button', { name: /Apri l’acquisto di/ }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('dialog', { name: /Spesa di/ }).getByRole('button', { name: 'Riattiva l’acquisto' }).click();
  await expect(page.getByRole('region', { name: 'Acquisti recenti' })).not.toContainText('annullato');
  await salvato(page);
  expect(await lotti()).toEqual([{ ing: 'ing:panna', q: '1000' }]);
  await expect(page.getByRole('region', { name: 'Acquisti recenti' })).not.toContainText('annullato');
});

test('una riga segnata «non è un alimento» per errore si riporta tra gli alimenti e finisce in «Da completare»', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Spatzle');
  await page.getByRole('button', { name: 'Spesa', exact: true }).click();
  await page.getByRole('button', { name: 'Aggiungi uno scontrino' }).click();
  await page.getByLabel('Oppure incolla il testo dello scontrino').fill('SUPERMERCATO ROSSI\nDESCRIZIONE   Prezzo\nIPERAL SPATZLE   1,99\nTOTALE   1,99\n05-11-2026 18:30');
  await page.getByRole('button', { name: 'Leggi le righe' }).click();
  await page.getByRole('dialog', { name: 'Controlla lo scontrino' }).getByRole('button', { name: 'Importa lo scontrino' }).click();
  await expect(page.getByRole('region', { name: 'Acquisti recenti' })).toContainText('IPERAL SPATZLE');
  await salvato(page);

  await page.getByRole('button', { name: /Apri l’acquisto di/ }).click();
  const foglio = page.getByRole('dialog', { name: /Spesa di/ });
  await expect(foglio).toContainText('Non è un alimento: non va in casa.');
  await foglio.getByRole('button', { name: 'IPERAL SPATZLE è un alimento' }).click();
  await foglio.getByLabel('Cos’è «IPERAL SPATZLE»?').fill('pasta');
  await foglio.getByRole('button', { name: /Pasta$/ }).first().click();
  await expect(foglio).not.toContainText('Non è un alimento');
  await expect(foglio).toContainText('Quantità da scrivere in Casa');
  await salvato(page);
  const righe = await sql<{ ing: string | null; q: string | null; lotto: string | null }>(
    `select ingrediente_id as ing, quantita::text as q, lotto_id::text as lotto from acquisto_riga where famiglia_id = ${famigliaDi}`,
    [luca.id],
  );
  expect(righe).toHaveLength(1);
  expect(righe[0].ing).toMatch(/^ing:pasta/);
  expect(righe[0].q).toBeNull();
  expect(righe[0].lotto).toBeNull();

  // In casa non c'è ancora niente: la quantità si scrive in Casa › Da completare.
  await foglio.getByRole('button', { name: 'Chiudi' }).click();
  await page.getByRole('button', { name: 'Casa', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Da completare' })).toContainText('Pasta');
});

test('scontrino con un prezzo ricavato dal totale: la riga è segnalata e non si importa finché non è controllata', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Da Controllare');
  await page.getByRole('button', { name: 'Spesa', exact: true }).click();
  await page.getByRole('button', { name: 'Aggiungi uno scontrino' }).click();
  // Il prezzo del latte non si legge: l'app lo ricava dal totale (2,89 - 1,50), ma non è letto e va guardato.
  await page.getByLabel('Oppure incolla il testo dello scontrino').fill('SUPERMERCATO ROSSI\nDESCRIZIONE   PREZZO IVA\nPANE   1,50 A\nLATTE INTERO 1L   ip: |\nTOTALE 2,89\nCARTA   2,89');
  await page.getByRole('button', { name: 'Leggi le righe' }).click();
  const foglio = page.getByRole('dialog', { name: 'Controlla lo scontrino' });
  await expect(foglio.getByRole('status')).toContainText('Una riga è segnalata');
  await expect(foglio.getByText('Da controllare: il prezzo è ricavato dal totale, non letto.')).toBeVisible();
  const importa = foglio.getByRole('button', { name: 'Importa lo scontrino' });
  await expect(importa).toBeDisabled();
  await expect(foglio).toContainText('Prima di importare controlla la riga segnalata.');

  // Guardata la riga, si segna «controllata»: ora si può importare.
  await foglio.getByRole('checkbox', { name: 'Ho controllato LATTE INTERO' }).check();
  await expect(foglio.getByText('Controllata', { exact: true })).toBeVisible();
  await expect(importa).toBeEnabled();
  await expect(foglio.getByRole('status')).toHaveCount(0);
});

test('lo stesso scontrino letto un po’ diverso (ora e negozio) non entra in casa due volte senza una conferma', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Doppione');
  await page.getByRole('button', { name: 'Spesa', exact: true }).click();
  const prima = scontrino(new Date().toLocaleDateString('sv-SE'));
  await page.getByRole('button', { name: 'Aggiungi uno scontrino' }).click();
  await page.getByLabel('Oppure incolla il testo dello scontrino').fill(prima);
  await page.getByRole('button', { name: 'Leggi le righe' }).click();
  await page.getByRole('dialog', { name: 'Controlla lo scontrino' }).getByRole('button', { name: 'Importa lo scontrino' }).click();
  await salvato(page);

  // Un’altra foto dello stesso scontrino: l’ora è letta 18:03 e il negozio storpiato.
  await page.getByRole('button', { name: 'Aggiungi uno scontrino' }).click();
  await page.getByLabel('Oppure incolla il testo dello scontrino').fill(prima.replace('18:30', '18:03').replace('SUPERMERCATO ROSSI', 'SUPERMERCATO R0SSI'));
  await page.getByRole('button', { name: 'Leggi le righe' }).click();
  const foglio = page.getByRole('dialog', { name: 'Controlla lo scontrino' });
  await expect(foglio.getByText(/Sembra lo stesso scontrino già importato/)).toBeVisible();
  const importa = foglio.getByRole('button', { name: 'Importa lo scontrino' });
  await expect(importa).toBeDisabled();
  await expect(foglio).toContainText('Prima di importare controlla se è già stato importato.');
  await foglio.getByRole('button', { name: 'È un altro scontrino' }).click();
  await expect(importa).toBeEnabled();
});

test('scontrino digitale come PDF: il testo si legge dal file e si importa come uno incollato', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Pdf');
  await page.getByRole('button', { name: 'Spesa', exact: true }).click();

  // Il PDF come lo salva Chrome («Stampa › Salva come PDF» dalla pagina dello scontrino digitale).
  const stampa = await page.context().newPage();
  await stampa.setContent(`<pre style="font: 12px monospace; margin: 20px">${scontrino(new Date().toLocaleDateString('sv-SE'))}</pre>`);
  const buffer = await stampa.pdf();
  await stampa.close();

  await page.getByRole('button', { name: 'Aggiungi uno scontrino' }).click();
  await page.getByRole('dialog', { name: 'Aggiungi uno scontrino' }).locator('input[type=file][accept="application/pdf"]').setInputFiles({ name: 'Scontrino_Digitale.pdf', mimeType: 'application/pdf', buffer });
  const foglio = page.getByRole('dialog', { name: 'Controlla lo scontrino' });
  await expect(foglio.getByLabel('Negozio')).toHaveValue('Supermercato Rossi');
  await expect(foglio.getByLabel('Totale €')).toHaveValue('3,09');
  await expect(foglio.getByLabel('Cosa fare di BANANE')).toHaveValue('casa');
  // Un PDF non è una foto: niente righe «da controllare» né data da confermare.
  await expect(foglio.getByRole('status')).toHaveCount(0);
  await foglio.getByLabel('Cosa fare di SHOPPER').selectOption('ignora');
  await foglio.getByRole('button', { name: 'Importa lo scontrino' }).click();
  await expect(page.getByRole('region', { name: 'Acquisti recenti' })).toContainText('Banane');
  await salvato(page);
});

test('il PDF si legge anche su un telefono senza le funzioni più nuove del browser (Promise.try, Map.getOrInsertComputed, Math.sumPrecise)', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  // Come su un telefono non aggiornatissimo: le funzioni non ci sono, né nella pagina né nel worker che legge il PDF.
  const togli = 'delete Promise.try; delete Map.prototype.getOrInsertComputed; delete Map.prototype.getOrInsert; delete WeakMap.prototype.getOrInsertComputed; delete Math.sumPrecise;';
  const { page } = await apri(browser, luca, info.project.use, '', async (contesto) => {
    await contesto.addInitScript(togli);
    await contesto.route(/pdf\.worker/, async (rotta) => {
      const risposta = await rotta.fetch();
      await rotta.fulfill({ response: risposta, body: `${togli}\n${await risposta.text()}` });
    });
  });
  expect(await page.evaluate(() => 'try' in Promise || 'sumPrecise' in Math)).toBe(false);
  await creaFamiglia(page, 'Casa Pdf Vecchio');
  await page.getByRole('button', { name: 'Spesa', exact: true }).click();
  const stampa = await page.context().newPage();
  await stampa.setContent(`<pre style="font: 12px monospace; margin: 20px">${scontrino(new Date().toLocaleDateString('sv-SE'))}</pre>`);
  const buffer = await stampa.pdf();
  await stampa.close();
  await page.getByRole('button', { name: 'Aggiungi uno scontrino' }).click();
  await page.getByRole('dialog', { name: 'Aggiungi uno scontrino' }).locator('input[type=file][accept="application/pdf"]').setInputFiles({ name: 'Scontrino_Digitale.pdf', mimeType: 'application/pdf', buffer });
  const foglio = page.getByRole('dialog', { name: 'Controlla lo scontrino' });
  await expect(foglio.getByLabel('Totale €')).toHaveValue('3,09');
});

test('un PDF senza testo (una scansione) o un file che non è un PDF dà un messaggio chiaro', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Pdf Vuoto');
  await page.getByRole('button', { name: 'Spesa', exact: true }).click();
  await page.getByRole('button', { name: 'Aggiungi uno scontrino' }).click();
  const ingresso = page.getByRole('dialog', { name: 'Aggiungi uno scontrino' }).locator('input[type=file][accept="application/pdf"]');
  const vuoto = await page.context().newPage();
  await vuoto.setContent('<div style="height:10px"></div>');
  await ingresso.setInputFiles({ name: 'Scansione.pdf', mimeType: 'application/pdf', buffer: await vuoto.pdf() });
  await expect(page.getByRole('alert')).toContainText('non contiene testo');
  await ingresso.setInputFiles({ name: 'Non-un-pdf.pdf', mimeType: 'application/pdf', buffer: Buffer.from('questo non è un pdf') });
  await expect(page.getByRole('alert')).toContainText('Non sono riuscito a leggere il PDF');
  // Il telefono (Android) a volte dà il file scelto vuoto: messaggio chiaro, non un errore della libreria.
  await ingresso.setInputFiles({ name: 'Vuoto.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) });
  await expect(page.getByRole('alert')).toContainText('Il telefono mi ha dato un file vuoto');
});

test('PDF scelto sul telefono: i byte si leggono finché il campo è nella pagina (su Android dopo il file risulta vuoto)', async ({ browser }, info) => {
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Pdf Android');
  await page.getByRole('button', { name: 'Spesa', exact: true }).click();
  const stampa = await page.context().newPage();
  await stampa.setContent(`<pre style="font: 12px monospace; margin: 20px">${scontrino(new Date().toLocaleDateString('sv-SE'))}</pre>`);
  const buffer = await stampa.pdf();
  await stampa.close();
  await page.getByRole('button', { name: 'Aggiungi uno scontrino' }).click();
  // Su Android il file scelto con il selettore non è più leggibile quando il campo non è più nella pagina o è stato pulito: chi lo legge dopo
  // vede zero byte («InvalidPDFException: The PDF file is empty»). Mentre si legge, la schermata toglie i pulsanti (e il campo): si simula.
  await page.evaluate(() => {
    const originale = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function (this: File) {
      const campo = document.querySelector<HTMLInputElement>('input[type=file][accept="application/pdf"]');
      return !campo || campo.files?.length === 0 ? Promise.resolve(new ArrayBuffer(0)) : originale.call(this);
    };
  });
  await page.getByRole('dialog', { name: 'Aggiungi uno scontrino' }).locator('input[type=file][accept="application/pdf"]').setInputFiles({ name: 'Scontrino_Digitale.pdf', mimeType: 'application/pdf', buffer });
  const foglio = page.getByRole('dialog', { name: 'Controlla lo scontrino' });
  await expect(foglio.getByLabel('Negozio')).toHaveValue('Supermercato Rossi');
  await expect(foglio.getByLabel('Totale €')).toHaveValue('3,09');
});
