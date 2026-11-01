import { useEffect, useMemo, useRef, useState } from 'react';
import { idDispositivo, useFamiglia, useVista, type Vista } from '../dati/contesto';
import { useIndice } from '../dati/indice';
import { type Esito, NOME_ESITO, type Verifica, type Vincolo } from '../dominio/compatibilita';
import {
  alPasto,
  type CategoriaPasto,
  categorieDellaFamiglia,
  dataLunga,
  type Eccezione,
  giorniDellaSettimana,
  type Gusto,
  gustiPerPiatto,
  ID_OSPITI,
  lunedi,
  nomeGiorno,
  nomeSettimana,
  type OspitiPasto,
  ospitiDel,
  type Persona,
  type PortataMenu,
  PORZIONE_BAMBINO,
  ripetiSettimana,
  valutaPortata,
} from '../dominio/menu';
import { avanziDi, porzioniPortata } from '../dominio/consumi';
import { CATEGORIE, type Categoria } from '../catalogo/tipi';
import { haPrincipale, type Principale, usaIngrediente } from '../dominio/principale';
import { BottoniSegno, CercaRicetta, type Segno } from '../ui/FiltriRicetta';
import { RICETTE_PER_PASTO } from '../dominio/proposte';
import { filtra, iconaRicetta, type Indice, type Ricetta } from '../dominio/ricette';
import { ALLERGENI_UE, ESIGENZE, INTOLLERANZE, type VoceVincolo } from '../dominio/vincoli';
import { IdeePerPasto, ProponiSettimana } from './Proposte';
import { FacciaAntonino } from './Antonino';
import { useConferme } from './ConfermaPasto';
import { SegnaCucinato, usePronti } from './Cucinato';
import { oggi, piuGiorni } from '../dominio/scadenze';
import { Foglio } from '../ui/Foglio';
import { ICONA_ESITO, MarchiSegni, motiviInBreve, useIcone, useSegni } from './Ricette';
import { IconaCibo } from '../ui/IconaCibo';
import { elencoNomi, leggiSenza, type Rimedio, rimedio, type Senza } from '../dominio/senza';
import { AvvisoNonSiToglie, EtichettaRimedio, FoglioSenza, testoSenza } from './Senza';
import { Sigla, type SiglaPersona, sigleDi } from '../ui/Sigla';

type Modo = 'giorni' | 'settimana' | 'panoramica';
const MODI: { id: Modo; nome: string }[] = [
  { id: 'giorni', nome: 'Giorni' },
  { id: 'settimana', nome: 'Settimana' },
  { id: 'panoramica', nome: 'Panoramica' },
];
const CHIAVE_MODO = 'mc-menu-modo';

/** Tablet e telefono girato: la stessa soglia dei fogli di stile. */
const LARGO = '(min-width: 900px), (orientation: landscape) and (min-width: 560px) and (max-height: 600px)';

function useLargo() {
  const [largo, setLargo] = useState(() => window.matchMedia(LARGO).matches);
  useEffect(() => {
    const m = window.matchMedia(LARGO);
    const cambia = () => setLargo(m.matches);
    m.addEventListener('change', cambia);
    return () => m.removeEventListener('change', cambia);
  }, []);
  return largo;
}

/** La scelta della vista è di questo dispositivo: sul telefono di base i giorni, sul tablet la settimana. */
function modoIniziale(): Modo {
  try {
    const v = localStorage.getItem(CHIAVE_MODO);
    if (v === 'griglia') return 'settimana';
    if (v === 'giorni' || v === 'settimana' || v === 'panoramica') return v;
  } catch {
    // Archivio del browser non disponibile.
  }
  return window.innerWidth >= 900 ? 'settimana' : 'giorni';
}

export interface DatiMenu {
  persone: Persona[];
  vincoli: Vincolo[];
  verifiche: Verifica[];
  gusti: Gusto[];
  categorie: CategoriaPasto[];
  portate: PortataMenu[];
  eccezioni: Eccezione[];
  ospiti: OspitiPasto[];
}

const numero = (x: unknown) => (x === null || x === undefined ? null : Number(x));

export function useDatiMenu(vista: Vista): DatiMenu {
  const r = vista.righe;
  return useMemo(() => {
    const attive = (t: keyof typeof r) => (r[t] ?? []).filter((x) => !x.eliminato_il);
    return {
      persone: attive('membro')
        .filter((m) => !m.archiviato)
        .map((m) => ({
          id: m.id,
          nome: String(m.nome),
          porzione: Number(m.porzione ?? 1),
        })),
      vincoli: attive('vincolo_alimentare') as unknown as Vincolo[],
      verifiche: attive('ricetta_verificata').map((v) => ({
        membro_id: String(v.membro_id),
        ricetta_id: String(v.ricetta_id),
        versione_ricetta: Number(v.versione_ricetta),
        va_bene: v.va_bene !== false,
      })),
      gusti: attive('gusto') as unknown as Gusto[],
      categorie: categorieDellaFamiglia(attive('categoria_pasto')),
      portate: attive('portata')
        .map((p) => ({
          ...(p as unknown as PortataMenu),
          porzioni: numero(p.porzioni),
          ordine: Number(p.ordine ?? 0),
          bloccata: !!p.bloccata,
          ricetta_id: (p.ricetta_id as string | null) ?? null,
          testo: (p.testo as string | null) ?? null,
          senza: leggiSenza(p.senza),
        }))
        .sort((a, b) => a.ordine - b.ordine || String(a.id).localeCompare(String(b.id))),
      eccezioni: attive('eccezione_membro').map((e) => ({
        ...(e as unknown as Eccezione),
        porzioni: numero(e.porzioni),
      })),
      ospiti: attive('ospiti_pasto').map((o) => ({
        ...(o as unknown as OspitiPasto),
        adulti: Number(o.adulti ?? 0),
        bambini: Number(o.bambini ?? 0),
        oggetti: (o.oggetti as string[] | null) ?? [],
      })),
    };
  }, [r]);
}

/** I dati del menu visti da un pasto: gli ospiti di quel pasto contano come una persona in più, con le loro esigenze. */
export function datiAlPasto(dati: DatiMenu, data: string, categoria: string): DatiMenu {
  return {
    ...dati,
    ...alPasto(dati.persone, dati.vincoli, ospitiDel(dati.ospiti, data, categoria)),
  };
}

/** Come si presenta un piatto: nome, esito per chi lo mangia (ospiti compresi), gusti contrari, porzioni. */
export function descrivi(indice: Indice, dati: DatiMenu, p: PortataMenu) {
  const ricetta = p.ricetta_id ? (indice.perId.get(p.ricetta_id) ?? null) : null;
  const eccezioni = dati.eccezioni.filter((e) => e.portata_id === p.id);
  const alTavolo = alPasto(dati.persone, dati.vincoli, ospitiDel(dati.ospiti, p.data, p.categoria));
  const valutazione = alTavolo.vincoli.length ? valutaPortata(indice, ricetta, alTavolo.persone, alTavolo.vincoli, eccezioni, dati.verifiche, p.senza) : null;
  const mangiano = dati.persone.filter((x) => !eccezioni.some((e) => e.membro_id === x.id));
  const gusti = ricetta ? gustiPerPiatto(indice, ricetta, mangiano, dati.gusti) : [];
  return {
    ricetta,
    titolo: ricetta?.titolo ?? p.testo ?? 'Piatto',
    /** «senza panna per Sara»: cosa è tolto dal piatto. */
    senza: ricetta ? testoSenza(indice, p.senza, dati.persone) : '',
    eccezioni,
    valutazione,
    gusti,
    nonPiace: gusti.filter((g) => g.valore === 'non_piace'),
    porzioni: porzioniPortata(p, dati.persone, dati.eccezioni, dati.ospiti),
    /** Porzioni messe da parte per i giorni dopo (piatto che dura più giorni). */
    dopo: avanziDi(p, dati.portate).reduce((t, a) => t + porzioniPortata(a, dati.persone, dati.eccezioni, dati.ospiti), 0),
  };
}

/**
 * Chiede al database di creare i giorni dei piatti fissi che mancano fino a `fino` (al più 60 giorni avanti).
 * Lo chiede una volta per data limite: il comando è idempotente, più dispositivi non creano doppioni.
 */
export function useProlungaFissi(fino: string) {
  const vista = useVista();
  const { esegui } = useFamiglia();
  const chiesto = useRef(new Set<string>());
  const { pasto_fisso: regole, portata: portate } = vista.righe;
  const pronta = vista.pronta;
  const inCoda = vista.coda.some((v) => v.comando.tipo === 'prolunga_pasti_fissi' || v.comando.tipo === 'fissa_pasto');
  useEffect(() => {
    if (!pronta || inCoda) return;
    const giorno = oggi();
    const massimo = piuGiorni(giorno, 60);
    const limite = fino < massimo ? fino : massimo;
    const presenti = new Set((portate ?? []).filter((p) => p.fisso_id).map((p) => `${String(p.fisso_id)}|${String(p.data)}`));
    const manca = (regole ?? []).some((f) => {
      if (f.eliminato_il) return false;
      const al = f.al ? String(f.al) : limite;
      const fine = al < limite ? al : limite;
      for (let d = String(f.dal) > giorno ? String(f.dal) : giorno; d <= fine; d = piuGiorni(d, 1)) if (!presenti.has(`${f.id}|${d}`)) return true;
      return false;
    });
    if (!manca || chiesto.current.has(limite)) return;
    chiesto.current.add(limite);
    void esegui('prolunga_pasti_fissi', { fino_a: limite });
  }, [pronta, inCoda, regole, portate, fino, esegui]);
}

export function Menu() {
  const vista = useVista();
  const indice = useIndice(vista);
  const dati = useDatiMenu(vista);
  const { esegui } = useFamiglia();
  const giorno = oggi();
  const [lun, setLunStato] = useState(() => lunedi(giorno));
  // Il giorno mostrato nella vista «Giorni»: oggi, oppure il lunedì delle altre settimane.
  const [scelto, setScelto] = useState(giorno);
  const [altro, setAltro] = useState(false);
  const setLun = (l: string) => {
    setLunStato(l);
    setScelto(l === lunedi(giorno) ? giorno : l);
  };
  const [modo, setModo] = useState<Modo>(modoIniziale);
  const [nuova, setNuova] = useState<{
    data: string;
    categoria: string;
    per?: string[];
  } | null>(null);
  const [aperta, setAperta] = useState<string | null>(null);
  const [pasti, setPasti] = useState(false);
  const [proponi, setProponi] = useState(false);
  const [ospiti, setOspiti] = useState<{
    data: string;
    categoria: string;
  } | null>(null);
  const largo = useLargo();
  const fineSettimana = piuGiorni(lun, 6);
  const dueSettimane = piuGiorni(giorno, 13);
  useProlungaFissi(fineSettimana > dueSettimane ? fineSettimana : dueSettimane);

  if (!vista.pronta || !indice) return <p className="tenue">Sto caricando il menu…</p>;
  const giorni = giorniDellaSettimana(lun);
  // La striscia parte da questa settimana finché si guarda questa o la prossima; più in là, dalla settimana scelta.
  const baseStriscia = lun === lunedi(giorno) || lun === piuGiorni(lunedi(giorno), 7) ? lunedi(giorno) : lun;
  const fine = giorni[6];
  const settimana = dati.portate.filter((p) => p.data >= lun && p.data <= fine);
  const precedente = dati.portate.filter((p) => p.data >= piuGiorni(lun, -7) && p.data < lun);
  // Si vedono i pasti attivi, più quelli spenti che in questa settimana hanno già qualcosa.
  const categorie = dati.categorie.filter((c) => c.attiva || settimana.some((p) => p.categoria === c.valore));
  const piatti = (data: string, categoria: string) => settimana.filter((p) => p.data === data && p.categoria === categoria);
  const portataAperta = aperta ? dati.portate.find((p) => p.id === aperta) : undefined;

  function cambiaModo(m: Modo) {
    setModo(m);
    try {
      localStorage.setItem(CHIAVE_MODO, m);
    } catch {
      // Si ricorderà solo finché la pagina resta aperta.
    }
  }

  async function ripeti() {
    if (settimana.length && !window.confirm(`Aggiungere i ${precedente.length} piatti della settimana prima a quelli già in menu?`)) return;
    const dati2 = ripetiSettimana(precedente, dati.eccezioni, piuGiorni(lun, -7), lun, () => crypto.randomUUID());
    await esegui('ripeti_portate', dati2);
  }

  const sigle = sigleDi(dati.persone);
  const aggiungi = (data: string, categoria: string) => setNuova({ data, categoria });
  const apriOspiti = (data: string, categoria: string) => setOspiti({ data, categoria });
  // I pasti ancora vuoti da oggi in poi: quelli che «Riempi i vuoti» può proporre.
  const vuoti = giorni.filter((g) => g >= giorno).reduce((n, g) => n + categorie.filter((c) => !piatti(g, c.valore).length).length, 0);
  const riquadro = (data: string, c: CategoriaPasto, cella = false) => (
    <RiquadroMenu
      key={`${data}|${c.valore}`}
      indice={indice}
      dati={dati}
      sigle={sigle}
      data={data}
      categoria={c}
      portate={piatti(data, c.valore)}
      cella={cella}
      largo={largo}
      apri={setAperta}
      aggiungi={() => aggiungi(data, c.valore)}
      apriOspiti={() => apriOspiti(data, c.valore)}
    />
  );

  const etichettaSettimana = (l: string) => (l === lunedi(giorno) ? 'Questa settimana' : l === piuGiorni(lunedi(giorno), 7) ? 'Settimana prossima' : null);
  const frecce = (centro: React.ReactNode) => (
    <>
      <button className="bottone piccolo freccia" aria-label="Settimana prima" onClick={() => setLun(piuGiorni(lun, -7))}>
        ‹
      </button>
      <div className="cresce titolo-settimana" aria-live="polite">
        {centro}
      </div>
      <button className="bottone piccolo freccia" aria-label="Settimana dopo" onClick={() => setLun(piuGiorni(lun, 7))}>
        ›
      </button>
    </>
  );
  const nomeSett = (
    <>
      {etichettaSettimana(lun) && <span className="sopratitolo">{etichettaSettimana(lun)}</span>}
      <h2>{nomeSettimana(lun)}</h2>
    </>
  );
  const altreAzioni = (
    <div className="altre-azioni">
      <button className="bottone piccolo tondo" aria-label="Altre azioni" aria-expanded={altro} onClick={() => setAltro(!altro)}>
        ⋯
      </button>
      {altro && (
        <div className="tendina" role="group" aria-label="Altre azioni sul menu">
          {precedente.length > 0 && (
            <button
              className="voce"
              onClick={() => {
                setAltro(false);
                void ripeti();
              }}
            >
              ↻ Ripeti la settimana prima
            </button>
          )}
          <button
            className="voce"
            onClick={() => {
              setAltro(false);
              setPasti(true);
            }}
          >
            Pasti
          </button>
        </div>
      )}
    </div>
  );
  const sceltaVista = (
    <div className="scelte segmenti" role="group" aria-label="Vista">
      {MODI.map((m) => (
        <button key={m.id} aria-pressed={modo === m.id} onClick={() => cambiaModo(m.id)}>
          {m.nome}
        </button>
      ))}
    </div>
  );
  const tornaOggi = lun !== lunedi(giorno) && (
    <button className="bottone piccolo" onClick={() => setLun(lunedi(giorno))}>
      Oggi
    </button>
  );
  const riempi = fine >= giorno && vuoti > 0 && modo !== 'panoramica' && (
    <button className={`bottone primario riempi-vuoti con-antonino${largo ? '' : ' pieno'}`} onClick={() => setProponi(true)} aria-label="Antonino, riempi la settimana">
      <FacciaAntonino piccola /> Riempi i vuoti{largo ? '' : ' della settimana'}
    </button>
  );
  /** Una striscia di 7 giorni: un pallino per pasto, colorato se ha già un piatto, vuoto se è da riempire. */
  const striscia = (l: string) => (
    <div className="striscia-giorni" role="group" aria-label={`Giorni: ${nomeSettimana(l)}`}>
      {giorniDellaSettimana(l).map((g) => (
        <button
          key={g}
          className={`${g < giorno ? 'passato' : ''}${g === giorno ? ' oggi' : ''}`}
          aria-pressed={g === scelto}
          aria-label={`Mostra ${dataLunga(g)}`}
          onClick={() => {
            setLunStato(lunedi(g));
            setScelto(g);
          }}
        >
          <small>{nomeGiorno(g, true)}</small>
          <strong>{Number(g.slice(8))}</strong>
          <span className="pallini-pasti" aria-hidden>
            {categorie.map((c) => (
              <i key={c.valore} className={dati.portate.some((p) => p.data === g && p.categoria === c.valore) ? `pieno t-${c.valore}` : 'vuoto'} />
            ))}
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <>
      {largo ? (
        <div className="riga comandi-menu largo">
          {sceltaVista}
          <span className="cresce" />
          {tornaOggi}
          {riempi}
          {altreAzioni}
        </div>
      ) : (
        <>
          <div className="riga testa-settimana">
            {frecce(nomeSett)}
            {altreAzioni}
          </div>
          <div className="riga comandi-menu">
            {sceltaVista}
            <span className="cresce" />
            {tornaOggi}
          </div>
        </>
      )}
      {largo && modo === 'settimana' && <div className="riga testa-settimana">{frecce(nomeSett)}</div>}

      {modo === 'giorni' &&
        (largo ? (
          // Tablet: questa settimana e la prossima affiancate.
          <div className="due-settimane">
            {[baseStriscia, piuGiorni(baseStriscia, 7)].map((l) => (
              <div key={l}>
                <p className="sopratitolo striscia-titolo">{etichettaSettimana(l) ? `${etichettaSettimana(l)} · ${nomeSettimana(l)}` : nomeSettimana(l)}</p>
                {striscia(l)}
              </div>
            ))}
          </div>
        ) : (
          striscia(lun)
        ))}
      {dati.vincoli.length > 0 && <p className="tenue">✅ adatto · ❔ da verificare · ⛔ non adatto a chi lo mangia · 🙅 a qualcuno non piace</p>}

      {modo === 'settimana' && <SettimanaGriglia largo={largo} giorni={giorni} categorie={categorie} oggiData={giorno} scelto={scelto} cella={(g, c) => riquadro(g, c, true)} />}

      {modo === 'giorni' &&
        giorni
          .filter((g) => g === scelto)
          .map((g) => {
            const daRiempire = categorie.filter((c) => !piatti(g, c.valore).length).length;
            const ospitiDelGiorno = categorie.map((c) => ({ c, o: ospitiDel(dati.ospiti, g, c.valore) })).filter((x) => x.o);
            // Tablet: i pasti in una riga (le merende più strette) e l'ultimo, la cena, largo sotto.
            const colonne = largo
              ? categorie
                  .slice(0, -1)
                  .map((c) => (c.valore === 'merenda' || c.valore === 'spuntino' ? 'minmax(0, 1fr)' : 'minmax(0, 1.5fr)'))
                  .join(' ')
              : undefined;
            return (
              <section key={g} className={`giorno-riquadri${g === giorno ? ' oggi' : ''}`} aria-label={dataLunga(g)}>
                <h3 className="titolo-giorno">
                  <span className="maiuscola">{dataLunga(g)}</span>
                  {g === giorno && <span className="etichetta">oggi</span>}
                  {daRiempire > 0 && g >= giorno && <span className="etichetta da-riempire">{daRiempire === 1 ? '1 pasto da riempire' : `${daRiempire} pasti da riempire`}</span>}
                  {ospitiDelGiorno.map(({ c, o }) => (
                    <span key={c.valore} className="etichetta ospiti-giorno">
                      👥 {o!.adulti + o!.bambini} ospiti a {c.nome.toLowerCase()}
                    </span>
                  ))}
                </h3>
                <div
                  className={`riquadri${largo ? ' riquadri-menu-largo' : categorie.length >= 5 ? ' fitto' : ''}`}
                  style={colonne && categorie.length > 1 ? { gridTemplateColumns: colonne } : undefined}
                >
                  {categorie.map((c) => riquadro(g, c))}
                </div>
              </section>
            );
          })}

      {!largo && riempi}

      {modo === 'panoramica' && <Panoramica indice={indice} dati={dati} giorni={giorni} categorie={categorie} settimana={settimana} apri={setAperta} oggiData={giorno} />}

      {nuova && (
        <NuovoPiatto
          indice={indice}
          dati={dati}
          {...nuova}
          chiudi={() => setNuova(null)}
          apriOspiti={() => {
            setOspiti({ data: nuova.data, categoria: nuova.categoria });
            setNuova(null);
          }}
        />
      )}
      {portataAperta && (
        <SchedaPiatto
          indice={indice}
          dati={dati}
          portata={portataAperta}
          chiudi={() => setAperta(null)}
          apriOspiti={() => {
            setOspiti({
              data: portataAperta.data,
              categoria: portataAperta.categoria,
            });
            setAperta(null);
          }}
          apriNuovo={(per) => {
            setNuova({
              data: portataAperta.data,
              categoria: portataAperta.categoria,
              per,
            });
            setAperta(null);
          }}
        />
      )}
      {ospiti && <SchedaOspiti dati={dati} {...ospiti} chiudi={() => setOspiti(null)} />}
      {pasti && <Pasti categorie={dati.categorie} chiudi={() => setPasti(false)} />}
      {proponi && <ProponiSettimana indice={indice} dati={dati} giorni={giorni} chiudi={() => setProponi(false)} />}
    </>
  );
}

/** Le icone accanto al nome di un piatto del menu: esito per le esigenze, gusti, bloccato, già confermato. */
function SegniPiatto({ d, portata: p, confermato }: { d: ReturnType<typeof descrivi>; portata: PortataMenu; confermato: boolean }) {
  const esito = d.valutazione?.esito;
  return (
    <>
      {esito && esito !== 'adatta' && <span aria-label={NOME_ESITO[esito]}>{ICONA_ESITO[esito]} </span>}
      {d.nonPiace.length > 0 && <span title={d.nonPiace.map((g) => `a ${g.nome} non piace ${g.cosa.toLowerCase()}`).join('; ')}>🙅 </span>}
      {p.bloccata && <span aria-label="bloccato">🔒 </span>}
      {confermato && <span aria-label="pasto confermato">✔️ </span>}
    </>
  );
}

const chiMangia = (dati: DatiMenu, eccezioni: Eccezione[]) => dati.persone.filter((x) => !eccezioni.some((e) => e.membro_id === x.id)).map((x) => x.id);

function SigleDi({ sigle, chi }: { sigle: Map<string, SiglaPersona>; chi: string[] }) {
  return (
    <span className="sigle">
      {[...chi]
        .sort((a, b) => (sigle.get(a)?.ordine ?? 0) - (sigle.get(b)?.ordine ?? 0))
        .map((id) => (
          <Sigla key={id} s={sigle.get(id)} />
        ))}
    </span>
  );
}

/**
 * Un pasto di un giorno come riquadro, uguale a quelli di Oggi: i piatti con le sigle di chi li mangia
 * (tocco = scheda del piatto), gli ospiti, «+» per aggiungere. `cella`: la versione compatta della settimana.
 */
function RiquadroMenu({
  indice,
  dati,
  sigle,
  data,
  categoria: c,
  portate,
  cella,
  largo,
  apri,
  aggiungi,
  apriOspiti,
}: {
  indice: Indice;
  dati: DatiMenu;
  sigle: Map<string, SiglaPersona>;
  data: string;
  categoria: CategoriaPasto;
  portate: PortataMenu[];
  cella?: boolean;
  largo?: boolean;
  apri: (id: string) => void;
  aggiungi: () => void;
  apriOspiti: () => void;
}) {
  const conferme = useVista().righe.conferma_pasto;
  const confermato = (id: string) => !!conferme?.some((x) => x.portata_id === id && x.attiva && !x.eliminato_il);
  const etichetta = `Aggiungi a ${c.nome.toLowerCase()} di ${dataLunga(data)}`;
  const vuoto = portate.length === 0;
  return (
    <div className={`riquadro t-${c.valore}${vuoto ? ' vuoto' : ''}${cella ? ' cella' : ''}`}>
      {!cella && (
        <div className="testa-riquadro">
          <h4>
            <span className="emoji-pasto" aria-hidden>
              {c.emoji}
            </span>
            {c.nome}
          </h4>
        </div>
      )}
      {/* Telefono: «+» tondo in alto a destra; tablet: «+ Aggiungi» tratteggiato in fondo al riquadro. Nella settimana
          le caselle piene non hanno il «+»: si aggiunge dal giorno. */}
      {!vuoto && !cella && !largo && (
        <button className="altro-riquadro piu" aria-label={etichetta} onClick={aggiungi}>
          +
        </button>
      )}
      {vuoto ? (
        <button className="aggiungi-riquadro" aria-label={etichetta} onClick={aggiungi}>
          + Aggiungi
        </button>
      ) : (
        <ul className="piatti-riquadro">
          {portate.map((p) => {
            const d = descrivi(indice, dati, p);
            const nota = [p.avanzo_di && 'avanzo', d.dopo > 0 && `+${d.dopo.toLocaleString('it-IT')} per i giorni dopo`, p.in_attesa && 'in invio'].filter(Boolean).join(' · ');
            return (
              <li key={p.id}>
                <button className={`piatto-riquadro${d.valutazione ? ` ${d.valutazione.esito}` : ''}`} onClick={() => apri(p.id)} aria-label={`Apri ${d.titolo}`}>
                  <span className="nome-piatto">
                    <SegniPiatto d={d} portata={p} confermato={confermato(p.id)} />
                    {d.titolo}
                    {nota && <span className="nota-piatto"> · {nota}</span>}
                  </span>
                  {dati.persone.length > 1 && <SigleDi sigle={sigle} chi={chiMangia(dati, d.eccezioni)} />}
                  <span className="solo-lettura">
                    {' '}
                    {formattaPorzioni(d.porzioni)}
                    {d.eccezioni.length > 0 && ` · ${chiLoMangia(dati, d.eccezioni)}`}
                  </span>
                </button>
                {/* I piatti a parte (Sara mangia altro) con la sua sigla: si aprono sulla scheda del piatto. */}
                {d.eccezioni
                  .filter((e) => e.tipo === 'alternativa')
                  .map((e) => {
                    const persona = dati.persone.find((x) => x.id === e.membro_id);
                    if (!persona) return null;
                    const titolo = (e.ricetta_id ? indice.perId.get(e.ricetta_id)?.titolo : null) ?? e.testo ?? 'altro';
                    return (
                      <button key={e.id} className="piatto-riquadro a-parte" onClick={() => apri(p.id)} aria-label={`Apri ${titolo} (per ${persona.nome})`}>
                        <span className="nome-piatto">{titolo}</span>
                        {dati.persone.length > 1 && <SigleDi sigle={sigle} chi={[persona.id]} />}
                      </button>
                    );
                  })}
              </li>
            );
          })}
        </ul>
      )}
      {!vuoto && !cella && largo && (
        <button className="aggiungi-riquadro" aria-label={etichetta} onClick={aggiungi}>
          + Aggiungi
        </button>
      )}
      <EtichettaOspiti ospiti={ospitiDel(dati.ospiti, data, c.valore)} apri={apriOspiti} />
    </div>
  );
}

/**
 * La settimana come griglia pasti × giorni, ogni casella un riquadro. Sul tablet tutta la settimana; sul
 * telefono due giorni e mezzo che scorrono di lato, con i pallini che dicono a che punto si è.
 */
function SettimanaGriglia({
  largo,
  giorni,
  categorie,
  oggiData,
  scelto,
  cella,
}: {
  largo: boolean;
  giorni: string[];
  categorie: CategoriaPasto[];
  oggiData: string;
  scelto: string;
  cella: (data: string, c: CategoriaPasto) => React.ReactNode;
}) {
  const scorre = useRef<HTMLDivElement>(null);
  const [pagina, setPagina] = useState(0);
  const pagine = 3;
  // Sul telefono si parte dal giorno scelto (di solito oggi).
  useEffect(() => {
    const el = scorre.current;
    if (largo || !el) return;
    const i = giorni.indexOf(scelto);
    const colonna = el.querySelector<HTMLElement>(`[data-giorno="${giorni[Math.max(0, i)]}"]`);
    if (colonna && i > 0) el.scrollLeft = colonna.offsetLeft - 52;
  }, [largo, giorni, scelto]);
  return (
    <>
      <div
        ref={scorre}
        className={`settimana-griglia${largo ? '' : ' scorre'}`}
        role="region"
        aria-label="Settimana"
        tabIndex={largo ? undefined : 0}
        onScroll={(e) => {
          const el = e.currentTarget;
          const max = el.scrollWidth - el.clientWidth;
          setPagina(max > 0 ? Math.round((el.scrollLeft / max) * (pagine - 1)) : 0);
        }}
        style={{
          ['--giorni' as string]: giorni.length,
          ['--pasti' as string]: categorie.length,
        }}
      >
        <span className="angolo" />
        {giorni.map((g) => (
          <span key={g} data-giorno={g} className={`testa-giorno${g === (largo ? oggiData : scelto) ? ' scelto' : ''}${g === oggiData ? ' oggi' : ''}`}>
            {nomeGiorno(g, true)} <strong>{Number(g.slice(8))}</strong>
          </span>
        ))}
        {categorie.map((c) => (
          <div key={c.valore} style={{ display: 'contents' }}>
            <span className="testa-pasto-settimana">
              <span aria-hidden>{c.emoji}</span>
              <small>{largo ? c.nome.toLowerCase() : c.nome.slice(0, 3).toLowerCase()}</small>
            </span>
            {giorni.map((g) => cella(g, c))}
          </div>
        ))}
      </div>
      {!largo && (
        <div className="pallini-pagina" aria-hidden>
          {Array.from({ length: pagine }, (_, i) => (
            <i key={i} className={i === pagina ? 'attivo' : undefined} />
          ))}
        </div>
      )}
    </>
  );
}

/** «per Luca e Anna» quando non tutti mangiano il piatto. */
export function chiLoMangia(dati: DatiMenu, eccezioni: Eccezione[]): string {
  const nomi = dati.persone.filter((x) => !eccezioni.some((e) => e.membro_id === x.id)).map((x) => x.nome);
  if (!nomi.length) return 'nessuno della famiglia';
  return `per ${nomi.length > 1 ? `${nomi.slice(0, -1).join(', ')} e ${nomi[nomi.length - 1]}` : nomi[0]}`;
}

function formattaPorzioni(n: number) {
  return n === 1 ? '1 porzione' : `${n.toLocaleString('it-IT')} porzioni`;
}

function Panoramica({
  indice,
  dati,
  giorni,
  categorie,
  settimana,
  apri,
  oggiData,
}: {
  indice: Indice;
  dati: DatiMenu;
  giorni: string[];
  categorie: CategoriaPasto[];
  settimana: PortataMenu[];
  apri: (id: string) => void;
  oggiData: string;
}) {
  const esiti = settimana.map((p) => descrivi(indice, dati, p));
  const problemi = esiti.filter((d) => d.valutazione && d.valutazione.esito !== 'adatta').length;
  const vuoti = giorni.reduce((n, g) => n + categorie.filter((c) => !settimana.some((p) => p.data === g && p.categoria === c.valore)).length, 0);
  return (
    <>
      <div className="scheda">
        <p style={{ margin: 0 }}>
          {settimana.length === 1 ? '1 piatto' : `${settimana.length} piatti`} in menu · {vuoti === 1 ? '1 pasto vuoto' : `${vuoti} pasti vuoti`}
          {problemi > 0 && ` · ${problemi} da controllare`}
        </p>
      </div>
      <div className="scheda">
        <ul className="elenco">
          {giorni.map((g) => {
            const delGiorno = categorie.flatMap((c) => settimana.filter((p) => p.data === g && p.categoria === c.valore).map((p) => ({ c, p })));
            return (
              <li key={g} className={g === oggiData ? 'oggi' : undefined}>
                <strong style={{ textTransform: 'capitalize' }}>{dataLunga(g)}</strong>
                {delGiorno.length === 0 ? (
                  <p className="tenue" style={{ margin: '4px 0 0' }}>
                    Niente in menu.
                  </p>
                ) : (
                  <div className="riga" style={{ flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                    {delGiorno.map(({ c, p }) => {
                      const d = descrivi(indice, dati, p);
                      return (
                        <button key={p.id} className="etichetta" onClick={() => apri(p.id)} aria-label={`Apri ${d.titolo}`}>
                          <span aria-hidden>{c.emoji}</span> {d.valutazione && d.valutazione.esito !== 'adatta' ? `${ICONA_ESITO[d.valutazione.esito]} ` : ''}
                          {d.titolo}
                        </button>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

type Scelta = { ricetta_id: string; testo: null } | { ricetta_id: null; testo: string };

/** Filtri della scelta del piatto, gli stessi per l'idea e per la ricerca. */
interface FiltroPiatto {
  categoria: Categoria | null;
  principale: Principale | null;
  /** Un ingrediente preciso (id), cercato per nome. */
  ingrediente: string | null;
  /** Solo le ⭐ preferite o le 💫 da ospiti. */
  segno: Segno | null;
}
const SENZA_FILTRI: FiltroPiatto = { categoria: null, principale: null, ingrediente: null, segno: null };
const PER_PAGINA = 12;

/** Cerca una ricetta per nome oppure scrivi il piatto a mano (per cambiare un piatto già nel menu). */
function CercaPiatto({ indice, dati, scegli, etichetta, persone }: { indice: Indice; dati: DatiMenu; scegli: (s: Scelta) => void; etichetta: string; persone?: Persona[] }) {
  const [testo, setTesto] = useState('');
  return (
    <div className="campo cerca-piatto">
      <label>
        <span>{etichetta}</span>
        <input type="search" value={testo} onChange={(e) => setTesto(e.target.value)} placeholder="Carbonara, minestrone, pizza…" autoFocus />
      </label>
      <RisultatiPiatto indice={indice} dati={dati} scegli={scegli} persone={persone} testo={testo} />
    </div>
  );
}

/** Le ricette trovate per nome e filtri, con l'esito per chi mangia. Con un filtro attivo l'elenco c'è anche senza scrivere. */
function RisultatiPiatto({
  indice,
  dati,
  scegli,
  persone,
  testo,
  filtro = SENZA_FILTRI,
  icone,
  vuoto,
  rimedi,
}: {
  indice: Indice;
  dati: DatiMenu;
  scegli: (s: Scelta) => void;
  persone?: Persona[];
  testo: string;
  filtro?: FiltroPiatto;
  icone?: Map<string, string>;
  /** Cosa dire quando non c'è ancora niente da cercare. */
  vuoto?: string;
  /**
   * Aggiungendo un piatto: una ricetta ⛔ che va bene togliendo un ingrediente apre «per chi toglierlo»;
   * se togliere non basta, lo dice e propone di far mangiare altro a chi non può.
   */
  rimedi?: { senza: (r: Ricetta, x: Rimedio) => void; mangiaAltro: (ricetta_id: string, chi: string[]) => void };
}) {
  const [quante, setQuante] = useState(PER_PAGINA);
  const [aperta, setAperta] = useState<string | null>(null);
  const chi = persone ?? dati.persone;
  const segni = useSegni();
  const filtrato = !!(filtro.categoria || filtro.principale || filtro.ingrediente || filtro.segno);
  const cerca = !!testo.trim() || filtrato;
  const chiave = `${testo}|${filtro.categoria}|${filtro.principale}|${filtro.ingrediente}|${filtro.segno}`;
  const [ultima, setUltima] = useState(chiave);
  if (ultima !== chiave) {
    setUltima(chiave);
    setQuante(PER_PAGINA);
  }
  const tutte = useMemo(
    () =>
      cerca
        ? filtra(indice, {
            testo,
            categoria: filtro.categoria,
            cucina: null,
            minuti: null,
            inCasa: null,
            origine: 'tutte',
            archiviate: false,
          })
            .filter((r) => r.categoria !== 'base' || filtro.categoria === 'base')
            .filter((r) => haPrincipale(indice, r, filtro.principale) && usaIngrediente(indice, r, filtro.ingrediente))
            .filter((r) => (filtro.segno === 'preferita' ? segni.preferite.has(r.id) : filtro.segno === 'ospiti' ? segni.perOspiti.has(r.id) : true))
        : [],
    [indice, testo, cerca, filtro, segni],
  );
  if (!cerca) return vuoto ? <p className="tenue piccolo risultati-piatto">{vuoto}</p> : null;
  const trovate = tutte.slice(0, quante);
  return (
    <div className="risultati-piatto">
      {filtrato && <p className="tenue piccolo conteggio">{tutte.length === 1 ? '1 ricetta' : `${tutte.length} ricette`} con questi filtri</p>}
      <ul className="elenco risultati compatti" aria-label="Risultati">
        {trovate.map((r) => {
          const v = dati.vincoli.length ? valutaPortata(indice, r, chi, dati.vincoli, [], dati.verifiche) : null;
          const no = gustiPerPiatto(indice, r, chi, dati.gusti).filter((g) => g.valore === 'non_piace');
          const x = rimedi && v?.esito === 'non_adatta' ? rimedio(indice, r, chi, dati.vincoli, dati.verifiche) : null;
          const tocca = () => {
            if (x?.possibile) rimedi!.senza(r, x);
            else if (x) setAperta(aperta === r.id ? null : r.id);
            else scegli({ ricetta_id: r.id, testo: null });
          };
          return (
            <li key={r.id}>
              <button type="button" className="voce" onClick={tocca} aria-expanded={x && !x.possibile ? aperta === r.id : undefined}>
                <span className="icona-voce" aria-hidden>
                  <IconaCibo valore={iconaRicetta(indice, r, icone?.get(r.id))} />
                </span>
                <span className="cresce">
                  {r.titolo}
                  <MarchiSegni id={r.id} segni={segni} />
                  {(v || no.length > 0) && (
                    <span className="tenue" style={{ display: 'block' }}>
                      {[v && NOME_ESITO[v.esito], no.length > 0 && `non piace a ${no.map((g) => g.nome).join(', ')}`].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  {x?.possibile && <EtichettaRimedio indice={indice} rimedio={x} />}
                </span>
                {v && <span aria-hidden>{ICONA_ESITO[v.esito]}</span>}
              </button>
              {x && !x.possibile && aperta === r.id && (
                <AvvisoNonSiToglie
                  rimedio={x}
                  famiglia={new Set(dati.persone.filter((m) => m.id !== ID_OSPITI).map((m) => m.id))}
                  mangiaAltro={(loro) => rimedi!.mangiaAltro(r.id, loro)}
                  aggiungiLoStesso={() => scegli({ ricetta_id: r.id, testo: null })}
                />
              )}
            </li>
          );
        })}
        {tutte.length > quante && (
          <li>
            <button type="button" className="voce" onClick={() => setQuante(quante + PER_PAGINA)}>
              Mostra altre ({tutte.length - quante})
            </button>
          </li>
        )}
        {testo.trim() && (
          <li>
            <button type="button" className="voce" onClick={() => scegli({ ricetta_id: null, testo: testo.trim() })}>
              ✏️ Scrivi «{testo.trim()}» senza ricetta
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

/** Le categorie di piatto: una riga di bottoni piccoli, prima quelle adatte al pasto. */
/** Prima ⭐ preferite e 💫 per ospiti, poi le categorie (quelle adatte al pasto per prime), sulla stessa riga. */
function FiltroCategoria({ pasto, filtro, cambia }: { pasto: string; filtro: FiltroPiatto; cambia: (f: FiltroPiatto) => void }) {
  const adatte = RICETTE_PER_PASTO[pasto] ?? [];
  const categorie = [...CATEGORIE.filter((c) => adatte.includes(c.id)), ...CATEGORIE.filter((c) => !adatte.includes(c.id))];
  return (
    <div className="scelte compatte">
      <BottoniSegno segno={filtro.segno} cambia={(segno) => cambia({ ...filtro, segno })} />
      <span className="separatore" aria-hidden />
      <div className="gruppo-in-riga" role="group" aria-label="Categoria">
        {categorie.map((c) => (
          <button key={c.id} type="button" aria-pressed={filtro.categoria === c.id} onClick={() => cambia({ ...filtro, categoria: filtro.categoria === c.id ? null : c.id })}>
            {c.emoji} {c.nome}
          </button>
        ))}
      </div>
    </div>
  );
}

function nomeCategoria(dati: DatiMenu, valore: string) {
  return dati.categorie.find((c) => c.valore === valore)?.nome ?? 'Pasto';
}

function NuovoPiatto({
  indice,
  dati: tutti,
  data,
  categoria,
  per,
  chiudi,
  apriOspiti,
}: {
  indice: Indice;
  dati: DatiMenu;
  data: string;
  categoria: string;
  /** Per chi è il piatto (id dei membri); di base per tutti. */
  per?: string[];
  chiudi: () => void;
  apriOspiti: () => void;
}) {
  const { esegui } = useFamiglia();
  const dati = datiAlPasto(tutti, data, categoria);
  const quanti = dati.portate.filter((p) => p.data === data && p.categoria === categoria).length;
  const [chi, setChi] = useState<Set<string>>(() => new Set(per ?? tutti.persone.map((x) => x.id)));
  const [filtro, setFiltro] = useState<FiltroPiatto>(SENZA_FILTRI);
  const [testo, setTesto] = useState('');
  const icone = useIcone();
  // Le proposte e gli avvisi guardano solo chi lo mangia (e gli ospiti del pasto, se ci sono).
  const perLoro = {
    ...dati,
    persone: dati.persone.filter((x) => chi.has(x.id) || !tutti.persone.some((m) => m.id === x.id)),
  };

  /** Una ricetta ⛔ che va bene togliendo un ingrediente: si sceglie per chi toglierlo prima di aggiungerla. */
  const [daTogliere, setDaTogliere] = useState<{ ricetta: Ricetta; rimedio: Rimedio; origine: 'manuale' | 'automatica' } | null>(null);
  const famiglia = new Set(tutti.persone.map((x) => x.id));

  /** Il piatto nuovo e, per chi non è spuntato (o `fuori`), «non mangia questo piatto». */
  async function aggiungi(campi: Record<string, unknown>, fuori: string[] = []) {
    const id = crypto.randomUUID();
    await esegui('aggiungi_portata', { id, data, categoria, ...campi, ordine: quanti });
    for (const x of tutti.persone)
      if (!chi.has(x.id) || fuori.includes(x.id)) await esegui('imposta_eccezione', { id: crypto.randomUUID(), portata_id: id, membro_id: x.id, tipo: 'non_mangia' });
    chiudi();
  }

  if (daTogliere)
    return (
      <FoglioSenza
        indice={indice}
        ricetta={daTogliere.ricetta}
        rimedio={daTogliere.rimedio}
        persone={perLoro.persone}
        famiglia={famiglia}
        porzioni={perLoro.persone.reduce((t, x) => t + x.porzione, 0)}
        bottone={`Aggiungi a ${nomeCategoria(dati, categoria).toLowerCase()}`}
        conferma={(senza: Senza[]) => aggiungi({ ricetta_id: daTogliere.ricetta.id, origine: daTogliere.origine, senza })}
        chiudi={() => setDaTogliere(null)}
      />
    );

  return (
    <Foglio titolo={`${nomeCategoria(dati, categoria)} di ${dataLunga(data)}`} chiudi={chiudi} alto>
      <div className="nuovo-piatto">
        <FiltroCategoria pasto={categoria} filtro={filtro} cambia={setFiltro} />
        <CercaRicetta
          indice={indice}
          etichetta="Cosa si mangia"
          segnaposto="Ricetta o ingrediente: carbonara, zucchine…"
          testo={testo}
          cambiaTesto={setTesto}
          filtro={filtro}
          cambia={(f) => setFiltro({ ...filtro, ...f })}
        />
        {chi.size === 0 ? (
          <p className="tenue">Spunta almeno una persona qui sotto.</p>
        ) : (
          <>
            <IdeePerPasto indice={indice} dati={perLoro} data={data} categoria={categoria} filtro={filtro} conOspiti={!!ospitiDel(tutti.ospiti, data, categoria)} icone={icone} scegli={(ricetta_id, x) => {
                const r = indice.perId.get(ricetta_id);
                if (x && r) setDaTogliere({ ricetta: r, rimedio: x, origine: 'automatica' });
                else aggiungi({ ricetta_id, origine: 'automatica' });
              }} />
            <RisultatiPiatto
              indice={indice}
              dati={perLoro}
              testo={testo}
              filtro={filtro}
              icone={icone}
              vuoto="Scegli una categoria o un ingrediente, o scrivi un nome: qui compaiono le ricette."
              scegli={(s) => aggiungi(s)}
              rimedi={{
                senza: (ricetta, x) => setDaTogliere({ ricetta, rimedio: x, origine: 'manuale' }),
                mangiaAltro: (ricetta_id, loro) => aggiungi({ ricetta_id }, loro),
              }}
            />
          </>
        )}
        <div className="chi-e-ospiti">
          {tutti.persone.length > 1 && (
            <SpunteChiMangia
              compatte
              persone={tutti.persone}
              mangia={(id) => chi.has(id)}
              cambia={(id, si) => {
                const n = new Set(chi);
                if (si) n.add(id);
                else n.delete(id);
                setChi(n);
              }}
            />
          )}
          <BottoneOspiti ospiti={ospitiDel(tutti.ospiti, data, categoria)} apri={apriOspiti} />
        </div>
      </div>
    </Foglio>
  );
}

function SchedaPiatto({
  indice,
  dati,
  portata: p,
  chiudi,
  apriOspiti,
  apriNuovo,
}: {
  indice: Indice;
  dati: DatiMenu;
  portata: PortataMenu;
  chiudi: () => void;
  apriOspiti: () => void;
  /** Apre «aggiungi un piatto» allo stesso pasto, per queste persone. */
  apriNuovo: (per: string[]) => void;
}) {
  const { esegui } = useFamiglia();
  const d = descrivi(indice, dati, p);
  // Chi non mangia questo piatto e a questo pasto non ha ancora nessun altro piatto.
  const delPasto = dati.portate.filter((x) => x.data === p.data && x.categoria === p.categoria);
  const senzaPiatto = dati.persone.filter((x) => delPasto.every((q) => dati.eccezioni.some((e) => e.portata_id === q.id && e.membro_id === x.id && e.tipo === 'non_mangia')));
  const [cambia, setCambia] = useState(false);
  const [cucina, setCucina] = useState(false);
  const pronto = usePronti().get(p.id);
  const confermato = useConferme(useVista()).attive.has(p.id);
  const [data, setData] = useState(p.data);
  const [categoria, setCategoria] = useState(p.categoria);
  const [note, setNote] = useState(p.note ?? '');
  const modifica = (campi: Record<string, unknown>) =>
    esegui('modifica_portata', {
      id: p.id,
      versione_attesa: p.versione ?? 1,
      campi,
    });
  const automatiche = porzioniPortata({ ...p, porzioni: null }, dati.persone, dati.eccezioni, dati.ospiti);

  return (
    <Foglio titolo={d.titolo} chiudi={chiudi}>
      <p className="tenue" style={{ marginTop: 0, textTransform: 'capitalize' }}>
        {nomeCategoria(dati, p.categoria)} · {dataLunga(p.data)}
        {p.origine === 'ripetuta' && ' · ripetuto dalla settimana prima'}
        {p.origine === 'automatica' && ' · ✨ proposto dall’app'}
        {p.fisso_id && ' · 🔁 ogni giorno'}
        {!d.ricetta && ' · senza ricetta'}
      </p>
      {p.avanzo_di && <AvanzoDi dati={dati} portata={p} />}

      {d.valutazione && (
        <EsitoPiatto
          esito={d.valutazione.esito}
          righe={d.valutazione.perMembro
            .filter((m) => m.valutazione)
            .map(
              (m) =>
                `${m.nome}${m.mangia === 'alternativa' ? ' (piatto a parte)' : ''}: ${m.valutazione!.esito === 'adatta' || !m.valutazione!.dettagli?.length ? `${ICONA_ESITO[m.valutazione!.esito]} ` : ''}${motiviInBreve(m.valutazione!) || (m.senza?.length ? `senza ${elencoNomi(indice, m.senza)} ✂️` : 'nessun problema noto')}`,
            )}
        />
      )}
      {d.ricetta && !!p.senza?.length && <SenzaNelPiatto indice={indice} dati={dati} portata={p} ricetta={d.ricetta} testo={d.senza} modifica={modifica} />}
      {d.gusti.length > 0 && (
        <ul className="tenue" style={{ paddingLeft: 18 }}>
          {d.gusti.map((g) => (
            <li key={`${g.membro_id}${g.cosa}`}>
              {g.valore === 'piace' ? '😋' : '🙅'} A {g.nome} {g.valore === 'piace' ? 'piace' : 'non piace'} {g.cosa.toLowerCase()}
            </li>
          ))}
        </ul>
      )}

      {cambia ? (
        <CercaPiatto
          indice={indice}
          dati={datiAlPasto(dati, p.data, p.categoria)}
          etichetta="Nuovo piatto"
          scegli={async (s) => {
            await modifica(s);
            // Un piatto fisso si può cambiare solo per oggi o da questo giorno in poi.
            if (p.fisso_id && window.confirm('Cambiarlo anche nei giorni dopo? (Annulla = solo questo giorno)')) {
              await esegui('ferma_pasto_fisso', {
                id: p.fisso_id,
                dal: p.data,
                tieni: p.id,
              });
              await esegui('fissa_pasto', {
                id: crypto.randomUUID(),
                categoria: p.categoria,
                ...s,
                porzioni: p.porzioni,
                ordine: p.ordine,
                dal: p.data,
                da_portata: p.id,
              });
            }
            setCambia(false);
          }}
        />
      ) : (
        <div className="riga" style={{ flexWrap: 'wrap' }}>
          <button className="bottone piccolo" onClick={() => setCambia(true)}>
            Cambia piatto
          </button>
          {p.fisso_id ? (
            <button
              className="bottone piccolo"
              onClick={async () => {
                if (!window.confirm('Togliere questo piatto da oggi in poi? I giorni già confermati restano.')) return;
                await esegui('ferma_pasto_fisso', {
                  id: p.fisso_id,
                  dal: p.data,
                });
                chiudi();
              }}
            >
              Non più da questo giorno
            </button>
          ) : (
            <button
              className="bottone piccolo"
              onClick={() =>
                esegui('fissa_pasto', {
                  id: crypto.randomUUID(),
                  categoria: p.categoria,
                  ...(p.ricetta_id ? { ricetta_id: p.ricetta_id } : { testo: p.testo }),
                  porzioni: p.porzioni,
                  ordine: p.ordine,
                  dal: p.data,
                  da_portata: p.id,
                })
              }
            >
              🔁 Ogni giorno da qui
            </button>
          )}
        </div>
      )}

      <div className="campo" style={{ marginTop: 16 }}>
        <span>Porzioni</span>
        <div className="riga" role="group" aria-label="Porzioni">
          <div className="scelte" style={{ margin: 0 }}>
            <button aria-pressed={p.porzioni === null} onClick={() => modifica({ porzioni: null })}>
              Automatiche ({automatiche.toLocaleString('it-IT')})
            </button>
          </div>
          <button className="bottone piccolo" aria-label="Una porzione in meno" onClick={() => modifica({ porzioni: Math.max(0.5, d.porzioni - 1) })}>
            −
          </button>
          <span aria-live="polite">{d.porzioni.toLocaleString('it-IT')}</span>
          <button className="bottone piccolo" aria-label="Una porzione in più" onClick={() => modifica({ porzioni: Math.min(99, d.porzioni + 1) })}>
            +
          </button>
        </div>
      </div>

      {p.ricetta_id && !p.avanzo_di && <DuraPiuGiorni dati={dati} portata={p} cucinate={d.porzioni + d.dopo} />}
      {!p.avanzo_di && !confermato && (
        <div className="campo" style={{ marginTop: 16 }}>
          <span>Preparato in anticipo?</span>
          {pronto ? (
            <p className="tenue" style={{ margin: 0 }}>
              🍳 Cucinato: in {pronto.luogo} {pronto.quantita === 1 ? 'c’è' : 'ci sono'} {formattaPorzioni(pronto.quantita)}
              {pronto.data_limite && `, da mangiare entro ${dataLunga(pronto.data_limite)}`}.
            </p>
          ) : (
            <button className="bottone" aria-label={`Cucinato: ${d.titolo}`} onClick={() => setCucina(true)}>
              🍳 Cucinato
            </button>
          )}
        </div>
      )}
      {cucina && <SegnaCucinato indice={indice} dati={dati} portata={p} titolo={d.titolo} chiudi={() => setCucina(false)} />}

      <div className="campo">
        {dati.persone.length > 1 && (
          <>
            <SpunteChiMangia
              persone={dati.persone}
              mangia={(id) => !d.eccezioni.some((e) => e.membro_id === id)}
              nota={(id) => {
                const e = d.eccezioni.find((x) => x.membro_id === id && x.tipo === 'alternativa');
                return e ? `piatto a parte: ${e.ricetta_id ? (indice.perId.get(e.ricetta_id)?.titolo ?? 'ricetta') : e.testo}` : null;
              }}
              cambia={(id, si) => {
                const e = d.eccezioni.find((x) => x.membro_id === id);
                if (si && e) void esegui('rimuovi_eccezione', { id: e.id });
                if (!si)
                  void esegui('imposta_eccezione', {
                    id: crypto.randomUUID(),
                    portata_id: p.id,
                    membro_id: id,
                    tipo: 'non_mangia',
                    versione_attesa: e?.versione,
                  });
              }}
            />
            {senzaPiatto.length > 0 && (
              <button className="bottone piccolo" onClick={() => apriNuovo(senzaPiatto.map((x) => x.id))}>
                + Un altro piatto per {senzaPiatto.map((x) => x.nome).join(', ')}
              </button>
            )}
          </>
        )}
        <BottoneOspiti ospiti={ospitiDel(dati.ospiti, p.data, p.categoria)} apri={apriOspiti} />
      </div>

      <form
        className="campo"
        onSubmit={(e) => {
          e.preventDefault();
          if (data && (data !== p.data || categoria !== p.categoria)) void modifica({ data, categoria });
        }}
      >
        <span>Sposta</span>
        <div className="riga" style={{ flexWrap: 'wrap' }}>
          <input type="date" aria-label="Giorno" value={data} onChange={(e) => setData(e.target.value)} style={{ width: 'auto' }} />
          <select aria-label="Pasto" value={categoria} onChange={(e) => setCategoria(e.target.value)} style={{ width: 'auto' }}>
            {dati.categorie
              .filter((c) => c.attiva || c.valore === p.categoria)
              .map((c) => (
                <option key={c.valore} value={c.valore}>
                  {c.nome}
                </option>
              ))}
          </select>
          {(data !== p.data || categoria !== p.categoria) && <button className="bottone primario piccolo">Sposta</button>}
        </div>
      </form>

      <form
        className="campo"
        onSubmit={(e) => {
          e.preventDefault();
          void modifica({ note: note.trim() || null });
        }}
      >
        <span>Note</span>
        <div className="riga">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="cresce" aria-label="Note" />
          {note.trim() !== (p.note ?? '') && <button className="bottone primario piccolo">Salva</button>}
        </div>
      </form>

      <label className="riga" style={{ margin: '12px 0', minHeight: 44 }}>
        <input type="checkbox" checked={p.bloccata} onChange={(e) => modifica({ bloccata: e.target.checked })} />
        <span>🔒 Blocca: le proposte automatiche non lo cambieranno</span>
      </label>

      <button
        className="bottone pericolo pieno"
        onClick={async () => {
          await esegui('rimuovi_portata', { id: p.id });
          chiudi();
        }}
      >
        Togli dal menu
      </button>
    </Foglio>
  );
}

/** Un avanzo: si mangia ciò che è avanzato dal piatto di un altro giorno, non si cucina di nuovo. */
function AvanzoDi({ dati, portata: p }: { dati: DatiMenu; portata: PortataMenu }) {
  const origine = dati.portate.find((x) => x.id === p.avanzo_di);
  return (
    <p className="avviso" style={{ marginTop: 0 }}>
      🍰 Avanzo {origine ? `di ${nomeCategoria(dati, origine.categoria).toLowerCase()} di ${dataLunga(origine.data)}` : 'di un altro giorno'}: non si cucina e non va nella spesa.
      Confermando, si toglie dall’avanzo in casa.
    </p>
  );
}

/**
 * Un piatto che dura più giorni (una torta, un ragù): si mettono le porzioni nei pasti dei giorni dopo.
 * Il primo giorno si cucina e si compra per tutti; i giorni dopo si mangia l'avanzo.
 */
function DuraPiuGiorni({ dati, portata: p, cucinate }: { dati: DatiMenu; portata: PortataMenu; cucinate: number }) {
  const { esegui } = useFamiglia();
  const giorni = [1, 2, 3, 4, 5, 6].map((n) => piuGiorni(p.data, n));
  const [giorno, setGiorno] = useState(giorni[0]);
  const [categoria, setCategoria] = useState(p.categoria);
  const avanzi = avanziDi(p, dati.portate);
  return (
    <div className="campo" style={{ marginTop: 16 }}>
      <span>Dura più giorni?</span>
      {avanzi.length > 0 && (
        <>
          <p className="tenue" style={{ margin: '0 0 6px' }}>
            Si cucinano {formattaPorzioni(cucinate)}: le altre si mangiano dopo.
          </p>
          <ul className="elenco" aria-label="Avanzi nei giorni dopo">
            {avanzi.map((a) => (
              <li key={a.id} className="riga">
                <span className="cresce" style={{ textTransform: 'capitalize' }}>
                  {nomeCategoria(dati, a.categoria)} · {dataLunga(a.data)}
                </span>
                <button className="bottone piccolo" aria-label={`Togli l’avanzo di ${dataLunga(a.data)}`} onClick={() => esegui('rimuovi_portata', { id: a.id })}>
                  Togli
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="riga" style={{ flexWrap: 'wrap' }}>
        <select className="dato" aria-label="Giorno dell’avanzo" value={giorno} onChange={(e) => setGiorno(e.target.value)} style={{ width: 'auto' }}>
          {giorni.map((g) => (
            <option key={g} value={g}>
              {dataLunga(g)}
            </option>
          ))}
        </select>
        <select className="dato" aria-label="Pasto dell’avanzo" value={categoria} onChange={(e) => setCategoria(e.target.value)} style={{ width: 'auto' }}>
          {dati.categorie.map((c) => (
            <option key={c.valore} value={c.valore}>
              {c.nome}
            </option>
          ))}
        </select>
        <button
          className="bottone piccolo"
          onClick={() =>
            esegui('aggiungi_avanzo', {
              id: crypto.randomUUID(),
              avanzo_di: p.id,
              data: giorno,
              categoria,
              ordine: dati.portate.filter((x) => x.data === giorno && x.categoria === categoria).length,
            })
          }
        >
          🍰 Avanza anche qui
        </button>
      </div>
    </div>
  );
}

/**
 * Cosa è tolto dal piatto («✂️ Senza panna per Sara»): si cambia per chi (solo per lei o per tutti) o si rimette.
 * Il foglio usa la ricetta com'è, per chi mangia il piatto quel giorno.
 */
function SenzaNelPiatto({
  indice,
  dati,
  portata: p,
  ricetta,
  testo,
  modifica,
}: {
  indice: Indice;
  dati: DatiMenu;
  portata: PortataMenu;
  ricetta: Ricetta;
  testo: string;
  modifica: (campi: Record<string, unknown>) => Promise<unknown>;
}) {
  const [cambia, setCambia] = useState(false);
  const alTavolo = alPasto(dati.persone, dati.vincoli, ospitiDel(dati.ospiti, p.data, p.categoria));
  const fuori = new Set(dati.eccezioni.filter((e) => e.portata_id === p.id).map((e) => e.membro_id));
  const mangiano = alTavolo.persone.filter((x) => !fuori.has(x.id));
  const x = rimedio(indice, ricetta, mangiano, alTavolo.vincoli, dati.verifiche);
  const perTutti = (p.senza ?? []).every((s) => s.membro_id === null);
  return (
    <div className="senza-nel-piatto riga">
      <span aria-hidden style={{ fontSize: '1.3rem' }}>
        ✂️
      </span>
      <span className="cresce">
        <strong>{testo.charAt(0).toUpperCase() + testo.slice(1)}</strong>
        <span className="tenue piccolo" style={{ display: 'block' }}>
          {perTutti ? 'Nessuno lo mette: non va nella spesa' : 'La sua porzione si mette da parte prima di aggiungerlo'}
        </span>
      </span>
      {x?.possibile && (
        <button type="button" className="bottone piccolo" onClick={() => setCambia(true)}>
          Cambia
        </button>
      )}
      <button
        type="button"
        className="bottone piccolo"
        onClick={() => window.confirm('Rimettere gli ingredienti tolti? Il piatto tornerà ⛔ per chi non può mangiarli.') && modifica({ senza: [] })}
      >
        Rimetti
      </button>
      {cambia && x?.possibile && (
        <FoglioSenza
          indice={indice}
          ricetta={ricetta}
          rimedio={x}
          persone={mangiano}
          famiglia={new Set(dati.persone.map((m) => m.id))}
          porzioni={porzioniPortata(p, dati.persone, dati.eccezioni, dati.ospiti)}
          iniziale={perTutti ? 'tutti' : 'loro'}
          bottone="Salva"
          conferma={async (senza) => {
            await modifica({ senza });
            setCambia(false);
          }}
          chiudi={() => setCambia(false)}
        />
      )}
    </div>
  );
}

function EsitoPiatto({ esito, righe }: { esito: Esito; righe: string[] }) {
  return (
    <div
      className={`avviso ${esito === 'adatta' ? 'info' : 'errore'}`}
      style={
        esito === 'da_verificare'
          ? {
              background: 'var(--attenzione-tenue)',
              color: 'var(--attenzione)',
            }
          : undefined
      }
    >
      <strong>
        {ICONA_ESITO[esito]} {esito === 'adatta' ? 'Adatto a chi lo mangia' : NOME_ESITO[esito]}
      </strong>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {righe.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

/** Chi mangia il piatto: una spunta per persona. Chi non è spuntato può avere un altro piatto nello stesso pasto. */
function SpunteChiMangia({
  persone,
  mangia,
  cambia,
  nota,
  compatte,
}: {
  /** In una riga di bottoni, come nella scelta di un piatto nuovo. */
  compatte?: boolean;
  persone: Persona[];
  mangia: (id: string) => boolean;
  cambia: (id: string, mangia: boolean) => void;
  nota?: (id: string) => string | null;
}) {
  return (
    <fieldset className={`spunte${compatte ? ' compatte' : ''}`} style={{ border: 0, padding: 0, margin: '0 0 8px' }}>
      <legend style={{ fontWeight: 600, marginBottom: 4 }}>Chi mangia questo piatto</legend>
      {persone.map((x) => (
        <label key={x.id} className={compatte ? 'spunta-chip' : 'riga'} style={compatte ? undefined : { minHeight: 44 }}>
          <input type="checkbox" checked={mangia(x.id)} onChange={(e) => cambia(x.id, e.target.checked)} />
          <span className="cresce">
            {x.porzione < 1 && <span aria-hidden>🧒 </span>}
            {x.nome}
            {nota?.(x.id) && <span className="tenue"> · {nota(x.id)}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function contaOspiti(o: Pick<OspitiPasto, 'adulti' | 'bambini'>) {
  const parti = [];
  if (o.adulti) parti.push(o.adulti === 1 ? '1 adulto' : `${o.adulti} adulti`);
  if (o.bambini) parti.push(o.bambini === 1 ? '1 bambino' : `${o.bambini} bambini`);
  return parti.join(' e ');
}

/** Nel calendario, solo se a quel pasto ci sono ospiti. */
function EtichettaOspiti({ ospiti, apri }: { ospiti?: OspitiPasto; apri: () => void }) {
  if (!ospiti) return null;
  return (
    <button className="etichetta" onClick={apri} aria-label={`Ospiti: ${contaOspiti(ospiti)}`}>
      👥 {ospiti.adulti + ospiti.bambini}
      {ospiti.oggetti.length > 0 && ' ⚠️'}
      {ospiti.in_attesa && ' · in invio'}
    </button>
  );
}

function BottoneOspiti({ ospiti, apri }: { ospiti?: OspitiPasto; apri: () => void }) {
  return (
    <button className="bottone piccolo" onClick={apri}>
      👥 {ospiti ? `Ospiti: ${contaOspiti(ospiti)}` : 'Ci sono ospiti?'}
    </button>
  );
}

const GRUPPI_OSPITI: { nome: string; voci: VoceVincolo[] }[] = [
  { nome: 'Allergie', voci: ALLERGENI_UE },
  { nome: 'Intolleranze', voci: INTOLLERANZE },
  { nome: 'Esigenze', voci: ESIGENZE },
];

/**
 * Ospiti a un pasto: quanti adulti e bambini e cosa non possono mangiare. Niente nomi; le esigenze
 * si dimenticano appena il pasto è passato, restano solo i numeri per spesa e consumi.
 */
function SchedaOspiti({ dati, data, categoria, chiudi }: { dati: DatiMenu; data: string; categoria: string; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const attuali = ospitiDel(dati.ospiti, data, categoria);
  const [adulti, setAdulti] = useState(attuali?.adulti ?? 1);
  const [bambini, setBambini] = useState(attuali?.bambini ?? 0);
  const [oggetti, setOggetti] = useState<string[]>(attuali?.oggetti ?? []);
  const passato = data < oggi();

  async function salva(a: number, b: number) {
    await esegui('imposta_ospiti', {
      data,
      categoria,
      adulti: a,
      bambini: b,
      oggetti: passato ? [] : oggetti,
      ...(attuali && !attuali.in_attesa ? { versione_attesa: attuali.versione } : {}),
      dispositivo: idDispositivo(),
    });
    chiudi();
  }

  const contatore = (nome: string, valore: number, cambia: (n: number) => void) => (
    <div className="riga" role="group" aria-label={nome}>
      <span className="cresce">{nome}</span>
      <button className="bottone piccolo" aria-label={`${nome}: uno in meno`} onClick={() => cambia(Math.max(0, valore - 1))}>
        −
      </button>
      <span aria-live="polite" style={{ minWidth: 24, textAlign: 'center' }}>
        {valore}
      </span>
      <button className="bottone piccolo" aria-label={`${nome}: uno in più`} onClick={() => cambia(Math.min(50, valore + 1))}>
        +
      </button>
    </div>
  );

  return (
    <Foglio titolo={`Ospiti a ${nomeCategoria(dati, categoria).toLowerCase()} di ${dataLunga(data)}`} chiudi={chiudi}>
      <div className="campo">
        {contatore('Adulti', adulti, setAdulti)}
        {contatore('Bambini', bambini, setBambini)}
        <p className="tenue" style={{ margin: 0 }}>
          Le porzioni dei piatti crescono da sole: un adulto conta 1, un bambino {PORZIONE_BAMBINO.toLocaleString('it-IT')}.
        </p>
      </div>
      {!passato &&
        GRUPPI_OSPITI.map((g) => (
          <div className="campo" key={g.nome}>
            <span>{g.nome} degli ospiti</span>
            <div className="riga" style={{ flexWrap: 'wrap', gap: 6 }} role="group" aria-label={`${g.nome} degli ospiti`}>
              {g.voci.map((v) => {
                const scelto = oggetti.includes(v.oggetto);
                return (
                  <button
                    key={v.oggetto}
                    className="etichetta"
                    aria-pressed={scelto}
                    onClick={() => setOggetti(scelto ? oggetti.filter((o) => o !== v.oggetto) : [...oggetti, v.oggetto])}
                  >
                    {scelto ? '✓ ' : ''}
                    {v.nome}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      <p className="tenue">
        {passato
          ? 'Il pasto è passato: si segnano solo quanti eravate, per i consumi.'
          : 'Niente nomi. Il menu controlla i piatti anche per gli ospiti; le loro allergie ed esigenze si cancellano da sole dopo il pasto.'}
      </p>
      <div className="riga" style={{ flexWrap: 'wrap' }}>
        <button className="bottone primario" disabled={adulti + bambini === 0} onClick={() => void salva(adulti, bambini)}>
          Salva gli ospiti
        </button>
        {attuali && (
          <button className="bottone" onClick={() => void salva(0, 0)}>
            Nessun ospite
          </button>
        )}
      </div>
    </Foglio>
  );
}

/** Quali pasti usa la famiglia: spuntino e merenda si accendono, altri si creano. */
function Pasti({ categorie, chiudi }: { categorie: CategoriaPasto[]; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const [nome, setNome] = useState('');
  const [emoji, setEmoji] = useState('🍽️');

  function accendi(c: CategoriaPasto, attiva: boolean) {
    if (c.standard) void esegui('imposta_categoria', { chiave: c.valore, attiva });
    else
      void esegui('modifica_categoria', {
        id: c.id,
        versione_attesa: c.versione,
        campi: { attiva },
      });
  }

  return (
    <Foglio titolo="Pasti della famiglia" chiudi={chiudi}>
      <ul className="elenco">
        {categorie.map((c) => (
          <li key={c.valore}>
            <label className="riga" style={{ minHeight: 44 }}>
              <input type="checkbox" checked={c.attiva} onChange={(e) => accendi(c, e.target.checked)} />
              <span aria-hidden>{c.emoji}</span>
              <span className="cresce">{c.nome}</span>
            </label>
          </li>
        ))}
      </ul>
      <form
        className="campo"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!nome.trim()) return;
          await esegui('crea_categoria', {
            id: crypto.randomUUID(),
            nome: nome.trim(),
            emoji: emoji || null,
            ordine: 10 + categorie.length,
          });
          setNome('');
        }}
      >
        <span>Nuovo pasto</span>
        <div className="riga">
          <input aria-label="Emoji del pasto" value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} style={{ width: 64 }} />
          <input aria-label="Nome del pasto" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={40} className="cresce" placeholder="Brunch, dopo-scuola…" required />
          <button className="bottone primario piccolo">Aggiungi</button>
        </div>
      </form>
      <p className="tenue">Un pasto spento sparisce dal calendario, ma i piatti già messi restano visibili.</p>
    </Foglio>
  );
}
