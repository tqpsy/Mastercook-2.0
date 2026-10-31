import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import catalogo from './catalogo.json';
import nuove from './ricette-nuove.json';
import { controllaCatalogo } from './controlli';
import type { Catalogo } from './tipi';

const c = catalogo as Catalogo;

describe('catalogo di sistema pubblicato', () => {
  it('supera i controlli d’importazione senza errori bloccanti', () => {
    expect(controllaCatalogo(c).errori).toEqual([]);
  });

  it('ha le ricette e gli ingredienti attesi dal vecchio Mastercook', () => {
    expect(c.ricette).toHaveLength(216);
    expect(c.ingredienti.length).toBeGreaterThan(400);
    expect(new Set(c.ricette.map((r) => r.categoria))).toEqual(new Set(['antipasto', 'primo', 'secondo', 'contorno', 'piatto_unico', 'dolce', 'colazione']));
  });

  it('le ricette nate in Mastercook 2.0 sono nel catalogo e nella loro migrazione, uguali', () => {
    for (const r of nuove.ricette) expect(c.ricette.find((x) => x.id === r.id)).toEqual(r);
    const sql = readFileSync(resolve(import.meta.dirname, '../../supabase/migrations/20261115000000_pizze.sql'), 'utf8');
    const json = JSON.parse(sql.split('$catalogo$')[1]) as { ricette: unknown[] };
    expect(json.ricette).toEqual(nuove.ricette);
  });

  it('i controlli si accorgono dei problemi', () => {
    const rotto: Catalogo = structuredClone(c);
    rotto.ricette[0].ingredienti[0] = { ...rotto.ricette[0].ingredienti[0], ingrediente_id: 'ing:inesistente' };
    const uova = rotto.ricette.find((r) => r.ingredienti.some((g) => g.ingrediente_id === 'ing:uova'))!;
    uova.ingredienti.find((g) => g.ingrediente_id === 'ing:uova')!.unita = 'g';
    rotto.ricette[2].categoria = 'merenda' as never;
    const { errori } = controllaCatalogo(rotto);
    expect(errori.map((e) => e.cosa)).toEqual(
      expect.arrayContaining(['ingrediente non presente nella tassonomia', 'unità g incompatibile con pezzi', 'categoria non prevista: merenda']),
    );
  });
});
