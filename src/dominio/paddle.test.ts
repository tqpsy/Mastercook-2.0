import { describe, expect, it } from 'vitest';
import { prezziDaColonna, unisciColonne } from './colonne';
import { allargaRiquadro, decodificaCtc, impagina, inclinazione, inizioPrezzi, larghezzaPerLettura, riquadriDaMappa, type Scatola, tensoreLettura, tensoreRilevazione, unisciRiquadri } from './paddle';
import { leggiScontrino } from './scontrini';

// Pezzi di testo che PaddleOCR (nel browser) ha letto da foto storte di uno scontrino Iperal, come [testo, x sinistra, y alto,
// y basso] su una foto larga 1400 punti: la foto originale, e la stessa foto compressa a bassa qualità (JPEG 30), di cui si ha
// anche la rilettura della sola colonna dei prezzi.
const ORIGINALE: [string, number, number, number][] = [["SAN PAOLOD'ARGON", 183, 303, 383], ["IPERAL SUPERMERCATI", 279, 376, 425], ["SPA", 822, 378, 423], ["VIA SARNICO 12", 392, 434, 477], ["SERVIZTOC CLIENTT", 180, 459, 544], ["8661232736", 342, 510, 603], ["GDOUMENTCOMERCIALE", 288, 633, 776], ["DESCRIZTONE", 76, 784, 853], ["CARIAMICA.DIGITALE", 35, 833, 928], ["PREZZO IVA", 1011, 870, 922], ["MENABREA BIRRA CL66", 32, 890, 985], ["0,00 C", 1067, 929, 978], ["PRIMIA DISG LIO LTI", 34, 948, 1038], ["1,39C", 1069, 985, 1031], ["PRIMIA.SUCCHIETTI", 39, 1008, 1084], ["1,99C", 1068, 1039, 1085], ["MOLISANA PENNONI RIG", 31, 1061, 1156], ["0.65 A", 1066, 1093, 1139], ["UOVA X6", 41, 1124, 1191], ["0.90A", 1065, 1147, 1193], ["VALSOIA CREMA SPALM", 39, 1178, 1259], ["1.99", 1067, 1203, 1245], ["B", 1210, 1204, 1239], ["VALSOIA CREMA SPALM", 42, 1239, 1313], ["2,85", 1063, 1250, 1302], ["B", 1209, 1253, 1290], ["PRIMIA YOGURT GRECO", 41, 1297, 1367], ["B", 1209, 1304, 1347], ["2,85", 1063, 1306, 1357], ["B", 1209, 1356, 1406], ["PRIMIA YOGURT GRECO", 44, 1357, 1419], ["0.89", 1064, 1362, 1409], ["B", 1209, 1414, 1458], ["0.89", 1065, 1418, 1462], ["IPERAL VALT LATTE PS", 49, 1418, 1475], ["A", 1209, 1466, 1510], ["1,35", 1065, 1468, 1517], ["IPERAL VALT LATTE PS", 49, 1477, 1533], ["1,35", 1067, 1522, 1571], ["A", 1209, 1523, 1563], ["BIO PRIMIA POLPA FIN", 48, 1538, 1589], ["1.20", 1067, 1575, 1624], ["A", 1208, 1580, 1620], ["BIO PRIMIA POLPA FIN", 50, 1596, 1647], ["1,20 A", 1063, 1625, 1686], ["IPERAL SALM.AFF.NORV", 51, 1654, 1706], ["5,95B", 1056, 1674, 1747], ["PERE WILLIAMS G500", 50, 1712, 1760], ["0,99 A", 1061, 1736, 1799], ["BANANE CONFEZIONATE", 50, 1770, 1819], ["1,80 A", 1066, 1796, 1852], ["ZUCCA DELICA", 50, 1827, 1875], ["2,09 A", 1063, 1850, 1906], ["ZUCCHINE", 51, 1885, 1932], ["2,22 A", 1063, 1905, 1961], ["SHOPPER COMPOSTABILE", 48, 1942, 1991], ["0,01 C", 1065, 1964, 2016], ["PRIMIA TESTINE X4", 43, 1997, 2050], ["3.49 C", 1062, 2019, 2073], ["PRIMIA FORCELLE C/FI", 43, 2055, 2109], ["1,55C", 1066, 2080, 2129], ["MENTADENT DENT KIDS", 43, 2114, 2165], ["2,79 C", 1062, 2135, 2186], ["SCONTO", 136, 2175, 2216], ["-0,44", 1045, 2193, 2240], ["SPLEG PANCETTA CUB.", 43, 2230, 2282], ["1,59B", 1063, 2252, 2303], ["SPLEG PANCETTA CUB.", 44, 2287, 2339], ["1,59B", 1062, 2308, 2362], ["IPERAL SPATZLE", 46, 2349, 2392], ["1,99 A", 1064, 2367, 2416], ["IPERAL SPATZLE", 46, 2406, 2449], ["1,99 A", 1063, 2424, 2475], ["IPERALVALERTANA", 46, 2466, 2506], ["0,99 A", 1060, 2479, 2536], ["GUM BIDIRECTION SCOV", 43, 2523, 2569], ["4,69", 1062, 2538, 2588], ["c", 1208, 2545, 2593], ["MENTADENT COLLUTORIO", 42, 2582, 2627], ["4.99", 1060, 2591, 2647], ["C", 1205, 2600, 2641], ["TIGULLIO PESTO.G190", 44, 2638, 2686], ["2,39 B", 1055, 2646, 2709], ["SCONTO", 131, 2696, 2740], ["-0.40", 1044, 2709, 2759], ["0.10", 427, 2753, 2800], ["3X", 158, 2754, 2799], ["SHOPPERBTO SELF", 46, 2814, 2854], ["0,30 C", 1066, 2828, 2877], ["ARTICOLI", 75, 2870, 2912], ["33", 513, 2871, 2924], ["TOTALE COMPLESSIVO", 46, 2993, 3075], ["60,07", 1030, 3009, 3103], ["DI CUI IVA", 76, 3091, 3136], ["6,34", 1063, 3117, 3167], ["Isp Masterca", 80, 3197, 3250], ["60.07", 1036, 3222, 3272], ["RESTO", 81, 3253, 3299], ["0,00", 1063, 3282, 3331], ["A:IVA 4,00%", 86, 3360, 3414], ["B:IVA 10.00%", 84, 3414, 3468], ["C:IVA 22,00%", 84, 3463, 3525], ["10/11/2026", 94, 3574, 3626], ["18:18", 460, 3585, 3628], ["DOC.NUM. 0467-0070", 666, 3589, 3681], ["SERVER RT:53SNS303963", 328, 3673, 3785], ["ECR:014300523", 445, 3728, 3826], ["DM", 452, 3853, 3870]];
const COMPRESSA: [string, number, number, number][] = [["SAN PAOLO D'ARGON", 183, 303, 383], ["IPERAL SUPERMERCATISPA", 278, 376, 425], ["VIA SAPNICO 12", 392, 434, 477], ["SERVHZTO CLIENTT", 180, 460, 546], ["866-232736", 342, 510, 603], ["GDOCUMENTG COMERCIALE", 288, 633, 776], ["TAVNT SOMERIAEn", 246, 676, 835], ["DESCRIZTONE", 76, 784, 853], ["CARIAMICA.DIGITALE", 38, 834, 926], ["PREZZO IVA", 1011, 870, 923], ["MENABREA BIRRA CL66", 34, 890, 985], ["0,00 C", 1067, 929, 978], ["PRIMIA DISG LIO LTI", 34, 948, 1038], ["1,39C", 1069, 985, 1031], ["PRIMIA.SUCCHIETTT", 41, 1008, 1084], ["1,99C", 1066, 1037, 1086], ["MOLISANA PENNONI RIG", 32, 1061, 1156], ["0.65A", 1066, 1093, 1139], ["UOVA X6", 43, 1124, 1191], ["0.90", 1066, 1148, 1193], ["A", 1213, 1153, 1186], ["VALSOIA CREMA SPALM", 39, 1178, 1259], ["1.99", 1067, 1203, 1245], ["B", 1209, 1204, 1240], ["VALSOIA CREMA SPALM", 41, 1237, 1313], ["2,85", 1061, 1250, 1302], ["B", 1211, 1254, 1290], ["PRIMIA YOGURT GRECO", 43, 1297, 1367], ["B", 1209, 1303, 1347], ["2,85", 1063, 1306, 1357], ["PRIMIA YOGURT GRECO", 45, 1357, 1422], ["B", 1209, 1357, 1401], ["0,89", 1063, 1360, 1409], ["B", 1209, 1414, 1458], ["0.89", 1064, 1416, 1463], ["IPERAL VALT LATTE PS", 49, 1418, 1475], ["35", 1124, 1469, 1515], ["1", 1072, 1474, 1513], ["IPERAL VALT LATTE PS", 49, 1477, 1533], ["1,35", 1067, 1522, 1571], ["BIO PRIMIA POLPA FIN", 48, 1538, 1589], ["1", 1075, 1578, 1614], ["A", 1208, 1580, 1618], ["20", 1124, 1580, 1622], ["BIO PRIMIA POLPA FIN", 50, 1596, 1647], ["1,20", 1067, 1626, 1680], ["A", 1209, 1638, 1678], ["IPERAL SALM.AFF.NORV", 51, 1654, 1706], ["5,95", 1062, 1678, 1736], ["B", 1209, 1693, 1737], ["PERE WILLIAMS G500", 50, 1712, 1760], ["0.99A", 1061, 1736, 1799], ["BANANE CONFEZIONATE", 51, 1771, 1817], ["1,80 A", 1067, 1796, 1850], ["ZUCCA DELICA", 52, 1827, 1875], ["2,09 A", 1063, 1850, 1906], ["ZUCCHINE", 51, 1885, 1932], ["2,22A", 1061, 1903, 1962], ["SHOPPER COMPOSTABILE", 48, 1942, 1991], ["0,01C", 1064, 1964, 2018], ["PRIMIA TESTINE X4", 43, 1997, 2050], ["3.49C", 1062, 2019, 2073], ["PRIMIA FORCELLE C/FI", 43, 2055, 2109], ["1,55C", 1063, 2078, 2129], ["MENTADENT DENT KIDS", 44, 2114, 2165], ["2.79C", 1062, 2135, 2186], ["SCONTO", 136, 2175, 2216], ["-0.44", 1045, 2193, 2241], ["SPLEG PANCETTA CUB.", 43, 2229, 2280], ["159B", 1063, 2252, 2303], ["SPLEG PANCETTA CUB.", 44, 2287, 2339], ["1,59B", 1062, 2308, 2362], ["IPERAL SPATZLE", 46, 2349, 2392], ["1,99 A", 1064, 2367, 2416], ["IPERALSPATZLE", 47, 2408, 2448], ["1,99A", 1063, 2424, 2475], ["IPERALVALERTANA", 46, 2466, 2506], ["0,99 A", 1061, 2480, 2534], ["GUM BIDIRECTION SCOV", 43, 2523, 2569], ["4.69 C", 1052, 2532, 2610], ["MENTADENT COLLUTORTO", 42, 2582, 2627], ["4,99", 1061, 2592, 2645], ["TIGULLIO PESTO.G190", 44, 2638, 2686], ["2,39 B", 1056, 2646, 2707], ["SCONTO", 131, 2696, 2740], ["-0.40", 1043, 2708, 2761], ["0.10", 426, 2751, 2800], ["3X", 158, 2754, 2799], ["SHOPPER BIOSELF", 46, 2814, 2854], ["0,30C", 1066, 2828, 2877], ["33", 512, 2871, 2923], ["ARTICOLI", 76, 2872, 2911], ["TOTALE COMPLESSTVOe", 46, 2993, 3075], ["60,07", 1030, 3009, 3103], ["DI CUI IVA", 78, 3091, 3136], ["6,34", 1063, 3117, 3167], ["Isp Masterca", 80, 3197, 3250], ["60.07", 1038, 3220, 3271], ["RESTO", 84, 3255, 3298], ["0,00", 1064, 3284, 3331], ["A: IVA 4,00%", 86, 3360, 3414], ["B:IVA 10.00%", 83, 3412, 3468], ["C:IVA 22,00%", 85, 3466, 3524], ["10/11/2026", 94, 3574, 3626], ["18:18", 460, 3585, 3628], ["DOC.NUM. 0467-0070", 666, 3589, 3681], ["SERVERRT:53SNS303963", 328, 3674, 3782], ["ECR:014300523", 446, 3726, 3827], ["ETRMA", 416, 3846, 3876]];
const COMPRESSA_COLONNA: [string, number, number, number][] = [["SAN PAOLO D'ARGON", 183, 303, 383], ["SERVHZTO CLIENTT", 180, 460, 546], ["PREZZOIVA", 1011, 870, 923], ["0,00 C", 1067, 929, 978], ["1,39C", 1068, 985, 1031], ["1,99C", 1066, 1037, 1086], ["0.65A", 1066, 1093, 1139], ["0.90 A", 1065, 1147, 1193], ["1,99B", 1064, 1198, 1246], ["2.85B", 1058, 1245, 1304], ["2,85B", 1056, 1293, 1361], ["089B", 1056, 1345, 1416], ["0,89B", 1059, 1405, 1466], ["135A", 1059, 1457, 1523], ["1,35A", 1062, 1513, 1574], ["1.20A", 1063, 1571, 1627], ["1,20 A", 1062, 1624, 1687], ["5,95B", 1056, 1674, 1747], ["0,99A", 1061, 1736, 1799], ["1,80 A", 1067, 1796, 1850], ["2,09 A", 1063, 1850, 1906], ["2,22A", 1061, 1903, 1962], ["0,01C", 1062, 1962, 2018], ["3.49C", 1062, 2019, 2073], ["1,55C", 1063, 2078, 2129], ["2.79C", 1062, 2135, 2186], ["-0.44", 1045, 2193, 2241], ["159B", 1062, 2252, 2303], ["1,59B", 1062, 2308, 2362], ["1,99A", 1064, 2367, 2416], ["1,99 A", 1062, 2422, 2475], ["0,99A", 1061, 2480, 2534], ["4.69c", 1047, 2529, 2616], ["4,99 C", 1057, 2589, 2650], ["2,39B", 1056, 2646, 2707], ["-0.40", 1043, 2708, 2761], ["0,30C", 1066, 2828, 2877], ["60,07", 1029, 3009, 3103], ["6,34", 1063, 3117, 3167], ["60,07", 1037, 3220, 3273], ["0,00", 1064, 3284, 3331], ["DOC.NUM.0467-0070", 666, 3589, 3681]];
const LARGHEZZA = 1400;
const scatole = (v: [string, number, number, number][]): Scatola[] => v.map(([testo, x0, y0, y1]) => ({ testo, x0, y0, x1: x0 + 100, y1, fiducia: 1 }));

const PREZZI = [0, 1.39, 1.99, 0.65, 0.9, 1.99, 2.85, 2.85, 0.89, 0.89, 1.35, 1.35, 1.2, 1.2, 5.95, 0.99, 1.8, 2.09, 2.22, 0.01, 3.49, 1.55, 2.35, 1.59, 1.59, 1.99, 1.99, 0.99, 4.69, 4.99, 1.99, 0.3];

/** Il testo dello scontrino come lo compone l'app: nomi e prezzi abbinati per ordine. */
const letto = (v: Scatola[]) => {
  const { pagina, prezzi, nomi } = impagina(v, LARGHEZZA);
  const testo = unisciColonne(pagina, prezziDaColonna(prezzi), nomi);
  return { pagina, testo, scontrino: testo ? leggiScontrino(testo) : null };
};

describe('scontrino letto con PaddleOCR (foto storta)', () => {
  it('la colonna dei prezzi inizia dove stanno i numeri col decimale', () => {
    const x = inizioPrezzi(scatole(ORIGINALE), LARGHEZZA);
    expect(x).toBeGreaterThan(900);
    expect(x).toBeLessThan(1070);
  });

  it('nomi e prezzi abbinati per ordine: 32 righe, prezzi giusti, il conto quadra senza correzioni', () => {
    const { scontrino: s } = letto(scatole(ORIGINALE));
    expect(s).toMatchObject({ totale: 60.07, quadra: true, corretti: 0, data: '2026-11-10', ora: '18:18', negozio: 'Iperal Supermercati Spa' });
    expect(s!.righe.map((r) => r.prezzo)).toEqual(PREZZI);
    expect(s!.righe[5].descrizione).toContain('UOVA');
    expect(s!.righe[22].sconto).toBe(0.44);
  });

  it('la pagina riga per riga (prezzo più vicino in verticale) da sola sbaglia: serve l’ordine', () => {
    const { pagina, scontrino } = letto(scatole(ORIGINALE));
    expect(leggiScontrino(pagina).righe.map((r) => r.prezzo)).not.toEqual(scontrino!.righe.map((r) => r.prezzo));
  });

  it('foto compressa: la prima lettura perde dei prezzi e non si abbina; riletta la colonna dei prezzi, torna tutto', () => {
    const prima = scatole(COMPRESSA);
    expect(letto(prima).testo).toBeNull();
    const x = inizioPrezzi(prima, LARGHEZZA);
    const { scontrino: s } = letto([...prima.filter((b) => b.x0 < x), ...scatole(COMPRESSA_COLONNA)]);
    expect(s).toMatchObject({ totale: 60.07, quadra: true, corretti: 0 });
    expect(s!.righe.map((r) => r.prezzo)).toEqual(PREZZI);
  });

  it('un nome letto da due riquadri sovrapposti non si ripete (il negozio resta «Iperal Supermercati Spa»)', () => {
    const doppio = scatole([...ORIGINALE, ['IPERAL SUPERMERCATI', 280, 369, 400]]);
    expect(letto(doppio).scontrino!.negozio).toBe('Iperal Supermercati Spa');
  });
});

describe('inclinazione della foto', () => {
  it('foto dritta: quasi niente; foto ruotata: i prezzi allineati a destra lo dicono', () => {
    expect(Math.abs(inclinazione(scatole(ORIGINALE), LARGHEZZA)!)).toBeLessThan(0.01);
    // Gli stessi prezzi con il bordo destro che scende di 5 punti ogni 100 (circa 3°).
    const inclinata = scatole(ORIGINALE).map((b) => ({ ...b, x0: b.x0 - b.y0 * 0.05, x1: b.x1 - b.y0 * 0.05 }));
    expect((inclinazione(inclinata, LARGHEZZA)! * 180) / Math.PI).toBeCloseTo(-2.9, 0);
    expect(inclinazione(scatole(ORIGINALE).slice(0, 5), LARGHEZZA)).toBeNull();
  });
});

describe('rilevazione del testo', () => {
  /** Una mappa w×h con i rettangoli dati, ciascuno con la sua probabilità. */
  const mappa = (w: number, h: number, rettangoli: [number, number, number, number, number][]) => {
    const m = new Float32Array(w * h);
    for (const [x0, y0, x1, y1, p] of rettangoli) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = p;
    return m;
  };

  it('trova i pezzi di testo, scarta i troppo piccoli e quelli poco sicuri', () => {
    const r = riquadriDaMappa(mappa(100, 60, [[10, 10, 60, 20, 0.9], [10, 40, 60, 50, 0.4], [80, 10, 82, 12, 0.9], [70, 30, 95, 38, 0.8]]), 100, 60);
    expect(r.map((x) => [x.x0, x.y0, x.x1, x.y1])).toEqual([[10, 10, 60, 20], [70, 30, 95, 38]]);
    expect(r[0].punteggio).toBeCloseTo(0.9);
  });

  it('i pezzi di una stessa riga si uniscono, righe diverse e colonne lontane no', () => {
    const riga = [{ x0: 0, y0: 100, x1: 40, y1: 115 }, { x0: 52, y0: 101, x1: 80, y1: 116 }];
    expect(unisciRiquadri(riga)).toEqual([{ x0: 0, y0: 100, x1: 80, y1: 116 }]);
    expect(unisciRiquadri([...riga, { x0: 0, y0: 130, x1: 40, y1: 145 }])).toHaveLength(2);
    expect(unisciRiquadri([riga[0], { x0: 500, y0: 100, x1: 540, y1: 115 }])).toHaveLength(2);
    // Per la colonna dei prezzi si accetta un vuoto largo: prezzo e lettera dell'IVA formano una riga sola.
    expect(unisciRiquadri([riga[0], { x0: 120, y0: 100, x1: 140, y1: 115 }], 12)).toHaveLength(1);
  });

  it('il riquadro si allarga di area × 1,6 / perimetro in orizzontale e meno in verticale, senza uscire dall’immagine', () => {
    const g = allargaRiquadro({ x0: 100, y0: 100, x1: 200, y1: 120 }, 1000, 1000);
    expect(g.x0).toBeCloseTo(100 - (100 * 20 * 1.6) / 240);
    expect(g.y0).toBeCloseTo(100 - (100 * 20 * 1) / 240);
    expect(allargaRiquadro({ x0: 0, y0: 0, x1: 100, y1: 20 }, 100, 20)).toEqual({ x0: 0, y0: 0, x1: 100, y1: 20 });
  });
});

describe('preparazione e decodifica', () => {
  it('rilevazione: tensore BGR normalizzato, fondo bianco oltre l’immagine', () => {
    const img = { width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255]) };
    const t = tensoreRilevazione(img, 2, 1);
    expect(t).toHaveLength(6);
    // Canale 0 = blu: il punto rosso ha blu 0 → (0 - 0,485) / 0,229; il fondo bianco → (1 - 0,485) / 0,229.
    expect(t[0]).toBeCloseTo(-0.485 / 0.229);
    expect(t[1]).toBeCloseTo(0.515 / 0.229);
    // Canale 2 = rosso: 255 → (1 - 0,406) / 0,225.
    expect(t[4]).toBeCloseTo(0.594 / 0.225);
  });

  it('lettura: altezza 48, valori da -1 a 1, zeri oltre la larghezza del riquadro', () => {
    const bianco = { width: 96, height: 48, data: new Uint8ClampedArray(96 * 48 * 4).fill(255) };
    expect(larghezzaPerLettura(96, 48)).toBe(96);
    const t = tensoreLettura([bianco], 120);
    expect(t).toHaveLength(3 * 48 * 120);
    expect(t[0]).toBe(1);
    expect(t[100]).toBe(0);
  });

  it('CTC: ripetuti uniti, «niente» tolti, spazio per ultimo', () => {
    // classi: 0 niente, 1 «a», 2 «b», 3 spazio (dizionario [a, b, ' '])
    const p = (c: number) => Float32Array.from([0, 1, 2, 3].map((k) => (k === c ? 0.9 : 0.03)));
    const seq = [1, 1, 0, 1, 2, 3, 2];
    const dati = new Float32Array(seq.flatMap((c) => [...p(c)]));
    expect(decodificaCtc(dati, seq.length, 4, ['a', 'b', ' ']).testo).toBe('aab b');
  });
});
