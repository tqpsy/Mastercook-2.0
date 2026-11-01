import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Una parentesi graffa dimenticata in stile.css spegne in silenzio tutte le regole che vengono dopo (è successo
 * due volte, unendo rami diversi): qui si controlla che ogni blocco si chiuda prima del successivo.
 */
describe('stile.css', () => {
  it('ogni blocco aperto si chiude, e nessuna regola finisce dentro un’altra per sbaglio', () => {
    const css = readFileSync(join(import.meta.dirname, 'stile.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
    let profondita = 0;
    const errori: string[] = [];
    css.split('\n').forEach((riga, i) => {
      // Una regola che inizia a capo riga (non indentata) deve stare fuori da tutto: solo @media & co. la contengono.
      if (/^[.#a-z:[*]/i.test(riga) && profondita > 0) errori.push(`riga ${i + 1}: «${riga.trim()}» è dentro un blocco non chiuso`);
      for (const c of riga) profondita += c === '{' ? 1 : c === '}' ? -1 : 0;
    });
    expect(errori.slice(0, 3)).toEqual([]);
    expect(profondita).toBe(0);
  });
});
