import { describe, expect, it } from 'vitest';
import { confrontaLetture, righeDubbie, senzaControllo } from './doppiaLettura';
import { leggiScontrino } from './scontrini';

const TESTO = (righe: string[], data = '02-11-2026 18:41', totale = '10,00') => ['IPER S.P.A.', 'DOCUMENTO COMMERCIALE', 'DESCRIZIONE PREZZO IVA', ...righe, `TOTALE COMPLESSIVO ${totale}`, data].join('\n');
const BASE = ['LATTE PARZ.SCREM. 1L 1,29 C', 'PASTA SEMOLA 500G 0,89 C', 'PETTO POLLO FETTE 6,35 C', 'BANANE 1,70 B'];
const leggi = (righe: string[], data?: string, totale?: string) => leggiScontrino(TESTO(righe, data, totale));

describe('doppia lettura della stessa foto', () => {
  it('due letture uguali: tutte le righe concordi, niente da controllare', () => {
    const c = confrontaLetture(leggi(BASE), leggi(BASE));
    expect(c).toMatchObject({ disponibile: true, mancanti: [], campi: { data: false, ora: false, totale: false } });
    expect(righeDubbie(c)).toBe(0);
  });

  it('un prezzo diverso: solo quella riga è dubbia', () => {
    const c = confrontaLetture(leggi(BASE), leggi(['LATTE PARZ.SCREM. 1L 1,29 C', 'PASTA SEMOLA 500G 0,69 C', ...BASE.slice(2)]));
    expect(c.righe.map((r) => r.concorde)).toEqual([true, false, true, true]);
  });

  it('prezzi scalati di una riga (la somma torna lo stesso): le righe scalate sono tutte dubbie', () => {
    const scalata = ['LATTE PARZ.SCREM. 1L 0,89 C', 'PASTA SEMOLA 500G 6,35 C', 'PETTO POLLO FETTE 1,70 C', 'BANANE 1,29 B'];
    const prima = leggi(BASE);
    const seconda = leggi(scalata);
    expect(prima.righe.reduce((s, r) => s + r.prezzo, 0)).toBeCloseTo(seconda.righe.reduce((s, r) => s + r.prezzo, 0), 2);
    expect(righeDubbie(confrontaLetture(prima, seconda))).toBe(4);
  });

  it('il nome letto un po’ diverso con lo stesso prezzo resta concorde; troppo diverso no', () => {
    expect(confrontaLetture(leggi(BASE), leggi(['LATTE PARZ.SCREM. 1L 1,29 C', 'PASTA SEMOLA 5OOG 0,89 C', ...BASE.slice(2)])).righe[1].concorde).toBe(true);
    expect(confrontaLetture(leggi(BASE), leggi(['LATTE PARZ.SCREM. 1L 1,29 C', 'XQZW KJHG 0,89 C', ...BASE.slice(2)])).righe[1].concorde).toBe(false);
  });

  it('una riga che la seconda lettura non ha è dubbia; una che ha in più è «forse persa»', () => {
    const senzaPasta = confrontaLetture(leggi(BASE), leggi([BASE[0], BASE[2], BASE[3]]));
    expect(senzaPasta.righe.map((r) => r.concorde)).toEqual([true, false, true, true]);
    const inPiu = confrontaLetture(leggi([BASE[0], BASE[2], BASE[3]]), leggi(BASE));
    expect(inPiu.righe.every((r) => r.concorde)).toBe(true);
    expect(inPiu.mancanti).toEqual([{ descrizione: 'PASTA SEMOLA 500G', prezzo: 0.89 }]);
  });

  it('data, ora e totale diversi sono campi dubbi, anche se uno dei due manca', () => {
    expect(confrontaLetture(leggi(BASE, '02-11-2026 18:41'), leggi(BASE, '02-11-2025 18:41')).campi).toMatchObject({ data: true, ora: false });
    expect(confrontaLetture(leggi(BASE, '02-11-2026 18:41'), leggi(BASE, '02-11-2026 18:14')).campi).toMatchObject({ data: false, ora: true });
    expect(confrontaLetture(leggi(BASE, '02-11-2026 18:41'), leggi(BASE, 'GRAZIE')).campi).toMatchObject({ data: true, ora: true });
    expect(confrontaLetture(leggi(BASE, undefined, '10,00'), leggi(BASE, undefined, '10,10')).campi.totale).toBe(true);
  });

  it('senza seconda lettura non si segnala niente', () => {
    const c = confrontaLetture(leggi(BASE), null);
    expect(c).toEqual(senzaControllo(4));
    expect(righeDubbie(c)).toBe(0);
  });
});
