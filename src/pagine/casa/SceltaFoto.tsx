import { Foglio } from '../../ui/Foglio';
import { VoceVerifica } from '../Verifica';

/**
 * Un solo ingresso per le foto in Casa: si sceglie se aggiungere quello che si vede
 * (Foto del frigo) o controllare cosa non torna (Verifica con le foto).
 */
export function SceltaFoto({ aggiungi, verifica, chiudi }: { aggiungi: () => void; verifica: () => void; chiudi: () => void }) {
  return (
    <Foglio titolo="Foto" chiudi={chiudi}>
      <p className="tenue" style={{ marginTop: 0 }}>
        Cosa vuoi fare con le foto?
      </p>
      <button className="voce scheda voce-verifica" onClick={aggiungi}>
        <span className="emoji" aria-hidden>
          📷
        </span>
        <span className="cresce">
          <strong>Aggiungi quello che vedi</strong>
          <br />
          <span className="tenue piccolo">Fotografa frigo, freezer o dispensa: ti propongo cosa mettere in casa</span>
        </span>
      </button>
      <VoceVerifica apri={verifica} />
    </Foglio>
  );
}
