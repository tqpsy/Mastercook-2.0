import { useState } from 'react';
import { useFamiglia, useVista } from '../dati/contesto';
import { useIndice } from '../dati/indice';
import { type CategoriaPasto, dataLunga, giorniDellaSettimana, lunedi, nomeGiorno, nomeSettimana, ospitiDel, ripetiSettimana } from '../dominio/menu';
import { ProponiSettimana } from './Proposte';
import { FacciaAntonino } from './Antonino';
import { oggi, piuGiorni } from '../dominio/scadenze';
import { sigleDi } from '../ui/Sigla';
import { useDatiMenu, useProlungaFissi } from '../dati/menu';
import { useCarosello, useFinoInFondo, useLargo, useScorrimento } from './menu/gesti';
import { Panoramica, RiquadroMenu, SettimanaGriglia } from './menu/Riquadri';
import { NuovoPiatto } from './menu/NuovoPiatto';
import { SchedaPiatto } from './menu/SchedaPiatto';
import { SchedaOspiti } from './menu/ChiMangia';
import { Pasti } from './menu/Pasti';

type Modo = 'giorni' | 'settimana' | 'panoramica';
const MODI: { id: Modo; nome: string }[] = [
  { id: 'giorni', nome: 'Giorni' },
  { id: 'settimana', nome: 'Settimana' },
  { id: 'panoramica', nome: 'Panoramica' },
];
const CHIAVE_MODO = 'mc-menu-modo';

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
  const vaiAl = (g: string) => {
    setLunStato(lunedi(g));
    setScelto(g);
  };
  // Col dito (o con le frecce della tastiera): nei Giorni un giorno alla volta, sulla striscia una settimana;
  // nella Settimana e nella Panoramica una settimana (indietro si arriva alla domenica, l'ultima colonna).
  const scorrimento = useScorrimento((verso, bersaglio) => {
    if (modo === 'giorni') return vaiAl(piuGiorni(scelto, bersaglio.closest('.striscia-giorni') ? 7 * verso : verso));
    const nuovo = piuGiorni(lun, 7 * verso);
    vaiAl(nuovo === lunedi(giorno) ? giorno : verso === 1 ? nuovo : piuGiorni(nuovo, 6));
  });
  const { finestra, binario, gesti } = useCarosello((verso) => vaiAl(piuGiorni(scelto, verso)), scelto);
  useFinoInFondo(finestra, largo ? 16 : 92, modo === 'giorni', `${modo}|${scelto}|${largo}`);

  if (!vista.pronta || !indice) return <p className="tenue">Sto caricando il menu…</p>;
  const giorni = giorniDellaSettimana(lun);
  // La striscia parte da questa settimana finché si guarda questa o la prossima; più in là, dalla settimana scelta.
  const baseStriscia = lun === lunedi(giorno) || lun === piuGiorni(lunedi(giorno), 7) ? lunedi(giorno) : lun;
  const fine = giorni[6];
  const settimana = dati.portate.filter((p) => p.data >= lun && p.data <= fine);
  const precedente = dati.portate.filter((p) => p.data >= piuGiorni(lun, -7) && p.data < lun);
  // Si vedono i pasti attivi, più quelli spenti che in questa settimana hanno già qualcosa.
  const categorie = dati.categorie.filter((c) => c.attiva || settimana.some((p) => p.categoria === c.valore));
  // Anche fuori dalla settimana: il carosello mostra accanto il giorno prima e quello dopo.
  const piatti = (data: string, categoria: string) => dati.portate.filter((p) => p.data === data && p.categoria === categoria);
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
            Tipi di pasti
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
  // «Oggi» c'è sempre (la riga in alto non cambia mai): spento quando si sta già guardando oggi.
  const giaOggi = modo === 'giorni' ? scelto === giorno : lun === lunedi(giorno);
  const tornaOggi = (
    <button className="bottone piccolo torna-oggi" aria-label="Torna a oggi" disabled={giaOggi} onClick={() => vaiAl(giorno)}>
      Oggi
    </button>
  );
  const riempi = fine >= giorno && vuoti > 0 && modo !== 'panoramica' && (
    <button className={`bottone primario riempi-vuoti con-antonino${largo ? '' : ' pieno'}`} onClick={() => setProponi(true)} aria-label="Antonino, riempi la settimana">
      <FacciaAntonino piccola /> Riempi i vuoti{largo ? '' : ' della settimana'}
    </button>
  );
  /** Una striscia di 7 giorni: si tocca un giorno per vederlo, si scorre col dito per cambiare settimana. */
  const striscia = (l: string) => (
    <div className="striscia-giorni" role="group" aria-label={`Giorni: ${nomeSettimana(l)}`}>
      {giorniDellaSettimana(l).map((g) => (
        <button
          key={g}
          className={`${g < giorno ? 'passato' : ''}${g === giorno ? ' oggi' : ''}`}
          aria-pressed={g === scelto}
          aria-label={`Mostra ${dataLunga(g)}`}
          onClick={() => vaiAl(g)}
        >
          <small>{nomeGiorno(g, true)}</small>
          <strong>{Number(g.slice(8))}</strong>
        </button>
      ))}
    </div>
  );

  return (
    <>
      {/* Ancorata in alto e sempre uguale: vista, «Oggi», (sul tablet «Riempi i vuoti») e «⋯». */}
      <div className={`riga comandi-menu${largo ? ' largo' : ''}`}>
        {sceltaVista}
        {tornaOggi}
        <span className="cresce" />
        {largo && riempi}
        {altreAzioni}
      </div>

      <div className="area-scorrevole" {...scorrimento}>

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
      {modo === 'settimana' && <SettimanaGriglia riserva={largo ? 16 : 120} largo={largo} giorni={giorni} categorie={categorie} oggiData={giorno} scelto={scelto} cella={(g, c) => riquadro(g, c, true)} />}

      {modo === 'giorni' && (
        <div className="carosello" ref={finestra} {...gesti}>
          <div className="binario" ref={binario}>
        {[piuGiorni(scelto, -1), scelto, piuGiorni(scelto, 1)]
          .map((g) => {
            const accanto = g !== scelto;
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
              <section key={g} className={`giorno-riquadri${g === giorno ? ' oggi' : ''}`} aria-label={dataLunga(g)} aria-hidden={accanto || undefined} inert={accanto}>
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
          </div>
        </div>
      )}

      {modo === 'panoramica' && <Panoramica indice={indice} dati={dati} giorni={giorni} categorie={categorie} settimana={settimana} apri={setAperta} oggiData={giorno} />}
      </div>

      {!largo && riempi}

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
