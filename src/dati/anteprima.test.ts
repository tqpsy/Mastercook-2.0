import { describe, expect, it } from 'vitest';
import type { VoceCoda } from './archivio';
import { attive, vistaConAnteprima } from './anteprima';

const F = 'fam';
const voce = (tipo: string, dati: Record<string, unknown>, stato: VoceCoda['stato'] = 'in_attesa'): VoceCoda => ({
  id: crypto.randomUUID(),
  famiglia_id: F,
  comando: { id: crypto.randomUUID(), famiglia_id: F, tipo, dati, versione_app: 1 },
  stato,
  tentativi: 0,
  creato_il: '2026-10-27T10:00:00Z',
});

describe('anteprima della coda', () => {
  const membro = { id: 'm1', famiglia_id: F, seq: 4, nome: 'Luca', porzione: 1 };

  it('un membro in coda compare subito, marcato in attesa', () => {
    const v = vistaConAnteprima({ membro: [membro] }, [voce('aggiungi_membro', { id: 'm2', nome: 'Sara' })]);
    expect(v.membro?.map((m) => [m.nome, !!m.in_attesa])).toEqual([
      ['Luca', false],
      ['Sara', true],
    ]);
  });

  it('una modifica in coda si vede sulla riga, senza toccare le righe originali', () => {
    const righe = { membro: [membro] };
    const v = vistaConAnteprima(righe, [voce('modifica_membro', { id: 'm1', versione_attesa: 1, campi: { porzione: 0.6 } })]);
    expect(v.membro?.[0]).toMatchObject({ porzione: 0.6, in_attesa: true });
    expect(righe.membro[0].porzione).toBe(1);
  });

  it('un comando da sistemare non ha effetto in anteprima', () => {
    const v = vistaConAnteprima({ membro: [membro] }, [voce('modifica_membro', { id: 'm1', campi: { nome: 'X' } }, 'da_sistemare')]);
    expect(v.membro?.[0].nome).toBe('Luca');
  });

  it('un vincolo rimosso in coda sparisce dalle righe attive', () => {
    const vincolo = { id: 'v1', famiglia_id: F, seq: 5, membro_id: 'm1' };
    const v = vistaConAnteprima({ vincolo_alimentare: [vincolo] }, [voce('rimuovi_vincolo', { id: 'v1' })]);
    expect(attive(v.vincolo_alimentare)).toEqual([]);
  });

  it('una riga già arrivata dal server non viene duplicata dall\'anteprima', () => {
    const v = vistaConAnteprima({ membro: [membro] }, [voce('aggiungi_membro', { id: 'm1', nome: 'Luca' })]);
    expect(v.membro).toHaveLength(1);
  });

  it('casa: un lotto aggiunto, poi usato in parte e poi tutto, si chiude in anteprima', () => {
    const v = vistaConAnteprima({}, [
      voce('aggiungi_lotto', { id: 'l1', ingrediente_id: 'ing:latte', quantita: 1000, unita: 'ml', luogo: 'frigo', tipo_data: 'sconosciuta' }),
      voce('scarica_lotto', { lotto_id: 'l1', causale: 'consumo', quantita: 400 }),
    ]);
    expect(v.lotto?.[0]).toMatchObject({ quantita: 600, chiuso_il: null, in_attesa: true });
    const v2 = vistaConAnteprima(v, [voce('correggi_lotto', { lotto_id: 'l1', quantita_vista: 600, quantita_nuova: 0 })]);
    expect(v2.lotto?.[0]).toMatchObject({ quantita: 0, chiuso_il: 'in_attesa' });
  });

  it('casa: spostare una parte crea il lotto nuovo con le stesse date', () => {
    const lotto = { id: 'l1', famiglia_id: F, seq: 3, quantita: 800, luogo: 'frigo', data_limite: '2026-11-01', tipo_data: 'scadenza' };
    const v = vistaConAnteprima({ lotto: [lotto] }, [voce('sposta_lotto', { lotto_id: 'l1', luogo: 'freezer', quantita: 300, nuovo_id: 'l2' })]);
    expect(v.lotto?.map((l) => [l.id, l.quantita, l.luogo, l.data_limite])).toEqual([
      ['l1', 500, 'frigo', '2026-11-01'],
      ['l2', 300, 'freezer', '2026-11-01'],
    ]);
  });

  it('ricette: una ricetta nuova compare con righe e passaggi; le modifiche riga per riga si vedono', () => {
    const v = vistaConAnteprima({}, [
      voce('salva_ricetta', {
        id: 'r1',
        nuova: true,
        campi: { titolo: 'Pasta', categoria: 'primo', porzioni: 4 },
        ingredienti: { aggiungi: [{ id: 'g1', ingrediente_id: 'ing:pasta', quantita: 320, unita: 'g' }] },
        passi: { aggiungi: [{ id: 'p1', ordine: 1, testo: 'Cuoci.' }] },
      }),
      voce('salva_ricetta', { id: 'r1', ingredienti: { modifica: [{ id: 'g1', versione_attesa: 1, campi: { quantita: 400 } }] }, passi: { rimuovi: ['p1'] } }),
    ]);
    expect(v.ricetta?.[0]).toMatchObject({ id: 'r1', titolo: 'Pasta', in_attesa: true });
    expect(v.ricetta_ingrediente?.[0]).toMatchObject({ ricetta_id: 'r1', quantita: 400 });
    expect(attive(v.ricetta_passo)).toEqual([]);
  });
});
