import { useState } from 'react';
import { useFamiglia, useVista } from '../dati/contesto';
import { useIndice } from '../dati/indice';
import { type CategoriaPasto, dataLunga, giorniDellaSettimana, lunedi, ospitiDel, ripetiSettimana } from '../dominio/menu';
import { ProponiSettimana } from './Proposte';
import { FacciaAntonino } from './Antonino';
import { oggi, piuGiorni } from '../dominio/scadenze';
import { sigleDi } from '../ui/Sigla';
import { useDatiMenu, useProlungaFissi } from '../dati/menu';
import { useLargo, useScorrimento } from './menu/gesti';
import { RiquadroMenu, SettimanaGriglia } from './menu/Riquadri';
import { NuovoPiatto } from './menu/NuovoPiatto';
import { SchedaPiatto } from './menu/SchedaPiatto';
import { SchedaOspiti } from './menu/ChiMangia';
import { Pasti } from './menu/Pasti';
import { Foglio } from '../ui/Foglio';

export function Menu() {
  const vista = useVista();
  const indice = useIndice(vista);
  const dati = useDatiMenu(vista);
  const { esegui } = useFamiglia();
  const giorno = oggi();
  const [lun, setLunStato] = useState(() => lunedi(giorno));
  // Il giorno in evidenza nella griglia (di solito oggi): sul telefono è anche quello a cui scorre la settimana.
  const [scelto, setScelto] = useState(giorno);
  const [altro, setAltro] = useState(false);
  // Il giorno aperto nella sua finestra (toccando il numero del giorno in cima alla griglia).
  const [giornoAperto, setGiornoAperto] = useState<string | null>(null);
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
  // Col dito (o con le frecce della tastiera) si passa alla settimana dopo o prima (indietro si arriva alla domenica, l'ultima colonna).
  const scorrimento = useScorrimento((verso) => {
    const nuovo = piuGiorni(lun, 7 * verso);
    vaiAl(nuovo === lunedi(giorno) ? giorno : verso === 1 ? nuovo : piuGiorni(nuovo, 6));
  });
  const apriGiorno = (g: string) => {
    setScelto(g);
    setGiornoAperto(g);
  };

  if (!vista.pronta || !indice) return <p className="tenue">Sto caricando il menu…</p>;
  const giorni = giorniDellaSettimana(lun);
  const fine = giorni[6];
  const settimana = dati.portate.filter((p) => p.data >= lun && p.data <= fine);
  const precedente = dati.portate.filter((p) => p.data >= piuGiorni(lun, -7) && p.data < lun);
  // Si vedono i pasti attivi, più quelli spenti che in questa settimana hanno già qualcosa.
  const categorie = dati.categorie.filter((c) => c.attiva || settimana.some((p) => p.categoria === c.valore));
  const piatti = (data: string, categoria: string) => dati.portate.filter((p) => p.data === data && p.categoria === categoria);
  const portataAperta = aperta ? dati.portate.find((p) => p.id === aperta) : undefined;

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
  // «Oggi» c'è sempre (la riga in alto non cambia mai): spento quando si sta già guardando la settimana di oggi.
  const giaOggi = lun === lunedi(giorno);
  const tornaOggi = (
    <button className="bottone piccolo torna-oggi" aria-label="Torna a oggi" disabled={giaOggi} onClick={() => vaiAl(giorno)}>
      Oggi
    </button>
  );
  const riempi = fine >= giorno && vuoti > 0 && (
    <button className={`bottone primario riempi-vuoti con-antonino${largo ? '' : ' pieno'}`} onClick={() => setProponi(true)} aria-label="Antonino, riempi la settimana">
      <FacciaAntonino piccola /> Riempi i vuoti{largo ? '' : ' della settimana'}
    </button>
  );
  /** Il contenuto della finestra di un giorno: come «Oggi», ma per il giorno toccato in cima alla griglia. */
  const dettaglioGiorno = (g: string) => {
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
      <>
        {(daRiempire > 0 || ospitiDelGiorno.length > 0) && (
          <div className="riga" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
            {daRiempire > 0 && g >= giorno && <span className="etichetta da-riempire">{daRiempire === 1 ? '1 pasto da riempire' : `${daRiempire} pasti da riempire`}</span>}
            {ospitiDelGiorno.map(({ c, o }) => (
              <span key={c.valore} className="etichetta ospiti-giorno">
                👥 {o!.adulti + o!.bambini} ospiti a {c.nome.toLowerCase()}
              </span>
            ))}
          </div>
        )}
        <div
          className={`riquadri${largo ? ' riquadri-menu-largo' : categorie.length >= 5 ? ' fitto' : ''}`}
          style={colonne && categorie.length > 1 ? { gridTemplateColumns: colonne } : undefined}
        >
          {categorie.map((c) => riquadro(g, c))}
        </div>
      </>
    );
  };

  return (
    <>
      {/* Ancorata in alto e sempre uguale: «Oggi», (sul tablet «Riempi i vuoti») e «⋯». */}
      <div className={`riga comandi-menu${largo ? ' largo' : ''}`}>
        {tornaOggi}
        <span className="cresce" />
        {largo && riempi}
        {altreAzioni}
      </div>

      <div className="area-scorrevole" {...scorrimento}>
        <SettimanaGriglia
          riserva={largo ? 16 : 120}
          largo={largo}
          giorni={giorni}
          categorie={categorie}
          oggiData={giorno}
          scelto={scelto}
          cella={(g, c) => riquadro(g, c, true)}
          apriGiorno={apriGiorno}
        />
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
      {giornoAperto && (
        <Foglio titolo={dataLunga(giornoAperto)} chiudi={() => setGiornoAperto(null)}>
          {dettaglioGiorno(giornoAperto)}
        </Foglio>
      )}
      {ospiti && <SchedaOspiti dati={dati} {...ospiti} chiudi={() => setOspiti(null)} />}
      {pasti && <Pasti categorie={dati.categorie} chiudi={() => setPasti(false)} />}
      {proponi && <ProponiSettimana indice={indice} dati={dati} giorni={giorni} chiudi={() => setProponi(false)} />}
    </>
  );
}
