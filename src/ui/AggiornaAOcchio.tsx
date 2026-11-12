/** Dopo aver cucinato o mangiato: quanto resta dei prodotti a occhio usati (tanto, metà, poco…). */
import { useMemo, useState } from 'react';
import { useFamiglia } from '../dati/contesto';
import type { Indice } from '../dominio/ricette';
import { LIVELLI } from '../dominio/livello';
import { useLotti } from '../dati/lotti';

/**
 * Dopo aver cucinato o mangiato: i prodotti a occhio usati dal piatto non perdono grammi, quindi si chiede a parole
 * quanto ne resta. Un tocco cambia il livello; «Finito» toglie un pezzo (l'ultimo chiude il prodotto).
 */
export function AggiornaAOcchio({ indice, ingredienti }: { indice: Indice; ingredienti: string[] }) {
  const { esegui } = useFamiglia();
  const lotti = useLotti();
  // Fissati all'apertura: un prodotto finito non deve sparire sotto il dito.
  const [ids] = useState(() => {
    const cercati = new Set(ingredienti);
    return lotti.filter((l) => l.livello && indice.antenati(l.ingrediente_id).some((a) => cercati.has(a))).map((l) => l.id);
  });
  const tutti = useMemo(() => new Map(lotti.map((l) => [l.id, l])), [lotti]);
  if (!ids.length) return null;
  return (
    <section className="a-occhio-usati" aria-label="A occhio: quanto ne resta?">
      <span className="tenue piccolo">A occhio, non tolgo grammi: quanto ne resta?</span>
      <ul className="elenco">
        {ids.map((id) => {
          const l = tutti.get(id);
          const nome = indice.nome(l?.ingrediente_id ?? '') || 'Prodotto';
          if (!l || !l.livello) {
            return (
              <li key={id} className="tenue piccolo">
                {nome}: finito.
              </li>
            );
          }
          return (
            <li key={id}>
              <strong>{l.nome ?? nome}</strong>
              {l.quantita > 1 && <span className="tenue piccolo"> · {l.quantita} pezzi</span>}
              <div className="scelte compatte livelli" role="group" aria-label={`Quanto resta: ${l.nome ?? nome}`}>
                {LIVELLI.map((x) => (
                  <button type="button" key={x.id} aria-pressed={l.livello === x.id} className={`livello-${x.id}`} onClick={() => void esegui('cambia_livello', { lotto_id: l.id, livello: x.id })}>
                    {x.nome}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => void esegui('cambia_livello', { lotto_id: l.id, livello: l.quantita > 1 ? 'tanto' : l.livello, pezzi: l.quantita - 1 })}
                >
                  Finito{l.quantita > 1 ? ' uno' : ''}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
