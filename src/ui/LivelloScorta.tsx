import { LIVELLI, type Livello } from '../dominio/livello';

/**
 * Quanto resta di un prodotto a occhio: i pezzi (o le confezioni) e, a parole, quello in uso. Si tocca e basta,
 * senza scrivere numeri: il formaggio non si pesa ogni volta.
 */
export function LivelloScorta({
  pezzi,
  livello,
  cambia,
  etichetta = 'Quanto ne resta',
}: {
  pezzi: number;
  livello: Livello | null;
  cambia: (x: { pezzi?: number; livello?: Livello }) => void;
  etichetta?: string;
}) {
  return (
    <>
      <div className="campo">
        <span>Quanti pezzi o confezioni</span>
        <div className="riga contapezzi">
          <button type="button" className="bottone" aria-label="Un pezzo in meno" disabled={pezzi <= 1} onClick={() => cambia({ pezzi: pezzi - 1 })}>
            −
          </button>
          <strong aria-live="polite" aria-label={`${pezzi} ${pezzi === 1 ? 'pezzo' : 'pezzi'}`}>{pezzi}</strong>
          <button type="button" className="bottone" aria-label="Un pezzo in più" disabled={pezzi >= 99} onClick={() => cambia({ pezzi: pezzi + 1 })}>
            +
          </button>
        </div>
      </div>
      <div className="campo">
        <span>
          {etichetta}
          {pezzi > 1 ? ' (di quello aperto)' : ''}
        </span>
        <div className="scelte livelli" role="group" aria-label={etichetta}>
          {LIVELLI.map((l) => (
            <button type="button" key={l.id} aria-pressed={livello === l.id} className={`livello-${l.id}`} onClick={() => cambia({ livello: l.id })}>
              <span className="tacche" aria-hidden>
                {l.simbolo}
              </span>{' '}
              {l.nome}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
