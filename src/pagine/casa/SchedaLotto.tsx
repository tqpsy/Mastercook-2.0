/** Casa: la scheda di un prodotto in casa (usato, buttato, correggi, sposta, data, confezioni, cronologia). */
import { type FormEvent, useDeferredValue, useMemo, useState } from 'react';
import { LUOGHI, NOME_LUOGO } from '../../catalogo/tipi';
import { useFamiglia, useVista } from '../../dati/contesto';
import { postoDelLotto, postiDi } from '../../dominio/frigo';
import { DisegnoFrigoMio } from '../../ui/FrigoMio';
import { useFrigo } from '../MioFrigo';
import type { Indice } from '../../dominio/ricette';
import { giorniTra, type Luogo, stima, type TipoData } from '../../dominio/scadenze';
import { formatta, leggiNumero, type Scritta, scrittaVuota, UNITA_BASE } from '../../dominio/unita';
import { daPrendere, elencoConfezioni, gruppoDi, quanteConfezioni, riassuntoConfezioni } from '../../dominio/confezioni';
import { CampoQuantita } from '../../ui/CampoQuantita';
import { LivelloScorta } from '../../ui/LivelloScorta';
import { type Livello, puoAOcchio } from '../../dominio/livello';
import { useProdotti } from '../../ui/CodiceProdotto';
import { Scanner } from '../../ui/Scanner';
import { FotoData } from '../../ui/FotoData';
import { chiediAOpenFoodFacts } from '../../ui/openFoodFacts';
import { schedaVuota } from '../../dominio/schedaProdotto';
import { Foglio } from '../../ui/Foglio';
import { type Lotto, quantitaDa, quantitaLotto } from '../../dati/lotti';
import { EtichettaData, useConsiglioPosto } from './comuni';

const DATA_MOVIMENTO = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });

type Azione = 'usa' | 'spreco' | 'correggi' | 'sposta' | 'data' | 'occhio' | 'misura' | 'confezione' | null;

const TITOLI: Record<Exclude<Azione, null>, string> = {
  usa: 'Quanto ne hai usato?',
  spreco: 'Quanto ne hai buttato?',
  correggi: 'Quanto ce n’è adesso?',
  sposta: 'Dove lo sposti?',
  data: 'Cambia la data',
  occhio: 'A occhio: quanto ne hai?',
  misura: 'Quanto pesa adesso?',
  confezione: 'Quanto contiene una confezione chiusa?',
};

const NOME_CAUSALE: Record<string, string> = {
  carico: 'Aggiunto',
  consumo: 'Usato',
  spreco: 'Buttato',
  scaduto: 'Buttato perché scaduto',
  correzione: 'Corretto',
  annullo: 'Annullato',
  spostamento: 'Spostato',
};

/**
 * La scheda di una riga di Casa: un lotto, o più confezioni uguali (stesso prodotto, posto e data) che si vedono
 * insieme. Usare, buttare, spostare o correggere vale per tutta la riga: si prende prima dalla confezione aperta.
 */
export function SchedaLotto({ indice, lotto: l, lotti, giorno, chiudi }: { indice: Indice; lotto: Lotto; lotti: Lotto[]; giorno: string; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const g = useMemo(() => gruppoDi(lotti, l), [lotti, l]);
  const totale = g.totale;
  const quante = quanteConfezioni(g);
  const confezioni = elencoConfezioni(g);
  const f = (valore: number) => formatta({ valore, unita: l.unita });
  const [eraScaduto, setEraScaduto] = useState(false);
  const vista = useVista();
  const ing = indice.ingrediente(l.ingrediente_id);
  const [azione, setAzione] = useState<Azione>(null);
  const [scritta, setScritta] = useState<Scritta>(() => scrittaVuota(l.unita));
  const cambiaScritta = (x: Partial<Scritta>) => setScritta((s) => ({ ...s, ...x }));
  const [tutto, setTutto] = useState(true);
  const [dove, setDove] = useState<Luogo>(l.luogo === 'frigo' ? 'freezer' : 'frigo');
  const [tipo, setTipo] = useState<TipoData>(l.tipo_data);
  const [data, setData] = useState(l.data_limite ?? '');
  const [errore, setErrore] = useState<string | null>(null);
  const frigo = useFrigo();
  const prodotti = useProdotti();
  const [scansionaCodice, setScansionaCodice] = useState(false);
  const [codiceSalvato, setCodiceSalvato] = useState<string | null>(null);
  const consiglio = useConsiglioPosto(ing ?? null, l.luogo);
  const postoOra = postoDelLotto(frigo, l);
  const ids = new Set(g.lotti.map((x) => x.id));
  const storia = (vista.righe.movimento ?? []).filter((m) => ids.has(String(m.lotto_id))).sort((a, b) => String(b.creato_il ?? '').localeCompare(String(a.creato_il ?? '')));
  // Al tocco la scheda compare subito; il disegno del frigo (il pezzo più pesante) arriva un attimo dopo, al suo posto.
  const disegna = useDeferredValue(true, false);
  const dataProtetta = l.fonte_data === 'confezione';
  // A occhio: niente grammi, si tocca il livello. Un lotto misurato si può passare a occhio (e viceversa).
  const occhio = !!l.livello;
  const [nuovoLivello, setNuovoLivello] = useState<{ pezzi: number; livello: Livello }>({ pezzi: 1, livello: 'tanto' });
  const cambiaLivello = (x: { pezzi?: number; livello?: Livello }) =>
    void esegui('cambia_livello', { lotto_id: l.id, livello: x.livello ?? l.livello, ...(x.pezzi !== undefined ? { pezzi: x.pezzi } : {}) });
  async function finitoUnPezzo() {
    if (l.quantita > 1) return cambiaLivello({ pezzi: l.quantita - 1, livello: 'tanto' });
    await esegui('cambia_livello', { lotto_id: l.id, livello: l.livello, pezzi: 0 });
    chiudi();
  }

  function apri(a: Azione) {
    setAzione(a);
    setErrore(null);
    setEraScaduto(false);
    cambiaScritta({
      numero: a === 'confezione' && (l.confezione || g.taglia) ? String(l.confezione ?? g.taglia).replace('.', ',') : '',
      quante: '1',
      ...(a === 'misura' ? { unita: UNITA_BASE[ing?.dimensione ?? 'massa'] } : a === 'confezione' ? { unita: l.unita } : {}),
    });
    // «Ho usato…»: di solito una parte, si scrivono i grammi.
    setTutto(a !== 'correggi' && a !== 'usa');
    // Più confezioni a occhio: tanti pezzi quante sono le confezioni.
    setNuovoLivello({ pezzi: Math.min(99, Math.max(1, quante)), livello: 'tanto' });
  }

  async function conferma(e: FormEvent) {
    e.preventDefault();
    setErrore(null);
    if (azione === 'usa' || azione === 'spreco') {
      // «Ho usato 400 g» (o buttato): si toglie prima dalla confezione aperta, poi se ne apre una chiusa (o più).
      let quantita = totale;
      if (!tutto) {
        const q = quantitaDa(scritta, ing);
        if (typeof q === 'string') return setErrore(q);
        if (q.valore > totale) return setErrore(`Ce n’è solo ${f(totale)}. Se ce n’era di più, usa «Correggi il totale» in «Altro».`);
        quantita = q.valore;
      }
      const causale = azione === 'usa' ? 'consumo' : eraScaduto ? 'scaduto' : 'spreco';
      for (const p of daPrendere(g, quantita)) {
        const x = g.lotti.find((y) => y.id === p.lotto_id)!;
        // Il lotto non sapeva quanto contiene una confezione: era una sola, intera. Lo ricorda, così quella aperta
        // resta nella stessa riga delle altre.
        if (p.quantita < x.quantita && !x.confezione) await esegui('modifica_lotto', { id: x.id, versione_attesa: x.versione, campi: { confezione: x.quantita } });
        await esegui('scarica_lotto', { lotto_id: x.id, causale, quantita: p.quantita });
      }
      if (quantita >= totale) return chiudi();
    } else if (azione === 'correggi') {
      const n = leggiNumero(scritta.numero);
      const q = n === 0 ? { valore: 0, unita: l.unita } : quantitaDa(scritta, ing);
      if (typeof q === 'string') return setErrore(q);
      // Di più: tutto nella prima confezione; di meno: si toglie come se lo si usasse.
      const correzioni =
        q.valore >= totale
          ? [{ lotto: g.primo, nuova: g.primo.quantita + q.valore - totale }]
          : daPrendere(g, totale - q.valore).map((p) => {
              const x = g.lotti.find((y) => y.id === p.lotto_id)!;
              return { lotto: x, nuova: Math.round((x.quantita - p.quantita) * 1000) / 1000 };
            });
      for (const c of correzioni) await esegui('correggi_lotto', { lotto_id: c.lotto.id, quantita_vista: c.lotto.quantita, quantita_nuova: c.nuova });
      if (q.valore === 0) return chiudi();
    } else if (azione === 'sposta') {
      let quantita = totale;
      if (!tutto) {
        const q = quantitaDa(scritta, ing);
        if (typeof q === 'string') return setErrore(q);
        quantita = Math.min(q.valore, totale);
      }
      const ricalcola = ing && (l.tipo_data === 'stimata' || l.tipo_data === 'sconosciuta') ? stima(ing, dove, giorno) : null;
      for (const p of daPrendere(g, quantita)) {
        const parte = p.quantita < (g.lotti.find((y) => y.id === p.lotto_id)?.quantita ?? 0);
        await esegui('sposta_lotto', {
          lotto_id: p.lotto_id,
          luogo: dove,
          quantita: parte ? p.quantita : null,
          nuovo_id: parte ? crypto.randomUUID() : null,
          stima: ricalcola ? { data_limite: ricalcola.data_limite, tipo_data: 'stimata', fonte_data: 'app', calcolata_il: ricalcola.calcolata_il } : null,
        });
      }
    } else if (azione === 'data') {
      let campi: Record<string, unknown>;
      if (tipo === 'sconosciuta') campi = { tipo_data: 'sconosciuta', data_limite: null, fonte_data: null, calcolata_il: null };
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return setErrore('Scegli una data.');
      else campi = { tipo_data: tipo === 'stimata' ? 'scadenza' : tipo, data_limite: data, fonte_data: dataProtetta ? 'confezione' : 'utente', calcolata_il: null };
      for (const x of g.lotti) await esegui('modifica_lotto', { id: x.id, versione_attesa: x.versione, campi });
    } else if (azione === 'confezione') {
      const q = nuovaConfezione;
      if (!q) return setErrore('Scrivi quanto contiene una confezione chiusa, per esempio 500.');
      for (const x of g.lotti) await esegui('modifica_lotto', { id: x.id, versione_attesa: x.versione, campi: { confezione: q.valore } });
    } else if (azione === 'occhio') {
      // Più confezioni diventano un prodotto a occhio solo: le altre righe si chiudono.
      await esegui('cambia_livello', { lotto_id: g.primo.id, nuovo_id: crypto.randomUUID(), ...nuovoLivello });
      for (const x of g.lotti) if (x.id !== g.primo.id) await esegui('correggi_lotto', { lotto_id: x.id, quantita_vista: x.quantita, quantita_nuova: 0 });
      return chiudi();
    } else if (azione === 'misura') {
      const q = quantitaDa(scritta, ing);
      if (typeof q === 'string') return setErrore(q);
      await esegui('cambia_livello', { lotto_id: l.id, livello: null, quantita: q.valore, unita: q.unita, nuovo_id: crypto.randomUUID() });
      return chiudi();
    }
    setAzione(null);
  }

  /** Collega il codice a barre scansionato a questo prodotto: dalla prossima volta lo riconosco. */
  async function collegaCodice(codice: string) {
    setScansionaCodice(false);
    const p = prodotti.get(codice);
    const scheda = (await chiediAOpenFoodFacts(codice))?.scheda;
    await esegui('salva_prodotto', {
      id: crypto.randomUUID(),
      codice,
      ingrediente_id: l.ingrediente_id,
      nome: l.nome ?? p?.nome ?? null,
      quantita: p?.quantita ?? null,
      unita: p?.unita ?? null,
      ...(scheda && !schedaVuota(scheda) ? { scheda } : {}),
    });
    setCodiceSalvato(codice);
  }

  // A occhio si butta o si sposta tutto: una parte non si misura.
  const chiedeQuantita = !occhio && (azione === 'usa' || azione === 'spreco' || azione === 'sposta');
  // «Quanto contiene una confezione»: un numero nell'unità del lotto, con l'anteprima di come si vedrà.
  const nuovaConfezioneLetta = azione === 'confezione' ? quantitaDa({ ...scritta, quante: '1' }, ing) : null;
  const nuovaConfezione = nuovaConfezioneLetta && typeof nuovaConfezioneLetta !== 'string' && nuovaConfezioneLetta.unita === l.unita ? nuovaConfezioneLetta : null;
  const anteprima = nuovaConfezione ? riassuntoConfezioni(gruppoDi(g.lotti.map((x) => ({ ...x, confezione: nuovaConfezione.valore })), { ...l, confezione: nuovaConfezione.valore })) : null;
  const scaduto = l.data_limite ? giorniTra(giorno, l.data_limite) < 0 : false;

  if (scansionaCodice) return <Scanner titolo="Scansiona il codice a barre" chiudi={() => setScansionaCodice(false)} trovato={(c) => void collegaCodice(c)} />;

  return (
    <Foglio titolo={l.nome ?? ing?.nome ?? 'Alimento'} chiudi={chiudi}>
      <p>
        <strong>{occhio ? quantitaLotto(l) : f(totale)}</strong> in {NOME_LUOGO[l.luogo].toLowerCase()} · <EtichettaData lotto={l} giorno={giorno} />
      </p>
      {!occhio && !azione && (
        <button className="bottone primario pieno" style={{ marginBottom: 12 }} onClick={() => apri('usa')}>
          Ho usato…
        </button>
      )}
      {!occhio && !azione && (confezioni.length > 1 || confezioni.some((c) => c.aperta)) && (
        // Le confezioni una per una, per sapere cosa c'è: chiuse e quella aperta. Con una sola chiusa basta la riga sopra.
        <section className="scheda confezioni" aria-label="Confezioni" style={{ background: 'var(--superficie-2)' }}>
          <h3 style={{ marginTop: 0 }}>{riassuntoConfezioni(g)}</h3>
          <ul className="elenco">
            {confezioni.map((c, i) => (
              <li key={`${c.lotto_id}:${i}`} className="riga spazio">
                <span>
                  {c.aperta ? (
                    <>
                      Aperta: restano <strong>{f(c.quantita)}</strong>
                      {c.da && <span className="tenue"> di {f(c.da)}</span>}
                    </>
                  ) : (
                    <>
                      Chiusa da <strong>{f(c.quantita)}</strong>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {frigo && l.luogo !== 'dispensa' && (
        <div className="consiglio-ripiano-mio">
          {disegna ? (
            <DisegnoFrigoMio frigo={frigo} evidenzia={postoOra?.id ?? consiglio?.posto.id} inFondo={!postoOra && consiglio?.inFondo} />
          ) : (
            // Lo stesso spazio del disegno (196 × 300), così la scheda non salta quando arriva.
            <div className="frigo-mio" style={{ aspectRatio: '196 / 300' }} aria-hidden />
          )}
          <div className="cosa-ci-va">
            <label className="campo" style={{ margin: 0 }}>
              <span className="tenue piccolo">{postoOra ? 'Sta qui' : 'Mettilo qui'}</span>
              <select
                className="dato"
                aria-label="Dove sta nel frigo"
                value={postoOra?.id ?? ''}
                onChange={(e) => {
                  for (const x of g.lotti) void esegui('modifica_lotto', { id: x.id, versione_attesa: x.versione, campi: { posto: e.target.value || null } });
                }}
              >
                <option value="">{consiglio ? `Non segnato (consiglio: ${consiglio.posto.nome})` : 'Non segnato'}</option>
                {postiDi(frigo, l.luogo).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </label>
            {!postoOra && consiglio && <span className="tenue">{consiglio.perche}</span>}
            {consiglio?.confezione && <span className="tenue piccolo">📦 {consiglio.confezione}</span>}
          </div>
        </div>
      )}
      {l.tipo_data === 'stimata' && <p className="tenue">Data stimata dall’app per un alimento senza data: è indicativa, controlla sempre.</p>}
      {l.tipo_data === 'tmc' && scaduto && <p className="tenue">«Preferibilmente entro» superato: non vuol dire per forza da buttare, controlla aspetto e odore.</p>}

      {!azione && occhio && l.livello && (
        <div className="scheda" style={{ background: 'var(--superficie-2)' }}>
          <LivelloScorta pezzi={l.quantita} livello={l.livello} cambia={cambiaLivello} />
          <button className="bottone primario pieno" onClick={finitoUnPezzo}>
            {l.quantita > 1 ? 'Finito quello aperto: ne apro un altro' : 'Finito'}
          </button>
          <p className="tenue piccolo" style={{ marginBottom: 0 }}>
            A occhio: le ricette non tolgono grammi. Quando resta poco te lo segnalo in Casa, nelle ricette e nella spesa.
          </p>
        </div>
      )}

      {codiceSalvato && (
        <div className="avviso info" role="status">
          Codice {codiceSalvato} collegato a questo prodotto: la prossima volta lo riconosco.
        </div>
      )}

      {!azione && (
        <>
          <div className="riga" style={{ flexWrap: 'wrap' }}>
            <button className="bottone" onClick={() => apri('spreco')}>
              Buttato
            </button>
            <button className="bottone" onClick={() => apri('sposta')}>
              Sposta
            </button>
            <button className="bottone" onClick={() => apri('data')}>
              Cambia data
            </button>
          </div>
          {/* Le cose che servono di rado, chiuse di base. */}
          <details className="altro-lotto" style={{ marginTop: 12 }}>
            <summary>Altro</summary>
            <div className="riga" style={{ flexWrap: 'wrap', marginTop: 8 }}>
              {!occhio && (
                <button className="bottone" onClick={() => apri('confezione')}>
                  Quanto contiene una confezione
                </button>
              )}
              {!occhio && (
                <button className="bottone" onClick={() => apri('correggi')}>
                  Correggi il totale
                </button>
              )}
              <button className="bottone" onClick={() => setScansionaCodice(true)}>
                <span aria-hidden>📷</span> Codice a barre
              </button>
              {!occhio && puoAOcchio(ing) && (
                <button className="bottone" onClick={() => apri('occhio')}>
                  A occhio
                </button>
              )}
              {occhio && (
                <button className="bottone" onClick={() => apri('misura')}>
                  Pesa
                </button>
              )}
            </div>
          </details>
        </>
      )}

      {azione && (
        <form onSubmit={conferma} className="scheda" style={{ background: 'var(--superficie-2)' }} noValidate>
          <h3 style={{ marginTop: 0 }}>{TITOLI[azione]}</h3>
          {azione === 'sposta' && (
            <div className="scelte">
              {LUOGHI.filter((x) => x !== l.luogo).map((x) => (
                <button type="button" key={x} aria-pressed={dove === x} onClick={() => setDove(x)}>
                  {NOME_LUOGO[x]}
                </button>
              ))}
            </div>
          )}
          {chiedeQuantita && (
            <div className="scelte">
              <button type="button" aria-pressed={tutto} onClick={() => setTutto(true)}>
                Tutto ({f(totale)})
              </button>
              <button type="button" aria-pressed={!tutto} onClick={() => setTutto(false)}>
                Una parte
              </button>
            </div>
          )}
          {azione === 'occhio' && (
            <>
              <p className="tenue" style={{ marginTop: 0 }}>Non scrivi più i grammi: conti i pezzi e dici quanto ne resta. Le ricette non lo scalano, ti avviso quando sta per finire.</p>
              <LivelloScorta pezzi={nuovoLivello.pezzi} livello={nuovoLivello.livello} cambia={(x) => setNuovoLivello((n) => ({ ...n, ...x }))} />
            </>
          )}
          {azione === 'spreco' && (
            <label className="riga" style={{ gap: 8, marginTop: 8 }}>
              <input type="checkbox" checked={eraScaduto} onChange={(e) => setEraScaduto(e.target.checked)} />
              <span>Perché era scaduto</span>
            </label>
          )}
          {occhio && (azione === 'spreco' || azione === 'sposta') && <p className="tenue" style={{ marginTop: 0 }}>Tutto ({quantitaLotto(l).toLowerCase()}).</p>}
          {azione === 'confezione' && (
            <>
              <p className="tenue" style={{ marginTop: 0 }}>
                Ce n’è {f(totale)} in tutto. Scrivi quanto c’è in una confezione chiusa (per la pasta di solito 500 g): ti dico come la vedo.
              </p>
              <label className="campo">
                <span>Una confezione chiusa ({l.unita})</span>
                <input inputMode="decimal" value={scritta.numero} onChange={(e) => cambiaScritta({ numero: e.target.value, unita: l.unita })} autoFocus />
              </label>
              {anteprima && <p role="status">{anteprima}</p>}
            </>
          )}
          {((chiedeQuantita && !tutto) || azione === 'correggi' || azione === 'misura') && (
            <CampoQuantita scritta={scritta} cambia={cambiaScritta} dimensione={ing?.dimensione ?? 'massa'} pesoPz={ing?.peso_pz} autoFocus />
          )}
          {azione === 'correggi' && <p className="tenue">Scrivi 0 se è finito. Se nel frattempo qualcuno l’ha cambiato da un altro telefono, te lo faremo vedere.</p>}
          {azione === 'data' && (
            <>
              <div className="scelte">
                <button type="button" aria-pressed={tipo === 'scadenza' || tipo === 'stimata'} onClick={() => setTipo('scadenza')}>
                  Da consumarsi entro
                </button>
                <button type="button" aria-pressed={tipo === 'tmc'} onClick={() => setTipo('tmc')}>
                  Preferibilmente entro
                </button>
                {!dataProtetta && (
                  <button type="button" aria-pressed={tipo === 'sconosciuta'} onClick={() => setTipo('sconosciuta')}>
                    Non la so
                  </button>
                )}
              </div>
              {tipo !== 'sconosciuta' && <input type="date" aria-label="Data" value={data} onChange={(e) => setData(e.target.value)} />}
              {tipo !== 'sconosciuta' && (
                <FotoData
                  letta={(d) => {
                    setData(d.data);
                    if (d.tipo) setTipo(d.tipo);
                  }}
                />
              )}
            </>
          )}
          {errore && (
            <div className="avviso errore" role="alert">
              {errore}
            </div>
          )}
          <div className="riga" style={{ marginTop: 12 }}>
            <button type="button" className="bottone" onClick={() => setAzione(null)}>
              Annulla
            </button>
            <button type="submit" className="bottone primario cresce">
              Conferma
            </button>
          </div>
        </form>
      )}

      {storia.length > 0 && (
        <>
          <h3>Cronologia</h3>
          <ul className="elenco">
            {storia.map((m) => (
              <li key={m.id} className="riga spazio">
                <span>
                  {NOME_CAUSALE[String(m.causale)] ?? String(m.causale)}
                  {m.in_attesa && <span className="etichetta attesa" style={{ marginLeft: 8 }}>in invio</span>}
                  {typeof m.nota === 'string' && m.nota && <span className="tenue piccolo nota-movimento">{m.nota}</span>}
                </span>
                <span className="tenue">
                  {Number(m.variazione) > 0 ? '+' : '−'}
                  {formatta({ valore: Math.abs(Number(m.variazione)), unita: l.unita })}
                  {m.creato_il ? ` · ${DATA_MOVIMENTO.format(new Date(String(m.creato_il)))}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Foglio>
  );
}
