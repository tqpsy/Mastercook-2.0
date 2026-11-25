import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { confrontaLetture } from './doppiaLettura';
import { type BozzaImportazione, costruisciImportazione, letturaDiscorde, proponiProdotto, proponiRighe, riabbina, righeDaLettura, rigaIncerta, rigaVuota, SOGLIA_FIDUCIA, SOGLIA_PREZZO_SICURO, testoEuro } from './importaScontrino';
import { Indice } from './ricette';
import { leggiScontrino } from './scontrini';

const indice = new Indice(catalogo as Catalogo);
const ing = (id: string) => indice.ingrediente(id)!;
let n = 0;
const nuovoId = () => `id-${++n}`;

const TESTO = 'SUPERMERCATO ROSSI\nLATTE INTERO 1L          1,29\nZUCCHINE 3 x 0,60        1,80\nSHOPPER                  0,10\nTOTALE                   3,19';

describe('proponiProdotto', () => {
  it('ricava ingrediente e quantità dal formato', () => {
    const p = proponiProdotto({ descrizione: 'LATTE INTERO 1L', prezzo: 1.29, formato: { quantita: 1000, unita: 'ml' } }, indice);
    expect(p.ing?.id).toBe(ing('ing:latte').id);
    expect(p.carico).toEqual({ quantita: 1000, unita: 'ml' });
    expect(p.numero).toBe('1000');
    expect(p.unita).toBe('ml');
  });

  it('senza quantità, ciò che si conta si propone a pezzi e il numero resta vuoto', () => {
    const p = proponiProdotto({ descrizione: 'ZUCCHINE', prezzo: 1.8 }, indice);
    expect(p.ing).not.toBeNull();
    expect(p.carico).toBeNull();
    expect(p.numero).toBe('');
    expect(p.unita).toBe(p.ing!.peso_pz && p.ing!.dimensione !== 'pezzi' ? 'pz' : p.unita);
  });

  it('un non alimento non ha ingrediente, e il posto di partenza è la dispensa', () => {
    const p = proponiProdotto({ descrizione: 'SHOPPER', prezzo: 0.1 }, indice);
    expect(p).toMatchObject({ ing: null, carico: null, numero: '', unita: 'g', luogo: 'dispensa' });
  });

  it('la virgola decimale si scrive come nei campi', () => {
    const p = proponiProdotto({ descrizione: 'BANANE', prezzo: 1.7, grammi: 856.5 }, indice);
    expect(p.numero).toBe('856,5');
  });
});

describe('proponiRighe e righeDaLettura', () => {
  it('cibo in casa, il resto solo spesa; il prezzo è scritto con la virgola', () => {
    const s = leggiScontrino(TESTO);
    const righe = righeDaLettura(s, confrontaLetture(s, null), [], indice, nuovoId);
    expect(righe.map((r) => [r.descrizione, r.azione, r.euro])).toEqual([
      ['LATTE INTERO 1L', 'casa', '1,29'],
      ['ZUCCHINE 3 X 0,60', 'casa', '1,80'],
      ['SHOPPER', 'altro', '0,10'],
    ]);
    expect(righe.every((r) => r.auto && !r.cerca)).toBe(true);
    expect(new Set(righe.map((r) => r.id)).size).toBe(3);
  });

  it('una riga già spuntata prende il prezzo e non entra in casa', () => {
    const lette = [{ id: 'a', riga: { descrizione: 'LATTE INTERO 1L', prezzo: 1.29 } }];
    const [r] = proponiRighe(lette, [{ id: 'riga-latte', ingrediente_id: 'ing:latte', nome: 'Latte' }], indice);
    expect(r.azione).toBe('abbina:riga-latte');
  });

  it('segna come da controllare la riga con il prezzo ricavato dal conto e quella su cui le due letture divergono', () => {
    const s = leggiScontrino(TESTO);
    const secondo = leggiScontrino(TESTO.replace('1,29', '1,20'));
    const righe = righeDaLettura(s, confrontaLetture(s, secondo), [], indice, nuovoId);
    expect(righe[0].dubbia).toBe('le due letture della foto non coincidono');
    expect(righe[1].dubbia).toBeUndefined();
    const senza = righeDaLettura(s, confrontaLetture(s, null), [], indice, nuovoId);
    expect(senza.every((r) => r.dubbia === undefined)).toBe(true);
  });

  it('una riga della foto con il prezzo letto con poca fiducia è da controllare; il testo incollato no', () => {
    const s = leggiScontrino(TESTO);
    const foto = { ...s, righe: s.righe.map((r, i) => ({ ...r, fiducia: [0.5, SOGLIA_FIDUCIA, 0.99][i] })) };
    expect(foto.righe.map(rigaIncerta)).toEqual([true, false, false]);
    expect(righeDaLettura(foto, confrontaLetture(foto, null), [], indice, nuovoId).map((r) => r.dubbia)).toEqual(['la foto non si legge bene su questa riga', undefined, undefined]);
    expect(righeDaLettura(s, confrontaLetture(s, null), [], indice, nuovoId).every((r) => r.dubbia === undefined)).toBe(true);
  });

  it('se le due letture non coincidono ma il prezzo è letto con sicurezza, a sbagliare è l’altra lettura: la riga non si segnala', () => {
    expect(letturaDiscorde({ descrizione: 'LATTE', prezzo: 1.29 }, false)).toBe(true);
    expect(letturaDiscorde({ descrizione: 'LATTE', prezzo: 1.29, fiducia: 0.9 }, false)).toBe(true);
    expect(letturaDiscorde({ descrizione: 'LATTE', prezzo: 1.29, fiducia: SOGLIA_PREZZO_SICURO }, false)).toBe(false);
    expect(letturaDiscorde({ descrizione: 'LATTE', prezzo: 1.29, fiducia: 0.5 }, true)).toBe(false);
  });

  it('le righe ripetute si uniscono in una sola con «quante»', () => {
    const s = leggiScontrino('IPER\nPETTO POLLO FETTE 300G   3,10\nPETTO POLLO FETTE 300G   3,10\nTOTALE   6,20');
    const righe = righeDaLettura(s, confrontaLetture(s, null), [], indice, nuovoId);
    expect(righe).toHaveLength(1);
    expect(righe[0]).toMatchObject({ quante: '2', euro: '6,20' });
  });
});

describe('riabbina', () => {
  it('cambia solo dove va la riga non toccata; quantità, unità e posto restano', () => {
    const base = proponiRighe([{ id: 'a', riga: { descrizione: 'LATTE INTERO 1L', prezzo: 1.29, formato: { quantita: 1000, unita: 'ml' } } }], [], indice);
    const scritta = { ...base[0], numero: '500', luogo: 'frigo' as const };
    const dopo = riabbina([scritta], [{ id: 'riga-latte', ingrediente_id: 'ing:latte', nome: 'Latte' }], indice);
    expect(dopo[0]).toMatchObject({ azione: 'abbina:riga-latte', numero: '500', luogo: 'frigo' });
  });

  it('le righe toccate dalla persona non si spostano', () => {
    const r = { ...proponiRighe([{ id: 'a', riga: { descrizione: 'LATTE INTERO 1L', prezzo: 1.29 } }], [], indice)[0], auto: false };
    expect(riabbina([r], [{ id: 'x', ingrediente_id: 'ing:latte', nome: 'Latte' }], indice)).toEqual([r]);
  });
});

describe('costruisciImportazione', () => {
  const bozza = (testo = TESTO, extra: Partial<BozzaImportazione> = {}): BozzaImportazione => {
    const s = leggiScontrino(testo);
    return { negozio: ' Rossi ', data: '2026-11-03', ora: '18:30', totale: '3,19', qr: null, testo, righe: righeDaLettura(s, confrontaLetture(s, null), [], indice, nuovoId), ...extra };
  };

  it('costruisce il comando: lotti con quantità e stima di scadenza, solo spesa senza lotto', () => {
    const e = costruisciImportazione(bozza(), nuovoId);
    if (e.errore !== undefined) throw new Error(e.errore);
    expect(e.comando).toMatchObject({ negozio: 'Rossi', data: '2026-11-03', ora: '18:30', totale: 3.19, qr: null });
    const [latte, , shopper] = e.comando.righe as { prezzo: number; nuova: Record<string, unknown> }[];
    expect(latte.nuova).toMatchObject({ ingrediente_id: 'ing:latte', quantita: 1000, unita: 'ml', tipo_data: 'sconosciuta' });
    expect(latte.nuova.lotto_id).toBeTruthy();
    expect(latte.prezzo).toBe(1.29);
    expect(shopper.nuova).toHaveProperty('id');
    expect(shopper.nuova).not.toHaveProperty('lotto_id');
  });

  it('ciò che è fresco (verdura) porta la scadenza stimata dall’app', () => {
    const riga = { ...rigaVuota('a'), azione: 'casa' as const, ing: ing('ing:zucchina'), numero: '3', unita: 'pz' as const, luogo: 'frigo' as const };
    const e = costruisciImportazione(bozza(TESTO, { righe: [riga] }), nuovoId);
    if (e.errore !== undefined) throw new Error(e.errore);
    const { nuova } = e.comando.righe[0] as { nuova: Record<string, unknown> };
    expect(nuova).toMatchObject({ quantita: expect.any(Number), tipo_data: 'stimata', fonte_data: 'app', affidabilita: 'bassa' });
    expect(nuova.data_limite).toMatch(/^2026-11-/);
  });

  it('la riga in casa senza quantità entra «da completare» e si segnala', () => {
    const e = costruisciImportazione(bozza('COOP\nZUCCHINE   1,80\nTOTALE   1,80'), nuovoId);
    if (e.errore !== undefined) throw new Error(e.errore);
    expect(e.mancanti).toEqual([expect.stringMatching(/zucchin/i)]);
    expect((e.comando.righe[0].nuova as Record<string, unknown>).lotto_id).toBeUndefined();
  });

  it('più confezioni uguali: il lotto ricorda quanto contiene una confezione', () => {
    const b = bozza('IPER\nYOGURT BIANCO 125G   0,50\nYOGURT BIANCO 125G   0,50\nTOTALE   1,00');
    expect(b.righe).toHaveLength(1);
    const e = costruisciImportazione(b, nuovoId);
    if (e.errore !== undefined) throw new Error(e.errore);
    expect((e.comando.righe[0] as { nuova: Record<string, unknown> }).nuova).toMatchObject({ quantita: 250, confezione: 125 });
  });

  it('due righe sulla stessa riga già comprata diventano una, con i prezzi sommati', () => {
    const b = bozza('IPER\nPETTO POLLO FETTE   3,10\nPETTO POLLO FETTE   3,20\nTOTALE   6,30', { righe: [] });
    b.righe = [
      { ...rigaVuota('a'), descrizione: 'PETTO POLLO', euro: '3,10', azione: 'abbina:r1' },
      { ...rigaVuota('b'), descrizione: 'PETTO POLLO', euro: '3,20', azione: 'abbina:r1' },
    ];
    const e = costruisciImportazione(b, nuovoId);
    if (e.errore !== undefined) throw new Error(e.errore);
    expect(e.comando.righe).toEqual([{ id: 'a', descrizione: 'PETTO POLLO ×2', prezzo: 6.3, abbina: 'r1' }]);
  });

  it('dice cosa non va, con le stesse frasi della schermata', () => {
    const errore = (b: BozzaImportazione) => costruisciImportazione(b, nuovoId).errore;
    expect(errore(bozza(TESTO, { data: '' }))).toBe('Scrivi la data dello scontrino.');
    expect(errore(bozza(TESTO, { ora: '25:99' }))).toBe('L’ora si scrive come 18:30.');
    expect(errore(bozza(TESTO, { totale: 'abc' }))).toBe('Il totale non è un numero.');
    expect(errore(bozza(TESTO, { righe: [{ ...rigaVuota('a'), descrizione: 'PANE', euro: 'x' }] }))).toBe('Il prezzo di «PANE» non è un numero.');
    expect(errore(bozza(TESTO, { righe: [{ ...rigaVuota('a'), descrizione: 'PANE', azione: 'casa' }] }))).toBe('Scegli cos’è «PANE», oppure segnalo come «solo spesa».');
    expect(errore(bozza(TESTO, { righe: [] }))).toBe('Non ci sono righe da importare.');
    const latte = { ...rigaVuota('a'), azione: 'casa' as const, ing: ing('ing:latte'), numero: 'abc', unita: 'ml' as const };
    expect(errore(bozza(TESTO, { righe: [latte] }))).toBe('Latte: Scrivi una quantità, per esempio 500 o 1,5.');
  });

  it('totale, ora e negozio vuoti diventano null; il testo si taglia a 20000 caratteri', () => {
    const e = costruisciImportazione(bozza(TESTO, { negozio: '  ', ora: '', totale: '', testo: 'x'.repeat(30000) }), nuovoId);
    if (e.errore !== undefined) throw new Error(e.errore);
    expect(e.comando).toMatchObject({ negozio: null, ora: null, totale: null });
    expect(e.comando.testo).toHaveLength(20000);
  });

  it('testoEuro', () => {
    expect([testoEuro(1.5), testoEuro(0), testoEuro(null), testoEuro(undefined)]).toEqual(['1,50', '0,00', '', '']);
  });
});
