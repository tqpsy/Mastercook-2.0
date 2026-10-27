import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { Indice } from './ricette';
import { abbinaRighe, daOpenFoodFacts, formatoDaDescrizione, leggiScontrino, quantitaProposta, suggerisciIngrediente } from './scontrini';

const indice = new Indice(catalogo as Catalogo);

const SCONTRINO = `
SUPERMERCATO ROSSI S.R.L.
Via Roma 1 - 20100 Milano
P.IVA 01234567890
DOCUMENTO COMMERCIALE
di vendita o prestazione
DESCRIZIONE              IVA   Prezzo(€)
LATTE INTERO 1L          10%     1,29
BANANE
0,856 kg x 1,99 €/kg      4%     1,70
SPAGHETTI N.5 500G       10%     0,89
SCONTO                          -0,20
2 x 0,99
YOGURT BIANCO 2X125G     10%     1,98
UOVA FRESCHE X6          10%     2.49 B
SHOPPER                  22%     0,10
SUBTOTALE                        8,25
TOTALE COMPLESSIVO               8,25
DI CUI IVA                       0,61
PAGAMENTO CONTANTE              10,00
RESTO                            1,75
02-11-2026 18:30
DOCUMENTO N. 0123-0045
`;

describe('lettura dello scontrino', () => {
  const s = leggiScontrino(SCONTRINO);

  it('legge negozio, data, ora e totale; IVA, pagamento e resto non sono righe', () => {
    expect(s).toMatchObject({ negozio: 'Supermercato Rossi S.R.L.', data: '2026-11-02', ora: '18:30', totale: 8.25, quadra: true });
    expect(s.righe.map((r) => r.descrizione)).toEqual(['LATTE INTERO 1L', 'BANANE', 'SPAGHETTI N.5 500G', 'YOGURT BIANCO 2X125G', 'UOVA FRESCHE X6', 'SHOPPER']);
  });

  it('peso sulla linea sotto, sconto sulla riga sopra, pezzi sulla riga sotto, lettera IVA dopo il prezzo', () => {
    expect(s.righe[1]).toEqual({ descrizione: 'BANANE', prezzo: 1.7, grammi: 856 });
    expect(s.righe[2]).toMatchObject({ prezzo: 0.69, formato: { quantita: 500, unita: 'g' } });
    expect(s.righe[3]).toMatchObject({ prezzo: 1.98, pezzi: 2, formato: { quantita: 250, unita: 'g' } });
    expect(s.righe[4]).toMatchObject({ prezzo: 2.49, formato: { quantita: 6, unita: 'pz' } });
  });

  it('i pezzi scritti sotto la riga vanno alla riga sopra se il conto torna', () => {
    const t = leggiScontrino('MOZZARELLA 125G   2,58\n2 x 1,29\nTOTALE 2,58\n03/11/26 09:05');
    expect(t.righe).toEqual([{ descrizione: 'MOZZARELLA 125G', prezzo: 2.58, pezzi: 2, formato: { quantita: 125, unita: 'g' } }]);
    expect(t).toMatchObject({ data: '2026-11-03', ora: '09:05', quadra: true });
  });

  it('un testo senza scontrino non inventa nulla', () => {
    expect(leggiScontrino('ciao a tutti')).toEqual({ negozio: 'Ciao A Tutti', data: null, ora: null, totale: null, righe: [], quadra: false });
    expect(leggiScontrino('').righe).toEqual([]);
    // Il totale che non torna si segnala.
    expect(leggiScontrino('PANE 1,50\nTOTALE 3,00').quadra).toBe(false);
  });

  it('formato dalla descrizione', () => {
    expect(formatoDaDescrizione('OLIO EVO 0,75L')).toEqual({ quantita: 750, unita: 'ml' });
    expect(formatoDaDescrizione('BIRRA 33CL')).toEqual({ quantita: 330, unita: 'ml' });
    expect(formatoDaDescrizione('FARINA 00 1KG')).toEqual({ quantita: 1000, unita: 'g' });
    expect(formatoDaDescrizione('DETERSIVO')).toBeUndefined();
  });
});

describe('ingredienti e abbinamenti', () => {
  it('suggerisce l’ingrediente da descrizioni abbreviate o al plurale, senza forzare', () => {
    const id = (d: string) => suggerisciIngrediente(d, indice)?.id;
    expect(id('LATTE INTERO 1L')).toBe('ing:latte');
    expect(id('BANANE')).toBe('ing:banana');
    expect(id('SPAGHETTI N.5 500G')).toBe('ing:spaghetti');
    expect(id('UOVA FRESCHE X6')).toBe('ing:uova');
    expect(id('SHOPPER')).toBeUndefined();
  });

  it('abbina alle righe del carrello senza prezzo, una per una; il resto è nuovo', () => {
    const s = leggiScontrino(SCONTRINO);
    const abbinate = abbinaRighe(
      s.righe,
      [
        { id: 'r-pasta', ingrediente_id: 'ing:pasta', nome: 'Pasta' },
        { id: 'r-latte', ingrediente_id: 'ing:latte', nome: 'Latte' },
        { id: 'r-det', ingrediente_id: null, nome: 'Shopper grande' },
      ],
      indice,
    );
    // Gli spaghetti valgono come pasta; lo shopper si abbina per nome.
    expect(abbinate).toEqual(['r-latte', null, 'r-pasta', null, null, 'r-det']);
  });

  it('quantità proposta nell’unità dell’ingrediente, o niente', () => {
    const s = leggiScontrino(SCONTRINO);
    expect(quantitaProposta(s.righe[0], { dimensione: 'volume' })).toEqual({ quantita: 1000, unita: 'ml' });
    expect(quantitaProposta(s.righe[1], { dimensione: 'massa' })).toEqual({ quantita: 856, unita: 'g' });
    expect(quantitaProposta(s.righe[3], { dimensione: 'massa' })).toEqual({ quantita: 500, unita: 'g' });
    expect(quantitaProposta(s.righe[4], { dimensione: 'pezzi' })).toEqual({ quantita: 6, unita: 'pz' });
    expect(quantitaProposta({ descrizione: 'PROSCIUTTO', prezzo: 3 }, { dimensione: 'massa' })).toBeNull();
  });
});

describe('Open Food Facts', () => {
  it('prende nome, marca e formato; senza prodotto non propone nulla', () => {
    expect(daOpenFoodFacts({ status: 1, product: { product_name_it: 'Latte intero', brands: 'Granarolo,Altro', product_quantity: '1000', product_quantity_unit: 'ml' } })).toEqual({
      nome: 'Latte intero Granarolo',
      formato: { quantita: 1000, unita: 'ml' },
    });
    expect(daOpenFoodFacts({ status: 1, product: { product_name: 'Spaghetti n.5', quantity: '500 g' } })).toEqual({ nome: 'Spaghetti n.5', formato: { quantita: 500, unita: 'g' } });
    expect(daOpenFoodFacts({ status: 0 })).toBeUndefined();
    expect(daOpenFoodFacts({ status: 1, product: { product_name: '' } })).toBeUndefined();
    expect(daOpenFoodFacts(null)).toBeUndefined();
  });
});
