import { describe, expect, it } from 'vitest';
import { avvisoScorta, descriviLivello, eBasso, puoAOcchio, scorteAOcchio } from './livello';

const antenati = (id: string) => (id === 'ing:parmigiano' ? ['ing:parmigiano', 'ing:formaggio'] : [id]);

describe('prodotti a occhio', () => {
  it('si tengono a occhio le cose che si pesano o si versano, non quelle che si contano', () => {
    expect(puoAOcchio({ id: 'ing:parmigiano', dimensione: 'massa' })).toBe(true);
    expect(puoAOcchio({ id: 'ing:olio', dimensione: 'volume' })).toBe(true);
    expect(puoAOcchio({ id: 'ing:uova', dimensione: 'pezzi' })).toBe(false);
  });

  it('descrive pezzi e livello', () => {
    expect(descriviLivello(1, 'meta')).toBe('Metà');
    expect(descriviLivello(1, 'finendo')).toBe('Sta per finire');
    expect(descriviLivello(3, 'poco')).toBe('3 pezzi · poco');
  });

  it('basso solo con un pezzo che è poco o sta per finire', () => {
    expect(eBasso({ ingrediente_id: 'x', quantita: 1, livello: 'finendo' })).toBe(true);
    expect(eBasso({ ingrediente_id: 'x', quantita: 2, livello: 'finendo' })).toBe(false);
    expect(eBasso({ ingrediente_id: 'x', quantita: 1, livello: 'meta' })).toBe(false);
    expect(eBasso({ ingrediente_id: 'x', quantita: 300, livello: null })).toBe(false);
  });

  it('per ricetta: avvisa se l’unico pezzo sta per finire, non se c’è altro', () => {
    const una = scorteAOcchio([{ ingrediente_id: 'ing:parmigiano', quantita: 1, livello: 'finendo' }], antenati);
    expect(avvisoScorta(una.get('ing:parmigiano'))).toBe('sta per finire: controlla se basta');
    expect(avvisoScorta(una.get('ing:formaggio'))).toBe('sta per finire: controlla se basta');
    expect(una.has('ing:olio')).toBe(false);

    const conNuovo = scorteAOcchio(
      [
        { ingrediente_id: 'ing:parmigiano', quantita: 1, livello: 'finendo' },
        { ingrediente_id: 'ing:parmigiano', quantita: 1, livello: 'tanto' },
      ],
      antenati,
    );
    expect(conNuovo.get('ing:parmigiano')).toEqual({ livello: 'tanto', pezzi: 2, misurato: false });
    expect(avvisoScorta(conNuovo.get('ing:parmigiano'))).toBeNull();

    const conGrammi = scorteAOcchio(
      [
        { ingrediente_id: 'ing:parmigiano', quantita: 1, livello: 'poco' },
        { ingrediente_id: 'ing:parmigiano', quantita: 200, livello: null },
      ],
      antenati,
    );
    expect(avvisoScorta(conGrammi.get('ing:parmigiano'))).toBeNull();
    expect(scorteAOcchio([{ ingrediente_id: 'ing:olio', quantita: 500 }], antenati).size).toBe(0);
  });
});
