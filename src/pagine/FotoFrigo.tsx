import { useState } from 'react';
import { IconaCibo } from '../ui/IconaCibo';
import { iconaIngrediente } from '../dominio/iconeCibo';
import { LUOGHI, NOME_LUOGO } from '../catalogo/tipi';
import { useFamiglia } from '../dati/contesto';
import { abbinaAlimenti, type PropostaFoto } from '../dominio/fotoFrigo';
import type { Indice } from '../dominio/ricette';
import { type Luogo, oggi, REPARTI_SFUSI, stima } from '../dominio/scadenze';
import { leggiNumero } from '../dominio/unita';
import { type ErroreFoto, riconosciFoto } from '../piattaforma/fotoFrigo';
import { Foglio } from '../ui/Foglio';
import { DisegnoFrigoMio } from '../ui/FrigoMio';
import { descriviPerFoto, posto as postoFrigo, postiDi } from '../dominio/frigo';
import { useFrigo } from './MioFrigo';
import { riduciFoto } from '../ui/Foto';

const CHIAVE_AVVISO = 'mc-foto-frigo-avviso';

const SPIEGA_ERRORE: Record<ErroreFoto, string> = {
  quota: 'Per oggi le foto gratuite di Gemini sono finite. Riprova domani, oppure aggiungi a mano.',
  chiave: 'La chiave Gemini della famiglia non è valida: chi amministra la controlla in Impostazioni.',
  non_configurata: 'Per usare la foto del frigo serve la chiave Gemini della famiglia: chi amministra la inserisce in Impostazioni.',
  rete: 'Serve la connessione a internet per leggere la foto. Riprova quando c’è rete.',
  gemini: 'Gemini non è riuscito a leggere la foto. Riprova con più luce, oppure aggiungi a mano.',
  non_autorizzato: 'Non risulti in questa famiglia: esci e rientra, poi riprova.',
};

function avvisoLetto(): boolean {
  try {
    return localStorage.getItem(CHIAVE_AVVISO) === 'si';
  } catch {
    return false;
  }
}

/**
 * Foto del frigo: Gemini propone cosa c'è, tu controlli. Si spuntano gli alimenti giusti, si scrivono o
 * correggono le quantità; in casa entra solo ciò che confermi.
 */
export function FotoFrigo({ indice, luogo: luogoIniziale, chiudi }: { indice: Indice; luogo: Luogo; chiudi: () => void }) {
  const { esegui, famiglia, dove, utenteId } = useFamiglia();
  const [letto, setLetto] = useState(avvisoLetto);
  const [stato, setStato] = useState<'scatta' | 'leggo' | 'scegli'>('scatta');
  const [errore, setErrore] = useState<string | null>(null);
  const [proposte, setProposte] = useState<PropostaFoto[]>([]);
  const [scelte, setScelte] = useState<Record<number, boolean>>({});
  const [quantita, setQuantita] = useState<Record<number, string>>({});
  const [luogo, setLuogo] = useState<Luogo>(luogoIniziale);
  const frigo = useFrigo();
  /** La parte del frigo che si fotografa (null = tutto il frigo o tutto il freezer). */
  const [parte, setParte] = useState<string | null>(null);
  const [posti, setPosti] = useState<Record<number, string>>({});
  const scelta = frigo ? postoFrigo(frigo, parte) : null;
  const postiLuogo = frigo ? postiDi(frigo, luogo) : [];

  async function leggi(file: File | undefined) {
    if (!file) return;
    setErrore(null);
    setStato('leggo');
    const descrizione = frigo && luogo !== 'dispensa' ? descriviPerFoto(frigo, scelta?.id ?? null) : null;
    const r = await riconosciFoto(famiglia, await riduciFoto(file), { dove, utenteId }, descrizione);
    if ('errore' in r) {
      setErrore(SPIEGA_ERRORE[r.errore] + (r.dettaglio ? ` (Risposta di Google: ${r.dettaglio})` : ''));
      return setStato('scatta');
    }
    const p = abbinaAlimenti(indice, r.alimenti);
    setProposte(p);
    setScelte(Object.fromEntries(p.map((x, i) => [i, !!x.ingrediente])));
    setQuantita(Object.fromEntries(p.map((x, i) => [i, x.quantita === null ? '' : String(x.quantita).replace('.', ',')])));
    // Il posto visto da Gemini se è una parte di questo luogo; altrimenti la parte fotografata.
    setPosti(Object.fromEntries(p.map((x, i) => [i, postiLuogo.find((q) => q.id === x.posto)?.id ?? scelta?.id ?? ''])));
    setStato('scegli');
  }

  async function conferma() {
    const giorno = oggi();
    const daMettere = proposte.map((p, i) => ({ p, i })).filter(({ p, i }) => p.ingrediente && scelte[i]);
    for (const { p, i } of daMettere) {
      const q = leggiNumero(quantita[i] ?? '');
      if (q === null || q <= 0) return setErrore(`Scrivi la quantità di ${p.ingrediente!.nome.toLowerCase()} (o togli la spunta).`);
    }
    for (const { p, i } of daMettere) {
      const ing = p.ingrediente!;
      const s = REPARTI_SFUSI.has(ing.reparto) ? stima(ing, luogo, giorno) : null;
      await esegui('aggiungi_lotto', {
        id: crypto.randomUUID(),
        ingrediente_id: ing.id,
        nome: null,
        quantita: leggiNumero(quantita[i])!,
        unita: p.unita,
        luogo,
        data_acquisto: null,
        origine: 'manuale',
        posto: posti[i] || null,
        ...(s
          ? { tipo_data: 'stimata', data_limite: s.data_limite, fonte_data: 'app', calcolata_il: s.calcolata_il, affidabilita: 'bassa' }
          : { tipo_data: 'sconosciuta', data_limite: null, fonte_data: null }),
      });
    }
    chiudi();
  }

  if (!letto) {
    return (
      <Foglio titolo="Foto del frigo" chiudi={chiudi}>
        <p style={{ marginTop: 0 }}>
          Fai una foto al frigo, al freezer o alla dispensa: Gemini di Google prova a riconoscere gli alimenti e l’app ti propone cosa aggiungere in casa. Controlli tu
          prima che entri qualcosa.
        </p>
        <div className="avviso" role="note">
          La foto viene inviata a Gemini di Google con la chiave della famiglia. Per chi è in Europa <strong>Google non la usa per addestrare i suoi modelli</strong>, ma
          la può conservare per un periodo limitato per i controlli contro gli abusi. Non fotografare persone, documenti o altro che non sia cibo. La foto non viene
          salvata nell’app.
        </div>
        <button
          className="bottone primario pieno"
          style={{ marginTop: 12 }}
          onClick={() => {
            try {
              localStorage.setItem(CHIAVE_AVVISO, 'si');
            } catch {
              // Lo richiederà la prossima volta.
            }
            setLetto(true);
          }}
        >
          Ho capito, continua
        </button>
      </Foglio>
    );
  }

  return (
    <Foglio titolo="Foto del frigo" chiudi={chiudi}>
      {stato === 'scatta' && (
        <>
          <label className="campo">
            <span>Dove la scatti?</span>
            <select
              className="dato"
              value={luogo}
              onChange={(e) => {
                setLuogo(e.target.value as Luogo);
                setParte(null);
              }}
            >
              {LUOGHI.map((l) => (
                <option key={l} value={l}>
                  {NOME_LUOGO[l]}
                </option>
              ))}
            </select>
          </label>
          {frigo && luogo !== 'dispensa' && (
            <div className="campo">
              <span>Cosa fotografi?</span>
              <div className="consiglio-ripiano-mio">
                <DisegnoFrigoMio
                  frigo={frigo}
                  scelto={parte}
                  scegli={(id) => {
                    const p = postoFrigo(frigo, id);
                    if (!p) return;
                    setLuogo(p.zona === 'freezer' ? 'freezer' : 'frigo');
                    setParte((x) => (x === id ? null : id));
                  }}
                />
                <div className="cosa-ci-va" aria-live="polite">
                  <strong>{scelta ? scelta.nome : luogo === 'freezer' ? 'Tutto il freezer' : 'Tutto il frigo'}</strong>
                  <span className="tenue">
                    {scelta ? 'Metto in questa parte tutto quello che vedo.' : 'Tocca una parte se fotografi solo quella. Ti dico dove ho visto ogni cosa.'}
                  </span>
                  {scelta && (
                    <button type="button" className="bottone piccolo" style={{ marginTop: 8 }} onClick={() => setParte(null)}>
                      {luogo === 'freezer' ? 'Tutto il freezer' : 'Tutto il frigo'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          {!frigo && luogo !== 'dispensa' && (
            <p className="tenue piccolo">Configura il frigo in Impostazioni › Il mio frigorifero: ti dirò anche su che ripiano ho visto ogni cosa.</p>
          )}
          <label className="bottone primario pieno">
            <span aria-hidden>📷</span> Scatta o scegli la foto
            <input type="file" accept="image/*" capture="environment" hidden aria-label="Foto del frigo" onChange={(e) => void leggi(e.target.files?.[0])} />
          </label>
          <p className="tenue">Gemini di Google, con la chiave della famiglia: la foto non resta nell’app.</p>
        </>
      )}
      {stato === 'leggo' && (
        <p role="status" aria-live="polite">
          Sto guardando la foto…
        </p>
      )}
      {stato === 'scegli' &&
        (proposte.length === 0 ? (
          <>
            <p>Nella foto non ho riconosciuto alimenti. Prova con più luce o più da vicino, oppure aggiungi a mano.</p>
            <button className="bottone pieno" onClick={() => setStato('scatta')}>
              Un’altra foto
            </button>
          </>
        ) : (
          <>
            <p className="tenue" style={{ marginTop: 0 }}>
              Ecco cosa mi sembra di vedere in {NOME_LUOGO[luogo].toLowerCase()}. Togli la spunta a ciò che è sbagliato e controlla le quantità.
            </p>
            {frigo && postiLuogo.length > 0 && (
              <DisegnoFrigoMio
                frigo={frigo}
                segni={proposte.reduce<Record<string, number>>((acc, p, i) => {
                  if (p.ingrediente && scelte[i] && posti[i]) acc[posti[i]] = (acc[posti[i]] ?? 0) + 1;
                  return acc;
                }, {})}
              />
            )}
            <ul className="elenco" aria-label="Alimenti nella foto">
              {proposte.map((p, i) => (
                <li key={i} className="riga" style={{ flexWrap: 'wrap' }}>
                  {p.ingrediente ? (
                    <>
                      <label className="riga cresce">
                        <input type="checkbox" checked={!!scelte[i]} onChange={(e) => setScelte((s) => ({ ...s, [i]: e.target.checked }))} />
                        <span>
                          <IconaCibo valore={iconaIngrediente(p.ingrediente)} /> {p.ingrediente.nome}
                        </span>
                      </label>
                      <input
                        className="dato"
                        inputMode="decimal"
                        aria-label={`Quantità di ${p.ingrediente.nome}`}
                        placeholder="quanto?"
                        value={quantita[i] ?? ''}
                        onChange={(e) => setQuantita((q) => ({ ...q, [i]: e.target.value }))}
                        style={{ width: 80 }}
                      />
                      <span className="tenue">{p.unita}</span>
                      {postiLuogo.length > 0 && (
                        <label className="riga posto-foto">
                          <span aria-hidden>📍</span>
                          <select
                            className="dato"
                            aria-label={`Dove sta ${p.ingrediente.nome}`}
                            value={posti[i] ?? ''}
                            onChange={(e) => setPosti((x) => ({ ...x, [i]: e.target.value }))}
                          >
                            <option value="">Non so dove</option>
                            {postiLuogo.map((q) => (
                              <option key={q.id} value={q.id}>
                                {q.nome}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </>
                  ) : (
                    <span className="tenue">«{p.nome}»: non lo trovo nel catalogo, aggiungilo a mano se serve.</span>
                  )}
                </li>
              ))}
            </ul>
            <button
              className="bottone primario pieno"
              style={{ marginTop: 12 }}
              disabled={!proposte.some((p, i) => p.ingrediente && scelte[i])}
              onClick={() => void conferma()}
            >
              Aggiungi in casa ({proposte.filter((p, i) => p.ingrediente && scelte[i]).length})
            </button>
          </>
        ))}
      {errore && (
        <div className="avviso errore" role="alert" style={{ marginTop: 12 }}>
          {errore}
        </div>
      )}
    </Foglio>
  );
}
