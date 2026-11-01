import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { LUOGHI, NOME_LUOGO } from '../catalogo/tipi';
import { righeAttive, useFamiglia, useStatoSync, useVista, type Vista } from '../dati/contesto';
import { useIndice } from '../dati/indice';
import type { Indice, Ingrediente } from '../dominio/ricette';
import { type Luogo, oggi, piuGiorni } from '../dominio/scadenze';
import {
  type Acquisto,
  giorniScelti,
  type Osservazione,
  periodoSpesa,
  prezziOsservati,
  quantitaVoce,
  type RigaAcquisto,
  type RigaDaConfermare,
  righeDaConfermare,
  stimaPrezzo,
  totaleStimato,
  type VoceSpesa,
} from '../dominio/spesa';
import { formatta, formattaEuro, formattaGiorno, leggiNumero, type PerNegozio, quantitaDaNegozio, UNITA, type Unita, UNITA_BASE, unitaPer } from '../dominio/unita';
import { CercaIngrediente } from '../ui/CercaIngrediente';
import { Foglio } from '../ui/Foglio';
import { ScansionaProdotto } from '../ui/CodiceProdotto';
import { FoglioSchedaProdotto } from '../ui/SchedaProdotto';
import { quantitaDa } from './Casa';
import { Scontrino } from './Scontrino';

/** Quanti giorni di menu guarda la lista. */
export const GIORNI_SPESA = 7;

const numero = (x: unknown) => (x === null || x === undefined ? null : Number(x));

export function useDatiSpesa(vista: Vista) {
  const r = vista.righe;
  return useMemo(() => {
    const vive = <T,>(t: keyof typeof r) => (r[t] ?? []).filter((x) => !x.eliminato_il) as unknown as T[];
    const voci = vive<VoceSpesa>('voce_spesa').map((v) => ({
      ...v,
      quantita_richiesta: numero(v.quantita_richiesta),
      quantita_scelta: numero(v.quantita_scelta),
    }));
    const acquisti = vive<Acquisto>('acquisto').sort((a, b) => b.data.localeCompare(a.data) || String(b.id).localeCompare(String(a.id)));
    const righe = vive<RigaAcquisto>('acquisto_riga').map((x) => ({ ...x, quantita: numero(x.quantita), prezzo: numero(x.prezzo) }));
    return { voci, acquisti, righe, prezzi: prezziOsservati(acquisti, righe) };
  }, [r]);
}

function nomeVoce(indice: Indice, v: Pick<VoceSpesa, 'ingrediente_id' | 'testo'>) {
  return v.ingrediente_id ? indice.nome(v.ingrediente_id) : (v.testo ?? 'Voce');
}

/** Peso di un pezzo e sottocategoria vengono dal catalogo; per gli ingredienti della famiglia non si sanno. */
function perNegozio(indice: Indice, id: string | null): PerNegozio | undefined {
  if (!id) return undefined;
  const c = indice.catalogo.ingredienti.find((x) => x.id === id);
  if (c) return c;
  const i = indice.ingrediente(id);
  return i && { id, dimensione: i.dimensione, sottocategoria: null, peso_pz: null };
}

/** Nella lista, la quantità come si compra («1 testa», «2 pz»); quella esatta si vede aprendo la voce. */
function quantitaNegozio(v: Pick<VoceSpesa, 'quantita_richiesta' | 'quantita_scelta' | 'unita' | 'tipo'>, ing?: PerNegozio) {
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

      {carrello.length === 0 && (
        <button className="bottone pieno" onClick={() => setConferma(true)}>
          Registra una spesa senza lista
        </button>
      )}

      <button className="bottone pieno" style={{ marginTop: 8 }} onClick={() => setScontrino(true)}>
        <span aria-hidden>🧾</span> Aggiungi uno scontrino
      </button>

      <Acquisti indice={indice} acquisti={acquisti} righe={righe} apri={setAcquistoAperto} />

      {aggiungi && <NuovaVoce indice={indice} chiudi={() => setAggiungi(false)} />}
      {vocePerta && <SchedaVoce indice={indice} voce={vocePerta} prezzi={prezzi} chiudi={() => setAperta(null)} />}
      {conferma && <ConfermaSpesa indice={indice} carrello={carrello} chiudi={() => setConferma(false)} />}
      {scontrino && <Scontrino indice={indice} chiudi={() => setScontrino(false)} />}
      {scansiona && <NelCarrello indice={indice} voci={voci} chiudi={() => setScansiona(false)} messo={setUltimo} />}
      {ultimo && dettagli && <FoglioSchedaProdotto codice={ultimo.codice} nome={ultimo.nome} chiudi={() => setDettagli(false)} />}
      {acquisto && <SchedaAcquisto indice={indice} acquisto={acquisto} righe={righe.filter((r) => r.acquisto_id === acquisto.id)} chiudi={() => setAcquistoAperto(null)} />}
    </>
  );
}

/** Quanti piatti del menu ci sono per giorno (gli avanzi non contano: non si comprano). */
function piattiPerGiorno(vista: Vista): Map<string, number> {
  const conta = new Map<string, number>();
  for (const p of righeAttive(vista, 'portata')) {
    if (!p.ricetta_id || p.avanzo_di) continue;
    const g = String(p.data);
    conta.set(g, (conta.get(g) ?? 0) + 1);
  }
  return conta;
}

function descriviGiorni(finestra: string[], scelti: string[]): string {
  if (scelti.length === finestra.length) return `Per il menu da ${formattaGiorno(finestra[0])} a ${formattaGiorno(finestra[finestra.length - 1])}`;
  const nomi = scelti.map((g) => formattaGiorno(g));
  return `Solo per ${nomi.length === 1 ? nomi[0] : `${nomi.slice(0, -1).join(', ')} e ${nomi[nomi.length - 1]}`}`;
}

/**
 * Per quali giorni fare la spesa: anche con tutta la settimana nel menu si può comprare solo per i
 * prossimi giorni. La scelta vale per la famiglia; almeno un giorno resta sempre acceso.
 */
function GiorniSpesa({ finestra, scelti, piatti, cambia }: { finestra: string[]; scelti: string[]; piatti: Map<string, number>; cambia: (giorni: string[]) => void }) {
  const fino = (n: number) => finestra.slice(0, n);
  const uguale = (a: string[]) => a.length === scelti.length && a.every((g) => scelti.includes(g));
  const preimpostati = [
    { nome: 'Oggi', giorni: fino(1) },
    { nome: '3 giorni', giorni: fino(3) },
    { nome: 'Settimana', giorni: finestra },
  ];
  const suMisura = !preimpostati.some((p) => uguale(p.giorni));
  // Un solo selettore; i giorni uno per uno stanno in «Personalizza» (aperto da sé se la scelta è su misura).
  const [personalizza, setPersonalizza] = useState(suMisura);
  return (
    <div className="giorni-spesa">
      <div className="scelte segmenti larghi" role="group" aria-label="Spesa per i giorni">
        {preimpostati.map((p) => (
          <button key={p.nome} aria-pressed={!personalizza && uguale(p.giorni)} onClick={() => (setPersonalizza(false), cambia(p.giorni))}>
            {p.nome}
          </button>
        ))}
        <button aria-pressed={personalizza || suMisura} onClick={() => setPersonalizza(!personalizza)}>
          Personalizza
        </button>
      </div>
      {(personalizza || suMisura) && (
      <div className="scelte giorni" role="group" aria-label="Giorni della spesa">
        {finestra.map((g, i) => {
          const acceso = scelti.includes(g);
          const n = piatti.get(g) ?? 0;
          const [nome, numero] = formattaGiorno(g).split(' ');
          return (
            <button
              key={g}
              aria-pressed={acceso}
              aria-label={`${formattaGiorno(g)}, ${n === 1 ? '1 piatto' : `${n} piatti`}`}
              disabled={acceso && scelti.length === 1}
              onClick={() => cambia(acceso ? scelti.filter((x) => x !== g) : [...scelti, g])}
            >
              <span>{i === 0 ? 'oggi' : nome}</span>
              <strong>{numero}</strong>
              <small aria-hidden>{n ? '•'.repeat(Math.min(n, 4)) : '—'}</small>
            </button>
          );
        })}
      </div>
      )}
    </div>
  );
}

/**
 * Un prodotto scansionato al supermercato va nel carrello: la voce della lista se c'è, altrimenti una
 * voce nuova. Un codice nuovo si ricorda per la famiglia, con la confezione se la si conosce già.
 */
function NelCarrello({
  indice,
  voci,
  chiudi,
  messo,
}: {
  indice: Indice;
  voci: VoceSpesa[];
  chiudi: () => void;
  messo: (p: { codice: string; nome: string }) => void;
}) {
  const { esegui } = useFamiglia();
  return (
    <ScansionaProdotto
      indice={indice}
      chiudi={chiudi}
      trovato={async ({ codice, ingrediente, prodotto, esterno }) => {
        chiudi();
        messo({ codice, nome: prodotto?.nome ?? esterno?.nome ?? ingrediente.nome });
        if (!prodotto) {
          const f = esterno?.formato?.unita === UNITA_BASE[ingrediente.dimensione] ? esterno.formato : undefined;
          prodotto = { id: crypto.randomUUID(), codice, ingrediente_id: ingrediente.id, nome: esterno?.nome ?? null, quantita: f?.quantita ?? null, unita: f?.unita ?? null };
          await esegui('salva_prodotto', prodotto as unknown as Record<string, unknown>);
        }
        // Solo una voce nella stessa unità: 10 capsule non sono «caffè, 250 g».
        const voce = voci.find(
          (v) => v.stato === 'da_acquistare' && v.ingrediente_id && (v.unita == null || v.unita === UNITA_BASE[ingrediente.dimensione]) && indice.antenati(ingrediente.id).includes(v.ingrediente_id),
        );
        if (voce) return void (await esegui('imposta_stato_voce', { id: voce.id, stato: 'nel_carrello' }));
        const id = crypto.randomUUID();
        const formato = prodotto?.quantita && prodotto.unita ? { quantita: prodotto.quantita, unita: prodotto.unita } : {};
        await esegui('aggiungi_voce', { id, ingrediente_id: ingrediente.id, ...formato });
        await esegui('imposta_stato_voce', { id, stato: 'nel_carrello' });
      }}
    />
  );
}

/** Le voci per reparto del negozio, nell'ordine del catalogo; le voci senza ingrediente in fondo. */
function raggruppa(indice: Indice, voci: VoceSpesa[]) {
  const altro = { id: 'altro', nome: 'Altro', emoji: '🛍️' };
  const gruppi = new Map<string, VoceSpesa[]>();
  for (const v of voci) {
    const r = (v.ingrediente_id && indice.ingrediente(v.ingrediente_id)?.reparto) || 'altro';
    gruppi.set(r, [...(gruppi.get(r) ?? []), v]);
  }
  const ordine = [...indice.catalogo.reparti.filter((r) => r.id !== 'altro'), altro];
  return ordine
    .filter((r) => gruppi.has(r.id))
    .map((r) => [r, (gruppi.get(r.id) ?? []).sort((a, b) => nomeVoce(indice, a).localeCompare(nomeVoce(indice, b)))] as const);
}

function RigaVoce({ indice, voce: v, prezzi, apri }: { indice: Indice; voce: VoceSpesa; prezzi: Map<string, Osservazione[]>; apri: () => void }) {
  const { esegui } = useFamiglia();
  const nome = nomeVoce(indice, v);
  const nelCarrello = v.stato === 'nel_carrello';
  const prezzo = v.ingrediente_id ? stimaPrezzo(prezzi.get(v.ingrediente_id), quantitaVoce(v)) : null;
  const ing = v.ingrediente_id ? indice.ingrediente(v.ingrediente_id) : undefined;
  return (
    <li className="riga">
      <input
        type="checkbox"
        className="spunta"
        checked={nelCarrello}
        aria-label={nelCarrello ? `Togli ${nome} dal carrello` : `Metti ${nome} nel carrello`}
        onChange={() => esegui('imposta_stato_voce', { id: v.id, stato: nelCarrello ? 'da_acquistare' : 'nel_carrello' })}
      />
      <button className="voce cresce" onClick={apri} aria-label={`Apri ${nome}`}>
        <span aria-hidden>{ing?.emoji ?? '🛍️'}</span>
        <span className="cresce">
          <span style={nelCarrello ? { textDecoration: 'line-through' } : undefined}>{nome}</span>
          <span className="tenue" style={{ display: 'block', fontSize: '0.85rem' }}>
            {[quantitaNegozio(v, perNegozio(indice, v.ingrediente_id)), v.tipo === 'manuale' && 'aggiunta a mano', v.nota, prezzo && `~${formattaEuro(prezzo.euro)}`, v.in_attesa && 'in invio'].filter(Boolean).join(' · ')}
          </span>
        </span>
        {v.non_piu_necessaria && <span className="etichetta avviso-data">non più necessaria</span>}
      </button>
    </li>
  );
}

function NuovaVoce({ indice, chiudi }: { indice: Indice; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const [ing, setIng] = useState<Ingrediente | null>(null);
  const [testo, setTesto] = useState<string | null>(null);
  const [numero, setNumero] = useState('');
  const [unita, setUnita] = useState<Unita>('g');
  const [errore, setErrore] = useState<string | null>(null);

  async function salva(e: FormEvent) {
    e.preventDefault();
    let q: { valore: number; unita: string } | null = null;
    if (numero.trim()) {
      const x = quantitaDa(numero, unita, ing ?? undefined);
      if (typeof x === 'string') return setErrore(x);
      q = x;
    }
    await esegui('aggiungi_voce', {
      id: crypto.randomUUID(),
      ingrediente_id: ing?.id ?? null,
      testo: ing ? null : testo,
      quantita: ing ? (q?.valore ?? null) : null,
      unita: ing ? (q?.unita ?? UNITA_BASE[ing.dimensione]) : null,
    });
    chiudi();
  }

  return (
    <Foglio titolo="Aggiungi alla lista" chiudi={chiudi}>
      {!ing && testo === null ? (
        <>
          <CercaIngrediente
            indice={indice}
            etichetta="Cosa serve?"
            autoFocus
            scegli={(i) => {
              setIng(i);
              setUnita(UNITA_BASE[i.dimensione]);
            }}
          />
          <button className="bottone piccolo" onClick={() => setTesto('')}>
            ✏️ Scrivi qualcosa che non è un alimento
          </button>
        </>
      ) : (
        <form onSubmit={salva} noValidate>
          {ing ? (
            <>
              <div className="riga spazio">
                <strong>
                  {ing.emoji} {ing.nome}
                </strong>
                <button type="button" className="bottone piccolo" onClick={() => setIng(null)}>
                  Cambia
                </button>
              </div>
              <div className="riga" style={{ alignItems: 'flex-end', marginTop: 12 }}>
                <label className="campo cresce">
                  <span>Quantità (facoltativa)</span>
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
            </>
          ) : (
            <label className="campo">
              <span>Cosa</span>
              <input value={testo ?? ''} onChange={(e) => setTesto(e.target.value)} maxLength={120} placeholder="Detersivo, pile, tovaglioli…" autoFocus required />
            </label>
          )}
          {errore && <div className="avviso errore">{errore}</div>}
          <button className="bottone primario pieno" disabled={!ing && !testo?.trim()}>
            Aggiungi
          </button>
        </form>
      )}
    </Foglio>
  );
}

function SchedaVoce({ indice, voce: v, prezzi, chiudi }: { indice: Indice; voce: VoceSpesa; prezzi: Map<string, Osservazione[]>; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const ing = v.ingrediente_id ? indice.ingrediente(v.ingrediente_id) : undefined;
  const [numero, setNumero] = useState(() => String(quantitaVoce(v) ?? '').replace('.', ','));
  const [nota, setNota] = useState(v.nota ?? '');
  const [errore, setErrore] = useState<string | null>(null);
  const prezzo = v.ingrediente_id ? stimaPrezzo(prezzi.get(v.ingrediente_id), quantitaVoce(v)) : null;

  async function salva(e: FormEvent) {
    e.preventDefault();
    const campi: Record<string, unknown> = {};
    if (ing && v.unita) {
      const n = numero.trim() ? leggiNumero(numero) : null;
      if (numero.trim() && (n === null || n <= 0)) return setErrore('Scrivi una quantità, per esempio 500 o 1,5.');
      if (n !== quantitaVoce(v)) campi[v.tipo === 'derivata' ? 'quantita_scelta' : 'quantita_richiesta'] = n;
    }
    if ((nota.trim() || null) !== v.nota) campi.nota = nota.trim() || null;
    if (Object.keys(campi).length) await esegui('modifica_voce', { id: v.id, versione_attesa: v.versione ?? 1, campi });
    chiudi();
  }

  return (
    <Foglio titolo={nomeVoce(indice, v)} chiudi={chiudi}>
      <p className="tenue" style={{ marginTop: 0 }}>
        {v.tipo === 'derivata' ? `Dal menu${v.quantita_richiesta != null && v.unita ? `: servono ${formatta({ valore: v.quantita_richiesta, unita: v.unita })}` : ''}` : 'Aggiunta a mano'}
        {prezzo && ` · circa ${formattaEuro(prezzo.euro)} (stima dai prezzi fino al ${formattaGiorno(prezzo.dal)})`}
      </p>
      {v.non_piu_necessaria && <div className="avviso info">Il menu è cambiato e questa voce non serve più. Puoi toglierla o tenerla.</div>}
      <form onSubmit={salva} noValidate>
        {ing && v.unita && (
          <label className="campo">
            <span>Quantità ({UNITA[v.unita].nome})</span>
            <input inputMode="decimal" value={numero} onChange={(e) => setNumero(e.target.value)} />
          </label>
        )}
        <label className="campo">
          <span>Nota</span>
          <input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} placeholder="Marca, formato…" />
        </label>
        {errore && <div className="avviso errore">{errore}</div>}
        <button className="bottone primario pieno">Salva</button>
      </form>
      <button
        className="bottone pericolo pieno"
        style={{ marginTop: 8 }}
        onClick={async () => {
          await esegui('imposta_stato_voce', { id: v.id, stato: 'rimossa' });
          chiudi();
        }}
      >
        Togli dalla lista
      </button>
    </Foglio>
  );
}

/** Conferma della spesa: due tocchi dal carrello («Conferma la spesa», poi «Conferma»). */
function ConfermaSpesa({ indice, carrello, chiudi }: { indice: Indice; carrello: VoceSpesa[]; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const giorno = oggi();
  const [righe, setRighe] = useState<(RigaDaConfermare & { numero: string; euro: string })[]>(() =>
    righeDaConfermare(carrello, (id) => indice.ingrediente(id), giorno, () => crypto.randomUUID()).map((r) => ({
      ...r,
      numero: r.quantita == null ? '' : String(r.quantita).replace('.', ','),
      euro: '',
    })),
  );
  const [negozio, setNegozio] = useState('');
  const [nuova, setNuova] = useState(false);
  const [nonPresi, setNonPresi] = useState<Set<string>>(() => new Set());
  // Una spunta appena data può arrivare un attimo dopo l'apertura: le voci entrate nel carrello si aggiungono.
  const mancanti = carrello.filter((v) => !nonPresi.has(v.id) && !righe.some((r) => r.voce_id === v.id));
  if (mancanti.length) {
    setRighe([
      ...righe,
      ...righeDaConfermare(mancanti, (id) => indice.ingrediente(id), giorno, () => crypto.randomUUID()).map((r) => ({
        ...r,
        numero: r.quantita == null ? '' : String(r.quantita).replace('.', ','),
        euro: '',
      })),
    ]);
  }
  const [errore, setErrore] = useState<string | null>(null);
  const cambia = (i: number, x: Partial<(typeof righe)[number]>) => setRighe(righe.map((r, j) => (j === i ? { ...r, ...x } : r)));

  async function conferma() {
    const pronte: Record<string, unknown>[] = [];
    for (const r of righe) {
      const nome = r.ingrediente_id ? indice.nome(r.ingrediente_id) : r.nome;
      const q = r.ingrediente_id ? leggiNumero(r.numero) : null;
      if (r.ingrediente_id && (q === null || q <= 0)) return setErrore(`Scrivi quanto ${nome} hai comprato.`);
      const prezzo = r.euro.trim() ? leggiNumero(r.euro) : null;
      if (r.euro.trim() && prezzo === null) return setErrore(`Il prezzo di ${nome} non è un numero.`);
      const riga: Record<string, unknown> = { ...r, quantita: q, prezzo };
      delete riga.numero;
      delete riga.euro;
      pronte.push(riga);
    }
    if (!pronte.length) return setErrore('Non c’è niente da confermare.');
    await esegui('conferma_acquisto', {
      id: crypto.randomUUID(),
      fonte: righe.some((r) => r.voce_id) ? 'carrello' : 'manuale',
      data: giorno,
      negozio: negozio.trim() || null,
      righe: pronte,
    });
    chiudi();
  }

  return (
    <Foglio titolo="Conferma la spesa" chiudi={chiudi}>
      <p className="tenue" style={{ marginTop: 0 }}>
        Controlla le quantità comprate. Il prezzo è facoltativo; le date di scadenza le puoi scrivere dopo, nella casa.
      </p>
      <ul className="elenco">
        {righe.map((r, i) => {
          const ing = r.ingrediente_id ? indice.ingrediente(r.ingrediente_id) : undefined;
          const nome = ing?.nome ?? r.nome ?? 'Voce';
          return (
            <li key={r.id}>
              <div className="riga spazio">
                <strong>
                  {ing?.emoji ?? '🛍️'} {nome}
                </strong>
                <button className="bottone piccolo" aria-label={`Non l’ho preso: ${nome}`} onClick={() => {
                    if (r.voce_id) setNonPresi(new Set([...nonPresi, r.voce_id]));
                    setRighe(righe.filter((_, j) => j !== i));
                  }}
                >
                  Non preso
                </button>
              </div>
              <div className="riga" style={{ flexWrap: 'wrap', marginTop: 6 }}>
                {ing && r.unita && (
                  <label className="riga">
                    <input className="dato" inputMode="decimal" aria-label={`Quantità di ${nome}`} value={r.numero} onChange={(e) => cambia(i, { numero: e.target.value })} style={{ width: 90 }} />
                    <span>{r.unita}</span>
                  </label>
                )}
                <label className="riga">
                  <input className="dato" inputMode="decimal" aria-label={`Prezzo di ${nome}`} value={r.euro} onChange={(e) => cambia(i, { euro: e.target.value })} placeholder="€" style={{ width: 80 }} />
                  <span>€</span>
                </label>
                {ing && (
                  <select className="dato" aria-label={`Dove va ${nome}`} value={r.luogo} onChange={(e) => cambia(i, { luogo: e.target.value as Luogo })} style={{ width: 'auto' }}>
                    {LUOGHI.map((l) => (
                      <option key={l} value={l}>
                        {NOME_LUOGO[l]}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {nuova ? (
        <CercaIngrediente
          indice={indice}
          etichetta="Cos’altro hai comprato?"
          autoFocus
          scegli={(ing) => {
            setRighe([
              ...righe,
              {
                ...righeDaConfermare(
                  [{ id: '', tipo: 'manuale', ingrediente_id: ing.id, testo: null, unita: UNITA_BASE[ing.dimensione], quantita_richiesta: null, quantita_scelta: null, stato: 'nel_carrello', non_piu_necessaria: false, nota: null }],
                  (id) => indice.ingrediente(id),
                  giorno,
                  () => crypto.randomUUID(),
                )[0],
                voce_id: null,
                numero: '',
                euro: '',
              },
            ]);
            setNuova(false);
          }}
        />
      ) : (
        <button className="bottone piccolo" style={{ marginTop: 8 }} onClick={() => setNuova(true)}>
          + Altro comprato
        </button>
      )}
      <label className="campo" style={{ marginTop: 12 }}>
        <span>Negozio (facoltativo)</span>
        <input value={negozio} onChange={(e) => setNegozio(e.target.value)} maxLength={80} />
      </label>
      {errore && <div className="avviso errore">{errore}</div>}
      <button className="bottone primario pieno" onClick={conferma}>
        Conferma
      </button>
    </Foglio>
  );
}

function Acquisti({ indice, acquisti, righe, apri }: { indice: Indice; acquisti: Acquisto[]; righe: RigaAcquisto[]; apri: (id: string) => void }) {
  if (!acquisti.length) return null;
  return (
    <section className="scheda" aria-label="Acquisti recenti" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Acquisti recenti</h3>
      <ul className="elenco">
        {acquisti.slice(0, 10).map((a) => {
          const sue = righe.filter((r) => r.acquisto_id === a.id);
          const totale = sue.reduce((s, r) => s + (r.prezzo ?? 0), 0);
          const titolo = `${formattaGiorno(a.data)}${a.negozio ? ` · ${a.negozio}` : ''}`;
          return (
            <li key={a.id}>
              <button className="voce" onClick={() => apri(a.id)} aria-label={`Apri l’acquisto di ${titolo}`}>
                <span className="cresce">
                  <strong>{titolo}</strong>
                  <span className="tenue" style={{ display: 'block', fontSize: '0.85rem' }}>
                    {[
                      sue.length === 1 ? '1 riga' : `${sue.length} righe`,
                      sue
                        .slice(0, 3)
                        .map((r) => (r.ingrediente_id ? indice.nome(r.ingrediente_id) : r.nome))
                        .join(', '),
                      totale > 0 && formattaEuro(totale),
                      a.in_attesa && 'in invio',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {a.stato === 'annullato' && <span className="etichetta">annullato</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SchedaAcquisto({ indice, acquisto: a, righe, chiudi }: { indice: Indice; acquisto: Acquisto; righe: RigaAcquisto[]; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const annullato = a.stato === 'annullato';
  return (
    <Foglio titolo={`Spesa di ${formattaGiorno(a.data)}`} chiudi={chiudi}>
      <p className="tenue" style={{ marginTop: 0 }}>
        {[a.negozio, a.fonte === 'carrello' ? 'dal carrello' : a.fonte === 'scontrino' ? 'dallo scontrino' : 'registrata a mano', annullato && 'annullata: le quantità sono state tolte dalla casa'].filter(Boolean).join(' · ')}
      </p>
      <ul className="elenco">
        {righe.map((r) => (
          <RigaComprata key={r.id} indice={indice} riga={r} modificabile={!annullato} />
        ))}
      </ul>
      {!annullato && (
        <button
          className="bottone pericolo pieno"
          style={{ marginTop: 12 }}
          onClick={async () => {
            if (!window.confirm('Annullare questo acquisto? Le quantità verranno tolte dalla casa; la cronologia resta.')) return;
            await esegui('annulla_acquisto', { id: a.id });
            chiudi();
          }}
        >
          Annulla l’acquisto
        </button>
      )}
    </Foglio>
  );
}

function RigaComprata({ indice, riga: r, modificabile }: { indice: Indice; riga: RigaAcquisto; modificabile: boolean }) {
  const { esegui } = useFamiglia();
  const [numero, setNumero] = useState(r.quantita == null ? '' : String(r.quantita).replace('.', ','));
  const [euro, setEuro] = useState(r.prezzo == null ? '' : String(r.prezzo).replace('.', ','));
  const [errore, setErrore] = useState<string | null>(null);
  const nome = r.ingrediente_id ? indice.nome(r.ingrediente_id) : (r.nome ?? 'Voce');
  const q = r.ingrediente_id ? leggiNumero(numero) : null;
  const p = euro.trim() ? leggiNumero(euro) : null;
  const cambiata = (r.ingrediente_id && q !== r.quantita) || p !== r.prezzo;

  async function salva(e: FormEvent) {
    e.preventDefault();
    if (r.ingrediente_id && (q === null || q <= 0)) return setErrore('Scrivi una quantità.');
    if (euro.trim() && p === null) return setErrore('Il prezzo non è un numero.');
    setErrore(null);
    await esegui('correggi_riga_acquisto', {
      id: r.id,
      ...(r.ingrediente_id && q !== r.quantita ? { quantita_vista: r.quantita, quantita_nuova: q } : {}),
      ...(p !== r.prezzo ? { prezzo: p } : {}),
    });
  }

  return (
    <li>
      <form onSubmit={salva} className="riga" style={{ flexWrap: 'wrap' }}>
        <strong className="cresce">{nome}</strong>
        {r.ingrediente_id && r.unita && (
          <label className="riga">
            <input className="dato" inputMode="decimal" aria-label={`Quantità di ${nome}`} value={numero} onChange={(e) => setNumero(e.target.value)} disabled={!modificabile} style={{ width: 90 }} />
            <span>{r.unita}</span>
          </label>
        )}
        <label className="riga">
          <input className="dato" inputMode="decimal" aria-label={`Prezzo di ${nome}`} value={euro} onChange={(e) => setEuro(e.target.value)} disabled={!modificabile} placeholder="€" style={{ width: 80 }} />
          <span>€</span>
        </label>
        {modificabile && cambiata && <button className="bottone primario piccolo">Correggi</button>}
      </form>
      {!r.ingrediente_id && <p className="tenue" style={{ margin: '4px 0 0' }}>Non è un alimento: non va in casa.</p>}
      {errore && <div className="avviso errore">{errore}</div>}
    </li>
  );
}
