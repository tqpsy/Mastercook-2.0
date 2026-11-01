import { useMemo, useState } from 'react';
import { IconaCibo } from '../ui/IconaCibo';
import { iconaIngrediente } from '../dominio/iconeCibo';
import { useFamiglia, useVista, type Vista } from '../dati/contesto';
import { avanziDi, type ConfermaPasto as Conferma, type Consumo, type EsitoPasto, giorniAvanzo, NOME_ESITO, porzioniPortata, previstoPortata } from '../dominio/consumi';
import type { PortataMenu } from '../dominio/menu';
import { type Indice, normalizza, type Ricetta } from '../dominio/ricette';
import { oggi, piuGiorni } from '../dominio/scadenze';
import { formatta, formattaGiorno, leggiNumero } from '../dominio/unita';
import { Foglio } from '../ui/Foglio';
import { usePronti } from './Cucinato';
import type { DatiMenu } from './Menu';

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

/** Quante porzioni sono avanzate: − e + di una porzione, oppure si scrive (anche mezze, «1,5»). */
export function PorzioniAvanzate({ valore, cambia, piatto, nome = 'Porzioni avanzate' }: { valore: string; cambia: (v: string) => void; piatto?: string; nome?: string }) {
  const di = piatto ? `: ${piatto}` : '';
  const etichetta = `${nome}${di}`;
  const n = leggiNumero(valore) ?? 0;
  const passo = (d: number) => cambia(testoNumero(Math.max(0, Math.round((n + d) * 2) / 2)));
  return (
    <span className="contatore">
      <button type="button" className="bottone piccolo" aria-label={`Una porzione in meno${di}`} disabled={n <= 0} onClick={() => passo(-1)}>
        −
      </button>
      <input className="dato" inputMode="decimal" aria-label={etichetta} value={valore} onChange={(e) => cambia(e.target.value)} onFocus={(e) => e.target.select()} />
      <button type="button" className="bottone piccolo" aria-label={`Una porzione in più${di}`} onClick={() => passo(1)}>
        +
      </button>
    </span>
  );
}

export function SceltaLuogo({ luogo, cambia }: { luogo: 'frigo' | 'freezer'; cambia: (l: 'frigo' | 'freezer') => void }) {
  return (
    <div className="scelte segmenti" role="radiogroup" aria-label="Dove va l’avanzo" style={{ display: 'inline-flex' }}>
      {(['frigo', 'freezer'] as const).map((l) => (
        <button key={l} type="button" role="radio" aria-checked={luogo === l} aria-pressed={luogo === l} onClick={() => cambia(l)}>
          {l === 'frigo' ? 'In frigo' : 'In freezer'}
        </button>
      ))}
    </div>
  );
}

const STIMA = (giorni: number) => `da mangiare entro ${giorni === 1 ? 'domani' : `${giorni} giorni`} (stima, controlla sempre)`;

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
  altro?: () => void;
  chiudi: () => void;
}) {
  const { esegui } = useFamiglia();
  const pronti = usePronti();
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
        return { p, titolo: titolo(p), perDopo, pronto, giorni: giorniAvanzo(ricettaId ? indice.perId.get(ricettaId) : null, indice.catalogo.regole_cotti) };
      }),
    [portate, dati, indice, titolo, pronti],
  );
  const [quante, setQuante] = useState<Record<string, string>>(() => Object.fromEntries(piatti.map((x) => [x.p.id, testoNumero(Math.round(x.perDopo * 2) / 2)])));
  const [luogo, setLuogo] = useState<'frigo' | 'freezer'>('frigo');
  const [errore, setErrore] = useState<string | null>(null);
  const valori = piatti.map((x) => ({ ...x, q: leggiNumero(quante[x.p.id] ?? '') }));
  const totale = valori.reduce((t, x) => t + (x.q && x.q > 0 ? x.q : 0), 0);

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
  return (
    <Foglio titolo="È avanzato qualcosa?" chiudi={chiudi}>
      <p className="tenue" style={{ marginTop: 0 }}>
        Se sono avanzate delle porzioni le metto in Casa, tra le cose da usare presto. Se avete finito tutto, lascia 0.
      </p>
      <ul className="elenco avanzi-mangiato" aria-label="Porzioni avanzate">
        {valori.map((x) => (
          <li key={x.p.id} className="riga spazio" style={{ flexWrap: 'wrap' }}>
            <span className="cresce">
              <strong>{x.titolo}</strong>
              {x.pronto ? (
                <span className="tenue piccolo" style={{ display: 'block' }}>
                  🍳 Cucinato: in {x.pronto.luogo} ce ne sono {testoNumero(x.pronto.quantita)}
                </span>
              ) : (
                x.perDopo > 0 && (
                  <span className="tenue piccolo" style={{ display: 'block' }}>
                    Nel menu dei giorni dopo ne avete messe {testoNumero(x.perDopo)}
                  </span>
                )
              )}
            </span>
            <PorzioniAvanzate piatto={x.titolo} valore={quante[x.p.id] ?? ''} cambia={(v) => setQuante({ ...quante, [x.p.id]: v })} />
          </li>
        ))}
      </ul>
      {totale > 0 && (
        <div className="campo">
          <SceltaLuogo luogo={luogo} cambia={setLuogo} />
          <p className="tenue" style={{ margin: '6px 0 0' }}>
            {luogo === 'frigo' && unaStima ? `In frigo: ${STIMA(unaStima.giorni!)}.` : 'La data per consumarlo la puoi scrivere in Casa.'}
          </p>
        </div>
      )}
      {errore && (
        <div className="avviso errore" role="alert">
          {errore}
        </div>
      )}
      <button className="bottone primario pieno" onClick={conferma}>
        {totale > 0 ? `✓ Mangiato · ${testoNumero(totale)} ${totale === 1 ? 'porzione avanzata' : 'porzioni avanzate'}` : '✓ Mangiato, niente avanzi'}
      </button>
      {altro && (
        <button className="link" style={{ marginTop: 10 }} onClick={altro}>
          Non è andata come previsto? Quantità diverse, altro piatto o saltato
        </button>
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
  chiudi,
}: {
  indice: Indice;
  dati: DatiMenu;
  portata: PortataMenu;
  titolo: string;
  attiva?: Conferma;
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
  const [esito, setEsito] = useState<EsitoPasto>(attiva?.esito ?? 'come_previsto');
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
