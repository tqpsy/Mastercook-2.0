import { useMemo, useState } from 'react';
import { useFamiglia } from '../dati/contesto';
import { avanziDi, porzioniPortata } from '../dominio/consumi';
import { consiglioCucinato } from '../dominio/cucinato';
import type { PortataMenu } from '../dominio/menu';
import { iconaRicetta, type Indice } from '../dominio/ricette';
import { giorniTra, oggi } from '../dominio/scadenze';
import { formattaGiorno, leggiNumero } from '../dominio/unita';
import { Foglio } from '../ui/Foglio';
import { ConsiglioRipiano } from '../ui/Frigo';
import { type Lotto, useLotti } from './Casa';
import { PorzioniAvanzate, SceltaLuogo, TestaPiatto, testoNumero } from './ConfermaPasto';
import { useIcone } from './Ricette';
import type { DatiMenu } from './Menu';

/** Il piatto pronto in casa di una portata cucinata in anticipo (anche già finito), se c'è. */
export function usePronti(): Map<string, Lotto> {
  const lotti = useLotti();
  return useMemo(() => new Map(lotti.filter((l) => l.portata_id).map((l) => [l.portata_id!, l])), [lotti]);
}

const fraGiorni = (n: number) => (n === 0 ? 'oggi' : n === 1 ? 'domani' : `fra ${n} giorni`);

/**
 * «Cucinato»: il piatto preparato in anticipo. Tolgo subito dalla casa gli ingredienti e metto il piatto
 * pronto in frigo (o in freezer) con la data stimata, che si può cambiare. Se si mangia oltre 2 giorni (o
 * oltre quanto regge quel piatto) un avviso consiglia il freezer; in frigo, il ripiano giusto.
 */
export function SegnaCucinato({
  indice,
  dati,
  portata,
  titolo,
  chiudi,
}: {
  indice: Indice;
  dati: DatiMenu;
  portata: PortataMenu;
  titolo: string;
  chiudi: () => void;
}) {
  const { esegui } = useFamiglia();
  const icone = useIcone();
  const giorno = oggi();
  const dopo = avanziDi(portata, dati.portate);
  const porzioni = [portata, ...dopo].reduce((t, p) => t + porzioniPortata(p, dati.persone, dati.eccezioni, dati.ospiti), 0);
  const ultimo = dopo.length ? dopo[dopo.length - 1].data : portata.data;
  const ricetta = portata.ricetta_id ? indice.perId.get(portata.ricetta_id) : undefined;
  const regola = ricetta?.conservazione ? indice.catalogo.regole_cotti.find((r) => r.id === ricetta.conservazione) : undefined;
  const c = consiglioCucinato(regola, giorno, ultimo);
  const [luogo, setLuogo] = useState<'frigo' | 'freezer'>(c.congela ? 'freezer' : 'frigo');
  const [avviso, setAvviso] = useState(c.congela);
  const [entro, setEntro] = useState(c.congela ? c.entroFreezer : c.entroFrigo);
  const [quante, setQuante] = useState(testoNumero(Math.round(porzioni * 2) / 2));
  const [errore, setErrore] = useState<string | null>(null);

  function cambiaLuogo(l: 'frigo' | 'freezer') {
    setLuogo(l);
    // La data segue il posto; poi la si può sempre cambiare a mano.
    setEntro(l === 'freezer' ? c.entroFreezer : c.entroFrigo);
  }

  async function salva() {
    const q = leggiNumero(quante);
    if (q === null || q <= 0) return setErrore('Scrivi quante porzioni hai cucinato.');
    if (!entro) return setErrore('Scrivi fino a quando si può mangiare.');
    const automatica = entro === (luogo === 'freezer' ? c.entroFreezer : c.entroFrigo);
    await esegui('cucina_portata', {
      id: crypto.randomUUID(),
      portata_id: portata.id,
      nome: titolo.slice(0, 120),
      porzioni: q,
      luogo,
      data_limite: entro,
      ...(automatica
        ? {
            tipo_data: 'stimata',
            fonte_data: 'app',
            calcolata_il: new Date().toISOString(),
            affidabilita: 'bassa',
          }
        : { tipo_data: 'scadenza', fonte_data: 'utente' }),
    });
    chiudi();
  }

  const quando = `${fraGiorni(c.giorniAlPasto)}${c.giorniAlPasto > 1 ? ` (${formattaGiorno(ultimo)})` : ''}`;
  const automatica = entro && entro === (luogo === 'freezer' ? c.entroFreezer : c.entroFrigo);
  const icona = ricetta ? iconaRicetta(indice, ricetta, icone.get(ricetta.id)) : '🍽️';
  const regge = c.limiteFrigo === 1 ? '1 giorno' : `${c.limiteFrigo} giorni`;
  // L'avviso dopo il foglio: così si apre sopra.
  return (
    <>
      <Foglio titolo="Cucinato" chiudi={chiudi}>
        <TestaPiatto icona={icona} titolo={titolo} sotto={`Da mangiare ${quando}`} />

        <div className="riquadro-porzioni">
          <span>Porzioni cucinate</span>
          <PorzioniAvanzate nome="Porzioni cucinate" valore={quante} cambia={setQuante} />
        </div>

        <div className="campo">
          <span>Dove lo metti?</span>
          <SceltaLuogo
            etichetta="Dove lo metti"
            luogo={luogo}
            cambia={cambiaLuogo}
            frigo={c.congela ? `regge solo ${regge}` : `entro ${formattaGiorno(c.entroFrigo)}`}
            freezer="fino a 3 mesi"
            consigliato={c.congela ? 'freezer' : 'frigo'}
          />
        </div>
        {luogo === 'frigo' ? (
          c.congela ? (
            <div className="avviso errore">
              ❄️ Lo mangiate {quando}: in frigo regge al massimo {regge}. Meglio il freezer.
            </div>
          ) : (
            <ConsiglioRipiano ripiano={c.ripiano} />
          )
        ) : (
          <p className="tenue piccolo">In freezer: il giorno prima spostalo in frigo a scongelare (sul ripiano basso, in un piatto).</p>
        )}

        <label className="campo riga-data">
          <span>Da mangiare entro</span>
          <input type="date" className="dato" value={entro} min={giorno} onChange={(e) => setEntro(e.target.value)} />
        </label>
        <p className="tenue piccolo" style={{ marginTop: -6 }}>
          {automatica
            ? `Calcolata da oggi (${giorniTra(giorno, entro) === 1 ? '1 giorno' : `${giorniTra(giorno, entro)} giorni`} in ${luogo}): puoi cambiarla.`
            : 'Data scritta da te.'}
        </p>

        {errore && (
          <div className="avviso errore" role="alert">
            {errore}
          </div>
        )}
        <button className="bottone primario pieno grande" onClick={salva}>
          🍳 Cucinato, metti in {luogo}
        </button>
        <p className="tenue piccolo nota-piede">Gli ingredienti li tolgo adesso dalla casa: quando lo mangiate non li tolgo una seconda volta.</p>
      </Foglio>
      {avviso && (
        <Foglio titolo="Meglio congelarlo" chiudi={() => setAvviso(false)}>
          <p style={{ marginTop: 0 }}>
            ❄️ <strong>{titolo}</strong> lo mangiate {quando}. In frigo un piatto cotto come questo si tiene al massimo{' '}
            {c.limiteFrigo === 1 ? '1 giorno' : `${c.limiteFrigo} giorni`}.
          </p>
          <p>Mettilo in freezer appena si è raffreddato e spostalo in frigo il giorno prima di mangiarlo.</p>
          <button
            className="bottone primario pieno"
            onClick={() => {
              cambiaLuogo('freezer');
              setAvviso(false);
            }}
          >
            ❄️ Va in freezer
          </button>
          <button
            className="bottone pieno"
            style={{ marginTop: 8 }}
            onClick={() => {
              cambiaLuogo('frigo');
              setAvviso(false);
            }}
          >
            Lo tengo in frigo lo stesso
          </button>
        </Foglio>
      )}
    </>
  );
}

