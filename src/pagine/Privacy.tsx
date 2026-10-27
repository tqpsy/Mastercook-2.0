import { useState } from 'react';
import { registraConsenso } from '../piattaforma/supabase';

/** Cambia quando cambia la sostanza dell'informativa: chi ha accettato una versione prima la rivede. */
export const VERSIONE_PRIVACY = 1;
const DATA_PRIVACY = '27 ottobre 2026';

/** L'informativa, in parole semplici. La stessa all'iscrizione e nelle Impostazioni. */
export function TestoPrivacy() {
  return (
    <div className="testo-privacy">
      <p className="tenue">
        Versione {VERSIONE_PRIVACY}, {DATA_PRIVACY}
      </p>
      <h3>Chi gestisce i dati</h3>
      <p>
        Mastercook è un’app privata, offerta gratis da chi l’ha messa in piedi a famiglie di amici. Non è un servizio commerciale: niente pubblicità, niente
        profilazione, nessun dato venduto o ceduto. Per qualsiasi domanda o richiesta sui tuoi dati scrivi a chi ti ha invitato a usarla.
      </p>
      <h3>Quali dati</h3>
      <ul>
        <li>Dal tuo account Google: indirizzo email, nome e un identificativo. Mai la password.</li>
        <li>
          Quello che la famiglia scrive: nomi o soprannomi delle persone, porzioni, ricette, menu, cose in casa, spesa, scontrini, foto delle ricette e dei
          piatti.
        </li>
        <li>
          <strong>Allergie, intolleranze ed esigenze alimentari</strong>: sono dati sulla salute, per cui serve il tuo consenso esplicito. Servono solo a dire se un
          piatto va bene per chi lo mangia.
        </li>
        <li>Gli ospiti di un pasto: solo quanti sono e cosa non possono mangiare, mai i nomi. Allergie ed esigenze degli ospiti si cancellano da sole dopo il pasto.</li>
      </ul>
      <h3>Dove stanno</h3>
      <ul>
        <li>Sul database Supabase dell’app, in Europa (Irlanda). Ogni famiglia vede solo i propri dati: lo controlla il database, non l’app.</li>
        <li>Una copia sul tuo dispositivo, per usare l’app anche senza rete. Uscendo dall’app la copia si cancella.</li>
        <li>L’app si scarica da GitHub Pages; l’accesso passa da Google.</li>
      </ul>
      <h3>Servizi esterni, solo quando li usi</h3>
      <ul>
        <li>
          <strong>Foto del frigo</strong>: la foto va a Google Gemini con la chiave che la famiglia ha messo nelle Impostazioni. Per chi è in Europa Google non la
          usa per addestrare i suoi modelli, ma la può conservare per un periodo limitato per i controlli contro gli abusi.
        </li>
        <li>
          <strong>Codici a barre</strong>: per un prodotto che l’app non conosce si chiede il nome a Open Food Facts, mandando solo il numero del codice.
        </li>
        <li>
          <strong>Scontrini</strong>: il testo si legge sul telefono; la foto non esce dal dispositivo.
        </li>
      </ul>
      <h3>Per quanto tempo</h3>
      <p>Finché la famiglia usa l’app. Eliminando la famiglia o il tuo account i dati si cancellano dal database.</p>
      <h3>I tuoi diritti</h3>
      <ul>
        <li>Vedere e correggere i dati: direttamente nell’app.</li>
        <li>Portarli via: Impostazioni → I tuoi dati → Esporta.</li>
        <li>Cancellarli: Impostazioni → Elimina il mio account (o Elimina la famiglia, per chi la gestisce).</li>
        <li>Ritirare il consenso: eliminando il tuo account. Quello che è stato fatto prima resta lecito.</li>
        <li>
          Fare reclamo al Garante per la protezione dei dati personali (
          <a href="https://www.garanteprivacy.it" target="_blank" rel="noreferrer">
            garanteprivacy.it
          </a>
          ).
        </li>
      </ul>
    </div>
  );
}

/** Al primo accesso (e quando l'informativa cambia): leggere, accettare, poi si entra. */
export function Consenso({ fatto, esci }: { fatto: () => void; esci: () => void }) {
  const [salute, setSalute] = useState(false);
  const [eta, setEta] = useState(false);
  const [attendi, setAttendi] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  async function accetta() {
    setAttendi(true);
    setErrore(null);
    try {
      await registraConsenso(VERSIONE_PRIVACY);
      fatto();
    } catch {
      setErrore('Serve la connessione per registrare il consenso. Riprova appena sei online.');
      setAttendi(false);
    }
  }

  return (
    <main className="pagina" style={{ maxWidth: 640, margin: '0 auto' }}>
      <h1>I tuoi dati</h1>
      <p>Prima di iniziare, ecco come Mastercook tratta i dati della tua famiglia.</p>
      <div className="scheda">
        <TestoPrivacy />
      </div>
      <div className="scheda">
        <label className="riga" style={{ alignItems: 'flex-start', minHeight: 44 }}>
          <input type="checkbox" checked={eta} onChange={(e) => setEta(e.target.checked)} />
          <span>Ho almeno 14 anni.</span>
        </label>
        <label className="riga" style={{ alignItems: 'flex-start', minHeight: 44 }}>
          <input type="checkbox" checked={salute} onChange={(e) => setSalute(e.target.checked)} />
          <span>Ho letto l’informativa e acconsento al trattamento di allergie, intolleranze ed esigenze alimentari mie e di chi aggiungo alla famiglia.</span>
        </label>
        {errore && <div className="avviso errore">{errore}</div>}
        <button className="bottone primario pieno" disabled={!salute || !eta || attendi} onClick={() => void accetta()}>
          {attendi ? 'Un momento…' : 'Accetto e continuo'}
        </button>
        <button className="bottone pieno" style={{ marginTop: 8 }} onClick={esci}>
          Non accetto, esci
        </button>
      </div>
    </main>
  );
}
