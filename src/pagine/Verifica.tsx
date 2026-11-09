import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useFamiglia, useVista } from '../dati/contesto';
import { NOME_LUOGO, LUOGHI } from '../catalogo/tipi';
import { iconaIngrediente } from '../dominio/iconeCibo';
import type { Indice, Ingrediente } from '../dominio/ricette';
import { giorniTra, type Luogo, oggi, piuGiorni, stima } from '../dominio/scadenze';
import { formatta, leggiNumero, type Scritta, scrittaVuota, totaleScritta, UNITA_BASE } from '../dominio/unita';
import { CampoQuantita } from '../ui/CampoQuantita';
import {
  confronta,
  contestoPerGemini,
  daGuardare,
  type Decisione,
  idNuovaZona,
  ingredientiDelMenu,
  MAX_FOTO_ZONA,
  MAX_ZONE,
  memoriaDa,
  NOME_TIPO,
  preparaVerifica,
  prodottiNoti,
  type RigaVerifica,
  type TipoRiga,
  ultimeVerifiche,
  type Visto,
  vistiDaGemini,
  type ZonaVerifica,
  zoneBase,
  zoneDa,
} from '../dominio/verifica';
import type { VistoInZona } from '../../supabase/functions/foto-frigo/nucleo';
import type { FaseLettura } from '../piattaforma/fotoFrigo';
import { avviaVerifica, fotoDellaZona, scartaVerifica, segnaAperta, useLetture } from '../piattaforma/letturaFoto';
import { CercaIngrediente } from '../ui/CercaIngrediente';
import { Foglio } from '../ui/Foglio';
import { LATO_ANALISI, riduciFoto } from '../ui/Foto';
import { IconaCibo } from '../ui/IconaCibo';
import { useLotti } from './Casa';
import { avvisoLetto, CHIAVE_AVVISO, SPIEGA_ERRORE } from './FotoFrigo';
import { useDatiMenu } from './Menu';
import { useFrigo } from './MioFrigo';

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

function Miniatura({ foto, togli }: { foto: Blob; togli: () => void }) {
  const url = useMemo(() => URL.createObjectURL(foto), [foto]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <span className="miniatura-verifica">
      {url && <img src={url} alt="Foto della zona" />}
      <button type="button" aria-label="Togli questa foto" onClick={togli}>
        ✕
      </button>
    </span>
  );
}

function FotoZona({ zona, foto, aggiungi, togli }: { zona: ZonaVerifica; foto: Blob[]; aggiungi: (f: Blob) => void; togli: (i: number) => void }) {
  const [riduco, setRiduco] = useState(false);
  const scegli = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setRiduco(true);
    try {
      aggiungi(await riduciFoto(f, LATO_ANALISI));
    } finally {
      setRiduco(false);
    }
  };
  return (
    <div className="foto-zona">
      {foto.length > 0 && (
        <div className="miniature-verifica">
          {foto.map((f, i) => (
            <Miniatura key={i} foto={f} togli={() => togli(i)} />
          ))}
        </div>
      )}
      {foto.length < MAX_FOTO_ZONA && (
        <>
          <label className={`bottone ${foto.length ? '' : 'primario '}pieno`} aria-busy={riduco}>
            <span aria-hidden>📷</span> {foto.length ? 'Un’altra angolazione' : `Fotografa ${zona.nome.toLowerCase()}`}
            <input type="file" accept="image/*" capture="environment" hidden aria-label={`Foto di ${zona.nome}`} onChange={scegli} />
          </label>
          <label className="bottone pieno" style={{ marginTop: 8 }} aria-busy={riduco}>
            <span aria-hidden>🖼️</span> Scegli dalla galleria
            <input type="file" accept="image/*" hidden aria-label={`Galleria del telefono per ${zona.nome}`} onChange={scegli} />
          </label>
        </>
      )}
    </div>
  );
}

type StatoLettura = { fase: 'attesa' | FaseLettura | 'fatto'; visti: VistoInZona[] };

const NOME_FASE: Record<StatoLettura['fase'], string> = {
  attesa: 'In attesa',
  preparo: 'Preparo le foto',
  invio: 'Mando le foto a Google',
  guarda: 'Gemini guarda le foto',
  fatto: 'Fatto',
};

/** Quanto di una zona è fatto, per la barra: le fasi vere e poi un po' per ogni alimento trovato. */
function quotaFatta(s: StatoLettura): number {
  if (s.fase === 'fatto') return 1;
  if (s.fase === 'attesa') return 0;
  if (s.fase === 'preparo') return 0.05;
  if (s.fase === 'invio') return 0.15;
  return Math.min(0.9, 0.25 + s.visti.length * 0.06);
}

/** I secondi passati da quando il componente è comparso. */
function useSecondi(): number {
  const [inizio] = useState(() => Date.now());
  const [ora, setOra] = useState(inizio);
  useEffect(() => {
    const t = setInterval(() => setOra(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.floor((ora - inizio) / 1000));
}

function quantoVisto(v: VistoInZona): string {
  return v.quantita !== null && v.unita ? `${v.nome} · ${formatta({ valore: v.quantita, unita: v.unita })}` : v.nome;
}

/** Una foto della zona con i riquadri degli alimenti trovati finora; l'ultimo trovato è evidenziato. */
function FotoConRiquadri({ foto, visti, cerca }: { foto: Blob; visti: { v: VistoInZona; ultimo: boolean }[]; cerca: boolean }) {
  // L'indirizzo della foto vive quanto l'immagine (anche con i doppi montaggi di React in sviluppo).
  const mostra = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img) return;
      const u = URL.createObjectURL(foto);
      img.src = u;
      return () => URL.revokeObjectURL(u);
    },
    [foto],
  );
  return (
    <div className={`foto-lettura${cerca ? ' cerca' : ''}`}>
      <img ref={mostra} alt="Foto che Gemini sta guardando" />
      {visti.map(({ v, ultimo }, i) => {
        const [y0, x0, y1, x1] = v.riquadro!;
        return (
          <span
            key={i}
            className={`riquadro-visto${ultimo ? ' ultimo' : ''}`}
            style={{ top: `${y0 / 10}%`, left: `${x0 / 10}%`, width: `${(x1 - x0) / 10}%`, height: `${(y1 - y0) / 10}%` }}
            aria-hidden
          >
            <span>{v.nome}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Mentre Gemini guarda: tempo, barra, e per ogni zona la fase, le foto con i riquadri e gli alimenti trovati. */
function Lettura({ zone, foto, stato }: { zone: ZonaVerifica[]; foto: Record<string, Blob[]>; stato: Record<string, StatoLettura> }) {
  const secondi = useSecondi();
  const finite = zone.filter((z) => stato[z.id]?.fase === 'fatto').length;
  const quota = zone.length ? zone.reduce((t, z) => t + quotaFatta(stato[z.id]), 0) / zone.length : 0;
  const trovati = zone.reduce((t, z) => t + (stato[z.id]?.visti.length ?? 0), 0);
  return (
    <div className="lettura-verifica">
      <div className="riga" style={{ justifyContent: 'space-between' }}>
        <strong>
          {finite} di {zone.length} {zone.length === 1 ? 'zona' : 'zone'}
        </strong>
        <span className="tenue" aria-label="Tempo trascorso">
          {Math.floor(secondi / 60)}:{String(secondi % 60).padStart(2, '0')}
        </span>
      </div>
      <div className="barra-lettura" role="progressbar" aria-label="Avanzamento della verifica" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(quota * 100)}>
        <span style={{ width: `${Math.round(quota * 100)}%` }} />
      </div>
      <p className="tenue piccolo" role="status" aria-live="polite" style={{ margin: '6px 0 12px' }}>
        {trovati ? `Trovati ${trovati} ${trovati === 1 ? 'alimento' : 'alimenti'} finora` : 'Gemini guarda le foto…'}
      </p>
      {zone.map((z) => {
        const s = stato[z.id];
        const lavora = s.fase !== 'attesa' && s.fase !== 'fatto';
        const fotoZona = foto[z.id] ?? [];
        return (
          <section key={z.id} className="zona-lettura" aria-label={`Lettura di ${z.nome}`} aria-busy={lavora}>
            <div className="riga" style={{ justifyContent: 'space-between' }}>
              <strong>{z.nome}</strong>
              <span className={`fase-lettura ${s.fase}`}>
                {s.fase === 'fatto' ? '✓ ' : ''}
                {s.fase === 'guarda' && s.visti.length ? `Trovati ${s.visti.length}…` : NOME_FASE[s.fase]}
              </span>
            </div>
            {s.fase !== 'attesa' && (
              <>
                <div className={`foto-lettura-elenco${fotoZona.length > 1 ? ' piu' : ''}`}>
                  {fotoZona.map((f, i) => (
                    <FotoConRiquadri
                      key={i}
                      foto={f}
                      cerca={lavora}
                      visti={s.visti.map((v, j) => ({ v, ultimo: lavora && j === s.visti.length - 1 })).filter(({ v }) => v.riquadro && (v.foto ?? 0) === i)}
                    />
                  ))}
                </div>
                {s.visti.length > 0 && (
                  <ul className="visti-lettura" aria-label={`Trovati in ${z.nome}`}>
                    {s.visti.map((v, j) => (
                      <li key={j} className={lavora && j === s.visti.length - 1 ? 'ultimo' : ''}>
                        {quantoVisto(v)}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

const NOME_CERTEZZA = { sicuro: 'sicuro', probabile: 'probabile', incerto: 'incerto' } as const;

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
  // Le letture vivono fuori da questo foglio (src/piattaforma/letturaFoto.ts): chiuderlo, cambiare scheda o passare a
  // un'altra app non le ferma, e riaprendo la verifica si ritrova il punto in cui era.
  const { zone: lettureZone } = useLetture();
  const mie = useMemo(() => lettureZone.filter((l) => l.famiglia === famiglia), [lettureZone, famiglia]);
  const [passo, setPasso] = useState<Passo>(() => (mie.length ? 'leggo' : 'zone'));
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

  function leggi() {
    const daLeggere = zoneScelte.filter((z) => foto[z.id]?.length);
    if (!daLeggere.length) return setErrore('Fai almeno una foto.');
    setErrore(null);
    const nomiMenu = [...menu.keys()].map((id) => indice.ingrediente(id)?.nome.toLowerCase()).filter((x): x is string => !!x);
    avviaVerifica({
      famiglia,
      sede: { dove, utenteId },
      zone: daLeggere.map((z) => ({
        zonaId: z.id,
        foto: foto[z.id],
        contesto: contestoPerGemini(z, foto[z.id].length, prodottiNoti(indice, lotti, zone, memoria, z.luogo), nomiMenu, memoria),
      })),
    });
    setPasso('leggo');
  }

  // Quando tutte le zone sono finite (anche se nel frattempo il foglio era chiuso) si passa al risultato, o all'errore.
  if (passo === 'leggo' && mie.length > 0 && mie.every((l) => l.fase === 'pronta' || l.fase === 'errore')) {
    const guasta = mie.find((l) => l.fase === 'errore');
    if (guasta) {
      setErrore(SPIEGA_ERRORE[guasta.errore ?? 'rete'] + (guasta.dettaglio ? ` (Risposta di Google: ${guasta.dettaglio})` : ''));
      // Le foto non si perdono: si può riprovare subito, anche se il foglio era stato chiuso.
      setScelte(zone.filter((z) => mie.some((l) => l.zonaId === z.id)).map((z) => z.id));
      setFoto((x) => ({ ...Object.fromEntries(mie.map((l) => [l.zonaId!, fotoDellaZona(l.zonaId!)])), ...x }));
      setPasso('scatta');
    } else {
      const lette = zone.filter((z) => mie.some((l) => l.zonaId === z.id));
      setVisti(lette.flatMap((z) => vistiDaGemini(z.id, mie.find((l) => l.zonaId === z.id)?.visti ?? [], prodottiNoti(indice, lotti, zone, memoria, z.luogo))));
      setFotografate(lette.map((z) => z.id));
      setDecisioni({});
      setSpostati({});
      setPasso('risultato');
    }
  }
  useEffect(() => {
    // Il risultato è passato al foglio: la lettura nello stato condiviso non serve più.
    if (passo !== 'leggo' && mie.length > 0 && mie.every((l) => l.fase === 'pronta' || l.fase === 'errore')) scartaVerifica();
  }, [passo, mie]);
  useEffect(() => {
    segnaAperta('verifica', true);
    return () => segnaAperta('verifica', false);
  }, []);
  /** Per mostrare l'avanzamento: la fase di ogni zona e gli alimenti trovati finora. */
  const stato = useMemo(
    () =>
      Object.fromEntries(
        mie.map((l) => [
          l.zonaId!,
          { fase: l.fase === 'pronta' ? 'fatto' : l.fase === 'attesa' ? 'guarda' : l.fase === 'invio' ? 'invio' : 'attesa', visti: l.visti ?? [] } satisfies StatoLettura,
        ]),
      ) as Record<string, StatoLettura>,
    [mie],
  );

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
                <button className="bottone primario cresce" disabled={!zoneScelte.some((z) => foto[z.id]?.length)} onClick={leggi}>
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
              <button className="bottone primario cresce" disabled={!zoneScelte.some((z) => foto[z.id]?.length)} onClick={leggi}>
                Confronta con la casa
              </button>
            </div>
          </>
        ))}

      {passo === 'leggo' && (
        <>
          <Lettura zone={zone.filter((z) => stato[z.id])} foto={Object.fromEntries(Object.keys(stato).map((id) => [id, foto[id] ?? fotoDellaZona(id)]))} stato={stato} />
          <p className="tenue piccolo" style={{ marginTop: 12 }}>
            {dove === 'locale'
              ? 'Tieni aperta l’app finché non ho finito: le foto vanno da questo telefono a Gemini.'
              : 'Puoi chiudere questo foglio, usare l’app o passare a un’altra: ci penso io e ti avviso qui appena è pronto.'}
          </p>
          <button className="bottone pieno" style={{ marginTop: 8 }} onClick={() => chiudi()}>
            Continua a usare l’app
          </button>
        </>
      )}

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

function Risultato({
  indice,
  righe,
  zone,
  completa,
  setCompleta,
  decisioni,
  decidi,
  correggi,
  spostati,
  sposta,
  avanti,
  rifai,
}: {
  indice: Indice;
  righe: RigaVerifica[];
  zone: ZonaVerifica[];
  completa: boolean;
  setCompleta: (x: boolean) => void;
  decisioni: Record<string, Decisione>;
  decidi: (chiave: string, d: Decisione | null) => void;
  correggi: (nomi: string[], ing: Ingrediente) => void;
  spostati: Record<string, string>;
  sposta: (chiave: string, posto: string | null) => void;
  avanti: () => void;
  rifai: () => void;
}) {
  const anomalie = daGuardare(righe);
  const mostrate = completa ? righe : anomalie;
  const gruppi = (Object.keys(NOME_TIPO) as TipoRiga[]).map((t) => ({ t, righe: mostrate.filter((r) => r.tipo === t) })).filter((g) => g.righe.length);
  const decise = new Set([...Object.keys(decisioni), ...Object.keys(spostati)].filter((k) => righe.some((r) => r.chiave === k))).size;
  return (
    <>
      <div className="scelte" role="radiogroup" aria-label="Verifica">
        <button type="button" aria-pressed={!completa} onClick={() => setCompleta(false)}>
          Rapida ({anomalie.length})
        </button>
        <button type="button" aria-pressed={completa} onClick={() => setCompleta(true)}>
          Completa ({righe.length})
        </button>
      </div>
      {!mostrate.length && <p>{righe.length ? 'Tutto torna: niente da controllare.' : 'Nelle foto non ho riconosciuto alimenti. Prova con più luce o più da vicino.'}</p>}
      {gruppi.map((g) => (
        <section key={g.t} aria-label={NOME_TIPO[g.t]}>
          <h3>
            {NOME_TIPO[g.t]} <span className="etichetta">{g.righe.length}</span>
          </h3>
          {g.t === 'non_visto' && <p className="tenue piccolo">Non visti nelle foto: potrebbero essere dietro ad altro. Dimmi tu.</p>}
          {g.t === 'posto' && <p className="tenue piccolo">Per l’igiene del frigo: spostali e dimmelo, aggiorno il posto in Casa.</p>}
          <ul className="elenco">
            {g.righe.map((r) => (
              <RigaVista
                key={r.chiave}
                indice={indice}
                r={r}
                zone={zone}
                decisione={decisioni[r.chiave] ?? null}
                decidi={(d) => decidi(r.chiave, d)}
                correggi={correggi}
                spostato={!!spostati[r.chiave]}
                sposta={(x) => sposta(r.chiave, x ? (r.avvisoPosto?.dove.id ?? null) : null)}
              />
            ))}
          </ul>
        </section>
      ))}
      <div className="riga barra-verifica">
        <button className="bottone" onClick={rifai}>
          Altre foto
        </button>
        <button className="bottone primario cresce" onClick={avanti}>
          Rivedi e conferma{decise ? ` (${decise})` : ''}
        </button>
      </div>
    </>
  );
}

function RigaVista({
  indice,
  r,
  zone,
  decisione,
  decidi,
  correggi,
  spostato,
  sposta,
}: {
  indice: Indice;
  r: RigaVerifica;
  zone: ZonaVerifica[];
  decisione: Decisione | null;
  decidi: (d: Decisione | null) => void;
  correggi: (nomi: string[], ing: Ingrediente) => void;
  spostato: boolean;
  sposta: (si: boolean) => void;
}) {
  const [apri, setApri] = useState<'quantita' | 'prodotto' | null>(null);
  const q = (v: number | null) => (v === null || !r.unita ? null : formatta({ valore: v, unita: r.unita }));
  const nome = r.ingrediente?.nome ?? `«${r.nomi[0]}»`;
  const zona = zone.find((z) => z.id === r.zona)?.nome;
  const scelto = (a: Decisione['azione']) => decisione?.azione === a;
  const tasto = (etichetta: string, d: Decisione) => (
    <button type="button" aria-pressed={scelto(d.azione) && (!('valore' in d) || (decisione as { valore?: number }).valore === d.valore)} onClick={() => decidi(scelto(d.azione) ? null : d)}>
      {etichetta}
    </button>
  );
  const nuovo = r.tipo === 'nuovo' || (r.tipo === 'incerto' && !r.lotti.length);

  let descrizione: string;
  if (r.tipo === 'non_visto') descrizione = `In casa ${q(r.inCasa)}${zona ? ` · di solito in ${zona.toLowerCase()}` : ''} · non l’ho visto`;
  else if (r.tipo === 'quantita') descrizione = `In casa ${q(r.inCasa)} · ne vedo ${q(r.visto)}`;
  else if (nuovo) descrizione = `${r.ingrediente ? 'Non è in casa' : 'Non so cos’è'} · ${q(r.visto) ? `ne vedo ${q(r.visto)}` : 'quantità da dire'}${zona ? ` · ${zona.toLowerCase()}` : ''}`;
  else descrizione = `In casa ${q(r.inCasa) ?? ''}${r.visto !== null ? ` · ne vedo ${q(r.visto)}` : ' · visto'}${r.altrove ? ` · registrato in ${r.altrove.toLowerCase()}` : ''}`;

  return (
    <li className="riga-verifica">
      <div className="riga spazio">
        <span>
          <IconaCibo valore={r.ingrediente ? iconaIngrediente(r.ingrediente) : '❓'} /> <strong>{nome}</strong>
          {r.tipo === 'incerto' && r.ingrediente && <span className="tenue"> ?</span>}
        </span>
        <span className="riga" style={{ gap: 4 }}>
          {r.menu && <span className="etichetta menu-verifica">menu</span>}
          {r.certezza && <span className={`etichetta certezza-${r.certezza}`}>{NOME_CERTEZZA[r.certezza]}</span>}
        </span>
      </div>
      <p className="tenue piccolo" style={{ margin: '4px 0 8px' }}>
        {descrizione}
        {r.tipo === 'incerto' && r.nomi.length > 0 && r.ingrediente && ` · visto come «${r.nomi.join('», «')}»`}
      </p>
      {r.avvisoPosto && (
        <div className={`avviso-posto${r.avvisoPosto.grave ? ' grave' : ''}`} role="note" aria-label={`Posto di ${nome}`}>
          <strong>
            {r.avvisoPosto.grave ? '⚠️ ' : ''}Va {r.avvisoPosto.dove.zona === 'cassetto' ? 'nel' : r.avvisoPosto.dove.zona === 'sportello' ? 'nel' : 'sul'} {r.avvisoPosto.dove.nome.toLowerCase()}.
          </strong>{' '}
          <span>{r.avvisoPosto.perche}</span>
          <div className="scelte piccole" style={{ marginTop: 8 }}>
            <button type="button" aria-pressed={spostato} onClick={() => sposta(!spostato)}>
              L’ho spostato
            </button>
            {r.tipo === 'posto' && tasto('Va bene così', { azione: 'presente' })}
          </div>
        </div>
      )}
      <div className="scelte piccole" role="group" aria-label={`Cosa fare con ${nome}`}>
        {r.tipo === 'non_visto' && (
          <>
            {tasto('C’è', { azione: 'presente' })}
            {tasto('Finito', { azione: 'terminato' })}
          </>
        )}
        {r.tipo === 'quantita' && (
          <>
            {r.visto !== null && tasto(`Sono ${q(r.visto)}`, { azione: 'quantita', valore: r.visto })}
            {tasto(`Restano ${q(r.inCasa)}`, { azione: 'presente' })}
            {tasto('Finito', { azione: 'terminato' })}
          </>
        )}
        {r.tipo === 'incerto' && r.ingrediente && (
          <button type="button" onClick={() => correggi(r.nomi, r.ingrediente!)}>
            Sì, è {r.ingrediente.nome.toLowerCase()}
          </button>
        )}
        {nuovo && r.ingrediente && r.tipo === 'nuovo' && r.visto !== null && tasto(`Aggiungi ${q(r.visto)}`, { azione: 'aggiungi', valore: r.visto })}
        {r.tipo === 'coerente' && r.lotti.length > 0 && tasto('Finito', { azione: 'terminato' })}
        {(r.lotti.length > 0 || (r.tipo === 'nuovo' && r.ingrediente)) && (
          <button type="button" aria-pressed={apri === 'quantita'} onClick={() => setApri(apri === 'quantita' ? null : 'quantita')}>
            Quantità…
          </button>
        )}
        {r.nomi.length > 0 && (
          <button type="button" aria-pressed={apri === 'prodotto'} onClick={() => setApri(apri === 'prodotto' ? null : 'prodotto')}>
            Altro prodotto…
          </button>
        )}
        {(nuovo || r.tipo === 'incerto') && tasto('Non c’è', { azione: 'non_c_e' })}
        {r.lotti.length > 0 && tasto('Non so', { azione: 'non_verificabile' })}
      </div>
      {apri === 'quantita' && (r.ingrediente || r.unita) && (
        <QuantitaVerifica
          ingrediente={r.ingrediente}
          inPezzi={r.unita === 'pz'}
          iniziale={decisione && 'valore' in decisione ? decisione.valore : (r.visto ?? r.inCasa)}
          fatto={(v) => {
            decidi(r.lotti.length ? (v === 0 ? { azione: 'terminato' } : { azione: 'quantita', valore: v }) : { azione: 'aggiungi', valore: v });
            setApri(null);
          }}
        />
      )}
      {apri === 'prodotto' && (
        <CercaIngrediente
          indice={indice}
          etichetta="Che cos’è?"
          autoFocus
          iniziale={r.nomi[0] ?? ''}
          scegli={(i) => {
            correggi(r.nomi, i);
            setApri(null);
          }}
        />
      )}
      {decisione && <p className="piccolo decisione-verifica">✓ {testoDecisione(decisione, q)}</p>}
      {spostato && r.avvisoPosto && <p className="piccolo decisione-verifica">✓ Spostato: in Casa lo segno {r.avvisoPosto.dove.zona === 'ripiano' ? 'sul' : 'nel'} {r.avvisoPosto.dove.nome.toLowerCase()}</p>}
    </li>
  );
}

function testoDecisione(d: Decisione, q: (v: number | null) => string | null): string {
  switch (d.azione) {
    case 'presente':
      return 'C’è: resta com’è';
    case 'terminato':
      return 'Finito: lo tolgo dalla casa';
    case 'quantita':
      return `Ne restano ${q(d.valore)}`;
    case 'aggiungi':
      return `Lo metto in casa: ${q(d.valore)}`;
    case 'non_verificabile':
      return 'Non si può verificare: resta com’è';
    case 'non_c_e':
      return 'Non c’è: Gemini si è sbagliato, me lo ricordo';
  }
}

function QuantitaVerifica({ ingrediente, inPezzi, iniziale, fatto }: { ingrediente: Ingrediente | null; inPezzi: boolean; iniziale: number | null; fatto: (v: number) => void }) {
  // In casa in pezzi (un prodotto «a occhio»): si scrivono i pezzi, senza farli diventare grammi.
  const dimensione = inPezzi ? 'pezzi' : (ingrediente?.dimensione ?? 'pezzi');
  const pesoPz = inPezzi ? null : ingrediente?.peso_pz;
  const [scritta, setScritta] = useState<Scritta>(() => scrittaVuota(UNITA_BASE[dimensione], iniziale === null ? '' : String(iniziale).replace('.', ',')));
  const [errore, setErrore] = useState<string | null>(null);
  return (
    <form
      className="quantita-verifica"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (leggiNumero(scritta.numero) === 0) return fatto(0);
        const b = totaleScritta(scritta, dimensione, pesoPz);
        if (!b.ok) return setErrore(b.motivo === 'confezioni_non_valide' ? 'Scrivi quante confezioni, per esempio 1 o 3.' : 'Scrivi un numero, per esempio 2 o 1,5.');
        fatto(b.quantita.valore);
      }}
    >
      <CampoQuantita
        scritta={scritta}
        cambia={(x) => setScritta((s) => ({ ...s, ...x }))}
        dimensione={dimensione}
        pesoPz={pesoPz}
        etichetta="Quanto ce n’è"
        autoFocus
      />
      <button type="submit" className="bottone primario pieno">
        OK
      </button>
      {errore && (
        <p className="avviso errore" role="alert" style={{ width: '100%', margin: 0 }}>
          {errore}
        </p>
      )}
      <span className="tenue piccolo" style={{ width: '100%' }}>
        0 = finito.
      </span>
    </form>
  );
}

/** Aggiungere, togliere e rinominare le zone. Si salvano per tutta la famiglia. */
function GestioneZone({ zone: iniziali, frigoBase, fatto }: { zone: ZonaVerifica[]; frigoBase: ZonaVerifica[]; fatto: () => void }) {
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
