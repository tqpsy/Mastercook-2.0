import { type FormEvent, memo, useDeferredValue, useEffect, useMemo, useState } from 'react';
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
import { daUsarePresto, descriviData, descriviDurata, eFresco, giorniTra, type Luogo, oggi, piuGiorni, scadutoVero, spreco, statoData, stima, type TipoData } from '../dominio/scadenze';
import { formatta, leggiNumero, type Scritta, scrittaVuota, totaleScritta, UNITA_BASE, type UnitaBase } from '../dominio/unita';
import { CampoQuantita } from '../ui/CampoQuantita';
import { LivelloScorta } from '../ui/LivelloScorta';
import { descriviLivello, eBasso, eLivello, LIVELLI, type Livello, puoAOcchio, type ScortaAOcchio, scorteAOcchio } from '../dominio/livello';
import { CercaIngrediente } from '../ui/CercaIngrediente';
import { type ProdottoScansionato, ScansionaProdotto } from '../ui/CodiceProdotto';
import { FoglioSchedaProdotto } from '../ui/SchedaProdotto';
import { chiediAOpenFoodFacts } from '../ui/openFoodFacts';
import { type SchedaProdotto, schedaVuota } from '../dominio/schedaProdotto';
import { Foglio } from '../ui/Foglio';
import { consumaApertura, useLetture } from '../piattaforma/letturaFoto';
import { FotoFrigo } from './FotoFrigo';
import { Verifica, VoceVerifica } from './Verifica';
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
  /** A occhio (formaggio, olio…): la quantità è il numero di pezzi e questo dice quanto resta di quello in uso. */
  livello?: Livello | null;
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
  livello: eLivello(r.livello) ? r.livello : null,
  versione: Number(r.versione ?? 1),
  in_attesa: r.in_attesa,
});

/** Come stanno i prodotti a occhio, per ingrediente (e per i suoi antenati): per gli avvisi nelle ricette. */
export function useScorteAOcchio(indice: Indice | null): Map<string, ScortaAOcchio> {
  const lotti = useLotti();
  return useMemo(() => (indice ? scorteAOcchio(lotti, (id) => indice.antenati(id)) : new Map()), [lotti, indice]);
}

/** I lotti aperti della famiglia. */
export function useLotti(): Lotto[] {
  const vista = useVista();
  const righe = vista.righe.lotto;
  return useMemo(() => (righe ?? []).filter((r) => !r.eliminato_il).map(aLotto).filter((l) => !l.chiuso_il && l.quantita > 0), [righe]);
}

/** Lo spreco degli ultimi 30 giorni: guarda tutti i movimenti della storia, quindi si rifà solo quando cambiano. */
function useSprecati(giorno: string) {
  const { lotto, movimento } = useVista().righe;
  return useMemo(() => {
    const perId = new Map((lotto ?? []).map((l) => [l.id, { ingrediente_id: String(l.ingrediente_id), unita: String(l.unita) }]));
    const movimenti = (movimento ?? []).map((m) => ({ lotto_id: String(m.lotto_id), variazione: Number(m.variazione), causale: String(m.causale), creato_il: String(m.creato_il ?? new Date().toISOString()) }));
    return spreco(movimenti, perId, piuGiorni(giorno, -30));
  }, [lotto, movimento, giorno]);
}

/** «300 g», o a occhio «Metà», «2 pezzi · poco». */
export const quantitaLotto = (l: Pick<Lotto, 'quantita' | 'unita' | 'livello'>) => (l.livello ? descriviLivello(l.quantita, l.livello) : formatta({ valore: l.quantita, unita: l.unita }));

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
  const [aperto, setAperto] = useState<string | 'nuovo' | 'foto' | 'verifica' | null>(null);
  // L'avviso «foto del frigo» in alto porta qui: il foglio della foto si apre sul risultato (o sull'attesa).
  const { richiestaApertura } = useLetture();
  if (richiestaApertura && aperto !== richiestaApertura) setAperto(richiestaApertura);
  useEffect(() => {
    if (richiestaApertura) consumaApertura();
  }, [richiestaApertura]);
  // «Da usare presto» è chiusa di base: l'elenco e le ricette (calcolo pesante) si preparano solo quando si apre.
  const [prestoAperto, setPrestoAperto] = useState(false);
  const giorno = oggi();
  const presto = useMemo(() => daUsarePresto(lotti, giorno), [lotti, giorno]);
  const finendo = useMemo(() => lotti.filter(eBasso), [lotti]);
  const scaduti = useMemo(() => lotti.filter((l) => scadutoVero(l, giorno)).length, [lotti, giorno]);
  const sprecati = useSprecati(giorno);

  if (!vista.pronta || !indice) return <p className="tenue">Sto caricando la casa…</p>;
  const lotto = aperto && aperto !== 'nuovo' && aperto !== 'foto' && aperto !== 'verifica' ? lotti.find((l) => l.id === aperto) : undefined;

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

      {lotti.some((l) => l.luogo !== 'dispensa') && <VoceVerifica apri={() => setAperto('verifica')} />}

      <DaCompletare indice={indice} />

      {presto.length > 0 && (
        // Una tendina chiusa di base: si vede subito quanti prodotti stanno per scadere, l'elenco si apre al tocco.
        <section className="scheda" aria-label="Da usare presto">
          <details open={prestoAperto} onToggle={(e) => setPrestoAperto(e.currentTarget.open)}>
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
            {prestoAperto && (
              <>
                {scaduti > 0 && (
                  <p className="tenue" style={{ marginTop: 0 }}>
                    {scaduti === 1 ? 'Un prodotto è scaduto' : `${scaduti} prodotti sono scaduti`}: non {scaduti === 1 ? 'lo' : 'li'} conto per la spesa e le ricette. Se {scaduti === 1 ? 'l’hai buttato' : 'li hai buttati'}, scarica {scaduti === 1 ? 'il lotto' : 'i lotti'} con «Buttato perché scaduto».
                  </p>
                )}
                <ElencoLotti indice={indice} lotti={presto.slice(0, 8)} giorno={giorno} apri={setAperto} conLuogo />
                {presto.length > 8 && <p className="tenue">E altri {presto.length - 8}.</p>}
                <RicettePerUrgenti indice={indice} presto={presto} lotti={lotti} giorno={giorno} />
              </>
            )}
          </details>
        </section>
      )}

      {finendo.length > 0 && (
        <section className="scheda" aria-label="Stanno per finire">
          <h3 style={{ marginTop: 0 }}>
            Stanno per finire <span className="etichetta">{finendo.length}</span>
          </h3>
          <p className="tenue" style={{ margin: '0 0 8px' }}>
            Si usano a occhio e ne resta poco: forse basta per un’altra volta. Se serve per una ricetta, controlla; in Spesa li trovi da aggiungere alla lista.
          </p>
          <ElencoLotti indice={indice} lotti={finendo} giorno={giorno} apri={setAperto} conLuogo />
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
      <ColonneLuoghi indice={indice} lotti={lotti} giorno={giorno} luogo={luogo} apri={setAperto} />

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
      {aperto === 'verifica' && <Verifica indice={indice} chiudi={() => setAperto(null)} />}
      {aperto === 'nuovo' && <NuovoLotto indice={indice} luogo={luogo} chiudi={() => setAperto(null)} />}
      {lotto && <SchedaLotto indice={indice} lotto={lotto} giorno={giorno} chiudi={() => setAperto(null)} />}
    </>
  );
}

interface RigaDaCompletare {
  id: string;
  ing: Ingrediente;
  data: string;
  negozio: string | null;
}

/**
 * Frigo, freezer e dispensa con i loro prodotti. Separato e memorizzato: toccando un prodotto si apre la sua scheda
 * senza ridisegnare tutti gli elenchi (con un centinaio di prodotti la scheda si apriva in ritardo sul telefono).
 */
const ColonneLuoghi = memo(function ColonneLuoghi({
  indice,
  lotti,
  giorno,
  luogo,
  apri,
}: {
  indice: Indice;
  lotti: Lotto[];
  giorno: string;
  luogo: Luogo;
  apri: (id: string) => void;
}) {
  const perLuogo = useMemo(
    () =>
      new Map(
        LUOGHI.map((l) => [l, lotti.filter((x) => x.luogo === l).sort((a, b) => indice.nome(a.ingrediente_id).localeCompare(indice.nome(b.ingrediente_id), 'it'))]),
      ),
    [lotti, indice],
  );
  return (
    <div className="colonne-luoghi">
      {LUOGHI.map((l) => {
        const qui = perLuogo.get(l)!;
        return (
          <section key={l} className={`scheda luogo${l === luogo ? ' attivo' : ''}`} aria-label={NOME_LUOGO[l]}>
            <h3 className="titolo-luogo">
              {NOME_LUOGO[l]} <span className="etichetta">{qui.length}</span>
            </h3>
            {qui.length ? (
              <ElencoLotti indice={indice} lotti={qui} giorno={giorno} apri={apri} />
            ) : (
              <p className="tenue" style={{ margin: 0 }}>
                Niente in {NOME_LUOGO[l].toLowerCase()}. Aggiungi ciò che hai con «+ Aggiungi»: la quantità la scrivi tu, l’app non la indovina.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
});

/**
 * Le cose comprate con lo scontrino senza scriverne la quantità: in casa entrano quando si scrive quanto.
 * Si vedono per 30 giorni dall'acquisto; dopo non servono più (ormai è stato mangiato o buttato).
 */
function DaCompletare({ indice }: { indice: Indice }) {
  const vista = useVista();
  const [aperta, setAperta] = useState<RigaDaCompletare | null>(null);
  const giorno = oggi();
  const acquisti = new Map((vista.righe.acquisto ?? []).filter((a) => !a.eliminato_il && a.stato !== 'annullato').map((a) => [a.id, a]));
  const elenco: RigaDaCompletare[] = [];
  for (const r of vista.righe.acquisto_riga ?? []) {
    const a = acquisti.get(String(r.acquisto_id));
    const ing = r.ingrediente_id ? indice.ingrediente(String(r.ingrediente_id)) : undefined;
    if (r.eliminato_il || r.lotto_id || r.quantita != null || !a || !ing) continue;
    const data = String(a.data).slice(0, 10);
    if (giorniTra(data, giorno) > 30) continue;
    elenco.push({ id: r.id, ing, data, negozio: (a.negozio as string | null) ?? null });
  }
  if (!elenco.length) return null;
  elenco.sort((x, y) => y.data.localeCompare(x.data) || x.ing.nome.localeCompare(y.ing.nome, 'it'));
  return (
    <section className="scheda" aria-label="Da completare">
      <h3 style={{ marginTop: 0 }}>
        Da completare <span className="etichetta">{elenco.length}</span>
      </h3>
      <p className="tenue" style={{ margin: '0 0 8px' }}>
        Comprati con lo scontrino senza la quantità: scrivila e li metto in casa.
      </p>
      <ul className="elenco">
        {elenco.map((r) => (
          <li key={r.id}>
            <button className="voce" onClick={() => setAperta(r)} aria-label={`Scrivi la quantità di ${r.ing.nome}`}>
              <span className="emoji" aria-hidden>
                <IconaCibo valore={iconaIngrediente(r.ing)} />
              </span>
              <span className="cresce">
                <strong>{r.ing.nome}</strong>
                <span className="tenue" style={{ display: 'block' }}>
                  {[`comprato ${dataBreve(r.data)}`, r.negozio].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="etichetta avviso-data">quantità?</span>
            </button>
          </li>
        ))}
      </ul>
      {aperta && <CompletaRiga riga={aperta} chiudi={() => setAperta(null)} />}
    </section>
  );
}

function CompletaRiga({ riga, chiudi }: { riga: RigaDaCompletare; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const { ing } = riga;
  const [scritta, setScritta] = useState<Scritta>(() => scrittaVuota(ing.dimensione !== 'pezzi' && ing.peso_pz ? 'pz' : UNITA_BASE[ing.dimensione]));
  const cambiaScritta = (x: Partial<Scritta>) => setScritta((s) => ({ ...s, ...x }));
  const [luogo, setLuogo] = useState<Luogo>(ing.luogo);
  const [errore, setErrore] = useState<string | null>(null);
  const consiglio = useConsiglioPosto(ing, luogo);
  // Fresco o sfuso: la scadenza la calcola l'app dal giorno dell'acquisto, come nello scontrino.
  const proposta = eFresco(ing) ? stima(ing, luogo, riga.data) : null;
  // Il formaggio comprato senza pesarlo: pezzi e quanto ne resta, come in «Aggiungi».
  const [aOcchio, setAOcchio] = useState(false);
  const [occhio, setOcchio] = useState<{ pezzi: number; livello: Livello }>({ pezzi: 1, livello: 'tanto' });
  const conOcchio = aOcchio && puoAOcchio(ing);

  async function salva(e: FormEvent) {
    e.preventDefault();
    const q = conOcchio ? null : quantitaDa(scritta, ing);
    if (typeof q === 'string') return setErrore(q);
    await esegui('completa_riga_acquisto', {
      id: riga.id,
      lotto_id: crypto.randomUUID(),
      ...(q ? { quantita: q.valore, unita: q.unita } : occhio),
      luogo,
      posto: consiglio?.posto.id ?? null,
      ...(proposta
        ? { data_limite: proposta.data_limite, tipo_data: 'stimata', fonte_data: 'app', calcolata_il: proposta.calcolata_il, affidabilita: 'bassa' }
        : { tipo_data: 'sconosciuta' }),
    });
    chiudi();
  }

  return (
    <Foglio titolo={`Quanto ${ing.nome.toLowerCase()}?`} chiudi={chiudi}>
      <form onSubmit={salva} noValidate>
        <p className="tenue" style={{ marginTop: 0 }}>
          Comprato {dataBreve(riga.data)}
          {riga.negozio ? ` da ${riga.negozio}` : ''}. Scrivi quanto ne hai preso: entra in casa con la data dello scontrino.
        </p>
        {puoAOcchio(ing) && (
          <div className="scelte" role="group" aria-label="Come lo conti">
            <button type="button" aria-pressed={!aOcchio} onClick={() => setAOcchio(false)}>
              Peso o misuro
            </button>
            <button type="button" aria-pressed={aOcchio} onClick={() => setAOcchio(true)}>
              A occhio
            </button>
          </div>
        )}
        {conOcchio ? (
          <LivelloScorta pezzi={occhio.pezzi} livello={occhio.livello} cambia={(x) => setOcchio((o) => ({ ...o, ...x }))} />
        ) : (
          <div style={{ marginTop: puoAOcchio(ing) ? 12 : 0 }}>
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
        {consiglio && <p className="tenue">📍 Mettilo qui: {consiglio.posto.nome}{consiglio.inFondo ? ', in fondo' : ''}.</p>}
        {proposta && <p className="tenue">Scadenza automatica: {dataBreve(proposta.data_limite)}. Puoi cambiarla dopo.</p>}
        {errore && (
          <div className="avviso errore" role="alert">
            {errore}
          </div>
        )}
        <button type="submit" className="bottone primario pieno">
          Metti in casa
        </button>
      </form>
    </Foglio>
  );
}

/** Ricette che usano ciò che scade, da mettere a cena stasera in un tocco se la cena è ancora vuota. */
function RicettePerUrgenti({ indice, presto, lotti, giorno }: { indice: Indice; presto: Lotto[]; lotti: Lotto[]; giorno: string }) {
  const dati = useDatiMenu(useVista());
  const { esegui } = useFamiglia();
  const cenaOggi = dati.portate.some((p) => p.data === giorno && p.categoria === 'cena');
  // Il calcolo passa per tutto il catalogo: si rifà solo se cambiano i dati, non a ogni disegno della scheda.
  const proposte = useMemo(
    () =>
      ricettePerUrgenti(
        indice,
        presto.map((l) => l.ingrediente_id),
        lotti.map((l) => l.ingrediente_id),
        dati.persone,
        dati.vincoli,
        3,
        dati.verifiche,
      ),
    [indice, presto, lotti, dati.persone, dati.vincoli, dati.verifiche],
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
  return postoIngrediente(frigo, { id: ing.id, reparto: ing.reparto, sottocategoria }, luogo);
}

const ElencoLotti = memo(function ElencoLotti({
  indice,
  lotti,
  giorno,
  apri,
  conLuogo,
}: {
  indice: Indice;
  lotti: Lotto[];
  giorno: string;
  apri: (id: string) => void;
  conLuogo?: boolean;
}) {
  const frigo = useFrigo();
  return (
    <ul className="elenco">
      {lotti.map((l) => {
        const ing = indice.ingrediente(l.ingrediente_id);
        const posto = postoDelLotto(frigo, l);
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
                  {quantitaLotto(l)}
                  {conLuogo && ` · ${NOME_LUOGO[l.luogo]}`}
                  {posto && ` · 📍 ${posto.nome}`}
                </span>
              </span>
              {eBasso(l) ? <span className="etichetta avviso-data">{l.livello === 'finendo' ? 'sta per finire' : 'poco'}</span> : <EtichettaData lotto={l} giorno={giorno} />}
            </button>
          </li>
        );
      })}
    </ul>
  );
});

/** La scheda del codice scansionato: quella appena letta, quella ricordata o, per qualche istante, quella in arrivo da Open Food Facts. */
async function schedaDelCodice(c: ProdottoScansionato): Promise<SchedaProdotto | undefined> {
  const pronta = c.scheda ?? c.prodotto?.scheda ?? undefined;
  if (pronta) return pronta;
  const attesa = new Promise<undefined>((r) => setTimeout(r, 2500));
  const scheda = (await Promise.race([chiediAOpenFoodFacts(c.codice), attesa]))?.scheda;
  return scheda && !schedaVuota(scheda) ? scheda : undefined;
}

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
const DATA_MOVIMENTO = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });

/** «5 novembre», con l'anno se non è quest'anno. */
function dataBreve(data: string): string {
  const d = new Date(`${data}T12:00:00`);
  return (d.getFullYear() !== new Date().getFullYear() ? DATA_CON_ANNO : DATA_BREVE).format(d);
}

function NuovoLotto({ indice, luogo: luogoIniziale, chiudi }: { indice: Indice; luogo: Luogo; chiudi: () => void }) {
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

function SchedaLotto({ indice, lotto: l, giorno, chiudi }: { indice: Indice; lotto: Lotto; giorno: string; chiudi: () => void }) {
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

/**
 * Dopo aver cucinato o mangiato: i prodotti a occhio usati dal piatto non perdono grammi, quindi si chiede a parole
 * quanto ne resta. Un tocco cambia il livello; «Finito» toglie un pezzo (l'ultimo chiude il prodotto).
 */
export function AggiornaAOcchio({ indice, ingredienti }: { indice: Indice; ingredienti: string[] }) {
  const { esegui } = useFamiglia();
  const lotti = useLotti();
  // Fissati all'apertura: un prodotto finito non deve sparire sotto il dito.
  const [ids] = useState(() => {
    const cercati = new Set(ingredienti);
    return lotti.filter((l) => l.livello && indice.antenati(l.ingrediente_id).some((a) => cercati.has(a))).map((l) => l.id);
  });
  const tutti = useMemo(() => new Map(lotti.map((l) => [l.id, l])), [lotti]);
  if (!ids.length) return null;
  return (
    <section className="a-occhio-usati" aria-label="A occhio: quanto ne resta?">
      <span className="tenue piccolo">A occhio, non tolgo grammi: quanto ne resta?</span>
      <ul className="elenco">
        {ids.map((id) => {
          const l = tutti.get(id);
          const nome = indice.nome(l?.ingrediente_id ?? '') || 'Prodotto';
          if (!l || !l.livello) {
            return (
              <li key={id} className="tenue piccolo">
                {nome}: finito.
              </li>
            );
          }
          return (
            <li key={id}>
              <strong>{l.nome ?? nome}</strong>
              {l.quantita > 1 && <span className="tenue piccolo"> · {l.quantita} pezzi</span>}
              <div className="scelte compatte livelli" role="group" aria-label={`Quanto resta: ${l.nome ?? nome}`}>
                {LIVELLI.map((x) => (
                  <button type="button" key={x.id} aria-pressed={l.livello === x.id} className={`livello-${x.id}`} onClick={() => void esegui('cambia_livello', { lotto_id: l.id, livello: x.id })}>
                    {x.nome}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => void esegui('cambia_livello', { lotto_id: l.id, livello: l.quantita > 1 ? 'tanto' : l.livello, pezzi: l.quantita - 1 })}
                >
                  Finito{l.quantita > 1 ? ' uno' : ''}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
