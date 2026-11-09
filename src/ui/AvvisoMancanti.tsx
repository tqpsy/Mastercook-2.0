import { useEffect, useState } from 'react';
import { useFamiglia, useVista } from '../dati/contesto';
import { useIndice } from '../dati/indice';
import { type Mancante, mancantiDi, descriviMancanti } from '../dominio/mancanti';

const TIPI = new Set(['conferma_pasto', 'cucina_portata', 'usa_ricetta']);

/**
 * Dopo «Mangiato», «Cucinato» o «Hai finito di cucinare», se la casa non aveva tutti gli ingredienti, lo dice:
 * la casa e il pasto non coincidono (comprato e non registrato? finito prima?). Si chiude con un tocco.
 */
export function AvvisoMancanti() {
  const { sync } = useFamiglia();
  const indice = useIndice(useVista());
  const [mancanti, setMancanti] = useState<Mancante[]>([]);

  useEffect(
    () =>
      sync.ascoltaApplicati((voce, esito) => {
        if (!TIPI.has(voce.comando.tipo)) return;
        const m = mancantiDi(esito.dettaglio);
        if (m.length) setMancanti(m);
      }),
    [sync],
  );

  if (!mancanti.length || !indice) return null;
  return (
    <div className="avviso" role="status">
      In casa non c’era abbastanza (o era scaduto): {descriviMancanti(indice, mancanti)}. Ho tolto quello che c’era. Se li avevi, aggiungili o correggi le quantità in Casa.
      <button className="link" style={{ marginLeft: 8 }} onClick={() => setMancanti([])}>
        Ok
      </button>
    </div>
  );
}
