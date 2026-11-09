import { schedaDelCodice } from '../Casa';
import { type FormEvent, useState } from 'react';
import { IconaCibo } from '../../ui/IconaCibo';
import { iconaIngrediente } from '../../dominio/iconeCibo';
import { LUOGHI, NOME_LUOGO } from '../../catalogo/tipi';
import { useFamiglia } from '../../dati/contesto';
import { DisegnoFrigoMio } from '../../ui/FrigoMio';
import { useFrigo } from '../MioFrigo';
import type { Indice, Ingrediente } from '../../dominio/ricette';
import { descriviDurata, eFresco, type Luogo, oggi, piuGiorni, stima } from '../../dominio/scadenze';
import { leggiNumero, type Scritta, scrittaVuota, totaleScritta, UNITA_BASE, type UnitaBase } from '../../dominio/unita';
import { CampoQuantita } from '../../ui/CampoQuantita';
import { LivelloScorta } from '../../ui/LivelloScorta';
import { type Livello, puoAOcchio } from '../../dominio/livello';
import { CercaIngrediente } from '../../ui/CercaIngrediente';
import { type ProdottoScansionato, ScansionaProdotto } from '../../ui/CodiceProdotto';
import { FoglioSchedaProdotto } from '../../ui/SchedaProdotto';
import { Foglio } from '../../ui/Foglio';
import { useConsiglioPosto } from '../Casa';

/** Legge «1,5» + «kg» × quante confezioni per l'ingrediente e lo porta in unità base, o dice cosa non va. */
export function quantitaDa(scritta: Scritta, ing: Ingrediente | undefined): { valore: number; unita: UnitaBase } | string {
  if (leggiNumero(scritta.numero) === null) return 'Scrivi una quantità, per esempio 500 o 1,5.';
  const e = totaleScritta(scritta, ing?.dimensione ?? 'massa', ing?.peso_pz);
  if (e.ok) return e.quantita;
  if (e.motivo === 'confezioni_non_valide') return 'Scrivi quante confezioni, per esempio 1 o 3.';
  return e.motivo === 'unita_incompatibile' ? 'Unità non adatta a questo ingrediente.' : 'La quantità deve essere più di zero.';
}

type SceltaData = 'scadenza' | 'tmc' | 'nessuna';

// Formati creati una volta: crearli a ogni riga dell'elenco costava molto sul telefono.
const DATA_BREVE = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long' });
const DATA_CON_ANNO = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
export const DATA_MOVIMENTO = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });

/** «5 novembre», con l'anno se non è quest'anno. */
export function dataBreve(data: string): string {
  const d = new Date(`${data}T12:00:00`);
  return (d.getFullYear() !== new Date().getFullYear() ? DATA_CON_ANNO : DATA_BREVE).format(d);
}

export function NuovoLotto({ indice, luogo: luogoIniziale, chiudi }: { indice: Indice; luogo: Luogo; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const [ing, setIng] = useState<Ingrediente | null>(null);
  const [scritta, setScritta] = useState<Scritta>(() => scrittaVuota('g'));
  const cambiaScritta = (x: Partial<Scritta>) => setScritta((s) => ({ ...s, ...x }));
  const [luogo, setLuogo] = useState<Luogo>(luogoIniziale);
  const [nome, setNome] = useState('');
  const [sceltaData, setSceltaData] = useState<SceltaData | null>(null);
  const [data, setData] = useState('');
  const [sfuso, setSfuso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [scansiona, setScansiona] = useState(false);
  const [codice, setCodice] = useState<ProdottoScansionato | null>(null);
  const [dettagli, setDettagli] = useState(false);
  // A occhio: pezzi e quanto resta a parole, invece dei grammi (il formaggio non si pesa ogni volta).
  const [aOcchio, setAOcchio] = useState(false);
  const [pezzi, setPezzi] = useState(1);
  const [livello, setLivello] = useState<Livello>('tanto');
  const giorno = oggi();

  /** Carne, pesce, frutta, verdura e avanzi senza confezione: la data la calcola l'app. Un prodotto scansionato è confezionato. */
  function scegli(i: Ingrediente, confezionato = false) {
    setIng(i);
    cambiaScritta({ unita: UNITA_BASE[i.dimensione] });
    setLuogo(i.luogo);
    const fresco = !confezionato && eFresco(i);
    setSfuso(fresco);
    setSceltaData(fresco ? 'nessuna' : null);
  }

  const proposta = ing && sceltaData === 'nessuna' && sfuso ? stima(ing, luogo, giorno) : null;
  const consiglio = useConsiglioPosto(ing, luogo);
  const frigo = useFrigo();

  async function salva(e: FormEvent) {
    e.preventDefault();
    if (!ing) return;
    const occhio = aOcchio && puoAOcchio(ing);
    const q = occhio ? { valore: pezzi, unita: 'pz' as const } : quantitaDa(scritta, ing);
    if (typeof q === 'string') return setErrore(q);
    if (!sceltaData) return setErrore('Indica la data: scadenza, «preferibilmente entro» o senza data.');
    if (sceltaData !== 'nessuna' && !/^\d{4}-\d{2}-\d{2}$/.test(data)) return setErrore('Scrivi la data che c’è sulla confezione.');
    let date: Record<string, unknown>;
    if (sceltaData === 'nessuna') {
      date = proposta
        ? { tipo_data: 'stimata', data_limite: proposta.data_limite, fonte_data: 'app', calcolata_il: proposta.calcolata_il, affidabilita: 'bassa' }
        : { tipo_data: 'sconosciuta', data_limite: null, fonte_data: null };
    } else {
      date = { tipo_data: sceltaData, data_limite: data, fonte_data: 'confezione' };
    }
    await esegui('aggiungi_lotto', {
      id: crypto.randomUUID(),
      ingrediente_id: ing.id,
      nome: nome.trim() || null,
      quantita: q.valore,
      unita: q.unita,
      ...(occhio ? { livello } : {}),
      luogo,
      data_acquisto: giorno,
      origine: 'manuale',
      posto: consiglio?.posto.id ?? null,
      ...date,
    });
    // Il codice a barre si ricorda con quello che si è scritto: la prossima volta propone la stessa confezione.
    const p = codice?.prodotto;
    const scheda = codice ? await schedaDelCodice(codice) : undefined;
    if (codice && !occhio && (!p || (scheda && !p.scheda) || p.ingrediente_id !== ing.id || p.quantita !== q.valore || p.unita !== q.unita || (p.nome ?? '') !== nome.trim())) {
      await esegui('salva_prodotto', {
        id: crypto.randomUUID(),
        codice: codice.codice,
        ingrediente_id: ing.id,
        nome: nome.trim() || null,
        quantita: q.valore,
        unita: q.unita,
        ...(scheda ? { scheda } : {}),
      });
    }
    chiudi();
  }

  if (scansiona) {
    return (
      <ScansionaProdotto
        indice={indice}
        chiudi={() => setScansiona(false)}
        trovato={(x) => {
          setScansiona(false);
          setCodice(x);
          scegli(x.ingrediente, true);
          const formato = x.prodotto?.quantita && x.prodotto.unita ? { quantita: x.prodotto.quantita, unita: x.prodotto.unita } : (x.esterno?.formato ?? x.scheda?.formato);
          if (formato && formato.unita === UNITA_BASE[x.ingrediente.dimensione]) {
            cambiaScritta({ numero: String(formato.quantita).replace('.', ','), unita: formato.unita, quante: '1' });
          }
          setNome(x.prodotto?.nome ?? x.esterno?.nome ?? '');
        }}
      />
    );
  }

  return (
    <Foglio titolo="Aggiungi in casa" chiudi={chiudi}>
      {!ing ? (
        <>
          <button type="button" className="bottone pieno" onClick={() => setScansiona(true)}>
            <span aria-hidden>📷</span> Scansiona il codice a barre
          </button>
          <CercaIngrediente indice={indice} scegli={scegli} etichetta="Cosa aggiungi?" autoFocus />
        </>
      ) : (
        <form onSubmit={salva} noValidate>
          <div className="riga spazio">
            <strong>
              <IconaCibo valore={iconaIngrediente(ing)} /> {ing.nome}
            </strong>
            <button type="button" className="bottone piccolo" onClick={() => setIng(null)}>
              Cambia
            </button>
          </div>
          {codice && (
            <p className="tenue" style={{ margin: '4px 0 0' }}>
              Codice {codice.codice}: {codice.prodotto ? 'già conosciuto, ho riempito la confezione.' : 'nuovo, lo ricorderò con questi dati.'}{' '}
              <button type="button" className="bottone piccolo" onClick={() => setDettagli(true)}>
                <span aria-hidden>📋</span> Valori e ingredienti
              </button>
            </p>
          )}
          {codice && dettagli && <FoglioSchedaProdotto codice={codice.codice} nome={nome.trim() || ing.nome} salvata={codice.scheda ?? codice.prodotto?.scheda ?? null} chiudi={() => setDettagli(false)} />}
          {puoAOcchio(ing) && (
            <div className="scelte" role="group" aria-label="Come lo conti" style={{ marginTop: 12 }}>
              <button type="button" aria-pressed={!aOcchio} onClick={() => setAOcchio(false)}>
                Peso o misuro
              </button>
              <button type="button" aria-pressed={aOcchio} onClick={() => setAOcchio(true)}>
                A occhio
              </button>
            </div>
          )}
          {aOcchio && puoAOcchio(ing) ? (
            <>
              <p className="tenue" style={{ margin: '8px 0 0' }}>
                Per ciò che usi senza pesare (formaggio, olio, sale): conti i pezzi e dici quanto ne resta. Le ricette non tolgono grammi, ti avviso io quando sta per finire.
              </p>
              <LivelloScorta pezzi={pezzi} livello={livello} cambia={(x) => (x.pezzi !== undefined && setPezzi(x.pezzi), x.livello && setLivello(x.livello))} />
            </>
          ) : (
            <div style={{ marginTop: 12 }}>
              <CampoQuantita scritta={scritta} cambia={cambiaScritta} dimensione={ing.dimensione} pesoPz={ing.peso_pz} autoFocus />
            </div>
          )}
          <div className="campo">
            <span>Dove</span>
            <div className="scelte">
              {LUOGHI.map((l) => (
                <button type="button" key={l} aria-pressed={luogo === l} onClick={() => setLuogo(l)}>
                  {NOME_LUOGO[l]}
                </button>
              ))}
            </div>
          </div>
          {frigo && consiglio && (
            <div className="consiglio-ripiano-mio" aria-label="Dove metterlo">
              <DisegnoFrigoMio frigo={frigo} evidenzia={consiglio.posto.id} inFondo={consiglio.inFondo} />
              <div className="cosa-ci-va">
                <span className="tenue piccolo">Mettilo qui</span>
                <strong>
                  {consiglio.posto.nome}
                  {consiglio.inFondo ? ', in fondo' : ''}
                </strong>
                <span className="tenue">{consiglio.perche}</span>
                {consiglio.confezione && <span className="tenue piccolo">📦 {consiglio.confezione}</span>}
              </div>
            </div>
          )}
          <div className="campo">
            <span>Data sulla confezione</span>
            <div className="scelte">
              <button type="button" aria-pressed={sceltaData === 'scadenza'} onClick={() => setSceltaData('scadenza')}>
                Da consumarsi entro
              </button>
              <button type="button" aria-pressed={sceltaData === 'tmc'} onClick={() => setSceltaData('tmc')}>
                Preferibilmente entro
              </button>
              <button type="button" aria-pressed={sceltaData === 'nessuna'} onClick={() => setSceltaData('nessuna')}>
                Senza data
              </button>
            </div>
            {(sceltaData === 'scadenza' || sceltaData === 'tmc') && <input type="date" aria-label="Data" value={data} min={piuGiorni(giorno, -365)} onChange={(e) => setData(e.target.value)} />}
            {sceltaData === 'nessuna' && (
              <>
                <label className="riga">
                  <input type="checkbox" checked={sfuso} onChange={(e) => setSfuso(e.target.checked)} /> È fresco o sfuso (frutta, verdura, pane, carne e pesce del banco)
                </label>
                <p className="tenue">
                  {proposta
                    ? `Scadenza automatica: ${dataBreve(proposta.data_limite)}, cioè ${descriviDurata(proposta.giorni)} in ${NOME_LUOGO[luogo].toLowerCase()}. Puoi cambiarla dopo.`
                    : 'La data resterà «sconosciuta»: comparirà tra le cose da controllare.'}
                </p>
              </>
            )}
          </div>
          <label className="campo">
            <span>Nome sulla confezione (facoltativo)</span>
            <input value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} placeholder={`es. ${ing.nome} bio`} />
          </label>
          {errore && (
            <div className="avviso errore" role="alert">
              {errore}
            </div>
          )}
          <button type="submit" className="bottone primario pieno">
            Aggiungi
          </button>
        </form>
      )}
    </Foglio>
  );
}
