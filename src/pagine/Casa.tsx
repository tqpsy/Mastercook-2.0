import { memo, useMemo, useState } from 'react';
import { IconaCibo } from '../ui/IconaCibo';
import { iconaIngrediente } from '../dominio/iconeCibo';
import { LUOGHI, NOME_LUOGO } from '../catalogo/tipi';
import type { RigaInVista } from '../dati/anteprima';
import { useFamiglia, useVista } from '../dati/contesto';
import { useCatalogo, useIndice } from '../dati/indice';
import { type Consiglio, postoDelLotto, postoIngrediente } from '../dominio/frigo';
import { useFrigo } from './MioFrigo';
import { ricettePerUrgenti } from '../dominio/consumi';
import type { Indice, Ingrediente } from '../dominio/ricette';
import { daUsarePresto, descriviData, type Luogo, oggi, piuGiorni, spreco, statoData, type TipoData } from '../dominio/scadenze';
import { formatta, type UnitaBase } from '../dominio/unita';
import { descriviLivello, eBasso, eLivello, LIVELLI, type Livello, type ScortaAOcchio, scorteAOcchio } from '../dominio/livello';
import { type ProdottoScansionato } from '../ui/CodiceProdotto';
import { chiediAOpenFoodFacts } from '../ui/openFoodFacts';
import { type SchedaProdotto, schedaVuota } from '../dominio/schedaProdotto';
import { FotoFrigo } from './FotoFrigo';
import { Verifica, VoceVerifica } from './Verifica';
import { useDatiMenu } from './Menu';
import { ColonneLuoghi, DaCompletare } from './casa/DaCompletare';
import { NuovoLotto } from './casa/NuovoLotto';
import { SchedaLotto } from './casa/SchedaLotto';

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
  // «Da usare presto» è chiusa di base: l'elenco e le ricette (calcolo pesante) si preparano solo quando si apre.
  const [prestoAperto, setPrestoAperto] = useState(false);
  const giorno = oggi();
  const presto = useMemo(() => daUsarePresto(lotti, giorno), [lotti, giorno]);
  const finendo = useMemo(() => lotti.filter(eBasso), [lotti]);
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
          <button key={l} role="tab" aria-selected={luogo === l} onClick={() => setLuogo(l)}>
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
  return postoIngrediente(frigo, { id: ing.id, reparto: ing.reparto, sottocategoria }, luogo);
}

export const ElencoLotti = memo(function ElencoLotti({
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
export async function schedaDelCodice(c: ProdottoScansionato): Promise<SchedaProdotto | undefined> {
  const pronta = c.scheda ?? c.prodotto?.scheda ?? undefined;
  if (pronta) return pronta;
  const attesa = new Promise<undefined>((r) => setTimeout(r, 2500));
  const scheda = (await Promise.race([chiediAOpenFoodFacts(c.codice), attesa]))?.scheda;
  return scheda && !schedaVuota(scheda) ? scheda : undefined;
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

export { quantitaDa } from './casa/NuovoLotto';
