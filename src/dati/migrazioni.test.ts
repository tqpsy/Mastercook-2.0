/**
 * Le migrazioni si applicano in ordine di versione (il numero prima di «_»): due file con la stessa versione
 * fanno fallire la pubblicazione sul database, che ne registra una sola. Più rami lavorano insieme: qui si vede subito.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('migrazioni', () => {
  it('ogni file ha una versione diversa', () => {
    const file = readdirSync(join(__dirname, '../../supabase/migrations')).filter((f) => f.endsWith('.sql'));
    const versioni = file.map((f) => f.split('_')[0]);
    const doppie = file.filter((_, i) => versioni.indexOf(versioni[i]) !== versioni.lastIndexOf(versioni[i]));
    expect(doppie).toEqual([]);
  });
});
