import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { Indice } from './ricette';
import { allinea, creaRapporto, leggiPerValutare, peggiorate, riassumi, somiglianza, valuta, type Verita } from './valutazione';

const indice = new Indice(catalogo as Catalogo);

const VERITA: Verita = {
  versione: 1,
  id: 'prova',
  origine: 'sintetico',
  verita: 'costruzione',
  data: '2026-11-02',
  ora: '18:41',
  totale: 4.77,
  righe: [
    { descrizione: 'LATTE PARZ.SCREM. 1L', prezzo: 1.29 },
    { descrizione: 'PASTA SEMOLA 500G', prezzo: 0.89 },
    { descrizione: 'PETTO POLLO FETTE', prezzo: 2.49 },
    { descrizione: 'SHOPPER CARTA', prezzo: 0.1 },
  ],
};

const TESTO = (righe: string[], coda = 'TOTALE COMPLESSIVO 4,77\n02-11-2026 18:41') => ['IPER S.P.A.', 'DOCUMENTO COMMERCIALE', 'DESCRIZIONE PREZZO IVA', ...righe, coda].join('\n');
const GIUSTO = ['LATTE PARZ.SCREM. 1L 1,29 C', 'PASTA SEMOLA 500G 0,89 C', 'PETTO POLLO FETTE 2,49 C', 'SHOPPER CARTA 0,10 A'];
const leggi = (testo: string, carrello = VERITA.carrello) => valuta(VERITA, leggiPerValutare(testo, indice, carrello));

describe('somiglianza dei nomi', () => {
  it('non conta maiuscole, accenti, spazi e punteggiatura', () => {
    expect(somiglianza('Latte parz.screm. 1L', 'LATTEPARZSCREM1L')).toBe(1);
    expect(somiglianza('PASSATA POMODORO 700G', 'PASSATAPOMODORO7OOG')).toBeGreaterThanOrEqual(0.85);
    expect(somiglianza('PASTA', 'LATTE')).toBeLessThan(0.5);
  });
});

describe('allineamento righe vere e righe lette', () => {
  const r = (descrizione: string, prezzo: number) => ({ descrizione, prezzo, senzaPrezzo: false, corretta: false, ingrediente: null, carico: null, abbina: null });
  it('tiene l’ordine e lascia fuori una riga persa o in più', () => {
    const vere = VERITA.righe;
    expect(allinea(vere, [r('LATTE PARZ.SCREM. 1L', 1.29), r('PETTO POLLO FETTE', 2.49), r('SHOPPER CARTA', 0.1)])).toEqual([0, null, 1, 2]);
    expect(allinea(vere, [r('LATTE PARZ.SCREM. 1L', 1.29), r('QUALCOSA DI STRANO', 9.99), r('PASTA SEMOLA 500G', 0.89), r('PETTO POLLO FETTE', 2.49), r('SHOPPER CARTA', 0.1)])).toEqual([0, 2, 3, 4]);
  });
  it('una riga con il nome rovinato ma il prezzo giusto è la stessa riga', () => {
    expect(allinea([{ descrizione: 'MOZZARELLA 125G', prezzo: 0.79 }], [r('MZZARLLA 1', 0.79)])).toEqual([0]);
  });
});

describe('valutazione di una lettura', () => {
  it('lettura giusta: perfetta, il conto torna davvero', () => {
    const v = leggi(TESTO(GIUSTO));
    expect(v).toMatchObject({ perfetta: true, falsoQuadra: false, quadra: true, errori: [] });
    expect(v.righe).toMatchObject({ vere: 4, ok: 4, inPiu: 0, mancanti: 0 });
  });

  it('riga persa: non perfetta, e il conto lo dice', () => {
    const v = leggi(TESTO(GIUSTO.slice(0, 3), 'TOTALE COMPLESSIVO 4,77\n02-11-2026 18:41'));
    expect(v.perfetta).toBe(false);
    expect(v.righe.mancanti).toBe(1);
    expect(v.errori[0]).toContain('SHOPPER CARTA');
  });

  it('prezzo sbagliato senza segnale è «silenzioso»; con la riga senza prezzo è «segnalato»', () => {
    const silenzioso = leggi(TESTO(['LATTE PARZ.SCREM. 1L 1,28 C', ...GIUSTO.slice(1)], 'TOTALE COMPLESSIVO 4,76\n02-11-2026 18:41'));
    expect(silenzioso.righe).toMatchObject({ prezzoSilenzioso: 1, prezzoSegnalato: 0 });
    // Totale letto male (4,80): il prezzo ricostruito dal conto (1,32) è sbagliato, ma la riga è segnalata come «corretta».
    const segnalato = leggi(TESTO(['LATTE PARZ.SCREM. 1L', ...GIUSTO.slice(1)], 'TOTALE COMPLESSIVO 4,80\n02-11-2026 18:41'));
    expect(segnalato.righe).toMatchObject({ prezzoSilenzioso: 0, prezzoSegnalato: 1 });
  });

  it('«falso quadra»: il conto torna ma i prezzi sono sbagliati (due errori che si compensano)', () => {
    const v = leggi(TESTO(['LATTE PARZ.SCREM. 1L 1,19 C', 'PASTA SEMOLA 500G 0,99 C', ...GIUSTO.slice(2)]));
    expect(v.quadra).toBe(true);
    expect(v.perfetta).toBe(false);
    expect(v.falsoQuadra).toBe(true);
  });

  it('data e ora sbagliate tolgono la perfezione; la data mancante si vede, ma non è un falso quadra', () => {
    const v = leggi(TESTO(GIUSTO, 'TOTALE COMPLESSIVO 4,77'));
    expect(v.falsoQuadra).toBe(false);
    expect(v.campi).toMatchObject({ data: false, ora: false, totale: true });
    expect(v.perfetta).toBe(false);
    expect(v.errori.join('|')).toContain('data non letta');
  });

  it('riga in più con un ingrediente: entra in casa, quindi non è sicura', () => {
    const v = leggi(TESTO([...GIUSTO, 'BANANE 1,50 C'], 'TOTALE COMPLESSIVO 6,27\n02-11-2026 18:41'));
    expect(v.righe.inPiu).toBe(1);
    expect(v.giacenza.inPiu).toBe(1);
    expect(v.sicura).toBe(false);
  });
});

describe('scontrino ritagliato: i campi che non si vedono non si misurano', () => {
  it('senza data e totale nella verità, una lettura senza data né totale può essere perfetta', () => {
    const ritagliata: Verita = { ...VERITA, data: undefined, ora: undefined, totale: undefined };
    const v = valuta(ritagliata, leggiPerValutare(TESTO(GIUSTO, ''), indice));
    expect(v.campi).toMatchObject({ data: null, ora: null, totale: null });
    expect(v.perfetta).toBe(true);
    const s = riassumi([{ caso: 'a', lettura: '1', valutazione: v }]);
    expect(s.data).toMatchObject({ valore: 0, su: 0 });
  });
});

describe('conversione in prodotti', () => {
  const verita: Verita = {
    ...VERITA,
    totale: 3.4,
    righe: [
      { descrizione: 'LATTE 1L', prezzo: 1.5, ingrediente: 'ing:latte', carico: { quantita: 1000, unita: 'ml' } },
      { descrizione: 'UOVA', prezzo: 1.9, ingrediente: 'ing:uova', carico: null },
    ],
  };
  const testo = (righe: string[]) => ['IPER S.P.A.', 'DOCUMENTO COMMERCIALE', 'DESCRIZIONE PREZZO IVA', ...righe, 'TOTALE COMPLESSIVO 3,40', '02-11-2026 18:41'].join('\n');

  it('quantità giusta; «da completare» dove la verità dice che non si sa', () => {
    const v = valuta(verita, leggiPerValutare(testo(['LATTE 1L 1,50 C', 'UOVA 1,90 C']), indice));
    expect(v.ingrediente).toMatchObject({ misurate: 2, ok: 2 });
    // «UOVA» senza numero: l'app propone 1 pezzo, la verità è «non si sa»: è una quantità inventata.
    expect(v.giacenza).toMatchObject({ misurate: 2, ok: 1, sbagliata: 1 });
    expect(v.sicura).toBe(false);
    expect(v.errori.join('|')).toContain('in casa 1 pz invece di niente');
  });

  it('una quantità non letta è «mancata» (si scrive dopo), non sbagliata', () => {
    const v = valuta({ ...verita, righe: [{ descrizione: 'PASTA 500G', prezzo: 1, ingrediente: 'ing:pasta', carico: { quantita: 500, unita: 'g' } }], totale: 1 }, leggiPerValutare(['IPER S.P.A.', 'DOCUMENTO COMMERCIALE', 'DESCRIZIONE PREZZO IVA', 'PASTA 5OOG 1,00 C', 'TOTALE COMPLESSIVO 1,00', '02-11-2026 18:41'].join('\n'), indice));
    expect(v.giacenza).toMatchObject({ misurate: 1, mancata: 1, sbagliata: 0 });
    expect(v.sicura).toBe(true);
  });
});

describe('abbinamento alle righe già comprate', () => {
  it('conta gli abbinamenti sbagliati (LATTE preso per Lattuga)', () => {
    const verita: Verita = {
      ...VERITA,
      totale: 1.29,
      carrello: [{ id: 'r-lattuga', ingrediente_id: 'ing:lattuga', nome: 'Lattuga' }],
      righe: [{ descrizione: 'LATTE', prezzo: 1.29, abbina: null }],
    };
    const testo = ['IPER S.P.A.', 'DOCUMENTO COMMERCIALE', 'DESCRIZIONE PREZZO IVA', 'LATTE 1,29 C', 'TOTALE COMPLESSIVO 1,29', '02-11-2026 18:41'].join('\n');
    const v = valuta(verita, leggiPerValutare(testo, indice, verita.carrello));
    expect(v.abbinamenti).toMatchObject({ misurate: 1, sbagliati: 1 });
    expect(v.sicura).toBe(false);
  });
});

describe('sintesi e confronto tra fasi', () => {
  const esito = (caso: string, lettura: string, testo: string) => ({ caso, lettura, valutazione: leggi(testo) });
  const buono = TESTO(GIUSTO);
  const cattivo = TESTO(['LATTE PARZ.SCREM. 1L 1,19 C', 'PASTA SEMOLA 500G 0,99 C', ...GIUSTO.slice(2)]);

  it('conta letture perfette, falsi quadra e stabilità', () => {
    const s = riassumi([esito('a', '1', buono), esito('a', '2', buono), esito('b', '1', cattivo), esito('b', '2', buono)]);
    expect(s.perfette).toMatchObject({ valore: 3, su: 4 });
    expect(s.falsiQuadra.valore).toBe(1);
    // Il caso «a» ha due letture uguali, il caso «b» due diverse: 3 su 4 hanno l'esito più frequente.
    expect(s.stabilita).toMatchObject({ valore: 3, su: 4 });
  });

  it('segnala i passi indietro e non le novità', () => {
    const prima = riassumi([esito('a', '1', buono), esito('b', '1', cattivo)]);
    const meglio = riassumi([esito('a', '1', buono), esito('b', '1', buono)]);
    expect(peggiorate(prima, meglio)).toEqual([]);
    expect(peggiorate(meglio, prima).join('|')).toContain('Letture perfette');
    expect(peggiorate(meglio, prima).join('|')).toContain('«Il conto torna» ma la lettura è sbagliata');
  });

  it('conta le letture fallite (errore al posto del testo) a parte', () => {
    const fallita = { ...esito('a', '3', ''), fallita: true };
    expect(riassumi([esito('a', '1', buono), fallita]).lettureFallite.valore).toBe(1);
    expect(creaRapporto('foto', 'prova', [fallita]).casi[0].fallita).toBe(true);
  });

  it('il rapporto elenca gli errori di ogni lettura', () => {
    const r = creaRapporto('testo', 'prova', [esito('b', '1', cattivo)]);
    expect(r).toMatchObject({ livello: 'testo', etichetta: 'prova' });
    expect(r.casi[0].errori.length).toBeGreaterThan(0);
  });
});
