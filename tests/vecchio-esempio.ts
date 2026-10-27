/** Un'esportazione del vecchio Mastercook, per i test dell'importazione (src/dati/migrazione.ts). */
const meta = { creato_da: 'm1', creato_il: '2026-09-01T10:00:00Z', modificato_da: 'm1', modificato_il: '2026-09-01T10:00:00Z' };

export function fileVecchio(): unknown {
  return {
    formato: 'masterfood-export',
    versione: 1,
    esportato_il: '2026-10-26T18:00:00.000Z',
    dati: {
      meta: { nucleo: { id: 'nucleo', nome: 'Casa Topsidakis' } },
      membri: {
        m1: { ...meta, id: 'm1', utente_id: 'google-123', nome: 'Luca', anno_nascita: 1985, allergie: [], intolleranze: [], escludi_tracce: false, restrizioni: [], preferenze: { graditi: ['ing:zucchina'], sgraditi: ['ing:fegato_inesistente'] }, fattore_porzione: 1, attivo: true },
        m2: { ...meta, id: 'm2', nome: 'Sara', allergie: ['arachidi', 'latte'], intolleranze: ['Lattosio', 'Nichel di troppo'], escludi_tracce: true, restrizioni: ['vegetariano'], preferenze: { graditi: [], sgraditi: ['ing:funghi'] }, fattore_porzione: 0.6, attivo: true },
        m3: { ...meta, id: 'm3', nome: 'Ospite tolto', allergie: [], intolleranze: [], escludi_tracce: false, restrizioni: [], preferenze: { graditi: [], sgraditi: [] }, fattore_porzione: 1, attivo: true, eliminato_il: '2026-10-01T10:00:00Z' },
      },
      ricette: {
        r1: {
          ...meta,
          id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
          origine: 'personale',
          titolo: 'Torta della nonna',
          portata: 'dolce',
          porzioni_base: 8,
          minuti: 60,
          difficolta: 2,
          allergeni_dichiarati: ['glutine'],
          ingredienti: [
            { ingrediente_id: 'ing:farina', testo: 'Farina', quantita: 300, unita: 'g', scalabile: true, opzionale: false, sostituti: [] },
            { ingrediente_id: 'ing:uova', testo: 'Uova', quantita: 200, unita: 'g', scalabile: true, opzionale: false, sostituti: [] },
            { testo: 'Pinoli della nonna', quantita: 30, unita: 'g', scalabile: true, opzionale: true, sostituti: [] },
            { ingrediente_id: 'ing:sale', testo: 'Sale', scalabile: true, opzionale: false, sostituti: [] },
          ],
          passaggi: ['Impasta.', 'Cuoci 40 minuti.'],
        },
        r2: { ...meta, id: '0190a1b2-c3d4-7e5f-8a9b-000000000002', titolo: 'Senza righe', portata: 'primo', porzioni_base: 2, minuti: 10, difficolta: 1, ingredienti: [], passaggi: ['x'], allergeni_dichiarati: [] },
      },
      ricette_meta: { x: { id: 'x', ricetta_id: 'sys:carbonara', preferita: true } },
      inventario: {
        a1: { ...meta, id: 'a1', nome: 'Latte intero', ingrediente_id: 'ing:latte', unita: 'ml', luogo: 'frigo', stato_conservazione: 'aperto', data_scadenza: '2026-11-05', tipo_scadenza: 'entro', conservare_fino: '2026-10-29', origine: 'barcode', movimenti: [{ delta: 1000, unita: 'ml', membro: 'm1', il: '2026-10-20T10:00:00Z', motivo: 'carico' }, { delta: -250, unita: 'ml', membro: 'm1', il: '2026-10-21T10:00:00Z', motivo: 'consumo' }] },
        a2: { ...meta, id: 'a2', nome: 'Pasta', ingrediente_id: 'ing:pasta', unita: 'g', luogo: 'dispensa', stato_conservazione: 'fresco', data_scadenza: '2027-05-01', tipo_scadenza: 'preferibilmente', origine: 'scontrino', movimenti: [{ delta: 500, unita: 'g', membro: 'm1', il: '2026-10-10T10:00:00Z', motivo: 'carico' }] },
        a3: { ...meta, id: 'a3', nome: 'Finito', ingrediente_id: 'ing:pasta', unita: 'g', luogo: 'dispensa', stato_conservazione: 'fresco', origine: 'manuale', movimenti: [{ delta: 500, unita: 'g', membro: 'm1', il: '2026-10-10T10:00:00Z', motivo: 'carico' }, { delta: -500, unita: 'g', membro: 'm1', il: '2026-10-12T10:00:00Z', motivo: 'consumo' }] },
        a4: { ...meta, id: 'a4', nome: 'Lasagne avanzate', ricetta_id: 'sys:lasagne', unita: 'pz', luogo: 'frigo', stato_conservazione: 'avanzato', conservare_fino: '2026-10-28', origine: 'ricetta', movimenti: [{ delta: 2, unita: 'pz', membro: 'm1', il: '2026-10-26T20:00:00Z', motivo: 'carico' }] },
        a5: { ...meta, id: 'a5', nome: 'Salsa segreta', prodotto_id: 'p1', unita: 'g', luogo: 'frigo', stato_conservazione: 'fresco', origine: 'barcode', movimenti: [{ delta: 190, unita: 'g', membro: 'm1', il: '2026-10-22T10:00:00Z', motivo: 'carico' }] },
        a6: { ...meta, id: 'a6', nome: 'Uova', ingrediente_id: 'ing:uova', unita: 'g', luogo: 'frigo', stato_conservazione: 'fresco', origine: 'manuale', movimenti: [{ delta: 300, unita: 'g', membro: 'm1', il: '2026-10-22T10:00:00Z', motivo: 'carico' }] },
      },
      prodotti_nucleo: { p1: { ...meta, id: 'p1', fonte: 'off', nome: 'Salsa segreta Bio', reparto: 'condimenti', allergeni: ['senape'], tracce: [], additivi: [] } },
      piani: {
        '2026-10-20:cena': { id: '2026-10-20:cena', data: '2026-10-20', tipo: 'cena', membri_presenti: [], portate: [{ ricetta_id: 'sys:carbonara', titolo: 'Carbonara', membri: ['m1', 'm2'] }] },
        '2026-10-28:pranzo': { id: '2026-10-28:pranzo', data: '2026-10-28', tipo: 'pranzo', membri_presenti: [], portate: [{ ricetta_id: 'sys:carbonara', titolo: 'Carbonara', membri: ['m1', 'm2'], porzioni_manuali: 3 }, { titolo: 'Frutta 150 g', membri: ['m1'] }] },
        '2026-10-29:merenda': { id: '2026-10-29:merenda', data: '2026-10-29', tipo: 'merenda', membri_presenti: [], portate: [{ ricetta_id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', titolo: 'Torta della nonna', membri: ['m1', 'm2'] }] },
      },
      liste: { 'lista:corrente': { id: 'lista:corrente' } },
      diete: { 'dieta:m2': { ...meta, id: 'dieta:m2', membro_id: 'm2', note: [], giorni: [], letta_con: 'gemini' } },
    },
    storico: {},
  };
}

