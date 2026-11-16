/**
 * Misura la lettura degli scontrini sul corpus (`tests/scontrini`), a livello di testo: ogni testo già letto
 * (congelato) passa da `leggiScontrino` e dalla conversione in prodotti, e si confronta con la verità riga per riga.
 * È deterministico, quindi serve da freno: nessuna metrica può peggiorare rispetto a `tests/scontrini/base.json`.
 * Chi migliora la lettura aggiorna la base di proposito:
 *
 *   MC_AGGIORNA_BASE=1 npm run valuta:scontrini     riscrive base.json con i numeri di adesso
 *   MC_RAPPORTO=percorso.json npm run valuta:scontrini     salva il rapporto completo (per confrontare le fasi)
 *
 * La lettura dalla foto (PaddleOCR) si misura a parte: scripts/valuta-scontrini/foto.mjs. Vedi docs/valutazione-scontrini.md.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { caricaCorpus, CARTELLA, controllaVerita } from '../../tests/scontrini/carica';
import { Indice } from './ricette';
import { creaRapporto, type Esito, leggiPerValutare, peggiorate, type Rapporto, testoMetrica, valuta } from './valutazione';

const indice = new Indice(catalogo as Catalogo);
const BASE = `${CARTELLA}base.json`;
const corpus = caricaCorpus();

const esiti: Esito[] = corpus.flatMap((c) => c.letture.map((l) => ({ caso: c.verita.id, lettura: l.nome, valutazione: valuta(c.verita, leggiPerValutare(l.testo, indice, c.verita.carrello, l.controllo ?? null)) })));
const rapporto = creaRapporto('testo', process.env.MC_ETICHETTA ?? 'testo', esiti);

describe('corpus degli scontrini: dati di riferimento', () => {
  it('ci sono scontrini veri e sintetici, ognuno con una lettura congelata (o la foto da cui congelarla)', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(8);
    expect(corpus.some((c) => c.verita.origine !== 'sintetico')).toBe(true);
    for (const c of corpus) expect(c.letture.length > 0 || c.foto !== null, c.verita.id).toBe(true);
  });

  it.each(corpus.map((c) => [c.verita.id, c] as const))('%s: la verità è coerente (somme, catalogo, unità)', (id, c) => {
    expect(controllaVerita(c.verita, id, catalogo as Catalogo)).toEqual([]);
  });

  it('la lettura ideale degli scontrini sintetici dà un testo che il lettore riconosce come scontrino', () => {
    for (const c of corpus.filter((x) => x.verita.stampa)) expect(leggiPerValutare(c.letture[0].testo, indice).righe.length, c.verita.id).toBeGreaterThan(0);
  });
});

describe('misura della lettura (testi congelati)', () => {
  it('scrive il rapporto o aggiorna la base se richiesto', () => {
    if (process.env.MC_RAPPORTO) writeFileSync(process.env.MC_RAPPORTO, JSON.stringify(rapporto, null, 1) + '\n');
    if (process.env.MC_AGGIORNA_BASE) writeFileSync(BASE, JSON.stringify({ ...rapporto, etichetta: process.env.MC_ETICHETTA ?? 'base' }, null, 1) + '\n');
    console.info(['', `Scontrini: ${corpus.length}, letture: ${esiti.length}`, ...Object.values(rapporto.sintesi).map((m) => `  ${m.etichetta}: ${testoMetrica(m)}`)].join('\n'));
  });

  it('nessuna metrica peggiora rispetto alla base', () => {
    expect(existsSync(BASE), 'manca tests/scontrini/base.json: MC_AGGIORNA_BASE=1 npm run valuta:scontrini').toBe(true);
    const base = JSON.parse(readFileSync(BASE, 'utf8')) as Rapporto;
    const chiave = (r: { caso: string; lettura: string }) => `${r.caso}/${r.lettura}`;
    // Cambiato il corpus, i numeri non sono più confrontabili: la base va rifatta di proposito.
    expect(rapporto.casi.map(chiave), 'il corpus è cambiato: MC_AGGIORNA_BASE=1 npm run valuta:scontrini').toEqual(base.casi.map(chiave));
    // La stabilità confronta letture di fonti diverse (foto, scatole, ideale): ha senso solo nella misura sulle foto, non qui.
    const senzaStabilita = (s: Rapporto['sintesi']) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'stabilita'));
    expect(peggiorate(senzaStabilita(base.sintesi), senzaStabilita(rapporto.sintesi)), 'metriche peggiorate').toEqual([]);
    const prima = new Map(base.casi.map((c) => [chiave(c), c]));
    const tornatiIndietro = rapporto.casi.filter((c) => prima.get(chiave(c))?.perfetta && !c.perfetta).map(chiave);
    expect(tornatiIndietro, 'letture che erano perfette e non lo sono più').toEqual([]);
    const nonPiuAffidabili = rapporto.casi.filter((c) => prima.get(chiave(c))?.affidabile && !c.affidabile).map(chiave);
    expect(nonPiuAffidabili, 'letture che erano affidabili (ogni errore segnalato) e non lo sono più').toEqual([]);
    const migliorate = Object.entries(rapporto.sintesi).filter(([k, m]) => base.sintesi[k] && testoMetrica(base.sintesi[k]) !== testoMetrica(m));
    if (migliorate.length) console.info(`Metriche cambiate in meglio: ${migliorate.map(([, m]) => m.etichetta).join('; ')}. Aggiorna la base: MC_AGGIORNA_BASE=1 npm run valuta:scontrini`);
  });
});
