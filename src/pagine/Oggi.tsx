import { righeAttive, useVista } from '../dati/contesto';
import { useIndice } from '../dati/indice';
import { daUsarePresto, oggi } from '../dominio/scadenze';
import { formatta } from '../dominio/unita';
import { EtichettaData, useLotti } from './Casa';
import { useOggiSiMangia } from './Menu';

/**
 * Oggi: cosa si mangia, cosa usare presto e cosa c'è già. Spesa e scontrini arrivano nelle prossime fasi:
 * qui lo si dice senza mostrare dati finti.
 */
export function Oggi({ vai }: { vai: (scheda: 'menu' | 'ricette' | 'casa') => void }) {
  const vista = useVista();
  const indice = useIndice(vista);
  const lotti = useLotti();
  const famiglia = righeAttive(vista, 'famiglia')[0];
  const persone = righeAttive(vista, 'membro').filter((m) => !m.archiviato).length;
  const giorno = oggi();
  const presto = daUsarePresto(lotti, giorno);
  const { piatti } = useOggiSiMangia();
  const data = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <>
      <p className="tenue" style={{ textTransform: 'capitalize' }}>
        {data}
      </p>
      <h2>{famiglia ? `Ciao, ${String(famiglia.nome)}` : 'Ciao'}</h2>

      <section className="scheda" aria-label="Oggi si mangia">
        <h3 style={{ marginTop: 0 }}>Oggi si mangia</h3>
        {piatti.length === 0 ? (
          <p className="tenue" style={{ margin: 0 }}>
            Niente in menu per oggi.
          </p>
        ) : (
          <ul className="elenco">
            {piatti.map(({ categoria, portata, titolo }) => (
              <li key={portata.id} className="riga">
                <span aria-hidden>{categoria.emoji}</span>
                <span className="cresce">
                  {titolo} <span className="tenue">· {categoria.nome.toLowerCase()}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="riga" style={{ marginTop: 12 }}>
          <button className="bottone piccolo" onClick={() => vai('menu')}>
            Apri il menu della settimana
          </button>
        </div>
      </section>

      <section className="scheda" aria-label="Da usare presto">
        <h3 style={{ marginTop: 0 }}>Da usare presto</h3>
        {presto.length === 0 ? (
          <p className="tenue" style={{ margin: 0 }}>
            {lotti.length ? 'Niente in scadenza nei prossimi giorni.' : 'Aggiungi ciò che hai in frigo, freezer e dispensa per vedere qui cosa usare prima.'}
          </p>
        ) : (
          <ul className="elenco">
            {presto.slice(0, 5).map((l) => {
              const ing = indice?.ingrediente(l.ingrediente_id);
              return (
                <li key={l.id} className="riga">
                  <span aria-hidden>{ing?.emoji}</span>
                  <span className="cresce">
                    {l.nome ?? ing?.nome} <span className="tenue">· {formatta({ valore: l.quantita, unita: l.unita })}</span>
                  </span>
                  <EtichettaData lotto={l} giorno={giorno} />
                </li>
              );
            })}
          </ul>
        )}
        <div className="riga" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          <button className="bottone piccolo" onClick={() => vai('casa')}>
            Vedi cosa c’è
          </button>
          <button className="bottone piccolo" onClick={() => vai('ricette')}>
            Cerca una ricetta
          </button>
        </div>
      </section>

      <div className="scheda">
        <p style={{ margin: 0 }}>
          {persone === 1 ? 'C’è 1 persona' : `Ci sono ${persone} persone`} in famiglia. Allergie ed esigenze di ognuno, nella scheda <strong>Famiglia</strong>, decidono quali ricette sono adatte.
        </p>
      </div>
      <div className="avviso info">Lista della spesa e scontrini arriveranno nelle prossime fasi.</div>
    </>
  );
}
