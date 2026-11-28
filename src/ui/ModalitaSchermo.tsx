/**
 * Modalità schermo: la settimana a tutto schermo, in sola lettura — per un tablet appeso in cucina (o il
 * telefono), da leggere al volo senza poter toccare per sbaglio qualcosa. Sul tablet è la stessa griglia
 * della vista «Settimana» del Menu, ingrandita; sul telefono un elenco dei giorni che scorre in verticale,
 * come la vista «Giorni» ma tutti insieme. Doppio tocco su un giorno apre le sue ricette; Indietro del
 * telefono, solo in quella scheda, torna alla settimana restando a tutto schermo — si esce solo toccando
 * di nuovo il logo (mai con Indietro, per non uscirne per sbaglio mentre si legge).
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useVista } from '../dati/contesto';
import { useIndice } from '../dati/indice';
import { chiLoMangia, type DatiMenu, descrivi, useDatiMenu, useProlungaFissi } from '../dati/menu';
import { type CategoriaPasto, dataLunga, giorniDellaSettimana, lunedi, nomeGiorno, nomeSettimana, type PortataMenu } from '../dominio/menu';
import type { Indice } from '../dominio/ricette';
import { oggi } from '../dominio/scadenze';
import { useLargo } from '../pagine/menu/gesti';
import { chiMangia, formattaPorzioni, SegniPiatto, SettimanaGriglia, SigleDi } from '../pagine/menu/Riquadri';
import { Foglio } from './Foglio';
import { Icona } from './Icona';
import { sigleDi } from './Sigla';

/**
 * Riga della raccolta differenziata: solo grafica, grigio chiaro, uguale per ogni giorno — nessun dato
 * vero finché non ci sarà da importare un calendario della raccolta (vedi il canvas «layout C»). Riserva
 * solo lo spazio e fa vedere com'è, senza dire (per ora) cosa si raccoglie in un giorno piuttosto che in un altro.
 */
function RaccoltaDifferenziata() {
  return (
    <span className="schermo-raccolta-icona" aria-hidden="true">
      <Icona nome="raccolta" grandezza={18} />
    </span>
  );
}

/** Due tocchi sullo stesso giorno entro poco: il primo si ricorda, il secondo apre. Una sola istanza per schermata. */
function useDoppioTocco() {
  const ultimi = useRef<Record<string, number>>({});
  return (chiave: string, azione: () => void) => {
    const ora = Date.now();
    if (ora - (ultimi.current[chiave] ?? 0) < 400) {
      ultimi.current[chiave] = 0;
      azione();
    } else {
      ultimi.current[chiave] = ora;
    }
  };
}

/** Un pasto di un giorno nella griglia del tablet: come un riquadro del Menu, ma solo da guardare. */
function CellaLettura({
  indice,
  dati,
  categoria: c,
  portate,
  confermato,
}: {
  indice: Indice;
  dati: DatiMenu;
  categoria: CategoriaPasto;
  portate: PortataMenu[];
  confermato: (id: string) => boolean;
}) {
  if (!portate.length) {
    return (
      <div className={`riquadro t-${c.valore} cella vuoto`}>
        <p className="vuoto-riquadro">–</p>
      </div>
    );
  }
  return (
    <div className={`riquadro t-${c.valore} cella`}>
      <ul className="piatti-riquadro">
        {portate.map((p) => {
          const d = descrivi(indice, dati, p);
          return (
            <li key={p.id}>
              <div className="piatto-riquadro">
                <span className="nome-piatto">
                  <SegniPiatto d={d} portata={p} confermato={confermato(p.id)} />
                  {d.titolo}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Lo stesso pasto come riga sola, per l'elenco dei giorni del telefono (un giorno sopra l'altro, non affiancati). */
function rigaPastoTelefono(indice: Indice, dati: DatiMenu, c: CategoriaPasto, portate: PortataMenu[]) {
  if (!portate.length) {
    return (
      <div key={c.valore} className={`riquadro t-${c.valore} riga vuoto`}>
        <span aria-hidden>{c.emoji}</span>
        <span className="nome-piatto tenue">–</span>
      </div>
    );
  }
  const [primo, ...altri] = portate;
  return (
    <div key={c.valore} className={`riquadro t-${c.valore} riga`}>
      <span aria-hidden>{c.emoji}</span>
      <span className="nome-piatto">{descrivi(indice, dati, primo).titolo}</span>
      {altri.length > 0 && <span className="nota-piatto">+{altri.length}</span>}
    </div>
  );
}

export function ModalitaSchermo({ esci }: { esci: () => void }) {
  const vista = useVista();
  const indice = useIndice(vista);
  const dati = useDatiMenu(vista);
  const largo = useLargo();
  const giorno = oggi();
  const lun = lunedi(giorno);
  const giorni = giorniDellaSettimana(lun);
  const fine = giorni[6];
  useProlungaFissi(fine);

  const [giornoAperto, setGiornoAperto] = useState<string | null>(null);
  const tocca = useDoppioTocco();
  const [ora, setOra] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setOra(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    // Esc chiude il dettaglio del giorno se è aperto, altrimenti esce dalla modalità: come il tasto Indietro.
    const tasto = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (giornoAperto) setGiornoAperto(null);
      else esci();
    };
    window.addEventListener('keydown', tasto);
    return () => window.removeEventListener('keydown', tasto);
  }, [esci, giornoAperto]);

  if (!vista.pronta || !indice) {
    return createPortal(
      <div className="schermo-settimana" role="dialog" aria-modal="true" aria-label="Modalità schermo">
        <p className="tenue">Sto caricando il menu…</p>
      </div>,
      document.body,
    );
  }

  const sigle = sigleDi(dati.persone);
  const settimana = dati.portate.filter((p) => p.data >= lun && p.data <= fine);
  const categorie = dati.categorie.filter((c) => c.attiva || settimana.some((p) => p.categoria === c.valore));
  const piatti = (data: string, categoria: string) => dati.portate.filter((p) => p.data === data && p.categoria === categoria);
  const conferme = vista.righe.conferma_pasto;
  const confermato = (id: string) => !!conferme?.some((x) => x.portata_id === id && x.attiva && !x.eliminato_il);
  const apriGiorno = (g: string) => tocca(g, () => setGiornoAperto(g));
  const perGiornoAperto = giornoAperto ? categorie.map((c) => ({ c, portate: piatti(giornoAperto, c.valore) })).filter((x) => x.portate.length > 0) : [];

  return createPortal(
    <div className="schermo-settimana" role="dialog" aria-modal="true" aria-label="Modalità schermo: la settimana">
      <div className="schermo-testata">
        <button className="schermo-logo" aria-label="Esci dalla modalità schermo" onClick={esci}>
          <img src={`${import.meta.env.BASE_URL}icona.svg`} alt="" />
        </button>
        <div className="schermo-titolo">
          <p className="sopratitolo">Modalità schermo · sola lettura</p>
          <h1>Settimana {nomeSettimana(lun)}</h1>
        </div>
        <div className="schermo-orologio">
          <strong>{ora.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</strong>
          <span>{dataLunga(giorno)}</span>
        </div>
      </div>

      <div className="schermo-corpo">
        {largo ? (
          <SettimanaGriglia
            riserva={16}
            largo
            giorni={giorni}
            categorie={categorie}
            oggiData={giorno}
            scelto={giorno}
            cella={(g, c) => (
              <button key={`${g}|${c.valore}`} className="schermo-tocco" onClick={() => apriGiorno(g)} aria-label={`Apri ${dataLunga(g)} (doppio tocco)`}>
                <CellaLettura indice={indice} dati={dati} categoria={c} portate={piatti(g, c.valore)} confermato={confermato} />
              </button>
            )}
          />
        ) : null}
        {largo && (
          <div className="schermo-raccolta" role="group" aria-label="Raccolta differenziata: non ancora collegata a un calendario">
            <span className="schermo-raccolta-etichetta" aria-hidden="true">
              <Icona nome="raccolta" grandezza={16} />
            </span>
            {giorni.map((g) => (
              <span key={g} className="schermo-raccolta-cella">
                <RaccoltaDifferenziata />
              </span>
            ))}
          </div>
        )}
        {!largo && (
          <div className="schermo-giorni">
            {giorni.map((g) => {
              const diOggi = g === giorno;
              return (
                <button key={g} className="schermo-giorno" onClick={() => apriGiorno(g)} aria-label={`Apri ${dataLunga(g)} (doppio tocco)`}>
                  <span className={`schermo-giorno-testata${diOggi ? ' oggi' : ''}`}>
                    {nomeGiorno(g, true).toUpperCase()} <strong>{Number(g.slice(8))}</strong>
                    {diOggi && ' · oggi'}
                  </span>
                  {categorie.map((c) => rigaPastoTelefono(indice, dati, c, piatti(g, c.valore)))}
                  <RaccoltaDifferenziata />
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="schermo-suggerimento">Doppio tocco su un giorno per le ricette · tocca di nuovo il logo per tornare alla modifica</div>

      {giornoAperto && (
        <Foglio titolo={dataLunga(giornoAperto)} chiudi={() => setGiornoAperto(null)}>
          <p className="sopratitolo" style={{ marginBottom: 12 }}>
            {giornoAperto === giorno ? 'Oggi · sola lettura' : 'Sola lettura'}
          </p>
          {perGiornoAperto.length === 0 ? (
            <p className="tenue">Niente in menu per questo giorno.</p>
          ) : (
            <div className="schermo-dettaglio">
              {perGiornoAperto.map(({ c, portate }) => (
                <div key={c.valore} className={`riquadro t-${c.valore}`}>
                  <div className="testa-riquadro">
                    <h4>
                      <span className="emoji-pasto" aria-hidden>
                        {c.emoji}
                      </span>
                      {c.nome}
                    </h4>
                  </div>
                  <ul className="piatti-riquadro">
                    {portate.map((p) => {
                      const d = descrivi(indice, dati, p);
                      const nota = [p.avanzo_di && 'avanzo', d.dopo > 0 && `+${d.dopo.toLocaleString('it-IT')} per i giorni dopo`, p.in_attesa && 'in invio'].filter(Boolean).join(' · ');
                      return (
                        <li key={p.id}>
                          <div className="piatto-riquadro">
                            <span className="nome-piatto">
                              <SegniPiatto d={d} portata={p} confermato={confermato(p.id)} />
                              {d.titolo}
                            </span>
                            <span className="nota-piatto">
                              {formattaPorzioni(d.porzioni)}
                              {d.eccezioni.length > 0 && ` · ${chiLoMangia(dati, d.eccezioni)}`}
                              {nota && ` · ${nota}`}
                            </span>
                            {dati.persone.length > 1 && <SigleDi sigle={sigle} chi={chiMangia(dati, d.eccezioni)} />}
                          </div>
                          {d.eccezioni
                            .filter((e) => e.tipo === 'alternativa')
                            .map((e) => {
                              const persona = dati.persone.find((x) => x.id === e.membro_id);
                              if (!persona) return null;
                              const titolo = (e.ricetta_id ? indice.perId.get(e.ricetta_id)?.titolo : null) ?? e.testo ?? 'altro';
                              return (
                                <div key={e.id} className="piatto-riquadro a-parte">
                                  <span className="nome-piatto">{titolo}</span>
                                  {dati.persone.length > 1 && <SigleDi sigle={sigle} chi={[persona.id]} />}
                                </div>
                              );
                            })}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Foglio>
      )}
    </div>,
    document.body,
  );
}
