import { describe, expect, it } from 'vitest';
import { correggiPrezzi } from './quadratura';
import { inizioColonnaPrezzi, prezziDaColonna, unisciColonne } from './colonne';
import { leggiScontrino } from './scontrini';

// Letture vere di Tesseract sulla foto di uno scontrino Iperal (foto storta, carta piegata): tutta la pagina,
// la sola colonna dei nomi e la sola colonna dei prezzi (solo cifre).
const PAGINA = `SANCISAOLO D' ARGO
ERERAL O SUE MERCATI SPA
VIA GAPNICO 12
GSHISNAIZZIO (CO EF ASI I
"3UIC)  291312 730)
DOCUMENTO Co)
ci VENdI La 0 ZIA
DESCRIZIONE
CARTAMICA. DIGITALE               PREZZO IVA
MENABREA BIRRA CL66               0,00 C
PRIMIA DISG LIO LT]               1,39 C
PRIMIA.SUCCHIETTI                  1,99 C
MOLTSANA PENNONI RIG              0-69 A
A_X6
VALSOIA CREMA SPALM                1,99 È
VALSOIA CREMA SPALM                3'S B
PRIMIA YOGURT GRECO                0 39 B
PRIMIA YOGURT GRECO                059 B
IPERAL VALT LATTE PS               1135 A
IPERAL VALT LATTE PS               1/35 A
BIO PRIMIA POLPA FIN               1/20 A
BIO PRIMIA POLPA FIN               1120 A
IPERAL SALM.AFF.NORV               5 95 B
PERE WILLTAMS G500                0.99 A
BANANE CONFEZIONATE                180 A
ZUCCA DELTCA                       2,09 A
ZUCCHINE                           2,22 A
SHOPPER COMPOSTABILE               0,01C
PRIMIA TESTINE X4                  3,49 C
PRIMIA FORCELLE C/FI               1,55 C
MENTADENT DENT KIDS                2,79 C
SCONTO                        -0,44
SPLEG PANCETTA CUB.                1,59 B
SPLEG PANCETTA CUB.                1,59 B
IPERAL SPATZLE                    1,99 A
IPERAL SPATZLE                    1,99 A
IPERAL VALERTANA                  0,99 A
GUM BIDIRECTION SCOV               4,69 C
MENTADENT COLLITORIO               4,99 C
TIGULLIO PESTO.G190                2,39 B
SCONTO                        -0,40
dx 0.10
SHOPPER BIO SELF                  0,30 C
ARTICOLI       33       É
IOTME OOPLESSIME =—6007
DI CUI IVA
6,34
Isp Masterca                   60,07
RESTO                             0,00
A: IVA 400%
B: IVA 10,00%
C: IVA 22 00%
10/11/2026 18:18
Celine i
DOC.NUM. 0467-0070
SERVER RT:S3SNS309064
EGR: 01430080 0
er RTTRMA`;
const NOMI = `SANPAOLO D'ALR
EPERALO SUPERMERCATI SPA
UVA SAPNICO 12
STISNMI.ZIO (CI EE N
UO 23/312 7130)
DOCUMENTO C:    Dr    l
di vendita  NIANILI cn
DESCRIZIONE
CARTAMICA. DIGITALE
MENABREA BIRRA CL66
PRIMIA DISG LIO LT]
PRIMIA.SUCCHIETTI
MOLISANA PENNONI RIG
UOVA X6
VALSOIA CREMA SPALM
VALSOIA CREMA SPALM
PRIMIA YOGURT GRECO
PRIMIA YOGURT GRECO
IPERAL VALT LATTE PS
IPERAL VALT LATTE PS
BIO PRIMIA POLPA FIN
BIO PRIMIA POLPA FIN
IPERAL SALM.AFF.NORV
PERE WILLIAMS G500
BANANE CONFEZIONATE
ZUCCA DELICA
ZUCCHINE
SHOPPER COMPOSTABILE
PRIMIA TESTINE X4q
PRIMIA FORCELLE C/FI
MENTADENT DENT KIDS
SCONTO
SPLEG PANCETTA CUB.
SPLEG PANCETTA CUB.
IPERAL SPATZLE
IPERAL SPATZLE
IPERAL VALERTANA
GUM BIDIRECTION SCOv
MENTADENT COLLUTORIO
TIGULLIO PESTO.G190
SCONTO
3 x      0.10
SHOPPER BIO SELF
ARTICOLI       33       4
Ti) 4
TOTALE COMPLESSIVO €
DI CUI IVA
Isp Masterca
RESTO
A: IVA 4,00%
B: IVA 10,00%
C: IVA 22,00%
10/11/2026 18:18   DOC.NUM. 0
SERVER RT: 53SNS308082
EGR: 01430059 "09
vec ann n gi E TIOMA`;
const PREZZI = `16
0 A
0,00 C
1,39 C
1,99 C
0,65 A
0,90 A
1,99 B
2,35 B
2,85 B
0,39 B
0,89 B
1,35 A
1,35 A
1,20 A
1,20 A
9,95 B
0,99 A
1,80 A
2,09 A
2,22 A
0,01 C
3,49 C
1,55 C
2,79 C
-0, 44
1,59 B
1,59 B
1,99 A
1,99 A
0,99 A
4,69 C
4,99 C
2,39 B
-0,40
0,30 C
0`;
const PREZZI_ALTRA = ` A
0,00 C
1,39 C
1,99 C
0,65 A
0,90 A
1,99 B
2,85 B
2,85 B
0,39 B
0,89 B
1,35 A
1,35 A
1,20 A
1,20 A
9,95 B
0,99 A
1,80 A
2,09 A
2,22 A
0,01 C
3,49 C
1,55 C
2,719 C
-0, 44
1,59 B
1,59 B
1,99 A
1,99 A
0,99 A
4,69 C
4,99
2,39 B
-0,40
0,30 C`;

const ATTESI = [
  ['CARTAMICA', 0], ['MENABREA', 1.39], ['DISG', 1.99], ['SUCCHIETTI', 0.65], ['PENNONI', 0.9], ['UOVA', 1.99], ['VALSOIA', 2.85], ['VALSOIA', 2.85],
  ['YOGURT', 0.89], ['YOGURT', 0.89], ['LATTE', 1.35], ['LATTE', 1.35], ['POLPA', 1.2], ['POLPA', 1.2], ['SALM', 5.95], ['PERE', 0.99], ['BANANE', 1.8],
  ['ZUCCA', 2.09], ['ZUCCHINE', 2.22], ['SHOPPER COMPOSTABILE', 0.01], ['TESTINE', 3.49], ['FORCELLE', 1.55], ['MENTADENT DENT', 2.35], ['PANCETTA', 1.59],
  ['PANCETTA', 1.59], ['SPATZLE', 1.99], ['SPATZLE', 1.99], ['VALERTANA', 0.99], ['GUM', 4.69], ['COLLUTORIO', 4.99], ['TIGULLIO', 1.99], ['SHOPPER BIO', 0.3],
] as const;

describe('scontrino letto a colonne (foto storta)', () => {
  it('i prezzi della colonna si leggono nell’ordine, con gli sconti negativi', () => {
    const p = prezziDaColonna(PREZZI);
    expect(p).toHaveLength(34);
    expect(p[0]).toEqual({ testo: '0,00 C', negativo: false });
    expect(p.filter((x) => x.negativo).map((x) => x.testo)).toEqual(['-0,44', '-0,40']);
  });

  it('abbinati per ordine ai nomi, e con le cifre confuse corrette, tutte e 32 le righe tornano e il conto quadra', () => {
    const testo = unisciColonne(PAGINA, prezziDaColonna(PREZZI), NOMI);
    expect(testo).not.toBeNull();
    const s = leggiScontrino(testo!);
    expect(s).toMatchObject({ totale: 60.07, quadra: true, corretti: 3 });
    expect(s.righe).toHaveLength(ATTESI.length);
    for (const [i, [nome, prezzo]] of ATTESI.entries()) {
      expect(s.righe[i].descrizione, `riga ${i}`).toContain(nome);
      expect(s.righe[i].prezzo, s.righe[i].descrizione).toBe(prezzo);
    }
    // Le tre cifre corrette: 2,35→2,85 e 0,39→0,89 (la riga gemella dice qual è giusta) e 9,95→5,95.
    expect(s.righe.filter((r) => r.corretta).map((r) => r.prezzo)).toEqual([2.85, 0.89, 5.95]);
  });

  it('con una lettura che perde un prezzo non abbina (meglio niente che sbagliato)', () => {
    expect(prezziDaColonna(PREZZI_ALTRA)).toHaveLength(33);
    expect(unisciColonne(PAGINA, prezziDaColonna(PREZZI_ALTRA), NOMI)).toBeNull();
  });

  it('non abbina se nomi e prezzi non sono lo stesso numero, o se uno sconto non ha il prezzo negativo', () => {
    expect(unisciColonne(PAGINA, prezziDaColonna(PREZZI).slice(1))).toBeNull();
    expect(unisciColonne(PAGINA, [])).toBeNull();
    const storto = prezziDaColonna(PREZZI);
    [storto[22], storto[23]] = [storto[23], storto[22]];
    expect(unisciColonne(PAGINA, storto, NOMI)).toBeNull();
  });

  it('la colonna dei prezzi inizia dove stanno i numeri con i decimali', () => {
    const parole = [10, 20, 30, 40, 50, 60].map((i) => ({ testo: `${i},99`, x0: 900 + i })).concat([{ testo: 'LATTE', x0: 20 }, { testo: '0,500', x0: 400 }, { testo: '1', x0: 5 }]);
    expect(inizioColonnaPrezzi(parole, 1400)).toBeGreaterThan(800);
    expect(inizioColonnaPrezzi(parole, 1400)).toBeLessThan(910);
    expect(inizioColonnaPrezzi([], 1000)).toBe(660);
  });
});

describe('lettura della colonna dei prezzi', () => {
  it('la virgola persa si rimette (tre o più cifre sole sono euro e centesimi), il segno meno e la lettera restano', () => {
    expect(prezziDaColonna('135A\n595 B\n000C\n-044\n1,99 A\n33\nPREZZO IVA\nSAN PAOLO').map((p) => p.testo)).toEqual(['1,35 A', '5,95 B', '0,00 C', '-0,44', '1,99 A']);
  });

  it('uno sconto a cui è caduto il segno meno resta uno sconto; più prezzi che nomi: quelli in fondo sono del totale', () => {
    const nomi = 'SAN PAOLO\nDESCRIZIONE\nPANE\nSCONTO\nLATTE\nARTICOLI 2\nTOTALE 2,35';
    const t = unisciColonne('', prezziDaColonna('1,50 A\n0,40\n1,25 A\n2,35\n2,35'), nomi);
    expect(t).not.toBeNull();
    const s = leggiScontrino(t!);
    expect(s.righe.map((r) => [r.descrizione, r.prezzo])).toEqual([['PANE', 1.1], ['LATTE', 1.25]]);
    expect(s.righe[0].sconto).toBe(0.4);
  });

  it('con meno prezzi che nomi non si abbina: manca un prezzo e non si sa quale', () => {
    expect(unisciColonne('', prezziDaColonna('1,50 A\n1,25 A'), 'DESCRIZIONE\nPANE\nLATTE\nUOVA\nARTICOLI 3')).toBeNull();
  });

  it('l’intestazione si riconosce anche letta male', () => {
    expect(unisciColonne('', prezziDaColonna('1,50 A\n1,25 A'), 'DESCRIZTONE\nPANE\nLATTE\nARTICOLI 2')).not.toBeNull();
  });
});

describe('correzione delle cifre confuse', () => {
  const riga = (nome: string, cent: number, iva?: string) => ({ nome, cent, iva, modificabile: true });
  it('una cifra letta male: il totale dice quale', () => {
    // 1,39 letto 1,99? No: 1,89 letto 1,39. Il totale 5,38 = 1,50 + 1,89 + 1,99.
    expect(correggiPrezzi([riga('PANE', 150), riga('LATTE', 139), riga('UOVA', 199)], { totale: 538 })).toEqual([150, 189, 199]);
    // Quando torna già, non si tocca niente.
    expect(correggiPrezzi([riga('PANE', 150)], { totale: 150 })).toBeNull();
  });
  it('se più correzioni sono possibili e nessuna spicca, non indovina', () => {
    // 3,00 e 3,00 → una delle due potrebbe essere 8,00 ma nessuna è «più probabile».
    expect(correggiPrezzi([riga('PANE', 300), riga('LATTE', 300)], { totale: 1100 })).toBeNull();
  });
  it('due righe gemelle con prezzo diverso: si corregge quella che le rende uguali', () => {
    expect(correggiPrezzi([riga('YOGURT', 89), riga('YOGURT', 39), riga('PANE', 150)], { totale: 89 + 89 + 150 })).toEqual([89, 89, 150]);
  });
  it('le righe con uno sconto non si toccano', () => {
    expect(correggiPrezzi([{ ...riga('YOGURT', 39), modificabile: false }, riga('PANE', 150)], { totale: 89 + 150 })).toBeNull();
  });
  it('l’IVA totale sceglie tra due soluzioni', () => {
    // 5,00 e 5,00 con totale 14,00: o la prima è 9,00 o la seconda; solo con una l'IVA scritta torna.
    const righe = [riga('A', 500, 'A'), riga('C', 500, 'C')];
    const aliquote = { A: 0.04, C: 0.22 };
    const iva = (a: number, c: number) => Math.round(a - a / 1.04) + Math.round(c - c / 1.22);
    expect(correggiPrezzi(righe, { totale: 1400 })).toBeNull();
    expect(correggiPrezzi(righe, { totale: 1400, ivaTotale: iva(900, 500), aliquote })).toEqual([900, 500]);
    expect(correggiPrezzi(righe, { totale: 1400, ivaTotale: iva(500, 900), aliquote })).toEqual([500, 900]);
  });
});
