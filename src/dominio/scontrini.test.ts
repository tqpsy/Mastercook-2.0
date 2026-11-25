import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { Indice } from './ricette';
import { abbinaRighe, daOpenFoodFacts, formatoDaDescrizione, leggiScontrino, pulisciLinea, quantitaProposta, type RigaRipetibile, suggerisciIngrediente, unisciDescrizioni, unisciRipetute } from './scontrini';

const indice = new Indice(catalogo as Catalogo);

describe('interfaccia pubblica di scontrini.ts', () => {
  it('espone ciò che servono agli altri file, anche dopo la divisione per responsabilità (righe, testata, prodotti, abbinamenti)', async () => {
    const tutto = await import('./scontrini');
    expect(Object.keys(tutto).sort()).toEqual(
      ['DA_SALTARE', 'FINE_RIGHE', 'IMPORTO', 'INTESTAZIONE_RIGHE', 'PEZZI', 'SCONTO', 'abbinaRighe', 'centesimi', 'daOpenFoodFacts', 'eFineRighe', 'eIntestazione', 'fineRighe', 'formatoDaDescrizione', 'leggiScontrino', 'numero', 'pulisciLinea', 'quantitaProposta', 'suggerisciIngrediente', 'unisciDescrizioni', 'unisciRipetute'].sort(),
    );
  });
});

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

  it('prezzi letti male: barra al posto della virgola, lettera dell’IVA letta come cifra', () => {
    const t = leggiScontrino(
      ['DESCRIZIONE', 'IPERAL VALT LATTE PS   1/35 A', 'BIO PRIMIA POLPA FIN   1720 A', 'PERE WILLIAMS G500   0.994', 'MENTADENT COLLUTORIO   4,990', 'TOTALE 8,53'].join('\n'),
    );
    expect(t.righe.map((r) => r.prezzo)).toEqual([1.35, 1.2, 0.99, 4.99]);
    expect(t.righe.map((r) => r.senzaPrezzo)).toEqual([undefined, undefined, undefined, undefined]);
    // Un peso o una data non diventano prezzi.
    expect(leggiScontrino('DESCRIZIONE\nBANANE   0,850\nPANE 1,50\n10/11/2026 18:18').righe.filter((r) => !r.senzaPrezzo).map((r) => r.prezzo)).toEqual([1.5]);
  });

  it('una riga con il nome chiaro e il prezzo rovinato resta, senza prezzo, e il conto non torna', () => {
    const t = leggiScontrino(
      ['DESCRIZIONE', 'MOLISANA PENNONI RIG   ip: |', 'X6', 'PRIMIA YOGURT GRECO   5’ B', 'IPERAL SPATZLE   1,99 A', 'PRIMIA YOGURT GRECO   0° SE', 'TOTALE 4,87'].join('\n'),
    );
    expect(t.righe).toEqual([
      { descrizione: 'MOLISANA PENNONI RIG', prezzo: 0, senzaPrezzo: true },
      { descrizione: 'PRIMIA YOGURT GRECO', prezzo: 0, senzaPrezzo: true },
      { descrizione: 'IPERAL SPATZLE', prezzo: 1.99, iva: 'A' },
      { descrizione: 'PRIMIA YOGURT GRECO', prezzo: 0, senzaPrezzo: true },
    ]);
    expect(t).toMatchObject({ totale: 4.87, quadra: false });
  });

  it('un solo prezzo illeggibile vale quanto manca al totale; se il pagamento smentisce il totale non si corregge niente', () => {
    const t = leggiScontrino('DESCRIZIONE\nPANE   1,50 A\nLATTE   ip: |\nTOTALE 2,89\nCARTA   2,89');
    expect(t.righe[1]).toMatchObject({ descrizione: 'LATTE', prezzo: 1.39, corretta: true });
    expect(t).toMatchObject({ quadra: true, corretti: 1, quadraDaSola: false });
    // Il totale letto 5,00 ma il pagamento dice 2,89: è il totale a essere sbagliato, i prezzi restano.
    const u = leggiScontrino('DESCRIZIONE\nPANE   1,50 A\nLATTE   1,39 A\nTOTALE 5,00\nCARTA   2,89');
    expect(u.righe.map((r) => r.prezzo)).toEqual([1.5, 1.39]);
    expect(u.corretti).toBe(0);
  });

  it('uno scontrino ritagliato (senza intestazione) non ha un negozio: una riga con il prezzo non è un nome', () => {
    const s = leggiScontrino('LATTE ESL BIO 3,12 B\nSALVASLIP COOP MAXI 2,16 C\nSCANSIONATO CON CAMSCANNER');
    expect(s.negozio).toBeNull();
    // Il piè di pagina senza prezzo (filigrana) non è un prodotto.
    expect(s.righe.map((r) => r.descrizione)).toEqual(['LATTE ESL BIO', 'SALVASLIP COOP MAXI']);
  });

  it('senza intestazione le righe prima del primo prezzo sono il negozio, non prodotti', () => {
    const s = leggiScontrino('SUPERMERCATO ROSSI\nZUCCHINE 1,80\nLATTE INTERO 1L 1,29\nTOTALE 3,09');
    expect(s.righe.map((r) => r.descrizione)).toEqual(['ZUCCHINE', 'LATTE INTERO 1L']);
    expect(leggiScontrino('IPER\nPETTO POLLO FETTE   3,10\nPETTO POLLO FETTE   3,20\nTOTALE   6,30').righe).toHaveLength(2);
    // Con l'intestazione, invece, una riga senza prezzo prima del primo prezzo resta (da completare).
    expect(leggiScontrino('DESCRIZIONE\nLATTE   ip: |\nPANE 1,50\nTOTALE 1,50').righe[0]).toMatchObject({ descrizione: 'LATTE', senzaPrezzo: true });
  });

  it('un testo senza scontrino non inventa nulla', () => {
    expect(leggiScontrino('ciao a tutti')).toEqual({ negozio: 'Ciao A Tutti', data: null, ora: null, totale: null, righe: [], corretti: 0, quadra: false, quadraDaSola: false });
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

describe('scontrini veri, letti da Tesseract', () => {
  const esempio = (nome: string) => readFileSync(new URL(`./scontrini-esempi/${nome}`, import.meta.url), 'utf8');
  const IPER = [
    { descrizione: 'PANE GRATTUG.BARAT.I', prezzo: 1.65 },
    { descrizione: 'BOCCONCINO IPER', prezzo: 1.89, grammi: 386 },
    { descrizione: 'SFIZIOSO OLIVE', prezzo: 3.01, grammi: 276 },
    { descrizione: 'PETTO POLLO FETTE', prezzo: 4.36, grammi: 314 },
    { descrizione: 'PETTO POLLO FETTE', prezzo: 8.87, grammi: 638 },
    { descrizione: 'SHOPPER 30X55 INATEC', prezzo: 0.1 },
  ];

  // Screenshot dello scontrino digitale Iper: pesi «0,386 * 4,90Kg» sotto la descrizione, lettera IVA dopo il
  // prezzo, l'ora del telefono in alto, «4,90K8g» e «13,89%g» letti male.
  it('Iper (screenshot): sei righe, pesi, negozio, data e ora dello scontrino', () => {
    const s = leggiScontrino(readFileSync(new URL('./scontrini-esempi/iper-screenshot.txt', import.meta.url), 'utf8'));
    expect(s.righe.map(({ descrizione, prezzo, grammi }) => ({ descrizione, prezzo, ...(grammi ? { grammi } : {}) }))).toEqual(IPER);
    expect(s).toMatchObject({ negozio: 'Iper Montebello S.P.A', data: '2026-11-02', ora: '18:41', totale: 19.88, quadra: true });
  });

  it('Iper (foto preparata): «3:01 A» è un prezzo', () => {
    const s = leggiScontrino(esempio('iper-preparato.txt'));
    expect(s.righe.map((r) => r.prezzo)).toEqual(IPER.map((r) => r.prezzo));
    expect(s.quadra).toBe(true);
  });

  it('totale letto male: vale il subtotale o l’importo pagato se tornano con le righe', () => {
    expect(leggiScontrino('PANE 1,50\nLATTE 1,29\nSUBTOTALE 2,79\nTOTALE 2,19\nPAGAMENTO ELETTRONICO 2,79')).toMatchObject({ totale: 2.79, quadra: true });
    // Se nessuno torna resta il totale scritto, e la differenza si vede.
    expect(leggiScontrino('PANE 1,50\nLATTE 1,29\nTOTALE 3,00\nPAGAMENTO CONTANTE 2,79')).toMatchObject({ totale: 3, quadra: false });
  });

  it('corregge gli errori tipici della lettura senza toccare il resto', () => {
    expect(pulisciLinea('latte 1 ,2O €')).toBe('LATTE 1,20');
    expect(pulisciLinea('olive 3:01 A')).toBe('OLIVE 3,01 A');
    expect(pulisciLinea('02-11-2026 18:41')).toBe('02-11-2026 18:41');
    expect(pulisciLinea('UOVA FRESCHE X6')).toBe('UOVA FRESCHE X6');
  });

  it('pezzi letti male, prezzo sotto la descrizione, segni sporchi dopo il prezzo', () => {
    const s = leggiScontrino('DESCRIZIONE PREZZO\nYOGURT BIANCO\n2 xXx 0,99   1,98 B\nCARTA IGIENICA 4 ROT. 22% 2,30 |\nOLIO EVO 1L 4% 7,90 È\nTOTALF 12,18');
    expect(s.righe).toEqual([
      { descrizione: 'YOGURT BIANCO', prezzo: 1.98, pezzi: 2, iva: 'B' },
      { descrizione: 'CARTA IGIENICA 4 ROT.', prezzo: 2.3 },
      { descrizione: 'OLIO EVO 1L', prezzo: 7.9, formato: { quantita: 1000, unita: 'ml' } },
    ]);
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

  it('sceglie l’ingrediente con più parole in comune: il macinato di pollo non è carne macinata', () => {
    const id = (d: string) => suggerisciIngrediente(d, indice)?.id;
    expect(id('MACINATO DI TACCHINO E POLLO')).toBe('ing:macinato_pollo');
    expect(id('MACINATO TACCHINO')).toBe('ing:macinato_pollo');
    expect(id('Macinato di pollo')).toBe('ing:macinato_pollo');
    expect(id('MACINATO')).toBe('ing:carne_macinata');
    expect(id('MACINATO SCELTO BOVINO')).toBe('ing:carne_macinata');
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

  it('spesa fatta con le spunte: lo scontrino Iper dà solo il prezzo, anche alle righe ripetute', () => {
    const s = leggiScontrino(readFileSync(new URL('./scontrini-esempi/iper-screenshot.txt', import.meta.url), 'utf8'));
    const carrello = [
      { id: 'r-pane', ingrediente_id: 'ing:pane_grattugiato', nome: 'Pane grattugiato' },
      { id: 'r-mozz', ingrediente_id: 'ing:mozzarella_bufala', nome: 'Mozzarella di bufala' },
      { id: 'r-olive', ingrediente_id: 'ing:olive', nome: 'Olive' },
      { id: 'r-pollo', ingrediente_id: 'ing:petto_pollo', nome: 'Petto di pollo' },
    ];
    expect(s.righe.map((r) => r.descrizione)).toEqual(['PANE GRATTUG.BARAT.I', 'BOCCONCINO IPER', 'SFIZIOSO OLIVE', 'PETTO POLLO FETTE', 'PETTO POLLO FETTE', 'SHOPPER 30X55 INATEC']);
    // Il bocconcino (mozzarella) va sulla mozzarella di bufala spuntata; le due confezioni di pollo sulla stessa riga.
    expect(abbinaRighe(s.righe, carrello, indice)).toEqual(['r-pane', 'r-mozz', 'r-olive', 'r-pollo', 'r-pollo', null]);
  });

  it('unendo righe ripetute, la riga unita resta «da controllare» se lo era una delle due', () => {
    const riga = (id: string, dubbia?: string): RigaRipetibile => ({ id, descrizione: 'LATTE', euro: '1,29', azione: 'casa', ing: { id: 'ing:latte' }, numero: '1', unita: 'l', luogo: 'frigo', ...(dubbia ? { dubbia } : {}) });
    expect(unisciRipetute([riga('a'), riga('b', 'le due letture non coincidono')])[0].dubbia).toBe('le due letture non coincidono');
    expect(unisciRipetute([riga('a'), riga('b')])[0].dubbia).toBeUndefined();
  });

  it('formato con l’unità prima del numero, moltiplicatore dopo e zeri letti O', () => {
    const f = formatoDaDescrizione;
    expect(f('LATTE A.Q.GRANAROLO LT.1')).toEqual({ quantita: 1000, unita: 'ml' });
    expect(f('CECI BIO SELECT GR 290')).toEqual({ quantita: 290, unita: 'g' });
    expect(f('AVOCADO HASS G 200')).toEqual({ quantita: 200, unita: 'g' });
    expect(f('POMODORINI FF G400')).toEqual({ quantita: 400, unita: 'g' });
    expect(f('MENABREA BIRRA CL66')).toEqual({ quantita: 660, unita: 'ml' });
    expect(f('ALTU.LAVAZZA250GX2')).toEqual({ quantita: 500, unita: 'g' });
    expect(f('PASTA DISEMOLA 5OOG')).toEqual({ quantita: 500, unita: 'g' });
    expect(f('PANE BAULETTO4OOG')).toEqual({ quantita: 400, unita: 'g' });
    // Già letti bene, come prima.
    expect(f('TONNO ALL OLIO OLIVA 3X80G')).toEqual({ quantita: 240, unita: 'g' });
    expect(f('ACQUA NATURALE 1.5L')).toEqual({ quantita: 1500, unita: 'ml' });
    expect(f('UOVA BIOLOGICHE M X4')).toEqual({ quantita: 4, unita: 'pz' });
  });

  it('la data incollata all’ora si legge; quella di una validità o di una tessera non è la data dello scontrino', () => {
    const t = (coda: string) => ['IPER S.P.A.', 'DOCUMENTO COMMERCIALE', 'DESCRIZIONE PREZZO IVA', 'PANE 1,50 A', 'TOTALE COMPLESSIVO 1,50', coda].join('\n');
    expect(leggiScontrino(t('02-11-202618:41'))).toMatchObject({ data: '2026-11-02', ora: '18:41' });
    expect(leggiScontrino(t('15/11/202612:52 DOC.NUM. 0467'))).toMatchObject({ data: '2026-11-15', ora: '12:52' });
    expect(leggiScontrino(t('VALIDO FINO AL 31/12/2026\n02/11/2026')).data).toBe('2026-11-02');
    expect(leggiScontrino(t('TESSERA SCADE 31/12/2027\n02/11/2026')).data).toBe('2026-11-02');
  });

  it('PROMO e OFFERTA dentro il nome di un prodotto non sono sconti; all’inizio della riga o con il prezzo negativo sì', () => {
    const t = (...righe: string[]) => leggiScontrino(['DESCRIZIONE PREZZO IVA', ...righe, 'TOTALE 9,99'].join('\n'));
    expect(t('LATTE 1,50 C', 'BISCOTTI PROMO 500G 2,50 C').righe.map((r) => [r.descrizione, r.prezzo])).toEqual([['LATTE', 1.5], ['BISCOTTI PROMO 500G', 2.5]]);
    expect(t('CAFFE 250G 3,49 C', 'SCONTO FEDELTA -0,35').righe).toMatchObject([{ descrizione: 'CAFFE 250G', prezzo: 3.14, sconto: 0.35 }]);
    expect(t('FETTE DORATE 2,35', 'OFFERTA LIDL PLUS -0,56').righe).toMatchObject([{ prezzo: 1.79 }]);
    expect(t('YOGURT 0,89', 'COUPON 0,30').righe).toMatchObject([{ prezzo: 0.59 }]);
  });

  it('LATTE non è Lattuga, MELE non è Melanzane, PANE non è Panettone; le abbreviazioni e i plurali sì', () => {
    const abbina = (d: string, nota: string) => abbinaRighe([{ descrizione: d, prezzo: 1 }], [{ id: 'x', ingrediente_id: null, nome: nota }], indice)[0] === 'x';
    expect(abbina('LATTE INTERO 1L', 'Lattuga')).toBe(false);
    expect(abbina('MELA GOLDEN', 'Melanzane')).toBe(false);
    expect(abbina('PANE COMUNE', 'Panettone')).toBe(false);
    expect(abbina('RISO CARNAROLI', 'Risotto')).toBe(false);
    expect(abbina('MELE GOLDEN 1KG', 'Mela')).toBe(true);
    expect(abbina('LATTE INTERO 1L', 'Latte')).toBe(true);
    expect(abbina('MOZZ BUFALA', 'Mozzarella')).toBe(true);
    expect(abbina('YOG BIANCO', 'Yogurt')).toBe(true);
  });

  it('sacchetti, shopper e abiti non sono ingredienti (niente ghiaccio, vino rosso o cernia)', () => {
    for (const d of ['SACCHETTO DI CONFEZ.', 'NS SACCHETTO COMPOST', 'SACCH.ORTOFR.BIOGRAD', 'SHOPPER COMPOSTABILE', 'GONNA MIDI NERO S-0487526', 'CARDIGAN NAVY S-0469699', 'MENTADENT DENT KIDS', 'PRIMIA TESTINE X4'])
      expect(suggerisciIngrediente(d, indice), d).toBeUndefined();
    expect(suggerisciIngrediente('SACCHETTI FREEZER', indice)).toBeDefined();
    expect(suggerisciIngrediente('DENTICE FILETTO', indice)?.id).toBe('ing:cernia'); // «dentice» è un sinonimo di cernia nel catalogo
  });

  it('il prezzo senza la virgola, attaccato alla lettera dell’IVA («366C»), si legge', () => {
    const t = leggiScontrino(['DESCRIZIONE PREZZO IVA', '208 SALAMELLE   366C', 'BARBERA ROCCA BADESSA ML   399D', 'PEPERONE GIALLO   1,34 B', 'TOTALE COMPLESSIVO 9,99'].join('\n'));
    expect(t.righe.map((r) => [r.descrizione, r.prezzo])).toEqual([['208 SALAMELLE', 3.66], ['BARBERA ROCCA BADESSA ML', 3.99], ['PEPERONE GIALLO', 1.34]]);
    // Un peso o un formato non è un prezzo: «500G» non cambia.
    expect(leggiScontrino(['DESCRIZIONE', 'PASTA 500G   0,89 A', 'TOTALE 0,89'].join('\n')).righe[0]).toMatchObject({ descrizione: 'PASTA 500G', prezzo: 0.89 });
  });

  it('«Cad 0,99 Pz. 3» dà i pezzi alla riga di sopra e non diventa una riga', () => {
    const t = leggiScontrino(['DESCRIZIONE PREZZO IVA', 'ZUCCHERO SEMOLATO   2,97 C', 'Cad 0,99 Pz. 3', 'FETTE DORATE   2,35 B', 'TOTALE COMPLESSIVO 5,32'].join('\n'));
    expect(t.righe.map((r) => [r.descrizione, r.prezzo, r.pezzi])).toEqual([['ZUCCHERO SEMOLATO', 2.97, 3], ['FETTE DORATE', 2.35, undefined]]);
  });

  it('un numero di una o due cifre in testa al nome è la quantità; uno di tre (un codice) no', () => {
    const t = (riga: string) => leggiScontrino(['DESCRIZIONE PREZZO IVA', riga, 'TOTALE 0,76'].join('\n')).righe[0];
    expect(t('4 PASTA DI SEMOLA 500G   0,76')).toMatchObject({ descrizione: 'PASTA DI SEMOLA 500G', pezzi: 4, formato: { quantita: 500, unita: 'g' } });
    expect(t('437 CALAMARO K.3   0,76')).toMatchObject({ descrizione: '437 CALAMARO K.3' });
    expect(t('5 X 0,10   0,76')?.pezzi).toBeUndefined();
  });

  it('formato con spazi persi e cifre confuse dalla lettura', () => {
    expect(formatoDaDescrizione('LATTEA.Q.GRANAROLOLT.1')).toEqual({ quantita: 1000, unita: 'ml' });
    expect(formatoDaDescrizione('POMODORINI FF G4CO')).toEqual({ quantita: 400, unita: 'g' });
    expect(formatoDaDescrizione('AVOCADO HASS G 2OO')).toEqual({ quantita: 200, unita: 'g' });
    expect(formatoDaDescrizione('GRANMIX FERRARI GR 1OO')).toEqual({ quantita: 100, unita: 'g' });
  });

  it('petto di pollo è il petto di pollo, non il tacchino affettato', () => {
    expect(suggerisciIngrediente('PETTO DI POLLO 500G', indice)?.id).toBe('ing:petto_pollo');
    expect(suggerisciIngrediente('PETTO POLLO FETTE', indice)?.id).toBe('ing:petto_pollo');
  });

  it('righe senza prezzo di validità, tessera o punti non diventano prodotti, nemmeno con gli spazi persi', () => {
    const t = leggiScontrino(['DESCRIZIONE PREZZO IVA', 'OFFERTAVALIDADAL01/11/2026AL30/11/2026', 'TESSERAVALIDAFIN0AL31/12/2027', 'LATTE   1,29 C', 'SALD0PUNTI1250', 'TOTALE COMPLESSIVO 1,29'].join('\n'));
    expect(t.righe.map((r) => r.descrizione)).toEqual(['LATTE']);
    expect(t.quadra).toBe(true);
  });

  it('«SLBTOTALE» è un subtotale letto male: le righe finiscono lì; uno sconto senza prezzo non è un prodotto', () => {
    const t = leggiScontrino(['DESCRIZIONE PREZZO IVA', 'LATTE   1,29 C', 'OFFERTA LIDL PIUS', 'SCONTO', 'PANE   0,99 A', 'SLBTOTALE   2,28', 'TOTALE COMPLESSIVO 2,28'].join('\n'));
    expect(t.righe.map((r) => r.descrizione)).toEqual(['LATTE', 'PANE']);
    expect(t.quadra).toBe(true);
  });

  it('screenshot tagliato a sinistra: «OTALE COMPLESSIVO» è il totale, il segno per letto 大 vale *, i titoli di sezione non sono righe', () => {
    const t = leggiScontrino(
      ['IPER MONTEBELLO S.P.A.', 'ESCRIZIONE   PREZZO IVA', 'RTICOLI AGGIUNTIVI', 'COQUA A4 PAG.BIANCA   2,69 D', 'NIZIO ESPLOSIONE', 'ILETTO DI SCORFANO', '0,218   大   29,91Kg   6,52 B', 'IL.PLATESSA IMP.FIN', '2   大   5,99   11,98 B', 'INE ESPLOSIONE', 'OTALE COMPLESSIVO   21,19', 'MPORTO PAGATO   21,19'].join('\n'),
    );
    expect(t.righe.map((r) => [r.descrizione, r.prezzo, r.grammi ?? r.pezzi ?? null])).toEqual([['COQUA A4 PAG.BIANCA', 2.69, null], ['ILETTO DI SCORFANO', 6.52, 218], ['IL.PLATESSA IMP.FIN', 11.98, 2]]);
    expect(t).toMatchObject({ totale: 21.19, quadra: true });
    // La T letta D: si riconosce lo stesso dalla parola «COMPLESSIVO».
    expect(leggiScontrino(['DESCRIZIONE PREZZO IVA', 'LATTE   1,29 C', 'DTALECOMPLESSIVO   1,29', 'MPORTOPAGATO   1,29'].join('\n'))).toMatchObject({ totale: 1.29, quadra: true });
  });

  it('le righe senza prezzo della tessera («BENNET CLUB», «CARTA NUM.») non sono prodotti; «CARTA IGIENICA» sì', () => {
    const t = leggiScontrino(['DESCRIZIONE PREZZO IVA', 'BENNET CLUB', 'CARTA', 'CARTA IGIENICA', '3,99 C', 'LATTE   1,29 C', 'TOTALE COMPLESSIVO 5,28'].join('\n'));
    expect(t.righe.map((r) => r.descrizione)).toEqual(['CARTA IGIENICA', 'LATTE']);
  });

  it('un «G 2» o un numero senza unità non è un formato', () => {
    expect(formatoDaDescrizione('POM.DATTERINO GIALLO G 2')).toBeUndefined();
    expect(formatoDaDescrizione('SPLEG PANCETTA CUB.')).toBeUndefined();
    expect(formatoDaDescrizione('IPERAL VALT LATTE PS')).toBeUndefined();
    expect(formatoDaDescrizione('VALSOIA CREMA SPALM')).toBeUndefined();
    expect(formatoDaDescrizione('GUM BIDIRECTION SCOV')).toBeUndefined();
  });

  it('conto tornato da solo o a forza: quadraDaSola dice la differenza', () => {
    expect(leggiScontrino('DESCRIZIONE\nPANE   1,50 A\nLATTE   1,39 A\nTOTALE 2,89')).toMatchObject({ quadra: true, quadraDaSola: true });
    expect(leggiScontrino('DESCRIZIONE\nPANE   1,50 A\nLATTE   ip: |\nTOTALE 2,89')).toMatchObject({ quadra: true, quadraDaSola: false });
    expect(leggiScontrino('DESCRIZIONE\nPANE   1,50 A\nLATTE   1,39 A\nTOTALE 9,99')).toMatchObject({ quadra: false, quadraDaSola: false });
  });

  it('la stessa riga ripetuta si unisce in una', () => {
    expect(unisciDescrizioni('PETTO POLLO', 'PETTO POLLO')).toBe('PETTO POLLO ×2');
    expect(unisciDescrizioni('PETTO POLLO ×2', 'PETTO POLLO')).toBe('PETTO POLLO ×3');
    expect(unisciDescrizioni('BOCCONCINO', 'MOZZ.BUFALA')).toBe('BOCCONCINO + MOZZ.BUFALA');
  });

  it('abbreviazioni corte e sinonimi; pane non è panna', () => {
    const lette = [
      { descrizione: 'YOG BIANCO', prezzo: 1 },
      { descrizione: 'PANNA CUCINA', prezzo: 1 },
    ];
    expect(abbinaRighe(lette, [{ id: 'r-yog', ingrediente_id: null, nome: 'Yogurt' }, { id: 'r-pane', ingrediente_id: null, nome: 'Pane' }], indice)).toEqual(['r-yog', null]);
  });

  it('quantità proposta nell’unità dell’ingrediente, o niente', () => {
    const s = leggiScontrino(SCONTRINO);
    expect(quantitaProposta(s.righe[0], { dimensione: 'volume' })).toEqual({ quantita: 1000, unita: 'ml' });
    expect(quantitaProposta(s.righe[1], { dimensione: 'massa' })).toEqual({ quantita: 856, unita: 'g' });
    expect(quantitaProposta(s.righe[3], { dimensione: 'massa' })).toEqual({ quantita: 500, unita: 'g' });
    expect(quantitaProposta(s.righe[4], { dimensione: 'pezzi' })).toEqual({ quantita: 6, unita: 'pz' });
    expect(quantitaProposta({ descrizione: 'PROSCIUTTO', prezzo: 3 }, { dimensione: 'massa' })).toBeNull();
    expect(quantitaProposta({ descrizione: 'ZUCCHINE', prezzo: 1.8, pezzi: 3 }, { dimensione: 'massa', peso_pz: 200 })).toEqual({ quantita: 3, unita: 'pz' });
    expect(quantitaProposta({ descrizione: 'PROSCIUTTO', prezzo: 3, pezzi: 2 }, { dimensione: 'massa' })).toBeNull();
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

describe('righe ripetute dello scontrino', () => {
  const riga = (id: string, x: Partial<RigaRipetibile> = {}): RigaRipetibile => ({
    id,
    descrizione: 'YOGURT GRECO 200G',
    euro: '1,29',
    azione: 'casa',
    ing: { id: 'ing:yogurt' },
    numero: '200',
    unita: 'g',
    luogo: 'frigo',
    quante: '1',
    ...x,
  });

  it('due righe uguali diventano una «× 2» con i prezzi sommati', () => {
    expect(unisciRipetute([riga('a'), riga('b'), riga('c', { descrizione: 'LATTE', ing: { id: 'ing:latte' }, numero: '1', unita: 'l' })])).toEqual([
      riga('a', { quante: '2', euro: '2,58' }),
      riga('c', { descrizione: 'LATTE', ing: { id: 'ing:latte' }, numero: '1', unita: 'l' }),
    ]);
  });

  it('prezzo, quantità o destinazione diversi restano righe separate', () => {
    expect(unisciRipetute([riga('a'), riga('b', { euro: '0,99' }), riga('c', { numero: '500' }), riga('d', { azione: 'altro' }), riga('e', { azione: 'altro' })])).toHaveLength(5);
  });
});
