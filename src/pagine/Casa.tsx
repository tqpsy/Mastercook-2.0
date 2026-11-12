import { memo, useEffect, useMemo, useState } from 'react';
import { IconaCibo } from '../ui/IconaCibo';
import { iconaIngrediente } from '../dominio/iconeCibo';
import { LUOGHI, NOME_LUOGO } from '../catalogo/tipi';
import { useFamiglia, useVista } from '../dati/contesto';
import { useIndice } from '../dati/indice';
import { postoDelLotto } from '../dominio/frigo';
import { useFrigo } from './MioFrigo';
import { ricettePerUrgenti } from '../dominio/consumi';
import type { Indice } from '../dominio/ricette';
import { daUsarePresto, type Luogo, oggi, piuGiorni, scadutoVero, spreco } from '../dominio/scadenze';
import { formatta, type UnitaBase } from '../dominio/unita';
import { chiaveGruppo, raggruppa } from '../dominio/confezioni';
import { eBasso } from '../dominio/livello';
import { consumaApertura, useLetture } from '../piattaforma/letturaFoto';
import { FotoFrigo } from './FotoFrigo';
import { Verifica } from './Verifica';
import { useDatiMenu } from '../dati/menu';
import { type Lotto, quantitaRiga, useLotti } from '../dati/lotti';
import { EtichettaData } from './casa/comuni';
import { NuovoLotto } from './casa/NuovoLotto';
import { SchedaLotto } from './casa/SchedaLotto';
import { DaCompletare } from './casa/DaCompletare';
import { SceltaFoto } from './casa/SceltaFoto';

/** Lo spreco degli ultimi 30 giorni: guarda tutti i movimenti della storia, quindi si rifà solo quando cambiano. */
function useSprecati(giorno: string) {
  const { lotto, movimento } = useVista().righe;
  return useMemo(() => {
    const perId = new Map((lotto ?? []).map((l) => [l.id, { ingrediente_id: String(l.ingrediente_id), unita: String(l.unita) }]));
    const movimenti = (movimento ?? []).map((m) => ({ lotto_id: String(m.lotto_id), variazione: Number(m.variazione), causale: String(m.causale), creato_il: String(m.creato_il ?? new Date().toISOString()) }));
    return spreco(movimenti, perId, piuGiorni(giorno, -30));
  }, [lotto, movimento, giorno]);
}

/** Quante righe si vedono (le confezioni uguali stanno in una riga). */
const quanteRighe = (lotti: Lotto[]) => raggruppa(lotti).length;

export function Casa() {
  const vista = useVista();
  const indice = useIndice(vista);
  const lotti = useLotti();
  const [luogo, setLuogo] = useState<Luogo>('frigo');
  const [aperto, setAperto] = useState<string | 'nuovo' | 'scegli-foto' | 'foto' | 'verifica' | null>(null);
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
  // La riga aperta: se il suo lotto finisce («Usata una confezione») la scheda resta sulle confezioni rimaste.
  const [chiaveAperta, setChiaveAperta] = useState<string | null>(null);
  const righePerLuogo = useMemo(() => new Map(LUOGHI.map((l) => [l, quanteRighe(lotti.filter((x) => x.luogo === l))])), [lotti]);

  if (!vista.pronta || !indice) return <p className="tenue">Sto caricando la casa…</p>;
  const suLotto = !!aperto && aperto !== 'nuovo' && aperto !== 'scegli-foto' && aperto !== 'foto' && aperto !== 'verifica';
  // La verifica serve solo se c'è qualcosa in frigo o in freezer: senza, «Foto» porta dritto ad aggiungere.
  const conVerifica = lotti.some((l) => l.luogo !== 'dispensa');
  const trovato = suLotto ? lotti.find((l) => l.id === aperto) : undefined;
  if (trovato && chiaveGruppo(trovato) !== chiaveAperta) setChiaveAperta(chiaveGruppo(trovato));
  const lotto = trovato ?? (suLotto && chiaveAperta ? lotti.find((l) => chiaveGruppo(l) === chiaveAperta) : undefined);

  return (
    <>
      <div className="riga spazio" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>In casa</h2>
        <div className="riga">
          <button className="bottone piccolo" onClick={() => setAperto(conVerifica ? 'scegli-foto' : 'foto')}>
            📷 Foto
          </button>
          <button className="bottone primario piccolo" onClick={() => setAperto('nuovo')}>
            + Aggiungi
          </button>
        </div>
      </div>

      <DaCompletare indice={indice} />

      {presto.length > 0 && (
        // Una tendina chiusa di base: si vede subito quanti prodotti stanno per scadere, l'elenco si apre al tocco.
        <section className="scheda" aria-label="Da usare presto">
          <details open={prestoAperto} onToggle={(e) => setPrestoAperto(e.currentTarget.open)}>
            <summary>
              <h3 style={{ display: 'inline', margin: 0 }}>
                Da usare presto <span className="etichetta">{quanteRighe(presto)}</span>
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
            {NOME_LUOGO[l]} ({righePerLuogo.get(l) ?? 0})
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

      {aperto === 'scegli-foto' && <SceltaFoto aggiungi={() => setAperto('foto')} verifica={() => setAperto('verifica')} chiudi={() => setAperto(null)} />}
      {aperto === 'foto' && <FotoFrigo indice={indice} luogo={luogo} chiudi={() => setAperto(null)} />}
      {aperto === 'verifica' && <Verifica indice={indice} chiudi={() => setAperto(null)} />}
      {aperto === 'nuovo' && <NuovoLotto indice={indice} luogo={luogo} chiudi={() => setAperto(null)} />}
      {lotto && <SchedaLotto indice={indice} lotto={lotto} lotti={lotti} giorno={giorno} chiudi={() => setAperto(null)} />}
    </>
  );
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
              {NOME_LUOGO[l]} <span className="etichetta">{quanteRighe(qui)}</span>
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
  // Le confezioni uguali (stesso prodotto, posto e data) in una riga: «500 g × 2».
  const righe = useMemo(() => raggruppa(lotti), [lotti]);
  return (
    <ul className="elenco">
      {righe.map((g) => {
        const l = g.primo;
        const ing = indice.ingrediente(l.ingrediente_id);
        const posto = postoDelLotto(frigo, l);
        return (
          <li key={g.chiave}>
            <button className="voce" onClick={() => apri(l.id)} aria-label={`Apri ${l.nome ?? ing?.nome}`}>
              <span className="emoji" aria-hidden>
                <IconaCibo valore={iconaIngrediente(ing)} />
              </span>
              <span className="cresce">
                <strong>{l.nome ?? ing?.nome ?? 'Ingrediente sconosciuto'}</strong>
                {g.lotti.some((x) => x.in_attesa) && <span className="etichetta attesa" style={{ marginLeft: 8 }}>in invio</span>}
                <span className="tenue" style={{ display: 'block' }}>
                  {quantitaRiga(g)}
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
