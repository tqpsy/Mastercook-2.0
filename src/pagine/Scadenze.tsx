/** Scadenze: tutti i prodotti scaduti, da usare oggi o in scadenza nei prossimi giorni, in un unico elenco (gli stessi di «Da usare presto» in Oggi e in Casa). */
import { useVista } from '../dati/contesto';
import { useIndice } from '../dati/indice';
import { useLotti } from '../dati/lotti';
import { daUsarePresto, oggi } from '../dominio/scadenze';
import { ElencoLotti } from './Casa';

export function Scadenze({ vai }: { vai: (scheda: 'casa') => void }) {
  const vista = useVista();
  const indice = useIndice(vista);
  const lotti = useLotti();
  const giorno = oggi();
  const presto = daUsarePresto(lotti, giorno);

  if (!vista.pronta || !indice) return <p className="tenue">Sto caricando le scadenze…</p>;

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Scadenze</h2>
      {presto.length === 0 ? (
        <div className="avviso info">Niente in scadenza: tutto a posto in casa.</div>
      ) : (
        <>
          <p className="tenue" style={{ marginTop: 0 }}>
            {presto.length === 1 ? '1 prodotto' : `${presto.length} prodotti`} scaduti, da usare oggi o in scadenza nei prossimi giorni.
          </p>
          <ElencoLotti indice={indice} lotti={presto} giorno={giorno} apri={() => vai('casa')} conLuogo />
        </>
      )}
    </>
  );
}
