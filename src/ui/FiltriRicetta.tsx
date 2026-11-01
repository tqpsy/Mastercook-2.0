/**
 * Filtri delle ricette usati sia in Ricette sia in «Aggiungi piatto» del Menu, così si cercano allo stesso modo:
 * cerca per ingrediente (preciso o per tipo) e ricette segnate ⭐ / 💫.
 */
import { useMemo, useState } from 'react';
import { PRINCIPALI, type Principale } from '../dominio/principale';
import type { Indice } from '../dominio/ricette';
import type { ModoSuggerimento } from '../dominio/suggerimenti';

export interface FiltroIngredienti {
  principale: Principale | null;
  /** Un ingrediente preciso (id), cercato per nome. */
  ingrediente: string | null;
}

/** Cerca per ingrediente: un ingrediente preciso scritto a mano, oppure un tipo (pasta, pesce, legumi…) con un tocco. */
export function FiltroIngrediente({ indice, filtro, cambia }: { indice: Indice; filtro: FiltroIngredienti; cambia: (f: Partial<FiltroIngredienti>) => void }) {
  const [testo, setTesto] = useState('');
  // Solo gli ingredienti che qualche ricetta usa (con i loro «genitori»: pasta, funghi…).
  const usati = useMemo(() => indice.estendi(indice.ricette.flatMap((r) => r.ingredienti.map((g) => g.ingrediente_id))), [indice]);
  const proposti = testo.trim() ? indice.cercaIngredienti(testo, 30).filter((i) => usati.has(i.id) && !indice.ingrediente(i.id)?.base).slice(0, 6) : [];
  const scelto = filtro.ingrediente ? indice.ingrediente(filtro.ingrediente) : null;
  return (
    <div className="campo filtro-ingrediente">
      {scelto ? (
        <div className="riga" style={{ gap: 6 }}>
          <span className="etichetta-campo">Ingrediente</span>
          <button type="button" className="chip-scelto" onClick={() => cambia({ ingrediente: null })} aria-label={`Togli ${scelto.nome}`}>
            {scelto.emoji} {scelto.nome} ✕
          </button>
        </div>
      ) : (
        <label>
          <span>Cerca per ingrediente</span>
          <input type="search" value={testo} onChange={(e) => setTesto(e.target.value)} placeholder="Zucchine, ceci, salmone…" />
        </label>
      )}
      {!scelto && proposti.length > 0 && (
        <div className="scelte compatte" role="group" aria-label="Ingredienti trovati" style={{ marginTop: 6 }}>
          {proposti.map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() => {
                cambia({ ingrediente: i.id });
                setTesto('');
              }}
            >
              {i.emoji} {i.nome}
            </button>
          ))}
        </div>
      )}
      {!scelto && testo.trim() && !proposti.length && <p className="tenue piccolo" style={{ margin: '4px 0 0' }}>Nessuna ricetta usa «{testo.trim()}».</p>}
      <div className="scelte compatte" role="group" aria-label="Ingrediente principale" style={{ marginTop: 6 }}>
        {PRINCIPALI.map((p) => (
          <button key={p.id} type="button" aria-pressed={filtro.principale === p.id} onClick={() => cambia({ principale: filtro.principale === p.id ? null : p.id })}>
            {p.emoji} {p.nome}
          </button>
        ))}
      </div>
    </div>
  );
}

export type Segno = 'preferita' | 'ospiti';

export const SEGNI: { id: Segno; emoji: string; nome: string; filtro: string }[] = [
  { id: 'preferita', emoji: '⭐', nome: 'Preferita', filtro: 'Preferite' },
  { id: 'ospiti', emoji: '💫', nome: 'Da ospiti', filtro: 'Per ospiti' },
];

/** Solo le ⭐ preferite o solo le 💫 da fare agli ospiti (un tocco accende, un altro spegne). */
export function BottoniSegno({ segno, cambia }: { segno: Segno | null; cambia: (s: Segno | null) => void }) {
  return (
    <div className="gruppo-in-riga" role="group" aria-label="Ricette segnate">
      {SEGNI.map((s) => (
        <button key={s.id} type="button" aria-pressed={segno === s.id} onClick={() => cambia(segno === s.id ? null : s.id)}>
          {s.emoji} {s.filtro}
        </button>
      ))}
    </div>
  );
}

export const MODI: { id: ModoSuggerimento; emoji: string; nome: string; spiega: string }[] = [
  { id: 'casa', emoji: '🏠', nome: 'Con ciò che ho', spiega: 'prima quelle con tutto in casa, poi quelle a cui manca una o due cose' },
  { id: 'ricettario', emoji: '📖', nome: 'Dal ricettario', spiega: 'prima le ⭐ preferite, quelle che piacciono e quelle che non fate da tempo' },
];

/** Come suggerire: con ciò che c'è in casa o da tutto il ricettario. */
export function BottoniModo({ modo, cambia, obbligatorio, casaVuota }: { modo: ModoSuggerimento | null; cambia: (m: ModoSuggerimento | null) => void; obbligatorio?: boolean; casaVuota?: boolean }) {
  return (
    <div className="gruppo-in-riga" role="group" aria-label="Suggerisci">
      {MODI.map((m) => (
        <button
          key={m.id}
          type="button"
          aria-pressed={modo === m.id}
          disabled={m.id === 'casa' && casaVuota}
          title={m.id === 'casa' && casaVuota ? 'In casa non c’è ancora niente' : m.spiega}
          onClick={() => cambia(modo === m.id ? (obbligatorio ? m.id : null) : m.id)}
        >
          {m.emoji} {m.nome}
        </button>
      ))}
    </div>
  );
}
