/**
 * Scenari di sincronizzazione della sezione 19 del prompt e del piano di test (T-SYN),
 * con dispositivi simulati su un Postgres vero.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Banco, creaFamiglia, nuovoBanco } from '../db/banco';
import { vistaConAnteprima } from '../../src/dati/anteprima';
import { casuale, dispositivo, statoLocale, statoServer } from './dispositivi';

let banco: Banco;
beforeAll(async () => {
  banco = await nuovoBanco();
});
afterAll(async () => {
  await banco.chiudi();
});

async function famigliaConDue() {
  const luca = await banco.utente();
  const { famiglia, membro } = await creaFamiglia(luca);
  return { luca, famiglia, membro, a: dispositivo(luca, famiglia, 'telefono'), b: dispositivo(luca, famiglia, 'tablet') };
}

describe('sincronizzazione tra dispositivi', () => {
  it('T-SYN-1/2: A e B, offline, aggiungono cose diverse; dopo la sincronizzazione entrambi le hanno tutte', async () => {
    const { famiglia, a, b, membro } = await famigliaConDue();
    await a.sync.sincronizza();
    await b.sync.sincronizza();
    a.rete.accesa = false;
    b.rete.accesa = false;
    await a.sync.accoda('aggiungi_vincolo', { id: randomUUID(), membro_id: membro, tipo: 'allergia', oggetto: 'all:glutine' });
    await b.sync.accoda('aggiungi_vincolo', { id: randomUUID(), membro_id: membro, tipo: 'allergia', oggetto: 'all:sesamo' });
    await a.sync.accoda('aggiungi_membro', { id: randomUUID(), nome: 'Sara' });
    await b.sync.accoda('aggiungi_membro', { id: randomUUID(), nome: 'Marco' });
    await a.sync.sincronizza();
    expect(a.sync.leggiStato()).toMatchObject({ in_attesa: 2, senza_rete: true });

    a.rete.accesa = true;
    b.rete.accesa = true;
    await Promise.all([a.sync.sincronizza(), b.sync.sincronizza()]);
    await a.sync.sincronizza();

    const server = await statoServer(banco, famiglia);
    expect(await statoLocale(a, famiglia)).toEqual(server);
    expect(await statoLocale(b, famiglia)).toEqual(server);
    const nomi = Object.values(server).filter((r) => r.nome && !('membro_id' in r) && !('impostazioni' in r)).map((r) => r.nome);
    expect(nomi.sort()).toEqual(['Luca', 'Marco', 'Sara']);
    const allergie = Object.values(server).filter((r) => r.oggetto).map((r) => r.oggetto);
    expect(allergie.sort()).toEqual(['all:glutine', 'all:sesamo']);
  });

  it('T-SYN-3: la risposta si perde e il dispositivo ritenta 5 volte: un solo effetto', async () => {
    const { famiglia, a } = await famigliaConDue();
    const id = randomUUID();
    await a.sync.accoda('aggiungi_membro', { id, nome: 'Sara' });
    a.rete.guasti = { perdiRisposta: 1 };
    for (let i = 0; i < 5; i++) expect(await a.sync.invia()).toBe('rete');
    a.rete.guasti = {};
    expect(await a.sync.invia()).toBe('vuota');
    expect((await banco.sql('select count(*)::int as n from membro where id = $1', [id]))[0].n).toBe(1);
    expect((await banco.sql('select count(*)::int as n from comando where famiglia_id = $1 and tipo = $2', [famiglia, 'aggiungi_membro']))[0].n).toBe(1);
  });

  it('T-SYN-3: richieste duplicate dalla rete non raddoppiano nulla', async () => {
    const { famiglia, a } = await famigliaConDue();
    a.rete.guasti = { duplica: 1 };
    for (let i = 0; i < 5; i++) await a.sync.accoda('aggiungi_membro', { id: randomUUID(), nome: `M${i}` });
    await a.sync.sincronizza();
    expect((await banco.sql('select count(*)::int as n from membro where famiglia_id = $1', [famiglia]))[0].n).toBe(6);
  });

  it("T-SYN-4: un'interruzione durante il salvataggio locale non lascia la copia a metà né avanza il cursore", async () => {
    const { famiglia, a, luca } = await famigliaConDue();
    for (let i = 0; i < 6; i++) await luca.applica({ id: randomUUID(), famiglia_id: famiglia, tipo: 'aggiungi_membro', dati: { id: randomUUID(), nome: `M${i}` }, versione_app: 1 });
    const originale = a.archivio.righe.bulkPut.bind(a.archivio.righe);
    let chiamate = 0;
    a.archivio.righe.bulkPut = (async (...args: Parameters<typeof originale>) => {
      chiamate++;
      await originale(...args);
      throw new Error('batteria scarica');
    }) as unknown as typeof originale;
    await expect(a.sync.scarica()).rejects.toThrow('batteria scarica');
    expect(chiamate).toBe(1);
    expect(await a.archivio.righe.count()).toBe(0);
    expect(await a.archivio.cursore(famiglia)).toBe(0);

    a.archivio.righe.bulkPut = originale;
    expect(await a.sync.scarica()).toBe('aggiornato');
    expect(await statoLocale(a, famiglia)).toEqual(await statoServer(banco, famiglia));
  });

  it('T-SYN-4: rete che cade a metà dello scarico a pagine: si riprende senza buchi', async () => {
    const luca = await banco.utente();
    const { famiglia } = await creaFamiglia(luca);
    for (let i = 0; i < 12; i++) await luca.applica({ id: randomUUID(), famiglia_id: famiglia, tipo: 'aggiungi_membro', dati: { id: randomUUID(), nome: `M${i}` }, versione_app: 1 });
    const a = dispositivo(luca, famiglia, 'telefono', { limitePagina: 4, caso: casuale(7) });
    a.rete.guasti = { perdiRisposta: 0.5 };
    let giri = 0;
    while ((await a.sync.scarica()) !== 'aggiornato') giri++;
    expect(giri).toBeGreaterThan(0);
    expect(await statoLocale(a, famiglia)).toEqual(await statoServer(banco, famiglia));
  });

  it('T-SYN-5: un\'app non aggiornata si ferma senza perdere la coda e riparte dopo l\'aggiornamento', async () => {
    const luca = await banco.utente();
    const { famiglia } = await creaFamiglia(luca);
    const a = dispositivo(luca, famiglia, 'telefono');
    await banco.sql('update compatibilita set versione_minima_app = 2');
    try {
      const id = randomUUID();
      await a.sync.accoda('aggiungi_membro', { id, nome: 'Sara' });
      expect(await a.sync.invia()).toBe('bloccata');
      expect(a.sync.leggiStato()).toMatchObject({ bloccato: 'app_da_aggiornare', in_attesa: 1 });
      expect((await banco.sql('select count(*)::int as n from membro where id = $1', [id]))[0].n).toBe(0);
      a.sync.sblocca(2);
      expect(await a.sync.invia()).toBe('vuota');
      expect((await banco.sql('select count(*)::int as n from membro where id = $1', [id]))[0].n).toBe(1);
    } finally {
      await banco.sql('update compatibilita set versione_minima_app = 1');
    }
  });

  it('T-SYN-6/8: un conflitto finisce in «da sistemare» con il valore attuale e si può correggere o scartare', async () => {
    const { famiglia, a, b, membro } = await famigliaConDue();
    await a.sync.accoda('modifica_membro', { id: membro, versione_attesa: 1, campi: { nome: 'Luca A' } });
    await b.sync.accoda('modifica_membro', { id: membro, versione_attesa: 1, campi: { nome: 'Luca B' } });
    await a.sync.sincronizza();
    await b.sync.sincronizza();
    expect(b.sync.leggiStato()).toMatchObject({ in_attesa: 0, da_sistemare: 1 });
    const [voce] = await b.sync.voci();
    expect(voce.esito?.dettaglio).toMatchObject({ motivo: 'stesso_campo', campi: [{ campo: 'nome', valore_attuale: 'Luca A' }] });

    // L'utente sceglie di tenere il suo valore: nuovo comando con la versione aggiornata.
    const [riga] = await banco.sql('select versione from membro where id = $1', [membro]);
    await b.sync.sostituisci(voce.id, { id: membro, versione_attesa: riga.versione, campi: { nome: 'Luca B' } });
    await b.sync.sincronizza();
    expect(b.sync.leggiStato()).toMatchObject({ in_attesa: 0, da_sistemare: 0 });
    expect((await banco.sql('select nome from membro where id = $1', [membro]))[0].nome).toBe('Luca B');

    // Un altro conflitto, questa volta scartato.
    await a.sync.accoda('modifica_membro', { id: membro, versione_attesa: 1, campi: { nome: 'Vecchio' } });
    await a.sync.sincronizza();
    const [daScartare] = await a.sync.voci();
    await a.sync.scarta(daScartare.id);
    expect(a.sync.leggiStato().da_sistemare).toBe(0);
    await a.sync.sincronizza();
    expect(await statoLocale(a, famiglia)).toEqual(await statoServer(banco, famiglia));
  });

  it('la stessa persona cambia due volte lo stesso campo prima dello scarico: nessun falso conflitto', async () => {
    const { famiglia, a, membro } = await famigliaConDue();
    await a.sync.sincronizza();
    // La vista mostra ancora la versione 1 finché lo scarico non arriva: tutti i tocchi partono da lì.
    await a.sync.accoda('modifica_membro', { id: membro, versione_attesa: 1, campi: { porzione: 2 } });
    expect(await a.sync.invia()).toBe('vuota');
    await a.sync.accoda('modifica_membro', { id: membro, versione_attesa: 1, campi: { porzione: 1 } });
    await a.sync.accoda('modifica_membro', { id: membro, versione_attesa: 1, campi: { porzione: 0.5 } });
    await a.sync.sincronizza();
    expect(a.sync.leggiStato()).toMatchObject({ in_attesa: 0, da_sistemare: 0 });
    expect(Number((await banco.sql('select porzione from membro where id = $1', [membro]))[0].porzione)).toBe(0.5);
    expect(await statoLocale(a, famiglia)).toEqual(await statoServer(banco, famiglia));

    // Scarico già arrivato ma schermata non ancora ridisegnata: il tocco parte dalla versione vecchia.
    const [vecchia] = await banco.sql('select versione from membro where id = $1', [membro]);
    await a.sync.accoda('modifica_membro', { id: membro, versione_attesa: vecchia.versione, campi: { porzione: 2 } });
    await a.sync.sincronizza();
    await a.sync.accoda('modifica_membro', { id: membro, versione_attesa: vecchia.versione, campi: { porzione: 0.5 } });
    await a.sync.sincronizza();
    expect(a.sync.leggiStato()).toMatchObject({ in_attesa: 0, da_sistemare: 0 });

    // Anche offline: i comandi in coda si aggiornano uno dopo l'altro mentre partono.
    a.rete.accesa = false;
    const [riga] = await banco.sql('select versione from membro where id = $1', [membro]);
    for (const porzione of [1, 1.5, 1]) await a.sync.accoda('modifica_membro', { id: membro, versione_attesa: riga.versione, campi: { porzione } });
    a.rete.accesa = true;
    await a.sync.sincronizza();
    expect(a.sync.leggiStato()).toMatchObject({ in_attesa: 0, da_sistemare: 0 });
    expect(Number((await banco.sql('select porzione from membro where id = $1', [membro]))[0].porzione)).toBe(1);
  });

  it('una modifica di un altro dispositivo in mezzo resta un conflitto vero', async () => {
    const { a, b, membro } = await famigliaConDue();
    await a.sync.sincronizza();
    await b.sync.sincronizza();
    await a.sync.accoda('modifica_membro', { id: membro, versione_attesa: 1, campi: { note: 'da A' } });
    await b.sync.accoda('modifica_membro', { id: membro, versione_attesa: 1, campi: { porzione: 2 } });
    await b.sync.invia();
    expect(await a.sync.invia()).toBe('vuota');
    // A cambia ora la porzione partendo dalla versione 1: non ha visto quella di B.
    await a.sync.accoda('modifica_membro', { id: membro, versione_attesa: 1, campi: { porzione: 1.5 } });
    await a.sync.sincronizza();
    expect(a.sync.leggiStato()).toMatchObject({ da_sistemare: 1 });
    const voce = (await a.sync.voci()).find((v) => v.stato === 'da_sistemare');
    expect(voce?.esito?.dettaglio).toMatchObject({ motivo: 'stesso_campo', campi: [{ campo: 'porzione', valore_attuale: 2 }] });
  });

  it('T-SYN-9: tre giorni offline con 40 comandi: partono in ordine al ritorno della rete', async () => {
    const { famiglia, a, membro } = await famigliaConDue();
    a.rete.accesa = false;
    const ids: string[] = [];
    for (let i = 0; i < 40; i++) {
      const id = randomUUID();
      ids.push(id);
      await a.sync.accoda('aggiungi_vincolo', { id, membro_id: membro, tipo: 'esigenza', oggetto: `ing:voce_${i}` });
    }
    await a.sync.sincronizza();
    expect(a.sync.leggiStato().in_attesa).toBe(40);
    a.rete.accesa = true;
    await a.sync.sincronizza();
    const ordine = await banco.sql('select id from vincolo_alimentare where famiglia_id = $1 order by seq', [famiglia]);
    expect(ordine.map((r) => r.id)).toEqual(ids);
    expect(a.sync.leggiStato()).toMatchObject({ in_attesa: 0, da_sistemare: 0 });
  });

  it("la coda sopravvive alla chiusura dell'app", async () => {
    const { famiglia, a } = await famigliaConDue();
    a.rete.accesa = false;
    const id = randomUUID();
    await a.sync.accoda('aggiungi_membro', { id, nome: 'Sara' });
    const riaperto = a.riavvia();
    riaperto.rete.accesa = true;
    await riaperto.sync.sincronizza();
    expect((await banco.sql('select count(*)::int as n from membro where id = $1', [id]))[0].n).toBe(1);
    expect(await statoLocale(riaperto, famiglia)).toEqual(await statoServer(banco, famiglia));
  });

  it('chi viene tolto dalla famiglia si ferma: non legge più nulla', async () => {
    const { famiglia, luca } = await famigliaConDue();
    const inv = await luca.applica({ id: randomUUID(), famiglia_id: famiglia, tipo: 'crea_invito', dati: { id: randomUUID() }, versione_app: 1 });
    const sara = await banco.utente();
    await sara.entra({ id: randomUUID(), famiglia_id: randomUUID(), tipo: 'entra_con_invito', dati: { codice: inv.dettaglio.codice, membro: { id: randomUUID(), nome: 'Sara' } }, versione_app: 1 });
    const s = dispositivo(sara, famiglia, 'telefono-sara');
    expect(await s.sync.scarica()).toBe('aggiornato');
    const [accesso] = await banco.sql('select id from utente_famiglia where utente_id = $1', [sara.id]);
    await luca.applica({ id: randomUUID(), famiglia_id: famiglia, tipo: 'rimuovi_accesso', dati: { id: accesso.id }, versione_app: 1 });
    expect(await s.sync.scarica()).toBe('bloccata');
    expect(s.sync.leggiStato().bloccato).toBe('non_autorizzato');
  });
});

describe('T-SYN-11: prova casuale con tre dispositivi e rete instabile', () => {
  for (const seme of [1, 2, 3]) {
    it(`seme ${seme}: alla fine tutte le copie sono uguali al server e ogni comando ha un esito`, async () => {
      const luca = await banco.utente();
      const { famiglia, membro } = await creaFamiglia(luca);
      const caso = casuale(seme);
      const disp = ['telefono', 'tablet', 'telefono2'].map((n) => dispositivo(luca, famiglia, n, { caso, limitePagina: 7 }));
      const membri = [membro];
      const accodati: string[] = [];

      for (let passo = 0; passo < 150; passo++) {
        const d = disp[Math.floor(caso() * disp.length)];
        d.rete.accesa = caso() > 0.2;
        d.rete.guasti = { perdiRichiesta: 0.1, perdiRisposta: 0.15, duplica: 0.1 };
        const r = caso();
        if (r < 0.3) {
          const id = randomUUID();
          membri.push(id);
          accodati.push(await d.sync.accoda('aggiungi_membro', { id, nome: `P${passo}` }));
        } else if (r < 0.55) {
          const bersaglio = membri[Math.floor(caso() * membri.length)];
          const locale = (await d.archivio.righeDi(famiglia, 'membro')).find((m) => m.id === bersaglio);
          accodati.push(
            await d.sync.accoda('modifica_membro', {
              id: bersaglio,
              versione_attesa: locale?.versione ?? 1,
              campi: caso() < 0.5 ? { porzione: Math.round(caso() * 20 + 5) / 10 } : { note: `nota ${passo}` },
            }),
          );
        } else if (r < 0.75) {
          const bersaglio = membri[Math.floor(caso() * membri.length)];
          accodati.push(await d.sync.accoda('aggiungi_vincolo', { id: randomUUID(), membro_id: bersaglio, tipo: 'allergia', oggetto: `all:a${Math.floor(caso() * 5)}` }));
        } else {
          await d.sync.sincronizza();
        }
      }

      // Rete di nuovo buona: ognuno svuota la coda, poi tutti riscaricano.
      for (const d of disp) {
        d.rete.accesa = true;
        d.rete.guasti = {};
      }
      for (const d of disp) await d.sync.sincronizza();
      for (const d of disp) await d.sync.scarica();

      const server = await statoServer(banco, famiglia);
      for (const d of disp) {
        expect(await statoLocale(d, famiglia)).toEqual(server);
        expect(d.sync.leggiStato().in_attesa).toBe(0);
      }
      // Ogni comando accodato è applicato sul server oppure è visibile come «da sistemare».
      const registrati = new Set((await banco.sql('select id from comando where famiglia_id = $1', [famiglia])).map((r) => r.id));
      const daSistemare = new Set((await Promise.all(disp.map((d) => d.sync.voci()))).flat().map((v) => v.id));
      for (const id of accodati) expect(registrati.has(id)).toBe(true);
      for (const id of daSistemare) {
        const [c] = await banco.sql('select esito from comando where id = $1', [id]);
        expect(c.esito).not.toBe('applicato');
      }
      // Nessun membro doppio.
      const doppi = await banco.sql('select id, count(*) from membro where famiglia_id = $1 group by id having count(*) > 1', [famiglia]);
      expect(doppi).toEqual([]);
    });
  }

  it('una ricetta con una foto nuova parte solo dopo che la foto è nel deposito', async () => {
    const { famiglia, a } = await famigliaConDue();
    await a.sync.sincronizza();
    const id = randomUUID();
    const percorso = `${famiglia}/${randomUUID()}.jpg`;
    await a.archivio.foto.put({ percorso, famiglia_id: famiglia, file: new Blob(['jpeg']), caricata: false });
    await a.sync.accoda('salva_ricetta', {
      id,
      nuova: true,
      campi: { titolo: 'Torta della nonna', categoria: 'dolce', porzioni: 8, foto: percorso },
      ingredienti: { aggiungi: [{ id: randomUUID(), ingrediente_id: 'ing:farina', quantita: 300, unita: 'g', qb: false, opzionale: false, ordine: 0 }] },
      passi: { aggiungi: [{ id: randomUUID(), ordine: 0, testo: 'Impasta e cuoci.' }] },
    });

    a.rete.fotoGuaste = true;
    const prima = a.rete.richieste;
    expect(await a.sync.invia()).toBe('rete');
    expect(a.rete.richieste).toBe(prima);
    expect(await banco.sql('select count(*)::int as n from ricetta where id = $1', [id])).toEqual([{ n: 0 }]);

    a.rete.fotoGuaste = false;
    expect(await a.sync.invia()).toBe('vuota');
    expect(a.rete.foto).toEqual([{ percorso, dopo: prima }]);
    expect(await banco.sql('select foto from ricetta where id = $1', [id])).toEqual([{ foto: percorso }]);
    expect((await a.archivio.foto.get(percorso))?.caricata).toBe(true);
  });

  it('un comando applicato resta nell’anteprima finché lo scarico non porta le sue righe: nessun ritorno indietro a metà', async () => {
    const { a, famiglia } = await famigliaConDue();
    await a.sync.sincronizza();
    const id = randomUUID();
    await a.sync.accoda('aggiungi_membro', { id, nome: 'Sara' });
    const vista = async () => {
      const righe = { membro: await a.archivio.righeDi(famiglia, 'membro') };
      return (vistaConAnteprima(righe, await a.sync.voci()).membro ?? []).some((m) => m.id === id);
    };
    expect(await a.sync.invia()).toBe('vuota');
    // Applicato sul server ma non ancora scaricato: si vede ancora (dall'anteprima), e non risulta «in attesa».
    expect((await a.sync.voci()).map((v) => v.stato)).toEqual(['inviata']);
    expect(a.sync.leggiStato().in_attesa).toBe(0);
    expect(await vista()).toBe(true);
    // Se lo scarico fallisce resta com'è; quando riesce, le righe vere prendono il posto dell'anteprima.
    a.rete.accesa = false;
    expect(await a.sync.scarica()).toBe('rete');
    expect(await vista()).toBe(true);
    a.rete.accesa = true;
    expect(await a.sync.scarica()).toBe('aggiornato');
    expect(await a.sync.voci()).toEqual([]);
    expect(await vista()).toBe(true);
  });
});
