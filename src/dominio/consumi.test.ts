import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { type ConfermaPasto, confermeAttive, daConfermare, giorniAvanzo, previstoPortata } from './consumi';
import type { PortataMenu } from './menu';
import { Indice } from './ricette';

const indice = new Indice(catalogo as Catalogo);
const persone = [
  { id: 'luca', nome: 'Luca', porzione: 1 },
  { id: 'sara', nome: 'Sara', porzione: 0.5 },
];
const portata = (id: string, data: string, extra: Partial<PortataMenu> = {}): PortataMenu => ({
  id,
  data,
  categoria: 'cena',
  ricetta_id: 'sys:carbonara',
  testo: null,
  porzioni: null,
  origine: 'manuale',
  bloccata: false,
  ordine: 0,
  note: null,
  ...extra,
});

describe('previsto (come il server)', () => {
  it('porzioni indicate: senza sale e pepe', () => {
    expect(previstoPortata(indice, portata('p', '2026-11-03', { porzioni: 4 }), persone, [])).toEqual([
      { ingrediente_id: 'ing:guanciale', unita: 'g', quantita: 150 },
      { ingrediente_id: 'ing:pecorino', unita: 'g', quantita: 60 },
      { ingrediente_id: 'ing:spaghetti', unita: 'g', quantita: 320 },
      { ingrediente_id: 'ing:uova', unita: 'pz', quantita: 4 },
    ]);
  });

  it('porzioni automatiche e alternativa di chi mangia altro', () => {
    const r = previstoPortata(indice, portata('p', '2026-11-03'), persone, [
      { id: 'e', portata_id: 'p', membro_id: 'sara', tipo: 'alternativa', ricetta_id: 'sys:spaghetti_aglio_olio', testo: null, porzioni: null },
    ]);
    // Luca: 1/4 di carbonara (80 g); Sara: mezza porzione di aglio e olio (320 × 0,5 / 4 = 40 g).
    expect(r.find((c) => c.ingrediente_id === 'ing:spaghetti')).toEqual({ ingrediente_id: 'ing:spaghetti', unita: 'g', quantita: 120 });
  });
});

describe('da confermare e avanzi', () => {
  it('solo fino a oggi, al più tre giorni indietro, senza conferma attiva', () => {
    const conferme: ConfermaPasto[] = [
      { id: 'c', portata_id: 'b', revisione: 1, esito: 'saltato', ricetta_id: null, testo: null, porzioni: null, attiva: true, nota: null },
      { id: 'd', portata_id: 'c', revisione: 1, esito: 'saltato', ricetta_id: null, testo: null, porzioni: null, attiva: false, nota: null },
    ];
    const elenco = daConfermare(
      [portata('vecchia', '2026-10-28'), portata('a', '2026-11-01'), portata('b', '2026-11-02'), portata('c', '2026-11-03'), portata('domani', '2026-11-04')],
      confermeAttive(conferme),
      '2026-11-03',
    );
    expect(elenco.map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('giorni dell’avanzo dalla regola dei cotti; senza regola non si stima', () => {
    const regole = (catalogo as Catalogo).regole_cotti;
    expect(giorniAvanzo(indice.perId.get('sys:carbonara'), regole)).toBe(1);
    expect(giorniAvanzo({ conservazione: null }, regole)).toBeNull();
  });
});
