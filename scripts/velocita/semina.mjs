/**
 * Banco di prova della velocità: crea sul server di prova (tests/e2e/server-prova.mjs) un utente e una famiglia
 * con N giorni di uso (menu, conferme, casa, spesa), con i comandi veri. Stampa utente e famiglia in JSON.
 *   node scripts/velocita/semina.mjs [giorni=60]
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const SERVER = `http://localhost:${process.env.MC_PORTA_SERVER ?? '14400'}`;
const GIORNI = Number(process.argv[2] ?? 60);
const catalogo = JSON.parse(readFileSync(new URL('../../src/catalogo/catalogo.json', import.meta.url), 'utf8'));
const ricette = catalogo.ricette.map((r) => r.id);
const ingredienti = catalogo.ingredienti.filter((i) => !i.base);

const utente = await (await fetch(`${SERVER}/prova/utente`, { method: 'POST', body: JSON.stringify({ nome: 'Luca' }) })).json();
const famiglia = randomUUID();
let n = 0;
async function applica(tipo, dati) {
  const comando = { id: randomUUID(), famiglia_id: famiglia, tipo, dati, versione_app: 99, dispositivo: 'banco' };
  const r = await fetch(`${SERVER}/rest/v1/rpc/applica_comando`, {
    method: 'POST',
    headers: { authorization: `Bearer ${utente.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ comando }),
  });
  const e = await r.json();
  n++;
  return e;
}
const giorno = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const caso = (a) => a[Math.floor(Math.random() * a.length)];

const e = await applica('crea_famiglia', { nome: 'Casa Prova', membro: { id: randomUUID(), nome: 'Luca', emoji: '🧑' } });
if (e.esito !== 'applicato') throw new Error(JSON.stringify(e));
for (const nome of ['Raffaella', 'Sofia', 'Marco']) await applica('aggiungi_membro', { id: randomUUID(), nome });

const lavori = [];
for (let d = -GIORNI; d <= 7; d++) {
  for (const categoria of ['colazione', 'pranzo', 'cena']) {
    lavori.push(async () => {
      const id = randomUUID();
      await applica('aggiungi_portata', { id, data: giorno(d), categoria, ricetta_id: caso(ricette), porzioni: 4 });
      if (d < 0) await applica('conferma_pasto', { id: randomUUID(), portata_id: id, esito: 'come_previsto' });
    });
  }
  if (d % 3 === 0)
    for (let k = 0; k < 6; k++) {
      const ing = caso(ingredienti);
      const unita = ing.dimensione === 'volume' ? 'ml' : ing.dimensione === 'pezzi' ? 'pz' : 'g';
      lavori.push(() =>
        applica('aggiungi_lotto', { id: randomUUID(), ingrediente_id: ing.id, quantita: unita === 'pz' ? 6 : 500, unita, luogo: caso(['frigo', 'dispensa', 'freezer']), tipo_data: 'scadenza', data_limite: giorno(d + 10), fonte_data: 'confezione' }),
      );
    }
}
// Un po' alla volta, come più telefoni.
while (lavori.length) await Promise.all(lavori.splice(0, 6).map((f) => f()));
const lun = new Date();
lun.setDate(lun.getDate() - ((lun.getDay() + 6) % 7));
const dal = lun.toISOString().slice(0, 10);
await applica('ricalcola_spesa', { dal, al: giorno(7) });
console.log(JSON.stringify({ utente, famiglia, comandi: n }));
