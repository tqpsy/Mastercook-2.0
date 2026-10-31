#!/usr/bin/env node
/**
 * Importazione verificata del catalogo di sistema dal vecchio Mastercook (docs/fase-0/07).
 *
 *   node scripts/importa-catalogo.mjs ../Mastercook
 *
 * Legge (senza modificarlo) il vecchio repository, converte ingredienti e ricette nel formato nuovo,
 * applica le correzioni documentate qui sotto, esegue i controlli e, solo se non ci sono errori,
 * scrive:
 *   - src/catalogo/catalogo.json                       il catalogo usato dall'app;
 *   - supabase/migrations/20261028000100_catalogo.sql  lo stesso catalogo nel database;
 *   - docs/catalogo-rapporto.md                        conteggi, correzioni, avvisi.
 * Con errori scrive solo il rapporto ed esce con codice 1.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runnerImport } from 'vite';

const RADICE = resolve(import.meta.dirname, '..');
const VECCHIO = resolve(process.argv[2] ?? join(RADICE, '..', 'Mastercook'));
const VERSIONE_CATALOGO = 1;

async function carica(percorso) {
  const { module } = await runnerImport(percorso, { configFile: false, root: VECCHIO, logLevel: 'error' });
  return module;
}

/**
 * Correzioni note, applicate in modo esplicito e riportate nel rapporto.
 * Ognuna dice cosa cambia e perché; nessuna inventa quantità.
 */
const CORREZIONI_RIGHE = [
  // Esempio di forma: { ricetta: 'sys:x', ingrediente: 'ing:y', quantita: 2, perche: '…' }
];

const { INGREDIENTI } = await carica(join(VECCHIO, 'src/rif/ingredienti.ts'));
const { RICETTE_SISTEMA } = await carica(join(VECCHIO, 'src/rif/ricette.ts'));
const { REPARTI } = await carica(join(VECCHIO, 'src/rif/reparti.ts'));
const { REGOLE_CONSERVAZIONE } = await carica(join(VECCHIO, 'src/rif/conservazione.ts'));
const { CUCINE } = await carica(join(VECCHIO, 'src/rif/ricetteBase.ts'));
const { emojiIngrediente, emojiReparto } = await carica(join(VECCHIO, 'src/rif/emoji.ts'));
const { controllaCatalogo, allergeniDagliIngredienti } = (await runnerImport(join(RADICE, 'src/catalogo/controlli.ts'), { configFile: false, root: RADICE, logLevel: 'error' })).module;

let commit = 'sconosciuto';
try {
  commit = execFileSync('git', ['-C', VECCHIO, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  // Cartella senza git: resta «sconosciuto» nel rapporto.
}

const DIMENSIONE = { g: 'massa', ml: 'volume', pz: 'pezzi' };
const correzioniFatte = [];

const ingredienti = INGREDIENTI.map((i) => ({
  id: i.id,
  nome: i.nome,
  sinonimi: [...(i.sinonimi ?? [])],
  reparto: i.reparto,
  sottocategoria: i.sottocategoria ?? null,
  dimensione: DIMENSIONE[i.unita] ?? i.unita,
  luogo: i.luogo,
  giorni: i.giorni,
  allergeni: [...(i.allergeni ?? [])],
  classi: [...(i.classi ?? [])],
  genitore: i.genitore ?? null,
  base: Boolean(i.base),
  mesi: i.mesi ? [...i.mesi] : null,
  peso_pz: i.peso_pz ?? null,
  emoji: emojiIngrediente(i.id),
}));
// Ingrediente nuovo di Mastercook 2.0 (Fase 5): le porzioni avanzate di un piatto, in casa come lotti.
// Nel database lo inserisce la migrazione 20261101000000_consumi.sql.
ingredienti.push({
  id: 'ing:avanzo',
  nome: 'Avanzo',
  sinonimi: ['avanzi', 'piatto avanzato', 'porzione avanzata'],
  reparto: 'gastronomia',
  sottocategoria: 'Avanzi',
  dimensione: 'pezzi',
  luogo: 'frigo',
  giorni: 2,
  allergeni: [],
  classi: [],
  genitore: null,
  base: false,
  mesi: null,
  peso_pz: null,
  emoji: '🥡',
});

const ricette = RICETTE_SISTEMA.map((r) => ({
  id: r.id,
  titolo: r.titolo,
  categoria: r.portata,
  cucina: r.cucina ?? 'italiana',
  provenienza: r.provenienza ?? null,
  porzioni: r.porzioni_base,
  minuti_totali: r.minuti,
  difficolta: r.difficolta,
  conservazione: r.categoria_conservazione ?? null,
  mesi: r.mesi_stagione ? [...r.mesi_stagione] : null,
  allergeni_dichiarati: [...(r.allergeni_dichiarati ?? [])],
  ingredienti: r.ingredienti.map((g) => {
    const c = CORREZIONI_RIGHE.find((x) => x.ricetta === r.id && x.ingrediente === g.ingrediente_id);
    if (c) correzioniFatte.push({ ...c, prima: g.quantita });
    const quantita = c ? c.quantita : (g.quantita ?? null);
    return {
      ingrediente_id: g.ingrediente_id,
      quantita,
      unita: g.unita,
      qb: quantita === null,
      opzionale: Boolean(g.opzionale),
      testo: g.testo,
    };
  }),
  passi: [...r.passaggi],
}));
// Ricette di sistema nate in Mastercook 2.0 (pizze bianche, peperoni e zucchine ripieni di carne, 31/10/2026): non
// vengono dal vecchio repository. Nel database le caricano le migrazioni 20261115000000_pizze.sql e 20261115000100_verdure_ripiene_carne.sql.
ricette.push(...JSON.parse(readFileSync(join(RADICE, 'src', 'catalogo', 'ricette-nuove.json'), 'utf8')).ricette);

const catalogo = {
  versione: VERSIONE_CATALOGO,
  origine: `tqpsy/Mastercook@${commit}`,
  reparti: REPARTI.map((r) => ({ id: r.id, nome: r.nome, emoji: emojiReparto(r.id) })),
  cucine: CUCINE.map((x) => ({ id: x.id, nome: x.nome, bandiera: x.bandiera })),
  regole_cotti: REGOLE_CONSERVAZIONE.map((r) => ({ id: r.id, nome: r.nome, consigliati: r.consigliati, massimo: r.massimo, rischio: r.rischio })),
  ingredienti,
  ricette,
};

const { errori, avvisi } = controllaCatalogo(catalogo);

// ───────── Rapporto ─────────
const perCategoria = Object.entries(ricette.reduce((a, r) => ({ ...a, [r.categoria]: (a[r.categoria] ?? 0) + 1 }), {}))
  .sort((a, b) => b[1] - a[1])
  .map(([k, n]) => `${k} ${n}`)
  .join(', ');
const perCucina = Object.entries(ricette.reduce((a, r) => ({ ...a, [r.cucina]: (a[r.cucina] ?? 0) + 1 }), {}))
  .map(([k, n]) => `${k} ${n}`)
  .join(', ');
const allergeniAggiunti = ricette.filter((r) => [...allergeniDagliIngredienti(catalogo, r.id)].some((a) => !r.allergeni_dichiarati.includes(a))).length;
const elenco = (xs) => (xs.length ? xs.map((p) => `- \`${p.dove}\`: ${p.cosa}`).join('\n') : '- nessuno');

const rapporto = `# Rapporto d'importazione del catalogo

Generato da \`scripts/importa-catalogo.mjs\` leggendo \`${catalogo.origine}\` (solo lettura).
Catalogo versione ${VERSIONE_CATALOGO}.

## Esito

**${errori.length ? `${errori.length} errori bloccanti: nulla è stato scritto` : '0 errori bloccanti'}** · ${avvisi.length} avvisi da guardare.

## Conteggi

- Ingredienti: ${ingredienti.length} (${ingredienti.filter((i) => i.base).length} di dispensa di base), in ${catalogo.reparti.length} reparti.
- Ricette: ${ricette.length}. Per categoria: ${perCategoria}. Per cucina: ${perCucina}.
- Righe d'ingrediente: ${ricette.reduce((n, r) => n + r.ingredienti.length, 0)}, di cui q.b. ${ricette.reduce((n, r) => n + r.ingredienti.filter((g) => g.qb).length, 0)}.
- Regole di conservazione dei cotti: ${catalogo.regole_cotti.length}, **indicative, da validare** con un professionista.
- Ricette i cui allergeni dagli ingredienti aggiungono qualcosa ai dichiarati: ${allergeniAggiunti}. Nell'app valgono sempre dichiarati ∪ ingredienti.

## Correzioni applicate

${correzioniFatte.length ? correzioniFatte.map((c) => `- \`${c.ricetta}\` → \`${c.ingrediente}\`: ${c.prima} → ${c.quantita}. ${c.perche}`).join('\n') : '- nessuna: le voci segnalate in Fase 0 (capsule di caffè, ostriche) sono già a pezzi nel vecchio catalogo e nessuna ricetta le usa in grammi.'}

## Errori bloccanti

${elenco(errori)}

## Avvisi

${elenco(avvisi)}

## Cosa non è stato importato

- Prodotti del vecchio catalogo (marche, formati, codici a barre): servono alla spesa, Fase 4.
- Gruppi alimentari della dieta e sinonimi Open Food Facts: fuori dal perimetro della Fase 2.
`;

writeFileSync(join(RADICE, 'docs', 'catalogo-rapporto.md'), rapporto);
if (errori.length) {
  console.error(`${errori.length} errori bloccanti: vedi docs/catalogo-rapporto.md`);
  process.exit(1);
}

writeFileSync(join(RADICE, 'src', 'catalogo', 'catalogo.json'), `${JSON.stringify(catalogo, null, 1)}\n`);

const json = JSON.stringify(catalogo);
if (json.includes('$catalogo$')) throw new Error('Il catalogo contiene il delimitatore SQL');
const sql = `-- Mastercook 2.0 · catalogo di sistema, versione ${VERSIONE_CATALOGO}.
-- GENERATO da scripts/importa-catalogo.mjs da ${catalogo.origine}: non modificare a mano.
-- Rapporto dei controlli: docs/catalogo-rapporto.md. È lo stesso contenuto di src/catalogo/catalogo.json.

select interno.carica_catalogo($catalogo$${json}$catalogo$::jsonb);
`;
writeFileSync(join(RADICE, 'supabase', 'migrations', '20261028000100_catalogo.sql'), sql);
console.log(`Catalogo scritto: ${ingredienti.length} ingredienti, ${ricette.length} ricette, ${avvisi.length} avvisi.`);
