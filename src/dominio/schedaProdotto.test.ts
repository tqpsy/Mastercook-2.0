import { describe, expect, it } from 'vitest';
import { schedaDaOpenFoodFacts, schedaVuota } from './schedaProdotto';
import { daOpenFoodFacts } from './scontrini';

// Forma della risposta di /api/v3/product/{codice}: status testuale, risultato, prodotto.
const V3 = {
  code: '8001234567890',
  status: 'success',
  result: { id: 'product_found' },
  product: {
    product_name_it: 'Biscotti frollini',
    brands: 'Forno Rossi',
    quantity: '350 g',
    product_quantity: 350,
    product_quantity_unit: 'g',
    serving_size: '30 g',
    nutriments: {
      'energy-kj_100g': 1975,
      'energy-kcal_100g': 471,
      fat_100g: 17,
      'saturated-fat_100g': 2.1,
      carbohydrates_100g: 70,
      sugars_100g: 23,
      fiber_100g: 2.8,
      proteins_100g: 7.4,
      salt_100g: 0.55,
      sodium_100g: 0.22,
      calcium_100g: 0.12,
      'vitamin-d_100g': 0.0000025,
      'energy-kcal_serving': 141,
      'nova-group_100g': 4,
      'nutrition-score-fr_100g': 18,
      'beta-carotene_100g': 0.001,
      'beta-carotene_unit': 'mg',
    },
    ingredients_text_it: 'Farina di _frumento_ 60%, zucchero, olio di girasole, _uova_, agenti lievitanti: E500',
    ingredients: [
      { text: 'Farina di _frumento_', percent: 60 },
      { text: 'agenti lievitanti', ingredients: [{ text: 'E500' }] },
    ],
    allergens_tags: ['en:gluten', 'en:eggs'],
    traces_tags: ['en:nuts', 'it:qualcosa-di-raro'],
    additives_tags: ['en:e500', 'en:e500ii'],
    nova_group: 4,
    nutriscore_grade: 'd',
    nutrient_levels: { fat: 'high', 'saturated-fat': 'moderate', sugars: 'high', salt: 'low' },
    labels_tags: ['en:eu-organic'],
    last_modified_t: 1767225600,
  },
};

describe('scheda prodotto da Open Food Facts v3', () => {
  const s = schedaDaOpenFoodFacts(V3)!;

  it('legge tutti i valori nutrizionali, nelle unità da etichetta', () => {
    const v = Object.fromEntries(s.valori.map((x) => [x.chiave, `${x.per100} ${x.unita}`]));
    expect(v).toMatchObject({
      'energy-kj': '1975 kJ',
      'energy-kcal': '471 kcal',
      fat: '17 g',
      'saturated-fat': '2.1 g',
      sugars: '23 g',
      salt: '0.55 g',
      sodium: '220 mg',
      calcium: '120 mg',
      'vitamin-d': '2.5 µg',
      'beta-carotene': '1 mg',
    });
    // Punteggi e indici non sono valori nutrizionali.
    expect(s.valori.map((x) => x.chiave)).not.toContain('nova-group');
    expect(s.valori.map((x) => x.chiave)).not.toContain('nutrition-score-fr');
    expect(s.valori.find((x) => x.chiave === 'energy-kcal')?.perPorzione).toBe(141);
    expect(s.valori.find((x) => x.chiave === 'sugars')?.sotto).toBe(true);
    expect(s.base).toBe('100 g');
    expect(s.porzione).toBe('30 g');
  });

  it('dà l’elenco completo degli ingredienti, allergeni, tracce e additivi', () => {
    expect(s.ingredienti).toBe('Farina di frumento 60%, zucchero, olio di girasole, uova, agenti lievitanti: E500');
    expect(s.linguaIngredienti).toBe('it');
    expect(s.elencoIngredienti).toEqual([
      { nome: 'Farina di frumento', percentuale: 60 },
      { nome: 'agenti lievitanti', sotto: [{ nome: 'E500' }] },
    ]);
    expect(s.allergeni).toEqual(['glutine', 'uova']);
    expect(s.tracce).toEqual(['frutta a guscio', 'qualcosa di raro']);
    expect(s.additivi).toEqual(['E500', 'E500II']);
  });

  it('riporta gli indicatori ufficiali così come sono', () => {
    expect(s.nova).toBe(4);
    expect(s.nutriScore).toBe('D');
    expect(s.livelli).toEqual({ grassi: 'alto', 'grassi saturi': 'moderato', zuccheri: 'alto', sale: 'basso' });
    expect(s.biologico).toBe(true);
    expect(s.aggiornataIl).toBe('2026-01-01');
    expect(s.codice).toBe('8001234567890');
  });

  it('il nome e il formato si leggono anche dalla v3', () => {
    expect(daOpenFoodFacts(V3)).toEqual({ nome: 'Biscotti frollini Forno Rossi', formato: { quantita: 350, unita: 'g' } });
  });

  it('prodotto sconosciuto o senza dati', () => {
    expect(schedaDaOpenFoodFacts({ status: 'failure', result: { id: 'product_not_found' } })).toBeUndefined();
    expect(daOpenFoodFacts({ status: 'failure' })).toBeUndefined();
    expect(schedaDaOpenFoodFacts(null)).toBeUndefined();
    const vuota = schedaDaOpenFoodFacts({ status: 'success', product: { product_name: 'X' } })!;
    expect(schedaVuota(vuota)).toBe(true);
  });

  it('bevande per 100 ml, ingredienti in altra lingua', () => {
    const b = schedaDaOpenFoodFacts({ status: 'success', product: { quantity: '1,5 l', ingredients_text: 'Water, sugar', nutriments: { sugars_100g: '10,6' } } })!;
    expect(b.base).toBe('100 ml');
    expect(b.linguaIngredienti).toBe('altra');
    expect(b.valori[0]).toMatchObject({ chiave: 'sugars', per100: 10.6 });
  });
});
