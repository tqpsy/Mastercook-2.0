/**
 * Accessibilità: axe-core su ogni scheda, telefono e tablet. Controlla le regole WCAG A e AA che si possono
 * verificare in automatico (nomi dei pulsanti, contrasto, etichette dei campi, struttura dei titoli).
 */
import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { apri, creaFamiglia, nuovoUtente } from './aiuti';

const percorsoAxe = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

const SCHEDE = ['Oggi', 'Menu', 'Spesa', 'Casa', 'Ricette', 'Impostazioni'] as const;

test('accessibilità: nessuna violazione WCAG A/AA nelle schede', async ({ browser }, info) => {
  test.setTimeout(240_000);
  const luca = await nuovoUtente('Luca');
  const { page } = await apri(browser, luca, info.project.use);
  await creaFamiglia(page, 'Casa Accessibile');
  await page.addScriptTag({ path: percorsoAxe });

  const trovate: string[] = [];
  for (const scheda of SCHEDE) {
    await page.getByRole('button', { name: scheda, exact: true }).click();
    await page.waitForTimeout(600);
    const esito = await page.evaluate(async (): Promise<string[]> => {
      // @ts-expect-error axe è iniettato nella pagina
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
      return r.violations.map((v: { id: string; help: string; nodes: { target: unknown[] }[] }) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes.slice(0, 3).map((n) => String(n.target)).join(' | ')}`);
    });
    trovate.push(...esito.map((e) => `[${scheda}] ${e}`));
  }
  expect(trovate).toEqual([]);
});
