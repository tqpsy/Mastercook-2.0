import { useEffect, useMemo, useRef, useState } from 'react';
import { righeAttive, useFamiglia, useStatoSync, useVista, type Vista } from '../dati/contesto';
import { useIndice } from '../dati/indice';
import type { Indice } from '../dominio/ricette';
import { oggi, piuGiorni } from '../dominio/scadenze';
import { type Acquisto, giorniScelti, periodoSpesa, prezziOsservati, quantitaVoce, type RigaAcquisto, totaleStimato, type VoceSpesa } from '../dominio/spesa';
import { formatta, formattaEuro, type PerNegozio, quantitaDaNegozio, UNITA_BASE } from '../dominio/unita';
import { FoglioSchedaProdotto } from '../ui/SchedaProdotto';
import { useLotti, useScorteAOcchio } from './Casa';
import { avvisoScorta, NOME_LIVELLO } from '../dominio/livello';
import { IconaCibo } from '../ui/IconaCibo';
import { iconaIngrediente } from '../dominio/iconeCibo';
import { Scontrino } from './Scontrino';
import { Speso } from './Speso';
import { GiorniSpesa, NelCarrello, descriviGiorni, piattiPerGiorno } from './spesa/Carrello';
import { NuovaVoce, RigaVoce, SchedaVoce, raggruppa } from './spesa/Voci';
import { ConfermaSpesa } from './spesa/ConfermaSpesa';
import { Acquisti, SchedaAcquisto } from './spesa/Acquisti';

/** Quanti giorni di menu guarda la lista. */
export const GIORNI_SPESA = 7;

export const numero = (x: unknown) => (x === null || x === undefined ? null : Number(x));

export function useDatiSpesa(vista: Vista) {
  const { voce_spesa, acquisto, acquisto_riga } = vista.righe;
  return useMemo(() => {
    const r = { voce_spesa, acquisto, acquisto_riga };
    const vive = <T,>(t: keyof typeof r) => (r[t] ?? []).filter((x) => !x.eliminato_il) as unknown as T[];
    const voci = vive<VoceSpesa>('voce_spesa').map((v) => ({
      ...v,
      quantita_richiesta: numero(v.quantita_richiesta),
      quantita_scelta: numero(v.quantita_scelta),
    }));
    const acquisti = vive<Acquisto>('acquisto').sort((a, b) => b.data.localeCompare(a.data) || String(b.id).localeCompare(String(a.id)));
    const righe = vive<RigaAcquisto>('acquisto_riga').map((x) => ({ ...x, quantita: numero(x.quantita), prezzo: numero(x.prezzo) }));
    return { voci, acquisti, righe, prezzi: prezziOsservati(acquisti, righe) };
  }, [voce_spesa, acquisto, acquisto_riga]);
}

export function nomeVoce(indice: Indice, v: Pick<VoceSpesa, 'ingrediente_id' | 'testo'>) {
  return v.ingrediente_id ? indice.nome(v.ingrediente_id) : (v.testo ?? 'Voce');
}

/** Peso di un pezzo e sottocategoria vengono dal catalogo; per gli ingredienti della famiglia non si sanno. */
export function perNegozio(indice: Indice, id: string | null): PerNegozio | undefined {
  if (!id) return undefined;
  const c = indice.catalogo.ingredienti.find((x) => x.id === id);
  if (c) return c;
  const i = indice.ingrediente(id);
  return i && { id, dimensione: i.dimensione, sottocategoria: null, peso_pz: null };
}

/** Nella lista, la quantità come si compra («1 testa», «2 pz»); quella esatta si vede aprendo la voce. */
export function quantitaNegozio(v: Pick<VoceSpesa, 'quantita_richiesta' | 'quantita_scelta' | 'unita' | 'tipo'>, ing?: PerNegozio) {
  const q = quantitaVoce(v);
  if (q == null || !v.unita) return null;
  // Una quantità scritta a mano resta com'è stata scritta; si arrotonda solo quella calcolata dal menu.
  return v.quantita_scelta != null || v.tipo !== 'derivata' ? formatta({ valore: q, unita: v.unita }) : quantitaDaNegozio({ valore: q, unita: v.unita }, ing);
}

export function Spesa() {
  const vista = useVista();
  const indice = useIndice(vista);
  const { esegui } = useFamiglia();
  const sync = useStatoSync();
  const { voci, acquisti, righe, prezzi } = useDatiSpesa(vista);
  const [aggiungi, setAggiungi] = useState(false);
  const [aperta, setAperta] = useState<string | null>(null);
  const [conferma, setConferma] = useState(false);
  const [acquistoAperto, setAcquistoAperto] = useState<string | null>(null);
  const [scontrino, setScontrino] = useState(false);
  const [scansiona, setScansiona] = useState(false);
  // L'ultimo prodotto scansionato: se ne guardano valori e ingredienti senza fermare la spesa.
  const [ultimo, setUltimo] = useState<{ codice: string; nome: string } | null>(null);
  const [dettagli, setDettagli] = useState(false);
  const dal = oggi();
  const finestra = useMemo(() => Array.from({ length: GIORNI_SPESA }, (_, i) => piuGiorni(dal, i)), [dal]);
  const famiglia = righeAttive(vista, 'famiglia')[0];
  const salvati = (famiglia?.impostazioni as { spesa_giorni?: unknown } | undefined)?.spesa_giorni;
  const scelti = useMemo(() => giorniScelti(finestra, salvati), [finestra, salvati]);
  const ricalcolata = useRef(false);
  const ricalcola = (giorni: string[]) => esegui('ricalcola_spesa', periodoSpesa(finestra, giorni));

  // All'apertura la lista si allinea al menu, per i giorni scelti (il calcolo lo fa il server: ripeterlo non crea doppioni).
  useEffect(() => {
    if (!vista.pronta || ricalcolata.current) return;
    ricalcolata.current = true;
    void esegui('ricalcola_spesa', periodoSpesa(finestra, scelti));
  }, [vista.pronta, esegui, finestra, scelti]);
  // La scheda resta montata anche quando non si vede (App.tsx): ogni volta che torna visibile la lista si riallinea.
  useEffect(
    () => () => {
      ricalcolata.current = false;
    },
    [],
  );

  // Ciò che una spesa o uno scontrino mette in casa esce subito dalla lista: si ricalcola dopo (ripeterlo non fa danni).
  const chiudiDopo = (chiudi: (aperto: boolean) => void) => () => {
    chiudi(false);
    void ricalcola(scelti);
  };

  if (!vista.pronta || !indice) return <p className="tenue">Sto caricando la spesa…</p>;
  const daComprare = voci.filter((v) => v.stato === 'da_acquistare');
  const carrello = voci.filter((v) => v.stato === 'nel_carrello');
  const totale = totaleStimato([...daComprare, ...carrello], prezzi);
  const inCoda = vista.coda.some((c) => c.comando.tipo === 'ricalcola_spesa' && c.stato === 'in_attesa');
  const reparti = raggruppa(indice, daComprare);
  const vocePerta = aperta ? voci.find((v) => v.id === aperta) : undefined;
  const acquisto = acquistoAperto ? acquisti.find((a) => a.id === acquistoAperto) : undefined;

  return (
    <>
      <div className="riga spazio" style={{ marginBottom: 4, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Lista della spesa</h2>
        <div className="riga">
          <button className="bottone piccolo" onClick={() => setScansiona(true)} aria-label="Scansiona un prodotto nel carrello">
            <span aria-hidden>📷</span> Scansiona
          </button>
          <button className="bottone primario piccolo" onClick={() => setAggiungi(true)}>
            + Aggiungi
          </button>
        </div>
      </div>
      {ultimo && (
        <div className="avviso info riga spazio" role="status" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span>
            <span aria-hidden>🛒</span> Nel carrello: <strong>{ultimo.nome}</strong>
          </span>
          <span className="riga">
            <button className="bottone piccolo" onClick={() => setDettagli(true)}>
              <span aria-hidden>📋</span> Valori e ingredienti
            </button>
            <button className="bottone piccolo" onClick={() => setUltimo(null)} aria-label="Chiudi l’avviso">
              ✕
            </button>
          </span>
        </div>
      )}
      <GiorniSpesa finestra={finestra} scelti={scelti} piatti={piattiPerGiorno(vista)} cambia={(g) => void ricalcola(g)} />
      <p className="tenue" style={{ marginTop: 4 }}>
        {descriviGiorni(finestra, scelti)}, tolto ciò che c’è già in casa.{' '}
        <button className="link" onClick={() => ricalcola(scelti)} disabled={inCoda}>
          {inCoda ? (sync.senza_rete ? 'Si aggiorna appena c’è rete' : 'Aggiorno…') : 'Aggiorna dal menu'}
        </button>
      </p>
      {totale.voci > 0 && (
        <div className="avanzamento" aria-live="polite">
          <progress max={totale.voci} value={carrello.length} aria-label="Voci nel carrello" />
          <p className="tenue">
            {carrello.length} di {totale.voci} nel carrello
            {totale.voci > totale.senzaPrezzo
              ? ` · circa ${formattaEuro(totale.euro)}${totale.senzaPrezzo ? ` (${totale.senzaPrezzo} senza prezzo)` : ''}`
              : ' · i prezzi arrivano dagli acquisti confermati'}
          </p>
        </div>
      )}

      {carrello.length > 0 && (
        <section className="scheda" aria-label="Nel carrello">
          <div className="riga spazio">
            <h3 style={{ margin: 0 }}>🛒 Nel carrello</h3>
            <button className="bottone primario piccolo" onClick={() => setConferma(true)}>
              Conferma la spesa
            </button>
          </div>
          <ul className="elenco">
            {carrello.map((v) => (
              <RigaVoce key={v.id} indice={indice} voce={v} prezzi={prezzi} apri={() => setAperta(v.id)} />
            ))}
          </ul>
          <p className="tenue" style={{ marginBottom: 0 }}>
            Ciò che è nel carrello entra in casa solo quando confermi la spesa.
          </p>
        </section>
      )}

      {daComprare.length === 0 ? (
        <div className="avviso info">{carrello.length ? 'Hai preso tutto.' : 'Niente da comprare: aggiungi piatti al menu o voci a mano.'}</div>
      ) : (
        reparti.map(([reparto, elenco]) => (
          <section key={reparto.id} className="scheda" aria-label={reparto.nome}>
            <h3 style={{ marginTop: 0 }}>
              <span aria-hidden>{reparto.emoji}</span> {reparto.nome}
            </h3>
            <ul className="elenco">
              {elenco.map((v) => (
                <RigaVoce key={v.id} indice={indice} voce={v} prezzi={prezzi} apri={() => setAperta(v.id)} />
              ))}
            </ul>
          </section>
        ))
      )}

      <StannoPerFinire indice={indice} voci={voci} />

      {carrello.length === 0 && (
        <button className="bottone pieno" onClick={() => setConferma(true)}>
          Registra una spesa senza lista
        </button>
      )}

      <button className="bottone pieno" style={{ marginTop: 8 }} onClick={() => setScontrino(true)}>
        <span aria-hidden>🧾</span> Aggiungi uno scontrino
      </button>

      <Speso vista={vista} indice={indice} acquisti={acquisti} righe={righe} />
      <Acquisti indice={indice} acquisti={acquisti} righe={righe} apri={setAcquistoAperto} />

      {aggiungi && <NuovaVoce indice={indice} chiudi={() => setAggiungi(false)} />}
      {vocePerta && <SchedaVoce indice={indice} voce={vocePerta} prezzi={prezzi} chiudi={() => setAperta(null)} />}
      {conferma && <ConfermaSpesa indice={indice} carrello={carrello} chiudi={chiudiDopo(setConferma)} />}
      {scontrino && <Scontrino indice={indice} chiudi={chiudiDopo(setScontrino)} />}
      {scansiona && <NelCarrello indice={indice} voci={voci} chiudi={() => setScansiona(false)} messo={setUltimo} />}
      {ultimo && dettagli && <FoglioSchedaProdotto codice={ultimo.codice} nome={ultimo.nome} chiudi={() => setDettagli(false)} />}
      {acquisto && <SchedaAcquisto indice={indice} acquisto={acquisto} righe={righe.filter((r) => r.acquisto_id === acquisto.id)} chiudi={() => setAcquistoAperto(null)} />}
    </>
  );
}

/**
 * Ciò che si usa a occhio e sta per finire (o ne resta poco), non ancora in lista: si aggiunge con un tocco.
 * Se il menu lo chiede, la lista lo mette già da sola quando sta per finire.
 */
function StannoPerFinire({ indice, voci }: { indice: Indice; voci: VoceSpesa[] }) {
  const { esegui } = useFamiglia();
  const lotti = useLotti();
  const scorte = useScorteAOcchio(indice);
  const inLista = new Set(voci.filter((v) => v.stato === 'da_acquistare' || v.stato === 'nel_carrello').map((v) => v.ingrediente_id));
  const visti = new Set<string>();
  const elenco = lotti.filter((l) => {
    if (!l.livello || visti.has(l.ingrediente_id) || inLista.has(l.ingrediente_id) || !avvisoScorta(scorte.get(l.ingrediente_id))) return false;
    visti.add(l.ingrediente_id);
    return true;
  });
  if (!elenco.length) return null;
  return (
    <section className="scheda" aria-label="Stanno per finire">
      <h3 style={{ marginTop: 0 }}>Stanno per finire</h3>
      <ul className="elenco">
        {elenco.map((l) => {
          const ing = indice.ingrediente(l.ingrediente_id);
          return (
            <li key={l.id} className="riga spazio">
              <span>
                <IconaCibo valore={iconaIngrediente(ing)} /> {indice.nome(l.ingrediente_id)} <span className="tenue">· {NOME_LIVELLO[scorte.get(l.ingrediente_id)?.livello ?? 'poco']}</span>
              </span>
              <button
                className="bottone piccolo"
                aria-label={`Aggiungi alla lista: ${indice.nome(l.ingrediente_id)}`}
                onClick={() => void esegui('aggiungi_voce', { id: crypto.randomUUID(), ingrediente_id: l.ingrediente_id, testo: null, quantita: null, unita: UNITA_BASE[ing?.dimensione ?? 'massa'] })}
              >
                + Lista
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
