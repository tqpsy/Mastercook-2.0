import { type ReactNode, useMemo, useState } from 'react';
import { IconaCibo } from '../ui/IconaCibo';
import { iconaIngrediente } from '../dominio/iconeCibo';
import { useFamiglia, useVista, type Vista } from '../dati/contesto';
import { avanziDi, type ConfermaPasto as Conferma, type Consumo, type EsitoPasto, giorniAvanzo, NOME_ESITO, porzioniPortata, previstoPortata } from '../dominio/consumi';
import type { PortataMenu } from '../dominio/menu';
import { iconaRicetta, type Indice, normalizza, type Ricetta } from '../dominio/ricette';
import { oggi, piuGiorni } from '../dominio/scadenze';
import { formatta, formattaGiorno, leggiNumero } from '../dominio/unita';
import { Foglio } from '../ui/Foglio';
import { usePronti } from './Cucinato';
import type { DatiMenu } from './Menu';
import { useIcone } from './Ricette';

const numero = (x: unknown) => (x === null || x === undefined ? null : Number(x));

/** Le conferme dei pasti e le righe di consumo, come le vede l'app. */
export function useConferme(vista: Vista) {
  const r = vista.righe;
  return useMemo(() => {
    const conferme = (r.conferma_pasto ?? [])
      .filter((c) => !c.eliminato_il)
      .map((c) => ({ ...(c as unknown as Conferma), porzioni: numero(c.porzioni), revisione: Number(c.revisione) }));
    const righe = (r.consumo_riga ?? [])
      .filter((c) => !c.eliminato_il)
      .map((c) => ({
        conferma_id: String(c.conferma_id),
        ingrediente_id: String(c.ingrediente_id),
        unita: c.unita as Consumo['unita'],
        prevista: numero(c.quantita_prevista),
        usata: Number(c.quantita_usata),
      }));
    return { conferme, righe, attive: new Map(conferme.filter((c) => c.attiva).map((c) => [c.portata_id, c])) };
  }, [r]);
}

/** L'avanzo da mettere in casa: in frigo con la data stimata dalla regola dei cotti, se c'è; altrimenti da scrivere. */
export function lottoAvanzo(nome: string, quantita: number, luogo: 'frigo' | 'freezer', giorni: number | null) {
  const stimata = luogo === 'frigo' && giorni !== null;
  return {
    lotto_id: crypto.randomUUID(),
    nome: nome.slice(0, 120) || 'Avanzo',
    quantita,
    luogo,
    ...(stimata
      ? { tipo_data: 'stimata', data_limite: piuGiorni(oggi(), giorni), fonte_data: 'app', calcolata_il: new Date().toISOString(), affidabilita: 'bassa' }
      : { tipo_data: 'sconosciuta' }),
  };
}

export const testoNumero = (n: number) => String(n).replace('.', ',');

/** Quante porzioni: − e + di una porzione, oppure si scrive (anche mezze, «1,5»). `grande`: al centro del foglio. */
export function PorzioniAvanzate({
  valore,
  cambia,
  piatto,
  nome = 'Porzioni avanzate',
  grande,
}: {
  valore: string;
  cambia: (v: string) => void;
  piatto?: string;
  nome?: string;
  grande?: boolean;
}) {
  const di = piatto ? `: ${piatto}` : '';
  const etichetta = `${nome}${di}`;
  const n = leggiNumero(valore) ?? 0;
  const passo = (d: number) => cambia(testoNumero(Math.max(0, Math.round((n + d) * 2) / 2)));
  return (
    <span className={`porzioni-contatore${grande ? ' grande' : ''}`}>
      <button type="button" className="bottone tondo" aria-label={`Una porzione in meno${di}`} disabled={n <= 0} onClick={() => passo(-1)}>
        −
      </button>
      <input className="dato" inputMode="decimal" aria-label={etichetta} value={valore} onChange={(e) => cambia(e.target.value)} onFocus={(e) => e.target.select()} />
      <button type="button" className="bottone tondo piu" aria-label={`Una porzione in più${di}`} onClick={() => passo(1)}>
        +
      </button>
    </span>
  );
}

/** Frigo o freezer: due riquadri grandi, con sotto fino a quando si tiene. */
export function SceltaLuogo({
  luogo,
  cambia,
  frigo,
  freezer,
  consigliato,
  etichetta = 'Dove va l’avanzo',
}: {
  luogo: 'frigo' | 'freezer';
  cambia: (l: 'frigo' | 'freezer') => void;
  frigo?: string;
  freezer?: string;
  consigliato?: 'frigo' | 'freezer';
  etichetta?: string;
}) {
  const voci = [
    { id: 'frigo', icona: '🧊', nome: 'In frigo', dettaglio: frigo },
    { id: 'freezer', icona: '❄️', nome: 'In freezer', dettaglio: freezer ?? 'fino a 3 mesi' },
  ] as const;
  return (
    <div className="scelta-luogo" role="radiogroup" aria-label={etichetta}>
      {voci.map((v) => (
        <button key={v.id} type="button" role="radio" aria-checked={luogo === v.id} aria-pressed={luogo === v.id} aria-label={v.nome} onClick={() => cambia(v.id)}>
          <span className="icona-luogo" aria-hidden>
            {v.icona}
          </span>
          <span className="nome-luogo">{v.nome}</span>
          {v.dettaglio && <span className="dettaglio-luogo">{v.dettaglio}</span>}
          {consigliato === v.id && <span className="consigliato">Consigliato</span>}
        </button>
      ))}
    </div>
  );
}

/** Il piatto in testa a un foglio: icona nel tondo, nome e una riga sotto. */
export function TestaPiatto({ icona, titolo, sotto }: { icona?: string; titolo: string; sotto?: ReactNode }) {
  return (
    <div className="testa-piatto">
      <span className="tondo-piatto" aria-hidden>
        <IconaCibo valore={icona ?? '🍽️'} />
      </span>
      <span className="cresce">
        <strong>{titolo}</strong>
        {sotto && <span className="tenue piccolo">{sotto}</span>}
      </span>
    </div>
  );
}

const STIMA = (giorni: number) => `da mangiare entro ${giorni === 1 ? 'domani' : `${giorni} giorni`} (stima, controlla sempre)`;

/** L'icona di un piatto del menu: la ricetta (con l'icona scelta dalla famiglia) o l'avanzo del piatto di prima. */
function iconaPortata(indice: Indice, icone: Map<string, string>, p: PortataMenu, tutte: PortataMenu[]) {
  const id = p.ricetta_id ?? (p.avanzo_di ? tutte.find((x) => x.id === p.avanzo_di)?.ricetta_id : null);
  const r = id ? indice.perId.get(id) : undefined;
  return r ? iconaRicetta(indice, r, icone.get(r.id)) : '🍽️';
}

/**
 * «✓ Mangiato»: prima di confermare chiede se è avanzato qualcosa e quante porzioni, piatto per piatto.
 * Gli avanzi vanno in Casa (e in «Da usare presto»). Se il piatto durava più giorni, propone le porzioni messe
 * nel menu dei giorni dopo; con 0 non resta niente in casa. Si conferma tutto «come previsto».
 */
export function SegnaMangiato({
  indice,
  dati,
  portate,
  titolo,
  altro,
  chiudi,
}: {
  indice: Indice;
  dati: DatiMenu;
  portate: PortataMenu[];
  titolo: (p: PortataMenu) => string;
  /** Per un piatto solo: apre le altre domande (quantità diverse, altro piatto, saltato). */
  altro?: (esito: EsitoPasto) => void;
  chiudi: () => void;
}) {
  const { esegui } = useFamiglia();
  const pronti = usePronti();
  const icone = useIcone();
  const piatti = useMemo(
    () =>
      portate.map((p) => {
        const pronto = pronti.get(p.id);
        // Cucinato in anticipo: avanza quel che resta del piatto pronto dopo questo pasto.
        const perDopo = pronto
          ? Math.max(0, pronto.quantita - porzioniPortata(p, dati.persone, dati.eccezioni, dati.ospiti))
          : avanziDi(p, dati.portate).reduce((t, a) => t + porzioniPortata(a, dati.persone, dati.eccezioni, dati.ospiti), 0);
        const origine = p.avanzo_di ? dati.portate.find((x) => x.id === p.avanzo_di) : undefined;
        const ricettaId = p.ricetta_id ?? origine?.ricetta_id;
        return {
          p,
          titolo: titolo(p),
          icona: iconaPortata(indice, icone, p, dati.portate),
          mangiano: porzioniPortata(p, dati.persone, dati.eccezioni, dati.ospiti),
          perDopo,
          pronto,
          giorni: giorniAvanzo(ricettaId ? indice.perId.get(ricettaId) : null, indice.catalogo.regole_cotti),
        };
      }),
    [portate, dati, indice, titolo, pronti, icone],
  );
  const [quante, setQuante] = useState<Record<string, string>>(() => Object.fromEntries(piatti.map((x) => [x.p.id, testoNumero(Math.round(x.perDopo * 2) / 2)])));
  const [luogo, setLuogo] = useState<'frigo' | 'freezer'>('frigo');
  const [errore, setErrore] = useState<string | null>(null);
  const valori = piatti.map((x) => ({ ...x, q: leggiNumero(quante[x.p.id] ?? '') }));
  const totale = valori.reduce((t, x) => t + (x.q && x.q > 0 ? x.q : 0), 0);
  const uno = valori.length === 1;

  async function conferma() {
    const sbagliato = valori.find((x) => x.q === null || x.q < 0);
    if (sbagliato) return setErrore(`Scrivi quante porzioni di ${sbagliato.titolo} sono avanzate (anche 0).`);
    for (const x of valori) {
      await esegui('conferma_pasto', {
        id: crypto.randomUUID(),
        portata_id: x.p.id,
        esito: 'come_previsto',
        // Sempre detto: 0 vuol dire finito tutto, anche per un piatto che durava più giorni.
        avanzi: x.q! > 0 ? [lottoAvanzo(x.titolo, x.q!, luogo, x.giorni)] : [],
      });
    }
    chiudi();
  }

  const unaStima = valori.find((x) => x.q && x.q > 0 && x.giorni !== null);
  const nota = (x: (typeof valori)[number]) =>
    x.pronto
      ? `🍳 Cucinato: in ${x.pronto.luogo} ce ne sono ${testoNumero(x.pronto.quantita)}`
      : x.perDopo > 0
        ? `Nel menu dei giorni dopo ne avete messe ${testoNumero(x.perDopo)}`
        : `${testoNumero(x.mangiano)} ${x.mangiano === 1 ? 'porzione' : 'porzioni'} a tavola`;
  return (
    <Foglio titolo="È avanzato qualcosa?" chiudi={chiudi}>
      <ul className={`avanzi-mangiato${uno ? ' uno' : ''}`} aria-label="Porzioni avanzate">
        {valori.map((x) => (
          <li key={x.p.id}>
            <TestaPiatto icona={x.icona} titolo={x.titolo} sotto={nota(x)} />
            <div className="porzioni-blocco">
              <PorzioniAvanzate grande={uno} piatto={x.titolo} valore={quante[x.p.id] ?? ''} cambia={(v) => setQuante({ ...quante, [x.p.id]: v })} />
              {uno && <span className="tenue piccolo">{x.q ? (x.q === 1 ? 'porzione avanzata' : 'porzioni avanzate') : 'finito tutto'}</span>}
            </div>
          </li>
        ))}
      </ul>
      {totale > 0 && (
        <div className="campo">
          <span>Dove le metti?</span>
          <SceltaLuogo
            luogo={luogo}
            cambia={setLuogo}
            frigo={unaStima ? `entro ${formattaGiorno(piuGiorni(oggi(), unaStima.giorni!))}` : 'data da scrivere'}
          />
          <p className="tenue piccolo" style={{ margin: '8px 0 0' }}>
            {luogo === 'frigo' && unaStima ? `In frigo: ${STIMA(unaStima.giorni!)}.` : 'La data per consumarlo la puoi scrivere in Casa.'} Le trovi in Casa, tra le cose
            da usare presto.
          </p>
        </div>
      )}
      {errore && (
        <div className="avviso errore" role="alert">
          {errore}
        </div>
      )}
      <button className="bottone primario pieno grande" onClick={conferma}>
        {totale > 0 ? `✓ Mangiato · ${testoNumero(totale)} ${totale === 1 ? 'porzione avanzata' : 'porzioni avanzate'}` : '✓ Mangiato, niente avanzi'}
      </button>
      {altro && (
        <div className="non-previsto">
          <span className="tenue piccolo">Non è andata così?</span>
          <div className="riga" role="group" aria-label="Non è andata così?">
            {ESITI.filter((e) => e.id !== 'come_previsto' && !(valori[0]?.pronto && e.id === 'quantita_diverse')).map((e) => (
              <button key={e.id} type="button" className="bottone piccolo" onClick={() => altro(e.id)}>
                {e.nome}
              </button>
            ))}
          </div>
        </div>
      )}
    </Foglio>
  );
}

const ESITI: { id: EsitoPasto; nome: string; spiega: string }[] = [
  { id: 'come_previsto', nome: 'Come previsto', spiega: 'Tolgo dalla casa quello che prevedeva il menu.' },
  { id: 'quantita_diverse', nome: 'Quantità diverse', spiega: 'Scrivi quanto hai usato di ogni ingrediente.' },
  { id: 'altro_piatto', nome: 'Altro piatto', spiega: 'Il menu resta com’era; tolgo quello che hai mangiato davvero.' },
  { id: 'saltato', nome: 'Saltato', spiega: 'Non tolgo niente dalla casa.' },
];

/**
 * Com'è andato il pasto: le domande di R-CON-1 (preparato? come previsto? altro piatto? quantità diverse?
 * avanzi? saltato?). Con una conferma già fatta è una correzione: il database sposta solo la differenza.
 */
export function ConfermaPasto({
  indice,
  dati,
  portata,
  titolo,
  attiva,
  esitoIniziale,
  chiudi,
}: {
  indice: Indice;
  dati: DatiMenu;
  portata: PortataMenu;
  titolo: string;
  attiva?: Conferma;
  /** Arrivando da «Non è andata così?»: la risposta già scelta. */
  esitoIniziale?: EsitoPasto;
  chiudi: () => void;
}) {
  const { esegui } = useFamiglia();
  const vista = useVista();
  const { righe: consumi, conferme } = useConferme(vista);
  // In una correzione: le porzioni avanzate segnate prima (anche quelle già mangiate da allora).
  const avanzatePrima = useMemo(() => {
    if (!attiva) return 0;
    const diQuesta = new Set(conferme.filter((c) => c.portata_id === portata.id).map((c) => c.id));
    const lotti = (vista.righe.lotto ?? []).filter((l) => l.origine === 'avanzo' && diQuesta.has(String(l.conferma_id)) && !l.eliminato_il);
    const ids = new Set(lotti.map((l) => l.id));
    const restano = lotti.filter((l) => !l.chiuso_il).reduce((t, l) => t + Number(l.quantita), 0);
    const mangiate = (vista.righe.movimento ?? [])
      .filter((m) => ids.has(m.lotto_id as string) && m.causale !== 'carico' && m.causale !== 'annullo')
      .reduce((t, m) => t - Number(m.variazione), 0);
    return Math.max(0, Math.round((restano + mangiate) * 2) / 2);
  }, [attiva, conferme, portata.id, vista.righe.lotto, vista.righe.movimento]);
  const previsto = useMemo(() => previstoPortata(indice, portata, dati.persone, dati.eccezioni, dati.portate, dati.ospiti), [indice, portata, dati]);
  // Porzioni messe nel menu dei giorni dopo (piatto che dura più giorni): sono l'avanzo atteso.
  const pronto = usePronti().get(portata.id);
  const perDopo = pronto
    ? Math.max(0, pronto.quantita - porzioniPortata(portata, dati.persone, dati.eccezioni, dati.ospiti))
    : avanziDi(portata, dati.portate).reduce((t, a) => t + porzioniPortata(a, dati.persone, dati.eccezioni, dati.ospiti), 0);
  const usatePrima = attiva ? consumi.filter((c) => c.conferma_id === attiva.id) : [];
  const [esito, setEsito] = useState<EsitoPasto>(attiva?.esito ?? esitoIniziale ?? 'come_previsto');
  const [quantita, setQuantita] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      previsto.map((c) => {
        const prima = usatePrima.find((u) => u.ingrediente_id === c.ingrediente_id && u.unita === c.unita);
        return [`${c.ingrediente_id}|${c.unita}`, String(prima ? prima.usata : c.quantita).replace('.', ',')];
      }),
    ),
  );
  const [cerca, setCerca] = useState('');
  const [ricetta, setRicetta] = useState<Ricetta | null>(attiva?.ricetta_id ? (indice.perId.get(attiva.ricetta_id) ?? null) : null);
  const [testo, setTesto] = useState(attiva?.testo ?? '');
  const [porzioni, setPorzioni] = useState(String(attiva?.porzioni ?? portata.porzioni ?? (previsto.length ? '' : 1)).replace('.', ','));
  const [porzioniAvanzo, setPorzioniAvanzo] = useState(testoNumero(attiva ? (pronto ? pronto.quantita : avanzatePrima) : Math.round(perDopo * 2) / 2));
  /** In una correzione gli avanzi cambiano solo se si toccano. */
  const [avanziToccati, setAvanziToccati] = useState(!attiva);
  const [luogoAvanzo, setLuogoAvanzo] = useState<'frigo' | 'freezer'>('frigo');
  const [nota, setNota] = useState(attiva?.nota ?? '');
  const [errore, setErrore] = useState<string | null>(null);

  const trovate = cerca.trim()
    ? indice.ricette.filter((r) => !r.archiviata && normalizza(r.titolo).includes(normalizza(cerca))).slice(0, 6)
    : [];
  const piatto = esito === 'altro_piatto' ? (ricetta?.titolo ?? testo.trim()) : titolo;
  const ricettaAvanzo = esito === 'altro_piatto' ? ricetta : portata.ricetta_id ? indice.perId.get(portata.ricetta_id) : null;
  const giorni = giorniAvanzo(ricettaAvanzo, indice.catalogo.regole_cotti);

  async function salva() {
    const d: Record<string, unknown> = { id: crypto.randomUUID(), portata_id: portata.id, esito, nota: nota.trim() || null };
    if (attiva) d.revisione_attesa = attiva.revisione;
    if (esito === 'quantita_diverse') {
      const righe = [];
      for (const c of previsto) {
        const q = leggiNumero(quantita[`${c.ingrediente_id}|${c.unita}`] ?? '');
        if (q === null || q < 0) return setErrore(`Scrivi quanto ${indice.nome(c.ingrediente_id)} hai usato (anche 0).`);
        righe.push({ ingrediente_id: c.ingrediente_id, unita: c.unita, quantita: q });
      }
      d.righe = righe;
    }
    if (esito === 'altro_piatto') {
      if (!ricetta && !testo.trim()) return setErrore('Scegli una ricetta o scrivi cosa avete mangiato.');
      if (ricetta) {
        const p = leggiNumero(porzioni);
        if (p === null || p <= 0) return setErrore('Scrivi quante porzioni.');
        Object.assign(d, { ricetta_id: ricetta.id, porzioni: p });
      } else d.testo = testo.trim();
    }
    const q = leggiNumero(porzioniAvanzo);
    if (esito !== 'saltato' && avanziToccati) {
      if (q === null || q < 0) return setErrore('Scrivi quante porzioni sono avanzate (anche 0).');
      // Sempre detto: 0 vuol dire finito tutto (anche per un piatto che durava più giorni).
      d.avanzi = q > 0 ? [lottoAvanzo(piatto, q, luogoAvanzo, giorni)] : [];
    }
    await esegui('conferma_pasto', d);
    chiudi();
  }

  return (
    <Foglio titolo={attiva ? 'Correggi il pasto' : 'Com’è andato il pasto?'} chiudi={chiudi}>
      <p className="tenue" style={{ marginTop: 0 }}>
        {titolo} · {formattaGiorno(portata.data)}
        {attiva && ` · ora: ${NOME_ESITO[attiva.esito].toLowerCase()}`}
      </p>
      <div className="scelte" role="radiogroup" aria-label="Com’è andata">
        {ESITI.filter((e) => !(pronto && e.id === 'quantita_diverse')).map((e) => (
          <button key={e.id} role="radio" aria-checked={esito === e.id} aria-pressed={esito === e.id} onClick={() => setEsito(e.id)}>
            {e.nome}
          </button>
        ))}
      </div>
      <p className="tenue">{ESITI.find((e) => e.id === esito)?.spiega}</p>

      {pronto && esito === 'come_previsto' ? (
        <p className="tenue">🍳 Cucinato in anticipo: gli ingredienti sono già stati tolti dalla casa.</p>
      ) : (esito === 'come_previsto' || esito === 'quantita_diverse') &&
        (previsto.length === 0 ? (
          <p className="tenue">Questo piatto non ha ingredienti da togliere dalla casa.</p>
        ) : (
          <ul className="elenco" aria-label="Ingredienti">
            {previsto.map((c) => {
              const k = `${c.ingrediente_id}|${c.unita}`;
              const nome = indice.nome(c.ingrediente_id);
              return (
                <li key={k} className="riga spazio">
                  <span>
                    <IconaCibo valore={iconaIngrediente(indice.ingrediente(c.ingrediente_id))} /> {nome}
                  </span>
                  {esito === 'quantita_diverse' ? (
                    <label className="riga">
                      <input
                        className="dato"
                        inputMode="decimal"
                        aria-label={`Quanto ${nome} hai usato`}
                        value={quantita[k] ?? ''}
                        onChange={(e) => setQuantita({ ...quantita, [k]: e.target.value })}
                        style={{ width: 80 }}
                      />
                      <span>{c.unita}</span>
                      <span className="tenue">(previsti {formatta({ valore: c.quantita, unita: c.unita })})</span>
                    </label>
                  ) : (
                    <span className="tenue">{formatta({ valore: c.quantita, unita: c.unita })}</span>
                  )}
                </li>
              );
            })}
          </ul>
        ))}

      {esito === 'altro_piatto' &&
        (ricetta ? (
          <div className="riga" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <button className="bottone piccolo" onClick={() => setRicetta(null)} aria-label={`Cambia ricetta: ${ricetta.titolo}`}>
              {ricetta.titolo}
            </button>
            <label className="campo">
              <span>Porzioni</span>
              <input inputMode="decimal" value={porzioni} onChange={(e) => setPorzioni(e.target.value)} style={{ width: 80 }} />
            </label>
          </div>
        ) : (
          <>
            <label className="campo">
              <span>Cosa avete mangiato?</span>
              <input
                value={cerca}
                onChange={(e) => {
                  setCerca(e.target.value);
                  setTesto(e.target.value);
                }}
                placeholder="Cerca una ricetta o scrivi (es. pizza fuori)"
                maxLength={120}
              />
            </label>
            {trovate.length > 0 && (
              <ul className="elenco risultati" aria-label="Ricette trovate">
                {trovate.map((r) => (
                  <li key={r.id}>
                    <button className="voce" onClick={() => setRicetta(r)}>
                      {r.titolo}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ))}

      {esito !== 'saltato' && (
        <div className="campo">
          <div className="riga spazio" style={{ flexWrap: 'wrap' }}>
            <span>Porzioni avanzate</span>
            <PorzioniAvanzate
              valore={porzioniAvanzo}
              cambia={(v) => {
                setPorzioniAvanzo(v);
                setAvanziToccati(true);
              }}
            />
          </div>
          {pronto ? (
            <p className="tenue" style={{ margin: '4px 0 0' }}>
              🍳 Cucinato: in {pronto.luogo} ce ne sono {testoNumero(pronto.quantita)}.
            </p>
          ) : (
            perDopo > 0 && (
              <p className="tenue" style={{ margin: '4px 0 0' }}>
                Nel menu dei giorni dopo ne avete messe {testoNumero(perDopo)}.
              </p>
            )
          )}
          {avanziToccati && (leggiNumero(porzioniAvanzo) ?? 0) > 0 && (
            <div style={{ marginTop: 8 }}>
              <SceltaLuogo luogo={luogoAvanzo} cambia={setLuogoAvanzo} />
              <p className="tenue" style={{ margin: '4px 0 0' }}>
                {luogoAvanzo === 'frigo' && giorni !== null ? `In frigo: ${STIMA(giorni)}.` : 'La data per consumarlo la puoi scrivere in Casa.'}
              </p>
            </div>
          )}
        </div>
      )}

      <label className="campo">
        <span>Nota (facoltativa)</span>
        <input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={500} />
      </label>
      {errore && (
        <div className="avviso errore" role="alert">
          {errore}
        </div>
      )}
      <button className="bottone primario pieno" onClick={salva}>
        {attiva ? 'Salva la correzione' : 'Conferma'}
      </button>
    </Foglio>
  );
}
