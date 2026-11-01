import { useEffect, useState } from 'react';
import { type Ingrediente, type Livello, SIGNIFICATO_NOVA, type SchedaProdotto, schedaVuota } from '../dominio/schedaProdotto';
import { Foglio } from './Foglio';
import { chiediAOpenFoodFacts } from './openFoodFacts';

const numero = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 3 });

/** Il foglio «Valori e ingredienti» di un codice a barre, chiesto a Open Food Facts. */
export function FoglioSchedaProdotto({ codice, nome, chiudi }: { codice: string; nome?: string; chiudi: () => void }) {
  // undefined = sto cercando; null = niente rete o servizio lento; {} = prodotto sconosciuto.
  const [scheda, setScheda] = useState<SchedaProdotto | null | undefined | false>(undefined);
  useEffect(() => {
    let attivo = true;
    void chiediAOpenFoodFacts(codice).then((r) => attivo && setScheda(r === undefined ? null : (r.scheda ?? false)));
    return () => {
      attivo = false;
    };
  }, [codice]);

  return (
    <Foglio titolo={nome || 'Valori e ingredienti'} chiudi={chiudi} alto>
      {scheda === undefined ? (
        <p className="tenue" aria-live="polite">
          Cerco valori e ingredienti su Open Food Facts…
        </p>
      ) : scheda === null ? (
        <div className="avviso">Open Food Facts non risponde: controlla la connessione e riprova tra poco.</div>
      ) : scheda === false || schedaVuota(scheda) ? (
        <div className="avviso">
          Open Food Facts non ha ancora valori e ingredienti per il codice {codice}. Puoi aggiungerli tu dall’app di Open Food Facts.
        </div>
      ) : (
        <DettagliProdotto scheda={scheda} />
      )}
    </Foglio>
  );
}

const TESTO_LIVELLO: Record<Livello, string> = { basso: 'basso', moderato: 'medio', alto: 'alto' };

export function DettagliProdotto({ scheda: s }: { scheda: SchedaProdotto }) {
  const porzione = s.valori.some((v) => v.perPorzione !== undefined);
  const livelli = Object.entries(s.livelli) as [string, Livello][];
  return (
    <div className="scheda-prodotto">
      {(s.nutriScore || s.nova || livelli.length > 0 || s.biologico) && (
        <section>
          <h3>Indicatori ufficiali</h3>
          <div className="etichette">
            {s.nutriScore && (
              <span className="etichetta indicatore" title="Nutri-Score: qualità nutrizionale da A (migliore) a E">
                <b className={`nutriscore ns-${s.nutriScore.toLowerCase()}`}>{s.nutriScore}</b> Nutri-Score
              </span>
            )}
            {s.nova && (
              <span className="etichetta indicatore" title="NOVA: grado di lavorazione da 1 (non lavorato) a 4 (ultra-lavorato)">
                <b className={`nova nova-${s.nova}`}>{s.nova}</b> NOVA · {SIGNIFICATO_NOVA[s.nova].toLowerCase()}
              </span>
            )}
            {s.biologico && <span className="etichetta indicatore">🌱 Biologico</span>}
          </div>
          {livelli.length > 0 && (
            <div className="etichette">
              {livelli.map(([nome, l]) => (
                <span key={nome} className={`etichetta livello-${l}`}>
                  {nome[0].toUpperCase() + nome.slice(1)}: {TESTO_LIVELLO[l]}
                </span>
              ))}
            </div>
          )}
          <p className="tenue piccolo-testo">
            Nutri-Score e NOVA sono sistemi pubblici e studiati, calcolati da Open Food Facts; i livelli per 100 g usano le soglie dell’agenzia alimentare
            britannica (FSA).
          </p>
        </section>
      )}

      {s.valori.length > 0 && (
        <section>
          <h3>Valori nutrizionali</h3>
          <table className="tabella-valori">
            <thead>
              <tr>
                <th scope="col"></th>
                <th scope="col">per {s.base}</th>
                {porzione && <th scope="col">per porzione{s.porzione ? ` (${s.porzione})` : ''}</th>}
              </tr>
            </thead>
            <tbody>
              {s.valori.map((v) => (
                <tr key={v.chiave} className={v.sotto ? 'sotto' : undefined}>
                  <th scope="row">{v.nome}</th>
                  <td>{v.per100 !== undefined ? `${numero.format(v.per100)} ${v.unita}` : '—'}</td>
                  {porzione && <td>{v.perPorzione !== undefined ? `${numero.format(v.perPorzione)} ${v.unita}` : '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {(s.ingredienti || s.elencoIngredienti.length > 0) && (
        <section>
          <h3>Ingredienti</h3>
          {s.ingredienti && <p style={{ marginTop: 0 }}>{s.ingredienti}</p>}
          {s.linguaIngredienti === 'altra' && <p className="tenue piccolo-testo">Elenco non disponibile in italiano: è quello dell’etichetta originale.</p>}
          {s.elencoIngredienti.length > 0 && (
            <details>
              <summary>Uno per uno{s.elencoIngredienti.some((i) => i.percentuale !== undefined) ? ', con le percentuali dichiarate' : ''}</summary>
              <ElencoIngredienti voci={s.elencoIngredienti} />
            </details>
          )}
        </section>
      )}

      {(s.allergeni.length > 0 || s.tracce.length > 0) && (
        <section>
          <h3>Allergeni</h3>
          {s.allergeni.length > 0 && (
            <div className="etichette">
              {s.allergeni.map((a) => (
                <span key={a} className="etichetta allergia">
                  {a}
                </span>
              ))}
            </div>
          )}
          {s.tracce.length > 0 && <p style={{ marginBottom: 0 }}>Può contenere tracce di: {s.tracce.join(', ')}.</p>}
        </section>
      )}

      {s.additivi.length > 0 && (
        <section>
          <h3>Additivi</h3>
          <div className="etichette">
            {s.additivi.map((a) => (
              <span key={a} className="etichetta">
                {a}
              </span>
            ))}
          </div>
        </section>
      )}

      <p className="tenue piccolo-testo">
        Dati di Open Food Facts (codice {s.codice}
        {s.aggiornataIl ? `, scheda aggiornata il ${new Date(s.aggiornataIl).toLocaleDateString('it-IT')}` : ''}), scritti da volontari: in caso di dubbio vale
        l’etichetta sulla confezione.
      </p>
    </div>
  );
}

function ElencoIngredienti({ voci }: { voci: Ingrediente[] }) {
  return (
    <ul className="elenco-ingredienti">
      {voci.map((i, n) => (
        <li key={`${i.nome}-${n}`}>
          {i.nome}
          {i.percentuale !== undefined && <span className="tenue"> {numero.format(i.percentuale)}%</span>}
          {i.sotto && <ElencoIngredienti voci={i.sotto} />}
        </li>
      ))}
    </ul>
  );
}
