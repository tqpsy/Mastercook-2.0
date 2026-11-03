/**
 * Leggere il piano del nutrizionista (PDF o foto) con Gemini: frequenze della settimana, regole di pranzo e cena,
 * alimenti da preferire e ricette. Modulo puro, senza API di Deno: lo usano la Edge Function, l'app per le
 * famiglie tenute solo sul telefono e i test.
 *
 * Il risultato è solo una proposta: l'app lo traduce negli ingredienti del catalogo e lo salva solo se la
 * persona conferma.
 */
import { chiediGemini, MODELLI, type Parte } from './nucleo.ts';

export const GRUPPI_PIANO = ['pesce', 'legumi', 'carne_rossa', 'carne_bianca', 'salumi', 'uova', 'formaggi'] as const;
export const CATEGORIE_PIANO = ['colazione', 'antipasto', 'primo', 'secondo', 'contorno', 'piatto_unico', 'dolce', 'base'] as const;
export const MIME_PIANO = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

export interface RigaLetta {
  nome: string;
  quantita: number | null;
  unita: 'g' | 'ml' | 'pz' | null;
  opzionale: boolean;
  /** Come la scrive il piano (es. «burro chiarificato», «farina di farro»). */
  testo: string | null;
}

export interface RicettaLetta {
  titolo: string;
  categoria: (typeof CATEGORIE_PIANO)[number];
  porzioni: number;
  minuti_totali: number | null;
  ingredienti: RigaLetta[];
  passi: string[];
}

export interface PianoLetto {
  nome: string | null;
  frequenze: { gruppo: (typeof GRUPPI_PIANO)[number]; min: number | null; max: number | null }[];
  cena_senza_carboidrati: boolean;
  legumi_senza_cereali: boolean;
  pranzo_con_carboidrati: boolean;
  verdure_a_ogni_pasto: boolean;
  alimenti_preferiti: string[];
  ricette: RicettaLetta[];
}

export const ISTRUZIONI_PIANO = `Sei l'aiuto di un'app di cucina italiana. Nel documento c'è un piano alimentare dato da un nutrizionista o dietista.
Traducilo nelle regole che l'app usa per proporre i pranzi e le cene della settimana. Non inventare nulla che non sia scritto.
- nome: un nome breve per il piano (es. "Piano del nutrizionista").
- frequenze: quante volte a settimana, tra pranzi e cene, per i gruppi pesce, legumi, carne_rossa, carne_bianca, salumi (affettati e insaccati), uova, formaggi (latticini).
  "circa N volte" → min N e max N+1; "al massimo N" → solo max N; "almeno N" → solo min N; se il piano dice "carne N volte alternando bianca e rossa" dividi tra carne_bianca e carne_rossa. Se un gruppo non è indicato, non metterlo.
- cena_senza_carboidrati: true se il piano dice di evitare o ridurre pasta, pane, riso, patate a cena.
- legumi_senza_cereali: true se dice di non abbinare i legumi a pasta, pane o riso.
- pranzo_con_carboidrati: true se a pranzo prevede un carboidrato (pasta, riso, cereali, patate) con proteine e verdure.
- verdure_a_ogni_pasto: true se le verdure vanno sia a pranzo sia a cena.
- alimenti_preferiti: cereali, pani e farine da preferire, con nomi generici in italiano al singolare (es. "farro", "riso basmati", "cous cous", "pane integrale", "pasta di kamut").
- ricette: le ricette scritte per intero nel piano (con ingredienti e procedimento) e le colazioni descritte con i loro ingredienti. Per ogni ricetta: titolo, categoria, porzioni (1 se non è detto), minuti_totali se si capisce, ingredienti e passi.
  Per ogni ingrediente: nome generico in italiano come lo cercheresti in un ricettario (es. "uova", "fiocchi d'avena", "burro", "farina integrale", "mele"); testo com'è scritto nel piano; quantita e unita ("g", "ml" o "pz" per le cose che si contano) solo se scritte o chiare, altrimenti null; opzionale se il piano dice "se gradito" o "in alternativa".
Ignora i consigli generali che non sono regole sui pasti (acqua, masticare, ascoltare la fame).`;

const NUMERO = { type: 'INTEGER', nullable: true };
const SCHEMA_PIANO = {
  type: 'OBJECT',
  properties: {
    nome: { type: 'STRING', nullable: true },
    frequenze: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { gruppo: { type: 'STRING', enum: [...GRUPPI_PIANO] }, min: NUMERO, max: NUMERO }, required: ['gruppo'] },
    },
    cena_senza_carboidrati: { type: 'BOOLEAN' },
    legumi_senza_cereali: { type: 'BOOLEAN' },
    pranzo_con_carboidrati: { type: 'BOOLEAN' },
    verdure_a_ogni_pasto: { type: 'BOOLEAN' },
    alimenti_preferiti: { type: 'ARRAY', items: { type: 'STRING' } },
    ricette: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          titolo: { type: 'STRING' },
          categoria: { type: 'STRING', enum: [...CATEGORIE_PIANO] },
          porzioni: NUMERO,
          minuti_totali: NUMERO,
          ingredienti: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                nome: { type: 'STRING' },
                testo: { type: 'STRING', nullable: true },
                quantita: { type: 'NUMBER', nullable: true },
                unita: { type: 'STRING', enum: ['g', 'ml', 'pz'], nullable: true },
                opzionale: { type: 'BOOLEAN' },
              },
              required: ['nome'],
            },
          },
          passi: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['titolo', 'categoria', 'ingredienti', 'passi'],
      },
    },
  },
  required: ['frequenze', 'ricette'],
};

const testoBreve = (x: unknown, max: number) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : null);
const intero = (x: unknown, da: number, a: number) => (typeof x === 'number' && Number.isFinite(x) && x >= da && x <= a ? Math.round(x) : null);

/** Legge la risposta di Gemini e tiene solo ciò che ha senso (numeri nei limiti, al più 30 ricette). */
export function leggiPianoGemini(testo: string): PianoLetto | null {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(testo);
  } catch {
    return null;
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const frequenze: PianoLetto['frequenze'] = [];
  for (const f of Array.isArray(d.frequenze) ? d.frequenze : []) {
    const g = (f ?? {}) as Record<string, unknown>;
    if (!GRUPPI_PIANO.includes(g.gruppo as never) || frequenze.some((x) => x.gruppo === g.gruppo)) continue;
    const min = intero(g.min, 0, 14);
    const max = intero(g.max, 0, 14);
    if (min === null && max === null) continue;
    frequenze.push({ gruppo: g.gruppo as PianoLetto['frequenze'][number]['gruppo'], min, max: max !== null && min !== null && max < min ? min : max });
  }
  const ricette: RicettaLetta[] = [];
  for (const x of Array.isArray(d.ricette) ? d.ricette.slice(0, 30) : []) {
    const r = (x ?? {}) as Record<string, unknown>;
    const titolo = testoBreve(r.titolo, 120);
    if (!titolo || !CATEGORIE_PIANO.includes(r.categoria as never)) continue;
    const ingredienti: RigaLetta[] = [];
    for (const y of Array.isArray(r.ingredienti) ? r.ingredienti.slice(0, 40) : []) {
      const g = (y ?? {}) as Record<string, unknown>;
      const nome = testoBreve(g.nome, 60)?.toLowerCase();
      if (!nome) continue;
      const unita = g.unita === 'g' || g.unita === 'ml' || g.unita === 'pz' ? g.unita : null;
      const q = typeof g.quantita === 'number' && Number.isFinite(g.quantita) && g.quantita > 0 && g.quantita < 100_000 ? g.quantita : null;
      ingredienti.push({ nome, quantita: q !== null && unita ? q : null, unita: q !== null ? unita : null, opzionale: g.opzionale === true, testo: testoBreve(g.testo, 120) });
    }
    const passi = (Array.isArray(r.passi) ? r.passi : []).map((p) => testoBreve(p, 1000)).filter((p): p is string => !!p);
    if (!ingredienti.length || !passi.length) continue;
    ricette.push({ titolo, categoria: r.categoria as RicettaLetta['categoria'], porzioni: intero(r.porzioni, 1, 50) ?? 1, minuti_totali: intero(r.minuti_totali, 1, 1440), ingredienti, passi });
  }
  return {
    nome: testoBreve(d.nome, 80),
    frequenze,
    cena_senza_carboidrati: d.cena_senza_carboidrati === true,
    legumi_senza_cereali: d.legumi_senza_cereali === true,
    pranzo_con_carboidrati: d.pranzo_con_carboidrati === true,
    verdure_a_ogni_pasto: d.verdure_a_ogni_pasto === true,
    alimenti_preferiti: (Array.isArray(d.alimenti_preferiti) ? d.alimenti_preferiti : [])
      .map((x) => testoBreve(x, 60)?.toLowerCase())
      .filter((x): x is string => !!x)
      .slice(0, 20),
    ricette,
  };
}

/** Chiede a Gemini di leggere il piano (PDF o immagine in base64). */
export async function leggiPianoDocumento(
  dati: string,
  mime: string,
  chiave: string,
  chiama: typeof fetch = fetch,
  modelli = MODELLI,
): Promise<{ piano: PianoLetto; modello: string } | { errore: 'quota' | 'chiave' | 'gemini' | 'illeggibile'; dettaglio?: string }> {
  const parti: Parte[] = [{ inline_data: { mime_type: mime, data: dati } }, { text: ISTRUZIONI_PIANO }];
  const r = await chiediGemini(parti, SCHEMA_PIANO, chiave, chiama, modelli);
  if ('errore' in r) return r;
  const piano = leggiPianoGemini(r.testo);
  return piano ? { piano, modello: r.modello } : { errore: 'illeggibile' };
}
