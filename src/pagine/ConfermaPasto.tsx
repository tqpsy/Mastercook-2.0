import { useMemo, useState } from 'react';
import { useFamiglia, useVista, type Vista } from '../dati/contesto';
import { avanziDi, type ConfermaPasto as Conferma, type Consumo, type EsitoPasto, giorniAvanzo, NOME_ESITO, porzioniPortata, previstoPortata } from '../dominio/consumi';
import type { PortataMenu } from '../dominio/menu';
import { type Indice, normalizza, type Ricetta } from '../dominio/ricette';
import { oggi, piuGiorni } from '../dominio/scadenze';
import { formatta, formattaGiorno, leggiNumero } from '../dominio/unita';
import { Foglio } from '../ui/Foglio';
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
  const { righe: consumi } = useConferme(vista);
  const previsto = useMemo(() => previstoPortata(indice, portata, dati.persone, dati.eccezioni, dati.portate), [indice, portata, dati]);
  // Porzioni messe nel menu dei giorni dopo (piatto che dura più giorni): sono l'avanzo atteso.
  const perDopo = avanziDi(portata, dati.portate).reduce((t, a) => t + porzioniPortata(a, dati.persone, dati.eccezioni), 0);
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
  const [avanzi, setAvanzi] = useState(!attiva && perDopo > 0);
  const [porzioniAvanzo, setPorzioniAvanzo] = useState(String(perDopo || 1).replace('.', ','));
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
    if (avanzi && esito !== 'saltato') {
      const q = leggiNumero(porzioniAvanzo);
      if (q === null || q <= 0) return setErrore('Scrivi quante porzioni sono avanzate.');
      const stimata = luogoAvanzo === 'frigo' && giorni !== null;
      d.avanzi = [
        {
          lotto_id: crypto.randomUUID(),
          nome: piatto.slice(0, 120) || 'Avanzo',
          quantita: q,
          luogo: luogoAvanzo,
          ...(stimata
            ? { tipo_data: 'stimata', data_limite: piuGiorni(oggi(), giorni), fonte_data: 'app', calcolata_il: new Date().toISOString(), affidabilita: 'bassa' }
            : { tipo_data: 'sconosciuta' }),
        },
      ];
    } else if (perDopo > 0 && !attiva) d.avanzi = []; // finito tutto: niente avanzo per i giorni dopo
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
        {ESITI.map((e) => (
          <button key={e.id} role="radio" aria-checked={esito === e.id} aria-pressed={esito === e.id} onClick={() => setEsito(e.id)}>
            {e.nome}
          </button>
        ))}
      </div>
      <p className="tenue">{ESITI.find((e) => e.id === esito)?.spiega}</p>

      {(esito === 'come_previsto' || esito === 'quantita_diverse') &&
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
                    {indice.ingrediente(c.ingrediente_id)?.emoji} {nome}
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
          <label className="riga">
            <input type="checkbox" checked={avanzi} onChange={(e) => setAvanzi(e.target.checked)} /> Sono avanzate delle porzioni
          </label>
          {avanzi && (
            <div className="riga" style={{ flexWrap: 'wrap', marginTop: 6 }}>
              <input className="dato" inputMode="decimal" aria-label="Porzioni avanzate" value={porzioniAvanzo} onChange={(e) => setPorzioniAvanzo(e.target.value)} style={{ width: 70 }} />
              <span>porzioni in</span>
              <select className="dato" aria-label="Dove va l’avanzo" value={luogoAvanzo} onChange={(e) => setLuogoAvanzo(e.target.value as 'frigo' | 'freezer')} style={{ width: 'auto' }}>
                <option value="frigo">Frigo</option>
                <option value="freezer">Freezer</option>
              </select>
              {perDopo > 0 && (
                <p className="tenue" style={{ width: '100%', margin: '4px 0 0' }}>
                  Nel menu dei giorni dopo ne avete messe {String(perDopo).replace('.', ',')}.
                </p>
              )}
              <p className="tenue" style={{ width: '100%', margin: '4px 0 0' }}>
                {luogoAvanzo === 'frigo' && giorni !== null
                  ? `Stima indicativa: da consumare entro ${giorni === 1 ? 'domani' : `${giorni} giorni`} (regola dei cotti). Controlla sempre.`
                  : 'Senza una regola per questo piatto la data resta da scrivere.'}
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
