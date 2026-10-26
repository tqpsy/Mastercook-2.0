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
});
