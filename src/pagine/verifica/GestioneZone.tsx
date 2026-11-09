import { useState } from 'react';
import { useFamiglia } from '../../dati/contesto';
import { NOME_LUOGO, LUOGHI } from '../../catalogo/tipi';
import { type Luogo } from '../../dominio/scadenze';
import { idNuovaZona, MAX_ZONE, type ZonaVerifica } from '../../dominio/verifica';

/** Aggiungere, togliere e rinominare le zone. Si salvano per tutta la famiglia. */
export function GestioneZone({ zone: iniziali, frigoBase, fatto }: { zone: ZonaVerifica[]; frigoBase: ZonaVerifica[]; fatto: () => void }) {
  const { esegui } = useFamiglia();
  const [zone, setZone] = useState(iniziali);
  const [errore, setErrore] = useState<string | null>(null);
  const cambia = (i: number, campi: Partial<ZonaVerifica>) => setZone((z) => z.map((x, j) => (j === i ? { ...x, ...campi } : x)));
  return (
    <>
      <p className="tenue" style={{ marginTop: 0 }}>
        Le zone valgono per tutta la famiglia. Una zona del frigo collegata a un ripiano riconosce subito gli alimenti che ci hai messo.
      </p>
      <ul className="elenco" aria-label="Zone">
        {zone.map((z, i) => (
          <li key={z.id} className="riga" style={{ flexWrap: 'wrap' }}>
            <input className="dato cresce" aria-label={`Nome della zona ${i + 1}`} value={z.nome} maxLength={40} onChange={(e) => cambia(i, { nome: e.target.value })} />
            <select className="dato" aria-label={`Dove sta ${z.nome}`} value={z.luogo} onChange={(e) => cambia(i, { luogo: e.target.value as Luogo })}>
              {LUOGHI.map((l) => (
                <option key={l} value={l}>
                  {NOME_LUOGO[l]}
                </option>
              ))}
            </select>
            <button type="button" className="bottone piccolo" aria-label={`Togli ${z.nome}`} disabled={zone.length <= 1} onClick={() => setZone((x) => x.filter((_, j) => j !== i))}>
              Togli
            </button>
          </li>
        ))}
      </ul>
      <div className="riga" style={{ flexWrap: 'wrap', margin: '12px 0' }}>
        <button
          type="button"
          className="bottone piccolo"
          disabled={zone.length >= MAX_ZONE}
          onClick={() => setZone((x) => [...x, { id: idNuovaZona(x), nome: `Zona ${x.length + 1}`, luogo: 'frigo' }])}
        >
          + Aggiungi zona
        </button>
        <button type="button" className="bottone piccolo" onClick={() => setZone(frigoBase)}>
          Torna alle zone del frigo
        </button>
      </div>
      {errore && (
        <div className="avviso errore" role="alert">
          {errore}
        </div>
      )}
      <div className="riga">
        <button className="bottone" onClick={fatto}>
          Annulla
        </button>
        <button
          className="bottone primario cresce"
          onClick={async () => {
            const pulite = zone.map((z) => ({ ...z, nome: z.nome.trim() }));
            if (pulite.some((z) => !z.nome)) return setErrore('Ogni zona ha bisogno di un nome.');
            const uguali = JSON.stringify(pulite) === JSON.stringify(frigoBase);
            await esegui('imposta_zone_verifica', { zone: uguali ? null : pulite });
            fatto();
          }}
        >
          Salva le zone
        </button>
      </div>
    </>
  );
}
