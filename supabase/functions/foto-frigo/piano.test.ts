import { describe, expect, it } from 'vitest';
import { leggiPianoDocumento, leggiPianoGemini } from './piano';

const gemini = (testo: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: testo }] } }] }), { status: 200 });

describe('piano del nutrizionista con Gemini', () => {
  it('tiene solo ciò che ha senso: gruppi noti, numeri nei limiti, ricette complete', () => {
    const p = leggiPianoGemini(
      JSON.stringify({
        nome: ' Piano ',
        frequenze: [
          { gruppo: 'pesce', min: 3, max: 4 },
          { gruppo: 'pesce', min: 1 },
          { gruppo: 'dolci', min: 1 },
          { gruppo: 'legumi', min: 3, max: 2 },
          { gruppo: 'uova', min: 99 },
        ],
        cena_senza_carboidrati: true,
        alimenti_preferiti: ['Farro', '', 3],
        ricette: [
          { titolo: 'Pancake', categoria: 'colazione', ingredienti: [{ nome: 'Uova', quantita: 1, unita: 'pz' }, { nome: 'avena', quantita: 30 }], passi: ['Cuoci.'] },
          { titolo: 'Senza passi', categoria: 'dolce', ingredienti: [{ nome: 'mele' }], passi: [] },
          { titolo: 'Categoria strana', categoria: 'merenda', ingredienti: [{ nome: 'mele' }], passi: ['x'] },
        ],
      }),
    )!;
    expect(p.nome).toBe('Piano');
    expect(p.frequenze).toEqual([
      { gruppo: 'pesce', min: 3, max: 4 },
      { gruppo: 'legumi', min: 3, max: 3 },
    ]);
    expect(p.cena_senza_carboidrati).toBe(true);
    expect(p.legumi_senza_cereali).toBe(false);
    expect(p.alimenti_preferiti).toEqual(['farro']);
    expect(p.ricette).toHaveLength(1);
    expect(p.ricette[0]).toMatchObject({ porzioni: 1, minuti_totali: null });
    expect(p.ricette[0].ingredienti).toEqual([
      { nome: 'uova', quantita: 1, unita: 'pz', opzionale: false, testo: null },
      { nome: 'avena', quantita: null, unita: null, opzionale: false, testo: null },
    ]);
    expect(leggiPianoGemini('non json')).toBeNull();
  });

  it('manda il PDF a Gemini con il suo tipo e la chiave solo nell’intestazione', async () => {
    let corpo: { contents: { parts: { inline_data?: { mime_type: string } }[] }[] } | null = null;
    let chiave: string | null = null;
    const chiama = (async (_url: string, init: RequestInit) => {
      corpo = JSON.parse(String(init.body));
      chiave = new Headers(init.headers).get('x-goog-api-key');
      return gemini('{"frequenze":[],"ricette":[]}');
    }) as typeof fetch;
    const r = await leggiPianoDocumento('JVBERi0=', 'application/pdf', 'segreta', chiama, ['a']);
    expect(r).toMatchObject({ modello: 'a', piano: { frequenze: [], ricette: [] } });
    expect(corpo!.contents[0].parts[0].inline_data?.mime_type).toBe('application/pdf');
    expect(chiave).toBe('segreta');
    expect(await leggiPianoDocumento('x', 'application/pdf', 'k', (async () => gemini('niente')) as typeof fetch, ['a'])).toEqual({ errore: 'illeggibile' });
  });
});
