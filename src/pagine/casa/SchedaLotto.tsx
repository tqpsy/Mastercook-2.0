import { type FormEvent, useDeferredValue, useState } from 'react';
import { LUOGHI, NOME_LUOGO } from '../../catalogo/tipi';
import { useFamiglia, useVista } from '../../dati/contesto';
import { postoDelLotto, postiDi } from '../../dominio/frigo';
import { DisegnoFrigoMio } from '../../ui/FrigoMio';
import { useFrigo } from '../MioFrigo';
import type { Indice } from '../../dominio/ricette';
import { giorniTra, type Luogo, stima, type TipoData } from '../../dominio/scadenze';
import { formatta, leggiNumero, type Scritta, scrittaVuota, UNITA_BASE } from '../../dominio/unita';
import { CampoQuantita } from '../../ui/CampoQuantita';
import { LivelloScorta } from '../../ui/LivelloScorta';
import { type Livello, puoAOcchio } from '../../dominio/livello';
import { Foglio } from '../../ui/Foglio';
import { DATA_MOVIMENTO, quantitaDa } from './NuovoLotto';
import { EtichettaData, quantitaLotto, type Lotto, useConsiglioPosto } from '../Casa';

type Azione = 'consumo' | 'spreco' | 'scaduto' | 'correggi' | 'sposta' | 'data' | 'occhio' | 'misura' | null;

const TITOLI: Record<Exclude<Azione, null>, string> = {
  consumo: 'Quanto ne hai usato?',
  spreco: 'Quanto ne hai buttato?',
  scaduto: 'Quanto ne hai buttato perché scaduto?',
  correggi: 'Quanto ce n’è adesso?',
  sposta: 'Dove lo sposti?',
  data: 'Cambia la data',
  occhio: 'A occhio: quanto ne hai?',
  misura: 'Quanto pesa adesso?',
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

export function SchedaLotto({ indice, lotto: l, giorno, chiudi }: { indice: Indice; lotto: Lotto; giorno: string; chiudi: () => void }) {
  const { esegui } = useFamiglia();
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
  const consiglio = useConsiglioPosto(ing ?? null, l.luogo);
  const postoOra = postoDelLotto(frigo, l);
  const storia = (vista.righe.movimento ?? []).filter((m) => m.lotto_id === l.id).sort((a, b) => String(b.creato_il ?? '').localeCompare(String(a.creato_il ?? '')));
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
    cambiaScritta({ numero: '', quante: '1', ...(a === 'misura' ? { unita: UNITA_BASE[ing?.dimensione ?? 'massa'] } : {}) });
    setTutto(a !== 'correggi');
    setNuovoLivello({ pezzi: 1, livello: 'tanto' });
  }

  async function conferma(e: FormEvent) {
    e.preventDefault();
    setErrore(null);
    if (azione === 'consumo' || azione === 'spreco' || azione === 'scaduto') {
      let quantita = l.quantita;
      if (!tutto) {
        const q = quantitaDa(scritta, ing);
        if (typeof q === 'string') return setErrore(q);
        if (q.valore > l.quantita) return setErrore(`Ce n’è solo ${formatta({ valore: l.quantita, unita: l.unita })}. Se ce n’era di più, usa «Correggi».`);
        quantita = q.valore;
      }
      await esegui('scarica_lotto', { lotto_id: l.id, causale: azione, quantita });
      if (quantita >= l.quantita) return chiudi();
    } else if (azione === 'correggi') {
      const n = leggiNumero(scritta.numero);
      const q = n === 0 ? { valore: 0, unita: l.unita } : quantitaDa(scritta, ing);
      if (typeof q === 'string') return setErrore(q);
      await esegui('correggi_lotto', { lotto_id: l.id, quantita_vista: l.quantita, quantita_nuova: q.valore });
      if (q.valore === 0) return chiudi();
    } else if (azione === 'sposta') {
      let quantita: number | null = null;
      if (!tutto) {
        const q = quantitaDa(scritta, ing);
        if (typeof q === 'string') return setErrore(q);
        quantita = q.valore < l.quantita ? q.valore : null;
      }
      const ricalcola = ing && (l.tipo_data === 'stimata' || l.tipo_data === 'sconosciuta') ? stima(ing, dove, giorno) : null;
      await esegui('sposta_lotto', {
        lotto_id: l.id,
        luogo: dove,
        quantita,
        nuovo_id: quantita === null ? null : crypto.randomUUID(),
        stima: ricalcola ? { data_limite: ricalcola.data_limite, tipo_data: 'stimata', fonte_data: 'app', calcolata_il: ricalcola.calcolata_il } : null,
      });
    } else if (azione === 'data') {
      let campi: Record<string, unknown>;
      if (tipo === 'sconosciuta') campi = { tipo_data: 'sconosciuta', data_limite: null, fonte_data: null, calcolata_il: null };
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return setErrore('Scegli una data.');
      else campi = { tipo_data: tipo === 'stimata' ? 'scadenza' : tipo, data_limite: data, fonte_data: dataProtetta ? 'confezione' : 'utente', calcolata_il: null };
      await esegui('modifica_lotto', { id: l.id, versione_attesa: l.versione, campi });
    } else if (azione === 'occhio') {
      await esegui('cambia_livello', { lotto_id: l.id, nuovo_id: crypto.randomUUID(), ...nuovoLivello });
      return chiudi();
    } else if (azione === 'misura') {
      const q = quantitaDa(scritta, ing);
      if (typeof q === 'string') return setErrore(q);
      await esegui('cambia_livello', { lotto_id: l.id, livello: null, quantita: q.valore, unita: q.unita, nuovo_id: crypto.randomUUID() });
      return chiudi();
    }
    setAzione(null);
  }

  // A occhio si butta o si sposta tutto: una parte non si misura.
  const chiedeQuantita = !occhio && (azione === 'consumo' || azione === 'spreco' || azione === 'scaduto' || azione === 'sposta');
  const scaduto = l.data_limite ? giorniTra(giorno, l.data_limite) < 0 : false;

  return (
    <Foglio titolo={l.nome ?? ing?.nome ?? 'Alimento'} chiudi={chiudi}>
      <p>
        <strong>{quantitaLotto(l)}</strong> in {NOME_LUOGO[l.luogo].toLowerCase()} · <EtichettaData lotto={l} giorno={giorno} />
      </p>
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
                onChange={(e) => void esegui('modifica_lotto', { id: l.id, versione_attesa: l.versione, campi: { posto: e.target.value || null } })}
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

      {!azione && (
        <div className="riga" style={{ flexWrap: 'wrap' }}>
          {!occhio && (
            <button className="bottone primario" onClick={() => apri('consumo')}>
              Usato
            </button>
          )}
          <button className="bottone" onClick={() => apri('spreco')}>
            Buttato
          </button>
          <button className="bottone" onClick={() => apri('scaduto')}>
            Scaduto
          </button>
          {!occhio && (
            <button className="bottone" onClick={() => apri('correggi')}>
              Correggi quantità
            </button>
          )}
          <button className="bottone" onClick={() => apri('sposta')}>
            Sposta
          </button>
          <button className="bottone" onClick={() => apri('data')}>
            Cambia data
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
                Tutto ({formatta({ valore: l.quantita, unita: l.unita })})
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
          {occhio && (azione === 'spreco' || azione === 'scaduto' || azione === 'sposta') && <p className="tenue" style={{ marginTop: 0 }}>Tutto ({quantitaLotto(l).toLowerCase()}).</p>}
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
