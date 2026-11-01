import { type FormEvent, useMemo, useState } from 'react';
import { IconaCibo } from '../ui/IconaCibo';
import { iconaIngrediente } from '../dominio/iconeCibo';
import { LUOGHI, NOME_LUOGO } from '../catalogo/tipi';
import type { RigaInVista } from '../dati/anteprima';
import { useFamiglia, useVista } from '../dati/contesto';
import { useCatalogo, useIndice } from '../dati/indice';
import { type Consiglio, postoDelLotto, postoIngrediente, postiDi } from '../dominio/frigo';
import { DisegnoFrigoMio } from '../ui/FrigoMio';
import { useFrigo } from './MioFrigo';
import { ricettePerUrgenti } from '../dominio/consumi';
import type { Indice, Ingrediente } from '../dominio/ricette';
import { daUsarePresto, descriviData, giorniTra, type Luogo, oggi, piuGiorni, REPARTI_SFUSI, spreco, statoData, stima, type TipoData } from '../dominio/scadenze';
import { formatta, inBase, leggiNumero, UNITA, type Unita, UNITA_BASE, type UnitaBase, unitaPer } from '../dominio/unita';
import { CercaIngrediente } from '../ui/CercaIngrediente';
import { type ProdottoScansionato, ScansionaProdotto } from '../ui/CodiceProdotto';
import { FoglioSchedaProdotto } from '../ui/SchedaProdotto';
import { Foglio } from '../ui/Foglio';
import { FotoFrigo } from './FotoFrigo';
import { useDatiMenu } from './Menu';

export interface Lotto {
  id: string;
  ingrediente_id: string;
  nome: string | null;
  quantita: number;
  unita: UnitaBase;
  luogo: Luogo;
  data_limite: string | null;
  tipo_data: TipoData;
  fonte_data: string | null;
  chiuso_il: string | null;
  note: string | null;
  /** Il piatto del menu cucinato in anticipo, se il lotto è un piatto pronto. */
  portata_id?: string | null;
  /** Dove sta nel frigo o nel freezer (Impostazioni › Il mio frigorifero). */
  posto?: string | null;
  versione: number;
  in_attesa?: boolean;
}

const aLotto = (r: RigaInVista): Lotto => ({
  id: r.id,
  ingrediente_id: String(r.ingrediente_id),
  nome: (r.nome as string | null) ?? null,
  quantita: Number(r.quantita ?? 0),
  unita: r.unita as UnitaBase,
  luogo: r.luogo as Luogo,
  data_limite: r.data_limite ? String(r.data_limite).slice(0, 10) : null,
  tipo_data: r.tipo_data as TipoData,
  fonte_data: (r.fonte_data as string | null) ?? null,
  chiuso_il: (r.chiuso_il as string | null) ?? null,
  note: (r.note as string | null) ?? null,
  portata_id: (r.portata_id as string | null) ?? null,
  posto: (r.posto as string | null) ?? null,
  versione: Number(r.versione ?? 1),
  in_attesa: r.in_attesa,
});

/** I lotti aperti della famiglia. */
export function useLotti(): Lotto[] {
  const vista = useVista();
  const righe = vista.righe.lotto;
  return useMemo(() => (righe ?? []).filter((r) => !r.eliminato_il).map(aLotto).filter((l) => !l.chiuso_il && l.quantita > 0), [righe]);
}

export function EtichettaData({ lotto, giorno }: { lotto: Pick<Lotto, 'data_limite' | 'tipo_data'>; giorno: string }) {
  const s = statoData(lotto, giorno);
  const classe = s === 'scaduto' ? 'scaduto' : s === 'ok' ? '' : 'avviso-data';
  return <span className={`etichetta ${classe}`}>{descriviData(lotto, giorno)}</span>;
}

export function Casa() {
  const vista = useVista();
  const indice = useIndice(vista);
  const lotti = useLotti();
  const [luogo, setLuogo] = useState<Luogo>('frigo');
  const [aperto, setAperto] = useState<string | 'nuovo' | 'foto' | null>(null);
  const giorno = oggi();
  const presto = daUsarePresto(lotti, giorno);
  const perId = new Map((vista.righe.lotto ?? []).map((l) => [l.id, { ingrediente_id: String(l.ingrediente_id), unita: String(l.unita) }]));
  const movimenti = (vista.righe.movimento ?? []).map((m) => ({ lotto_id: String(m.lotto_id), variazione: Number(m.variazione), causale: String(m.causale), creato_il: String(m.creato_il ?? new Date().toISOString()) }));
  const sprecati = spreco(movimenti, perId, piuGiorni(giorno, -30));

  if (!vista.pronta || !indice) return <p className="tenue">Sto caricando la casa…</p>;
  const lotto = aperto && aperto !== 'nuovo' && aperto !== 'foto' ? lotti.find((l) => l.id === aperto) : undefined;

  return (
    <>
      <div className="riga spazio" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>In casa</h2>
        <div className="riga">
          <button className="bottone piccolo" onClick={() => setAperto('foto')}>
            📷 Foto del frigo
          </button>
          <button className="bottone primario piccolo" onClick={() => setAperto('nuovo')}>
            + Aggiungi
          </button>
        </div>
      </div>

      {presto.length > 0 && (
        // Una tendina chiusa di base: si vede subito quanti prodotti stanno per scadere, l'elenco si apre al tocco.
        <section className="scheda" aria-label="Da usare presto">
          <details>
            <summary>
              <h3 style={{ display: 'inline', margin: 0 }}>
                Da usare presto <span className="etichetta">{presto.length}</span>
              </h3>
              {/* Anche chiusa, la tendina dice subito qual è il primo. */}
              <span className="primo-presto">
                Per primo: {indice.nome(presto[0].ingrediente_id)}
                {presto.length > 1 && ` e altri ${presto.length - 1}`}
              </span>
            </summary>
            <ElencoLotti indice={indice} lotti={presto.slice(0, 8)} giorno={giorno} apri={setAperto} conLuogo />
            {presto.length > 8 && <p className="tenue">E altri {presto.length - 8}.</p>}
            <RicettePerUrgenti indice={indice} presto={presto} lotti={lotti} giorno={giorno} />
          </details>
        </section>
      )}

      {/* Telefono: una scheda per luogo. Da 900 px: frigo, freezer e dispensa affiancati, e le schede spariscono. */}
      <div className="scelte schede-luogo" role="tablist" aria-label="Dove">
        {LUOGHI.map((l) => (
          <button key={l} role="tab" aria-pressed={luogo === l} aria-selected={luogo === l} onClick={() => setLuogo(l)}>
            {NOME_LUOGO[l]} ({lotti.filter((x) => x.luogo === l).length})
          </button>
        ))}
      </div>
      <div className="colonne-luoghi">
        {LUOGHI.map((l) => {
          const qui = lotti.filter((x) => x.luogo === l).sort((a, b) => indice.nome(a.ingrediente_id).localeCompare(indice.nome(b.ingrediente_id), 'it'));
          return (
            <section key={l} className={`scheda luogo${l === luogo ? ' attivo' : ''}`} aria-label={NOME_LUOGO[l]}>
              <h3 className="titolo-luogo">
                {NOME_LUOGO[l]} <span className="etichetta">{qui.length}</span>
              </h3>
              {qui.length ? (
                <ElencoLotti indice={indice} lotti={qui} giorno={giorno} apri={setAperto} />
              ) : (
                <p className="tenue" style={{ margin: 0 }}>
                  Niente in {NOME_LUOGO[l].toLowerCase()}. Aggiungi ciò che hai con «+ Aggiungi»: la quantità la scrivi tu, l’app non la indovina.
                </p>
              )}
            </section>
          );
        })}
      </div>

      {sprecati.length > 0 && (
        <section className="scheda" aria-label="Buttato negli ultimi 30 giorni">
          <h3 style={{ marginTop: 0 }}>Buttato negli ultimi 30 giorni</h3>
          <ul className="elenco">
            {sprecati.slice(0, 6).map((v) => (
              <li key={`${v.ingrediente_id}|${v.unita}`} className="riga spazio">
                <span>
                  <IconaCibo valore={iconaIngrediente(indice.ingrediente(v.ingrediente_id))} /> {indice.nome(v.ingrediente_id)}
                </span>
                <span className="tenue">
                  {formatta({ valore: v.quantita, unita: v.unita as UnitaBase })} · {v.volte === 1 ? '1 volta' : `${v.volte} volte`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="tenue">Le date stimate sono indicative: controlla sempre l’alimento. L’app non dice mai che qualcosa è sicuro oltre la data.</p>

      {aperto === 'foto' && <FotoFrigo indice={indice} luogo={luogo} chiudi={() => setAperto(null)} />}
      {aperto === 'nuovo' && <NuovoLotto indice={indice} luogo={luogo} chiudi={() => setAperto(null)} />}
      {lotto && <SchedaLotto indice={indice} lotto={lotto} giorno={giorno} chiudi={() => setAperto(null)} />}
    </>
  );
}

/** Ricette che usano ciò che scade, da mettere a cena stasera in un tocco se la cena è ancora vuota. */
function RicettePerUrgenti({ indice, presto, lotti, giorno }: { indice: Indice; presto: Lotto[]; lotti: Lotto[]; giorno: string }) {
  const dati = useDatiMenu(useVista());
  const { esegui } = useFamiglia();
  const cenaOggi = dati.portate.some((p) => p.data === giorno && p.categoria === 'cena');
  const proposte = ricettePerUrgenti(
    indice,
    presto.map((l) => l.ingrediente_id),
    lotti.map((l) => l.ingrediente_id),
    dati.persone,
    dati.vincoli,
    3,
    dati.verifiche,
  );
  if (!proposte.length) return null;
  return (
    <>
      <h4 style={{ margin: '12px 0 4px' }}>Ricette che li usano</h4>
      <ul className="elenco" aria-label="Ricette che li usano">
        {proposte.map(({ ricetta, usa, presenti, totali }) => (
          <li key={ricetta.id} className="riga" style={{ flexWrap: 'wrap' }}>
            <span className="cresce">
              {ricetta.titolo}
              <span className="tenue" style={{ display: 'block', fontSize: '0.85rem' }}>
                usa {usa.map((id) => indice.nome(id).toLowerCase()).join(', ')} · {presenti} su {totali} ingredienti in casa
              </span>
            </span>
            {!cenaOggi && (
              <button
                className="bottone piccolo"
                aria-label={`Metti a cena stasera: ${ricetta.titolo}`}
                onClick={() => esegui('aggiungi_portata', { id: crypto.randomUUID(), data: giorno, categoria: 'cena', ricetta_id: ricetta.id, ordine: 0 })}
              >
                Stasera
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Dove mettere un ingrediente nel frigo della famiglia (null senza frigo configurato o in dispensa). */
export function useConsiglioPosto(ing: Ingrediente | null, luogo: Luogo): Consiglio | null {
  const frigo = useFrigo();
  const catalogo = useCatalogo();
  if (!frigo || !ing || luogo === 'dispensa') return null;
  const sottocategoria = catalogo?.ingredienti.find((x) => x.id === ing.id)?.sottocategoria ?? null;
  return postoIngrediente(frigo, { reparto: ing.reparto, sottocategoria }, luogo);
}

function ElencoLotti({ indice, lotti, giorno, apri, conLuogo }: { indice: Indice; lotti: Lotto[]; giorno: string; apri: (id: string) => void; conLuogo?: boolean }) {
  const frigo = useFrigo();
  return (
    <ul className="elenco">
      {lotti.map((l) => {
        const ing = indice.ingrediente(l.ingrediente_id);
        return (
          <li key={l.id}>
            <button className="voce" onClick={() => apri(l.id)} aria-label={`Apri ${l.nome ?? ing?.nome}`}>
              <span className="emoji" aria-hidden>
                <IconaCibo valore={iconaIngrediente(ing)} />
              </span>
              <span className="cresce">
                <strong>{l.nome ?? ing?.nome ?? 'Ingrediente sconosciuto'}</strong>
                {l.in_attesa && <span className="etichetta attesa" style={{ marginLeft: 8 }}>in invio</span>}
                <span className="tenue" style={{ display: 'block' }}>
                  {formatta({ valore: l.quantita, unita: l.unita })}
                  {conLuogo && ` · ${NOME_LUOGO[l.luogo]}`}
                  {postoDelLotto(frigo, l) && ` · 📍 ${postoDelLotto(frigo, l)!.nome}`}
                </span>
              </span>
              <EtichettaData lotto={l} giorno={giorno} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Legge «1,5» + «kg» per l'ingrediente e lo porta in unità base, o dice cosa non va. */
export function quantitaDa(testo: string, unita: Unita, ing: Ingrediente | undefined): { valore: number; unita: UnitaBase } | string {
  const n = leggiNumero(testo);
  if (n === null) return 'Scrivi una quantità, per esempio 500 o 1,5.';
  const e = inBase(n, unita, ing?.dimensione ?? 'massa');
  if (!e.ok) return e.motivo === 'unita_incompatibile' ? 'Unità non adatta a questo ingrediente.' : 'La quantità deve essere più di zero.';
  return e.quantita;
}

type SceltaData = 'scadenza' | 'tmc' | 'nessuna';

function NuovoLotto({ indice, luogo: luogoIniziale, chiudi }: { indice: Indice; luogo: Luogo; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const [ing, setIng] = useState<Ingrediente | null>(null);
  const [numero, setNumero] = useState('');
  const [unita, setUnita] = useState<Unita>('g');
  const [luogo, setLuogo] = useState<Luogo>(luogoIniziale);
  const [nome, setNome] = useState('');
  const [sceltaData, setSceltaData] = useState<SceltaData | null>(null);
  const [data, setData] = useState('');
  const [sfuso, setSfuso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [scansiona, setScansiona] = useState(false);
  const [codice, setCodice] = useState<ProdottoScansionato | null>(null);
  const [dettagli, setDettagli] = useState(false);
  const giorno = oggi();

  function scegli(i: Ingrediente) {
    setIng(i);
    setUnita(UNITA_BASE[i.dimensione]);
    setLuogo(i.luogo);
    setSfuso(REPARTI_SFUSI.has(i.reparto));
  }

  const proposta = ing && sceltaData === 'nessuna' && sfuso ? stima(ing, luogo, giorno) : null;
  const consiglio = useConsiglioPosto(ing, luogo);
  const frigo = useFrigo();

  async function salva(e: FormEvent) {
    e.preventDefault();
    if (!ing) return;
    const q = quantitaDa(numero, unita, ing);
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
      luogo,
      data_acquisto: giorno,
      origine: 'manuale',
      posto: consiglio?.posto.id ?? null,
      ...date,
    });
    // Il codice a barre si ricorda con quello che si è scritto: la prossima volta propone la stessa confezione.
    const p = codice?.prodotto;
    if (codice && (!p || p.ingrediente_id !== ing.id || p.quantita !== q.valore || p.unita !== q.unita || (p.nome ?? '') !== nome.trim())) {
      await esegui('salva_prodotto', { id: crypto.randomUUID(), codice: codice.codice, ingrediente_id: ing.id, nome: nome.trim() || null, quantita: q.valore, unita: q.unita });
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
          scegli(x.ingrediente);
          const formato = x.prodotto?.quantita && x.prodotto.unita ? { quantita: x.prodotto.quantita, unita: x.prodotto.unita } : x.esterno?.formato;
          if (formato && formato.unita === UNITA_BASE[x.ingrediente.dimensione]) {
            setNumero(String(formato.quantita).replace('.', ','));
            setUnita(formato.unita);
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
          {codice && dettagli && <FoglioSchedaProdotto codice={codice.codice} nome={nome.trim() || ing.nome} chiudi={() => setDettagli(false)} />}
          <div className="riga" style={{ alignItems: 'flex-end', marginTop: 12 }}>
            <label className="campo cresce">
              <span>Quantità</span>
              <input inputMode="decimal" value={numero} onChange={(e) => setNumero(e.target.value)} autoFocus />
            </label>
            <label className="campo">
              <span>Unità</span>
              <select value={unita} onChange={(e) => setUnita(e.target.value as Unita)}>
                {unitaPer(ing.dimensione).map((u) => (
                  <option key={u} value={u}>
                    {UNITA[u].nome}
                  </option>
                ))}
              </select>
            </label>
          </div>
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
                  <input type="checkbox" checked={sfuso} onChange={(e) => setSfuso(e.target.checked)} /> È fresco o sfuso (frutta, verdura, pane, banco)
                </label>
                <p className="tenue">
                  {proposta
                    ? `Stima indicativa: entro ${proposta.giorni} ${proposta.giorni === 1 ? 'giorno' : 'giorni'} in ${NOME_LUOGO[luogo].toLowerCase()}. Puoi cambiarla dopo.`
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

type Azione = 'consumo' | 'spreco' | 'scaduto' | 'correggi' | 'sposta' | 'data' | null;

const TITOLI: Record<Exclude<Azione, null>, string> = {
  consumo: 'Quanto ne hai usato?',
  spreco: 'Quanto ne hai buttato?',
  scaduto: 'Quanto ne hai buttato perché scaduto?',
  correggi: 'Quanto ce n’è adesso?',
  sposta: 'Dove lo sposti?',
  data: 'Cambia la data',
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

function SchedaLotto({ indice, lotto: l, giorno, chiudi }: { indice: Indice; lotto: Lotto; giorno: string; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const vista = useVista();
  const ing = indice.ingrediente(l.ingrediente_id);
  const [azione, setAzione] = useState<Azione>(null);
  const [numero, setNumero] = useState('');
  const [unita, setUnita] = useState<Unita>(l.unita);
  const [tutto, setTutto] = useState(true);
  const [dove, setDove] = useState<Luogo>(l.luogo === 'frigo' ? 'freezer' : 'frigo');
  const [tipo, setTipo] = useState<TipoData>(l.tipo_data);
  const [data, setData] = useState(l.data_limite ?? '');
  const [errore, setErrore] = useState<string | null>(null);
  const frigo = useFrigo();
  const consiglio = useConsiglioPosto(ing ?? null, l.luogo);
  const postoOra = postoDelLotto(frigo, l);
  const storia = (vista.righe.movimento ?? []).filter((m) => m.lotto_id === l.id).sort((a, b) => String(b.creato_il ?? '').localeCompare(String(a.creato_il ?? '')));
  const dataProtetta = l.fonte_data === 'confezione';

  function apri(a: Azione) {
    setAzione(a);
    setErrore(null);
    setNumero('');
    setTutto(a !== 'correggi');
  }

  async function conferma(e: FormEvent) {
    e.preventDefault();
    setErrore(null);
    if (azione === 'consumo' || azione === 'spreco' || azione === 'scaduto') {
      let quantita = l.quantita;
      if (!tutto) {
        const q = quantitaDa(numero, unita, ing);
        if (typeof q === 'string') return setErrore(q);
        if (q.valore > l.quantita) return setErrore(`Ce n’è solo ${formatta({ valore: l.quantita, unita: l.unita })}. Se ce n’era di più, usa «Correggi».`);
        quantita = q.valore;
      }
      await esegui('scarica_lotto', { lotto_id: l.id, causale: azione, quantita });
      if (quantita >= l.quantita) return chiudi();
    } else if (azione === 'correggi') {
      const n = leggiNumero(numero);
      const q = n === 0 ? { valore: 0, unita: l.unita } : quantitaDa(numero, unita, ing);
      if (typeof q === 'string') return setErrore(q);
      await esegui('correggi_lotto', { lotto_id: l.id, quantita_vista: l.quantita, quantita_nuova: q.valore });
      if (q.valore === 0) return chiudi();
    } else if (azione === 'sposta') {
      let quantita: number | null = null;
      if (!tutto) {
        const q = quantitaDa(numero, unita, ing);
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
    }
    setAzione(null);
  }

  const chiedeQuantita = azione === 'consumo' || azione === 'spreco' || azione === 'scaduto' || azione === 'sposta';
  const scaduto = l.data_limite ? giorniTra(giorno, l.data_limite) < 0 : false;

  return (
    <Foglio titolo={l.nome ?? ing?.nome ?? 'Alimento'} chiudi={chiudi}>
      <p>
        <strong>{formatta({ valore: l.quantita, unita: l.unita })}</strong> in {NOME_LUOGO[l.luogo].toLowerCase()} · <EtichettaData lotto={l} giorno={giorno} />
      </p>
      {frigo && l.luogo !== 'dispensa' && (
        <div className="consiglio-ripiano-mio">
          <DisegnoFrigoMio frigo={frigo} evidenzia={postoOra?.id ?? consiglio?.posto.id} inFondo={!postoOra && consiglio?.inFondo} />
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
          </div>
        </div>
      )}
      {l.tipo_data === 'stimata' && <p className="tenue">Data stimata dall’app per un alimento senza data: è indicativa, controlla sempre.</p>}
      {l.tipo_data === 'tmc' && scaduto && <p className="tenue">«Preferibilmente entro» superato: non vuol dire per forza da buttare, controlla aspetto e odore.</p>}

      {!azione && (
        <div className="riga" style={{ flexWrap: 'wrap' }}>
          <button className="bottone primario" onClick={() => apri('consumo')}>
            Usato
          </button>
          <button className="bottone" onClick={() => apri('spreco')}>
            Buttato
          </button>
          <button className="bottone" onClick={() => apri('scaduto')}>
            Scaduto
          </button>
          <button className="bottone" onClick={() => apri('correggi')}>
            Correggi quantità
          </button>
          <button className="bottone" onClick={() => apri('sposta')}>
            Sposta
          </button>
          <button className="bottone" onClick={() => apri('data')}>
            Cambia data
          </button>
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
          {((chiedeQuantita && !tutto) || azione === 'correggi') && (
            <div className="riga" style={{ alignItems: 'flex-end' }}>
              <label className="campo cresce">
                <span>Quantità</span>
                <input inputMode="decimal" value={numero} onChange={(e) => setNumero(e.target.value)} autoFocus />
              </label>
              <label className="campo">
                <span>Unità</span>
                <select value={unita} onChange={(e) => setUnita(e.target.value as Unita)}>
                  {unitaPer(ing?.dimensione ?? 'massa').map((u) => (
                    <option key={u} value={u}>
                      {UNITA[u].nome}
                    </option>
                  ))}
                </select>
              </label>
            </div>
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
                </span>
                <span className="tenue">
                  {Number(m.variazione) > 0 ? '+' : '−'}
                  {formatta({ valore: Math.abs(Number(m.variazione)), unita: l.unita })}
                  {m.creato_il ? ` · ${new Date(String(m.creato_il)).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Foglio>
  );
}
