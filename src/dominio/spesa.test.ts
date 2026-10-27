import { describe, expect, it } from 'vitest';
import catalogo from '../catalogo/catalogo.json';
import type { Catalogo } from '../catalogo/tipi';
import { Indice } from './ricette';
import { type Acquisto, prezziOsservati, type RigaAcquisto, righeDaConfermare, stimaPrezzo, totaleStimato, type VoceSpesa } from './spesa';

const indice = new Indice(catalogo as Catalogo);

const acquisto = (id: string, data: string, stato: Acquisto['stato'] = 'confermato'): Acquisto => ({ id, fonte: 'carrello', data, negozio: 'Mercato', stato });
const riga = (acquisto_id: string, ingrediente_id: string, quantita: number, prezzo: number | null): RigaAcquisto => ({
  id: `${acquisto_id}-${ingrediente_id}`,
  acquisto_id,
  voce_id: null,
  ingrediente_id,
  nome: null,
  quantita,
  unita: 'g',
  prezzo,
  lotto_id: 'l',
});
const voce = (ingrediente_id: string | null, quantita: number | null, extra: Partial<VoceSpesa> = {}): VoceSpesa => ({
  id: `v-${ingrediente_id ?? 'testo'}`,
  tipo: 'derivata',
  ingrediente_id,
  testo: ingrediente_id ? null : 'Detersivo',
  unita: ingrediente_id ? 'g' : null,
  quantita_richiesta: quantita,
  quantita_scelta: null,
  stato: 'da_acquistare',
  non_piu_necessaria: false,
  nota: null,
  ...extra,
});

describe('prezzi (T-PRE)', () => {
  const acquisti = [acquisto('a', '2026-10-01'), acquisto('b', '2026-10-20'), acquisto('c', '2026-01-01'), acquisto('x', '2026-10-25', 'annullato')];
  const righe = [
    riga('a', 'ing:spaghetti', 500, 1.0), // 0,002 €/g
    riga('b', 'ing:spaghetti', 1000, 3.0), // 0,003 €/g
    riga('c', 'ing:spaghetti', 500, 10), // più vecchio di 6 mesi: non conta
    riga('x', 'ing:spaghetti', 500, 50), // annullato: non conta
    riga('b', 'ing:guanciale', 200, null),
  ];
  const prezzi = prezziOsservati(acquisti, righe);

  it('T-PRE-1 un ingrediente mai comprato con un prezzo non ha prezzo', () => {
    expect(stimaPrezzo(prezzi.get('ing:guanciale'), 100)).toBeNull();
    expect(stimaPrezzo(prezzi.get('ing:uova'), 6)).toBeNull();
  });

  it('T-PRE-3 la stima usa la mediana degli ultimi 6 mesi e dice la data dei dati', () => {
    expect(stimaPrezzo(prezzi.get('ing:spaghetti'), 500)).toEqual({ euro: 1.25, dal: '2026-10-20', osservazioni: 2 });
  });

  it('T-PRE-2 il totale conta solo le voci con un prezzo e dice quante mancano', () => {
    const t = totaleStimato([voce('ing:spaghetti', 500), voce('ing:guanciale', 150), voce(null, null), voce('ing:spaghetti', 500, { quantita_scelta: 1000 })], prezzi);
    expect(t).toEqual({ euro: 3.75, voci: 4, senzaPrezzo: 2 });
  });
});

describe('conferma dal carrello', () => {
  it('ogni voce diventa una riga: luogo abituale, data stimata solo per lo sfuso, testo senza casa', () => {
    let n = 0;
    const righe = righeDaConfermare(
      [voce('ing:zucchina', 500), voce('ing:spaghetti', 500, { quantita_scelta: 1000 }), voce(null, null)],
      (id) => indice.ingrediente(id),
      '2026-11-02',
      () => `id${++n}`,
      new Date('2026-11-02T10:00:00Z'),
    );
    expect(righe[0]).toMatchObject({ ingrediente_id: 'ing:zucchina', quantita: 500, luogo: 'frigo', tipo_data: 'stimata', fonte_data: 'app' });
    expect(righe[1]).toMatchObject({ ingrediente_id: 'ing:spaghetti', quantita: 1000, luogo: 'dispensa', tipo_data: 'sconosciuta' });
    expect(righe[1]).not.toHaveProperty('data_limite');
    expect(righe[2]).toMatchObject({ ingrediente_id: null, nome: 'Detersivo', quantita: null });
  });
});
