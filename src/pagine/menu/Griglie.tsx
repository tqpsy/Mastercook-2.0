import { useEffect, useRef, useState } from 'react';
import { useVista } from '../../dati/contesto';
import { NOME_ESITO } from '../../dominio/compatibilita';
import { type CategoriaPasto, dataLunga, nomeGiorno, ospitiDel, type PortataMenu } from '../../dominio/menu';
import { type Indice } from '../../dominio/ricette';
import { ICONA_ESITO } from '../Ricette';
import { Sigla, type SiglaPersona } from '../../ui/Sigla';
import { useFinoInFondo } from './ganci';
import { type DatiMenu, chiLoMangia, chiMangia, descrivi } from './dati';
import { EtichettaOspiti } from './Ospiti';

export function SegniPiatto({ d, portata: p, confermato }: { d: ReturnType<typeof descrivi>; portata: PortataMenu; confermato: boolean }) {
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


export function SigleDi({ sigle, chi }: { sigle: Map<string, SiglaPersona>; chi: string[] }) {
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
export function RiquadroMenu({
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
export function SettimanaGriglia({
  riserva,
  largo,
  giorni,
  categorie,
  oggiData,
  scelto,
  cella,
}: {
  riserva: number;
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
  useFinoInFondo(scorre, riserva, true, `${largo}|${categorie.length}`);
  // Sul telefono si parte dal giorno scelto (di solito oggi). Solo quando cambiano settimana o giorno scelto:
  // `giorni` è un elenco nuovo a ogni disegno, e riportare la griglia a oggi a ogni disegno impediva di scorrerla.
  const elencoGiorni = giorni.join(',');
  useEffect(() => {
    const el = scorre.current;
    if (largo || !el) return;
    const tutti = elencoGiorni.split(',');
    const i = tutti.indexOf(scelto);
    const colonna = el.querySelector<HTMLElement>(`[data-giorno="${tutti[Math.max(0, i)]}"]`);
    if (colonna && i > 0) el.scrollLeft = colonna.offsetLeft - 52;
  }, [largo, elencoGiorni, scelto]);
  return (
    <>
      <div
        ref={scorre}
        className={`settimana-griglia riempie${largo ? '' : ' scorre'}`}
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

export function formattaPorzioni(n: number) {
  return n === 1 ? '1 porzione' : `${n.toLocaleString('it-IT')} porzioni`;
}

export function Panoramica({
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
