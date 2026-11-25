/**
 * La testata di uno scontrino: negozio, data e ora. Il negozio è la ragione sociale o la prima riga che sembra un nome;
 * la data è quella dello scontrino, non la validità di un'offerta o la scadenza della tessera.
 */
import { DA_SALTARE, IMPORTO } from './scontrini-righe';

/** Ragione sociale nell'intestazione: il nome del negozio più affidabile. */
const SOCIETA = /\b(S\.?\s?P\.?\s?A|S\.?\s?R\.?\s?L|S\.?\s?N\.?\s?C|S\.?\s?A\.?\s?S|SOC\.?\s?COOP|COOP)\b\.?/;

const DATA = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g;
/** Righe con una data che non è quella dello scontrino. */
const DATA_DI_ALTRO = /\b(VALID[AOI]?|SCAD\w*|FINO AL|ENTRO|DAL)\b/i;

function giornoValido(m: RegExpMatchArray): string | null {
  const g = Number(m[1]);
  const mese = Number(m[2]);
  const anno = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (g < 1 || g > 31 || mese < 1 || mese > 12 || anno < 2000 || anno > 2099) return null;
  const d = new Date(Date.UTC(anno, mese - 1, g));
  if (d.getUTCDate() !== g) return null;
  return `${anno}-${String(mese).padStart(2, '0')}-${String(g).padStart(2, '0')}`;
}

/**
 * Data e ora dello scontrino. Prima si cerca una data con l'ora accanto («02-11-2026 18:41»): un'ora da sola
 * può essere altro (l'orologio del telefono in uno screenshot, gli orari del negozio).
 */
function dataOraDa(grezzo: string): { data: string | null; ora: string | null } {
  // La lettura perde lo spazio tra data e ora («02-11-202618:41»).
  const testo = grezzo.replace(/(\b\d{1,2}[/.-]\d{1,2}[/.-]20\d{2})(?=[0-2]\d[:.][0-5]\d\b)/g, '$1 ');
  for (const m of testo.matchAll(new RegExp(`${DATA.source}\\s+([01]?\\d|2[0-3])[:.]([0-5]\\d)\\b`, 'g'))) {
    const data = giornoValido(m);
    if (data) return { data, ora: `${m[4].padStart(2, '0')}:${m[5]}` };
  }
  let data: string | null = null;
  // Senza un'ora accanto, la prima data: ma non quella di una riga che parla d'altro (validità di un'offerta, scadenza della tessera).
  for (const linea of testo.split('\n').filter((l) => !DATA_DI_ALTRO.test(l))) {
    for (const m of linea.matchAll(DATA)) {
      data = giornoValido(m);
      if (data) break;
    }
    if (data) break;
  }
  const ora = testo.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return { data, ora: ora ? `${ora[1].padStart(2, '0')}:${ora[2]}` : null };
}

const nomeProprio = (l: string) =>
  l
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|[\s'.-])\p{L}/gu, (x) => x.toUpperCase())
    .slice(0, 80);

function negozioDa(linee: string[]): string | null {
  const intestazione = linee.slice(0, 15);
  // La ragione sociale («IPER MONTEBELLO S.P.A.») è quasi sempre il nome giusto.
  const societa = intestazione.find((l) => SOCIETA.test(l) && !IMPORTO.test(l) && !/^(VIA|CORSO|PIAZZA|V\.LE)\b/.test(l) && !/\d{5,}/.test(l));
  if (societa) return nomeProprio(societa);
  // Un testo con prezzi ma senza intestazione («documento commerciale», «descrizione») è uno scontrino ritagliato: le prime righe sono prodotti.
  if (linee.some((l) => IMPORTO.test(l)) && !linee.some((l) => /DOCUMENTO|COMMERCIALE|DESCRIZIONE|FISCALE|SCONTRINO/.test(l))) return null;
  for (const l of linee.slice(0, 6)) {
    // Niente indirizzi, indirizzi web, orari (lo screenshot ha in alto l'ora del telefono).
    if ((l.match(/[A-Z]/g) ?? []).length < 3 || DA_SALTARE.test(l) || IMPORTO.test(l) || /^VIA\b|^CORSO\b|^PIAZZA\b|^V\.LE\b|HTTP|WWW|\.(IT|COM)\b|\d{1,2}:\d{2}/.test(l)) continue;
    return nomeProprio(l);
  }
  return null;
}

/** Negozio, data e ora dalle linee ripulite dello scontrino. */
export function leggiTestata(linee: string[]): { negozio: string | null; data: string | null; ora: string | null } {
  const { data, ora } = dataOraDa(linee.join('\n'));
  return { negozio: negozioDa(linee), data, ora };
}
