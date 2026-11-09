import { useMemo, useState } from 'react';
import { useFamiglia, useVista } from '../dati/contesto';
import { NOME_LUOGO } from '../catalogo/tipi';
import type { Indice } from '../dominio/ricette';
import { giorniTra, oggi, piuGiorni, stima } from '../dominio/scadenze';
import { confronta, contestoPerGemini, type Decisione, ingredientiDelMenu, MAX_FOTO_ZONA, memoriaDa, preparaVerifica, prodottiNoti, ultimeVerifiche, type Visto, vistiDaGemini, zoneBase, zoneDa } from '../dominio/verifica';
import type { VistoInZona } from '../../supabase/functions/foto-frigo/nucleo';
import { riconosciZona } from '../piattaforma/fotoFrigo';
import { Foglio } from '../ui/Foglio';
import { useLotti } from './Casa';
import { avvisoLetto, CHIAVE_AVVISO, SPIEGA_ERRORE } from './FotoFrigo';
import { useDatiMenu } from './Menu';
import { useFrigo } from './MioFrigo';
import { FotoZona, Lettura, type StatoLettura } from './verifica/Lettura';
import { Risultato } from './verifica/Risultato';
import { GestioneZone } from './verifica/GestioneZone';

type Passo = 'zone' | 'gestione' | 'scatta' | 'leggo' | 'risultato' | 'riepilogo' | 'fatto';

/** Le impostazioni della famiglia (zone, memoria, ultime verifiche). */
function useImpostazioni(): Record<string, unknown> | undefined {
  return useVista().righe.famiglia?.find((r) => !r.eliminato_il)?.impostazioni as Record<string, unknown> | undefined;
}

/** Le zone della verifica (salvate o ricavate dal frigo) e la data dell'ultima verifica di ognuna. */
export function useZoneVerifica() {
  const impostazioni = useImpostazioni();
  const frigo = useFrigo();
  const chiave = JSON.stringify([impostazioni?.verifica ?? null, frigo]);
  return useMemo(
    () => ({ zone: zoneDa(impostazioni, frigo), ultime: ultimeVerifiche(impostazioni), memoria: memoriaDa(impostazioni), frigo }),
    [chiave], // eslint-disable-line react-hooks/exhaustive-deps
  );
}

function quandoUltima(data: string | undefined, giorno: string): string {
  if (!data) return 'mai verificata';
  const g = giorniTra(data, giorno);
  return g <= 0 ? 'verificata oggi' : g === 1 ? 'ieri' : `${g} giorni fa`;
}

/** La voce in Casa: apre la verifica e dice quando è stata fatta l'ultima. */
export function VoceVerifica({ apri }: { apri: () => void }) {
  const { ultime } = useZoneVerifica();
  const ultima = Object.values(ultime).sort().at(-1);
  return (
    <button className="voce scheda voce-verifica" onClick={apri}>
      <span className="emoji" aria-hidden>
        🔍
      </span>
      <span className="cresce">
        <strong>Verifica con le foto</strong>
        <br />
        <span className="tenue piccolo">Fotografa il frigo: ti mostro solo cosa non torna</span>
      </span>
      <span className="etichetta">{ultima ? quandoUltima(ultima, oggi()) : 'mai fatta'}</span>
    </button>
  );
}

/**
 * Verifica con le foto: zone → foto → confronto → decisioni → riepilogo → conferma. In casa cambia solo ciò che
 * la persona conferma nel riepilogo; le foto restano sul telefono finché il foglio è aperto e poi spariscono.
 */
export function Verifica({ indice, chiudi }: { indice: Indice; chiudi: () => void }) {
  const { esegui, famiglia, dove, utenteId } = useFamiglia();
  const vista = useVista();
  const { zone, ultime, memoria, frigo } = useZoneVerifica();
  const lottiCasa = useLotti();
  const { portate } = useDatiMenu(vista);
  const giorno = oggi();
  const [letto, setLetto] = useState(avvisoLetto);
  const [passo, setPasso] = useState<Passo>('zone');
  const [modo, setModo] = useState<'guidata' | 'libera'>('guidata');
  const [scelte, setScelte] = useState<string[]>([]);
  const [foto, setFoto] = useState<Record<string, Blob[]>>({});
  const [guida, setGuida] = useState(0);
  const [visti, setVisti] = useState<Visto[]>([]);
  const [fotografate, setFotografate] = useState<string[]>([]);
  const [completa, setCompleta] = useState(false);
  const [decisioni, setDecisioni] = useState<Record<string, Decisione>>({});
  const [correzioni, setCorrezioni] = useState<Record<string, string>>({});
  /** Righe spostate nel posto giusto (chiave → parte del frigo). */
  const [spostati, setSpostati] = useState<Record<string, string>>({});
  const [errore, setErrore] = useState<string | null>(null);
  const [lettura, setLettura] = useState<Record<string, StatoLettura>>({});
  const [esito, setEsito] = useState(0);

  const lotti = useMemo(
    () => lottiCasa.map((l) => ({ id: l.id, ingrediente_id: l.ingrediente_id, quantita: l.quantita, unita: l.unita, luogo: l.luogo, posto: l.posto, data_limite: l.data_limite })),
    [lottiCasa],
  );
  const menu = useMemo(() => ingredientiDelMenu(indice, portate, giorno, piuGiorni(giorno, 7)), [indice, portate, giorno]);
  const righe = useMemo(
    () => (passo === 'risultato' || passo === 'riepilogo' ? confronta({ indice, lotti, zone, fotografate, visti, memoria, menu, correzioni, frigo }) : []),
    [passo, indice, lotti, zone, fotografate, visti, memoria, menu, correzioni, frigo],
  );
  const zoneScelte = zone.filter((z) => scelte.includes(z.id));

  function aggiungiFoto(id: string, f: Blob) {
    setFoto((x) => ({ ...x, [id]: [...(x[id] ?? []), f].slice(0, MAX_FOTO_ZONA) }));
  }
  function togliFoto(id: string, i: number) {
    setFoto((x) => ({ ...x, [id]: (x[id] ?? []).filter((_, j) => j !== i) }));
  }

  async function leggi() {
    const daLeggere = zoneScelte.filter((z) => foto[z.id]?.length);
    if (!daLeggere.length) return setErrore('Fai almeno una foto.');
    setErrore(null);
    setLettura(Object.fromEntries(daLeggere.map((z) => [z.id, { fase: 'attesa', visti: [] } satisfies StatoLettura])));
    setPasso('leggo');
    const nomiMenu = [...menu.keys()].map((id) => indice.ingrediente(id)?.nome.toLowerCase()).filter((x): x is string => !!x);
    const perZona = new Map<string, Visto[]>();
    let fallita: string | null = null;
    // Due zone alla volta: Gemini risponde prima e la quota gratuita (richieste al minuto) regge.
    const coda = [...daLeggere];
    const lavora = async () => {
      for (let z = coda.shift(); z && !fallita; z = coda.shift()) {
        const zona = z;
        const noti = prodottiNoti(indice, lotti, zone, memoria, zona.luogo);
        const aggiorna = (fase: StatoLettura['fase'], visti: VistoInZona[]) => setLettura((x) => ({ ...x, [zona.id]: { fase, visti } }));
        const r = await riconosciZona(famiglia, foto[zona.id], contestoPerGemini(zona, foto[zona.id].length, noti, nomiMenu, memoria), { dove, utenteId }, aggiorna);
        if ('errore' in r) {
          fallita ??= SPIEGA_ERRORE[r.errore] + (r.dettaglio ? ` (Risposta di Google: ${r.dettaglio})` : '');
          return;
        }
        aggiorna('fatto', r.visti);
        perZona.set(zona.id, vistiDaGemini(zona.id, r.visti, noti));
      }
    };
    await Promise.all([lavora(), lavora()]);
    if (fallita) {
      setErrore(fallita);
      return setPasso('scatta');
    }
    setVisti(daLeggere.flatMap((z) => perZona.get(z.id) ?? []));
    setFotografate(daLeggere.map((z) => z.id));
    setDecisioni({});
    setSpostati({});
    setPasso('risultato');
  }

  const preparata = useMemo(
    () =>
      passo === 'riepilogo'
        ? preparaVerifica({
            righe,
            decisioni,
            zone,
            fotografate,
            correzioni,
            nuovoId: () => crypto.randomUUID(),
            stima: (ing, luogo) => stima(ing, luogo, giorno),
            spostati,
          })
        : null,
    [passo, righe, decisioni, zone, fotografate, correzioni, giorno, spostati],
  );

  async function conferma() {
    if (!preparata) return;
    await esegui('verifica_inventario', { data: giorno, ...preparata.dati });
    setEsito(preparata.modifiche.length);
    setFoto({});
    setPasso('fatto');
  }

  if (!letto) {
    return (
      <Foglio titolo="Verifica con le foto" chiudi={chiudi}>
        <p style={{ marginTop: 0 }}>
          Fotografi una o più zone del frigo e Gemini di Google le confronta con ciò che c’è in casa. Ti mostro solo cosa non torna: decidi tu, e in casa non cambia
          niente finché non confermi.
        </p>
        <div className="avviso" role="note">
          Le foto vengono inviate a Gemini di Google con la chiave della famiglia. Per chi è in Europa <strong>Google non le usa per addestrare i suoi modelli</strong>,
          ma le può conservare per un periodo limitato per i controlli contro gli abusi. Non fotografare persone o documenti. Le foto non vengono salvate nell’app.
        </div>
        <button
          className="bottone primario pieno"
          style={{ marginTop: 12 }}
          onClick={() => {
            try {
              localStorage.setItem(CHIAVE_AVVISO, 'si');
            } catch {
              // Lo richiederà la prossima volta.
            }
            setLetto(true);
          }}
        >
          Ho capito, continua
        </button>
      </Foglio>
    );
  }

  return (
    <Foglio titolo="Verifica con le foto" chiudi={chiudi} alto>
      {passo === 'zone' && (
        <>
          <p className="tenue" style={{ marginTop: 0 }}>
            Quali zone fotografi?
          </p>
          <div className="zone-verifica" role="group" aria-label="Zone da fotografare">
            {zone.map((z) => (
              <button
                key={z.id}
                type="button"
                aria-pressed={scelte.includes(z.id)}
                onClick={() => setScelte((s) => (s.includes(z.id) ? s.filter((x) => x !== z.id) : [...s, z.id]))}
              >
                <strong>{z.nome}</strong>
                <span className="piccolo">
                  {z.luogo !== 'frigo' ? `${NOME_LUOGO[z.luogo]} · ` : ''}
                  {quandoUltima(ultime[z.id], giorno)}
                </span>
              </button>
            ))}
          </div>
          <div className="riga" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
            <button type="button" className="bottone piccolo" onClick={() => setScelte(scelte.length === zone.length ? [] : zone.map((z) => z.id))}>
              {scelte.length === zone.length ? 'Nessuna' : 'Tutte'}
            </button>
            <button type="button" className="bottone piccolo" onClick={() => setPasso('gestione')}>
              ✎ Modifica zone
            </button>
          </div>
          <div className="scelte" role="radiogroup" aria-label="Come fotografi">
            <button type="button" aria-pressed={modo === 'guidata'} onClick={() => setModo('guidata')}>
              Guidata, una zona alla volta
            </button>
            <button type="button" aria-pressed={modo === 'libera'} onClick={() => setModo('libera')}>
              Libera
            </button>
          </div>
          <button
            className="bottone primario pieno"
            disabled={!scelte.length}
            onClick={() => {
              setGuida(0);
              setErrore(null);
              setPasso('scatta');
            }}
          >
            Inizia ({scelte.length} {scelte.length === 1 ? 'zona' : 'zone'})
          </button>
        </>
      )}

      {passo === 'gestione' && <GestioneZone zone={zone} frigoBase={zoneBase(frigo)} fatto={() => setPasso('zone')} />}

      {passo === 'scatta' &&
        (modo === 'guidata' && zoneScelte[guida] ? (
          <>
            <p className="tenue" style={{ marginTop: 0 }}>
              Zona {guida + 1} di {zoneScelte.length}
            </p>
            <h3 style={{ marginTop: 0 }}>{zoneScelte[guida].nome}</h3>
            <p className="tenue piccolo">Inquadra tutta la zona. Se qualcosa è dietro, aggiungi un’altra foto da un’altra angolazione.</p>
            <FotoZona zona={zoneScelte[guida]} foto={foto[zoneScelte[guida].id] ?? []} aggiungi={(f) => aggiungiFoto(zoneScelte[guida].id, f)} togli={(i) => togliFoto(zoneScelte[guida].id, i)} />
            <div className="riga" style={{ marginTop: 12 }}>
              <button className="bottone" onClick={() => (guida > 0 ? setGuida(guida - 1) : setPasso('zone'))}>
                Indietro
              </button>
              {guida < zoneScelte.length - 1 ? (
                <button className="bottone primario cresce" onClick={() => setGuida(guida + 1)}>
                  {foto[zoneScelte[guida].id]?.length ? 'Avanti' : 'Salta questa zona'}
                </button>
              ) : (
                <button className="bottone primario cresce" disabled={!zoneScelte.some((z) => foto[z.id]?.length)} onClick={() => void leggi()}>
                  Confronta con la casa
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            {zoneScelte.map((z) => (
              <section key={z.id} className="scheda" aria-label={z.nome}>
                <h3 style={{ marginTop: 0 }}>{z.nome}</h3>
                <FotoZona zona={z} foto={foto[z.id] ?? []} aggiungi={(f) => aggiungiFoto(z.id, f)} togli={(i) => togliFoto(z.id, i)} />
              </section>
            ))}
            <div className="riga">
              <button className="bottone" onClick={() => setPasso('zone')}>
                Zone
              </button>
              <button className="bottone primario cresce" disabled={!zoneScelte.some((z) => foto[z.id]?.length)} onClick={() => void leggi()}>
                Confronta con la casa
              </button>
            </div>
          </>
        ))}

      {passo === 'leggo' && <Lettura zone={zoneScelte.filter((z) => lettura[z.id])} foto={foto} stato={lettura} />}

      {passo === 'risultato' && (
        <Risultato
          indice={indice}
          righe={righe}
          zone={zone}
          completa={completa}
          setCompleta={setCompleta}
          decisioni={decisioni}
          decidi={(chiave, d) =>
            setDecisioni((x) => {
              const n = { ...x };
              if (d) n[chiave] = d;
              else delete n[chiave];
              return n;
            })
          }
          correggi={(nomi, ing) => setCorrezioni((c) => ({ ...c, ...Object.fromEntries(nomi.map((n) => [n, ing.id])) }))}
          spostati={spostati}
          sposta={(chiave, posto) =>
            setSpostati((x) => {
              const n = { ...x };
              if (posto) n[chiave] = posto;
              else delete n[chiave];
              return n;
            })
          }
          avanti={() => setPasso('riepilogo')}
          rifai={() => setPasso('scatta')}
        />
      )}

      {passo === 'riepilogo' && preparata && (
        <>
          <h3 style={{ marginTop: 0 }}>Prima di aggiornare la casa</h3>
          {preparata.modifiche.length ? (
            <ul className="elenco" aria-label="Modifiche">
              {preparata.modifiche.map((m) => (
                <li key={m.chiave} className="riga spazio">
                  <strong>{m.nome}</strong>
                  <span>
                    <span className="tenue">{m.prima}</span> → {m.dopo}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>In casa non cambia niente: segno solo che hai controllato{Object.keys(preparata.dati.impara.posizioni).length ? ' e dove stanno le cose' : ''}.</p>
          )}
          <p className="tenue piccolo">
            Le modifiche restano nella cronologia di ogni alimento («Verifica con foto: da … a …»). Le righe che non hai deciso restano come sono.
          </p>
          <div className="riga">
            <button className="bottone" onClick={() => setPasso('risultato')}>
              Indietro
            </button>
            <button className="bottone primario cresce" onClick={() => void conferma()}>
              {preparata.modifiche.length ? `Conferma e aggiorna (${preparata.modifiche.length})` : 'Conferma'}
            </button>
          </div>
        </>
      )}

      {passo === 'fatto' && (
        <>
          <p style={{ marginTop: 0 }} role="status">
            {esito ? `Fatto: ${esito === 1 ? '1 modifica' : `${esito} modifiche`} in casa.` : 'Fatto: la casa era già a posto.'} La prossima volta riconosco meglio ciò che
            hai corretto.
          </p>
          <button className="bottone primario pieno" onClick={chiudi}>
            Chiudi
          </button>
        </>
      )}

      {errore && (
        <div className="avviso errore" role="alert" style={{ marginTop: 12 }}>
          {errore}
        </div>
      )}
    </Foglio>
  );
}
