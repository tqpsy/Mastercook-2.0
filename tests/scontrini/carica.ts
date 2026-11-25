/**
 * Carica il corpus degli scontrini (`tests/scontrini/casi/*`) e controlla che i dati di riferimento siano coerenti.
 * Una lettura è un testo, come quello che la schermata «Scontrino» riceve dalla foto. Ogni caso ne ha:
 * - `letture/*.txt`: testi già letti, congelati (da una foto vera o da una prova); `<nome>-controllo.txt` accanto a
 *   `<nome>.txt` è la seconda lettura della stessa foto (il controllo), come la dà `leggiTestoDaFoto`;
 * - `letture/*-scatole.json`: i pezzi di testo di PaddleOCR con la loro posizione, ricomposti come fa l'app;
 * - `letture/*-righe.json`: la lettura scelta di una foto come la dà `leggiTestoDaFoto`, con le righe, la posizione e la fiducia di
 *   ogni pezzo (`righe`) e il controllo: misura anche le righe segnalate perché lette con poca fiducia;
 * - `ideale` (solo scontrini sintetici): il testo che darebbe una lettura perfetta di ciò che è stampato.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Catalogo } from '../../src/catalogo/tipi';
import type { Scatola } from '../../src/dominio/paddle';
import { creaRiga, daScatole, type LetturaGeometrica, type Pezzo, testoDa } from '../../src/dominio/scontrini-geometria';
import { impaginaFoto } from '../../src/dominio/scontrini-impaginazione';
import type { Carico, Verita } from '../../src/dominio/valutazione';

export const CARTELLA = new URL('./', import.meta.url).pathname;

export interface LetturaCongelata {
  nome: string;
  testo: string;
  /** La seconda lettura della stessa foto, se c'è (`<nome>-controllo.txt`). */
  controllo?: string;
  /** Le righe con posizione e fiducia da cui viene `testo` (`<nome>-righe.json`). */
  righe?: LetturaGeometrica;
}
export interface Caso {
  verita: Verita;
  letture: LetturaCongelata[];
  /** Percorso della foto vera del caso (`foto.jpg`…), se c'è. */
  foto: string | null;
}

/** Il testo che darebbe una lettura perfetta di ciò che è stampato: sinistra, tre spazi, destra. */
export function testoIdeale(stampa: NonNullable<Verita['stampa']>): string {
  return stampa.map(([sinistra, destra]) => (destra ? `${sinistra}   ${destra}` : sinistra)).join('\n');
}

/** I pezzi di PaddleOCR → il testo dello scontrino, come in `leggiConPaddle` (src/ui/ocr.ts). */
export function testoDaScatole(file: { larghezza: number; scatole: [string, number, number, number, number][] }): string {
  const scatole: Scatola[] = file.scatole.map(([testo, x0, y0, y1, x1]) => ({ testo, x0, y0, x1, y1, fiducia: 1 }));
  return testoDa(impaginaFoto(daScatole(scatole, file.larghezza))[0]);
}

export function caricaCaso(id: string, radice = join(CARTELLA, 'casi')): Caso {
  const cartella = join(radice, id);
  const verita = JSON.parse(readFileSync(join(cartella, 'verita.json'), 'utf8')) as Verita;
  const letture: LetturaCongelata[] = [];
  if (verita.stampa) letture.push({ nome: 'ideale', testo: testoIdeale(verita.stampa) });
  const dir = join(cartella, 'letture');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).sort()) {
      if (f.endsWith('-righe.json')) {
        // Le righe tengono i pezzi nell'ordine della lettura (un nome abbinato al prezzo è a sinistra anche se il prezzo sta più in alto).
        const file = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { controllo: string | null; righe: Omit<LetturaGeometrica, 'righe'> & { righe: { pezzi: Pezzo[] }[] } };
        const righe: LetturaGeometrica = { ...file.righe, righe: file.righe.righe.map((r) => creaRiga(r.pezzi, false)) };
        letture.push({ nome: f.replace(/\.json$/, ''), testo: testoDa(righe), righe, ...(file.controllo ? { controllo: file.controllo } : {}) });
      } else if (f.endsWith('-scatole.json')) letture.push({ nome: f.replace(/-scatole\.json$/, ''), testo: testoDaScatole(JSON.parse(readFileSync(join(dir, f), 'utf8'))) });
      else if (f.endsWith('.txt') && !f.endsWith('-controllo.txt')) {
        const nome = f.replace(/\.txt$/, '');
        const fileControllo = join(dir, `${nome}-controllo.txt`);
        letture.push({ nome, testo: readFileSync(join(dir, f), 'utf8'), ...(existsSync(fileControllo) ? { controllo: readFileSync(fileControllo, 'utf8') } : {}) });
      }
    }
  }
  const nomeFoto = readdirSync(cartella).find((f) => /^foto\.(jpe?g|png|webp)$/i.test(f));
  return { verita, letture, foto: nomeFoto ? join(cartella, nomeFoto) : null };
}

export function elencoCasi(radice = join(CARTELLA, 'casi')): string[] {
  return readdirSync(radice, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(radice, d.name, 'verita.json')))
    .map((d) => d.name)
    .sort();
}

export const caricaCorpus = (radice?: string): Caso[] => elencoCasi(radice).map((id) => caricaCaso(id, radice));

const UNITA_DI_DIMENSIONE = { massa: 'g', volume: 'ml', pezzi: 'pz' } as const;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** I problemi di un file di verità (vuoto se è coerente). Una verità sbagliata falsa ogni misura: meglio fermarsi qui. */
export function controllaVerita(v: Verita, id: string, catalogo: Catalogo): string[] {
  const p: string[] = [];
  const ing = new Map(catalogo.ingredienti.map((i) => [i.id, i]));
  if (v.versione !== 1) p.push('versione diversa da 1');
  if (v.id !== id) p.push(`id «${v.id}» diverso dalla cartella «${id}»`);
  if (!['scontrino-reale', 'esempio-reale', 'sintetico'].includes(v.origine)) p.push(`origine «${v.origine}» sconosciuta`);
  if (!['carta', 'ricavata', 'costruzione'].includes(v.verita)) p.push(`verita «${v.verita}» sconosciuta`);
  if (v.origine === 'sintetico' && v.verita !== 'costruzione') p.push('uno scontrino sintetico ha verità «costruzione»');
  if (v.origine === 'scontrino-reale' && v.verita !== 'carta') p.push('uno scontrino reale ha verità «carta»: scritta guardando lo scontrino, non l’uscita del lettore');
  if (v.data !== undefined && !DATA.test(v.data)) p.push(`data «${v.data}» non valida`);
  if (v.origine === 'sintetico' && (v.data === undefined || v.totale === undefined)) p.push('uno scontrino sintetico ha data e totale');
  if (v.ora && !/^[0-2]\d:[0-5]\d$/.test(v.ora)) p.push(`ora «${v.ora}» non valida`);
  if (!v.righe.length) p.push('nessuna riga');
  const somma = Math.round(v.righe.reduce((s, r) => s + r.prezzo, 0) * 100) / 100;
  if (v.totale !== undefined && Math.abs(somma - v.totale) > 0.001) p.push(`le righe fanno ${somma} ma il totale è ${v.totale}`);
  const idCarrello = new Set((v.carrello ?? []).map((c) => c.id));
  for (const c of v.carrello ?? []) if (c.ingrediente_id && !ing.has(c.ingrediente_id)) p.push(`carrello: ingrediente «${c.ingrediente_id}» non è nel catalogo`);
  for (const [i, r] of v.righe.entries()) {
    const dove = `riga ${i + 1} «${r.descrizione}»`;
    if (r.prezzo < 0) p.push(`${dove}: prezzo negativo (gli sconti sono già tolti dal prezzo)`);
    const i1 = r.ingrediente ? ing.get(r.ingrediente) : undefined;
    if (r.ingrediente && !i1) p.push(`${dove}: ingrediente «${r.ingrediente}» non è nel catalogo`);
    const carichi: [string, Carico | null | undefined][] = [['carico', r.carico], ['formato', r.formato]];
    for (const [nome, c] of carichi) {
      if (c && !(c.quantita > 0)) p.push(`${dove}: ${nome} con quantità non positiva`);
    }
    if (r.carico && i1 && r.carico.unita !== UNITA_DI_DIMENSIONE[i1.dimensione]) p.push(`${dove}: carico in ${r.carico.unita} ma «${i1.nome}» si conta in ${UNITA_DI_DIMENSIONE[i1.dimensione]}`);
    if (r.carico !== undefined && r.ingrediente === undefined) p.push(`${dove}: il carico si misura solo con l’ingrediente`);
    if (r.abbina && !idCarrello.has(r.abbina)) p.push(`${dove}: abbina «${r.abbina}» non è nel carrello`);
    if (r.abbina !== undefined && !v.carrello) p.push(`${dove}: abbina senza carrello`);
  }
  if (v.origine === 'sintetico' && !v.stampa?.length) p.push('uno scontrino sintetico ha la stampa (serve a disegnarlo e a dare la lettura ideale)');
  return p;
}
