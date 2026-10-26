import { useState } from 'react';
import { accediConGoogle } from '../piattaforma/supabase';

export function Accesso({ invito }: { invito: boolean }) {
  const [errore, setErrore] = useState<string | null>(null);
  const [attendi, setAttendi] = useState(false);
  async function accedi() {
    setAttendi(true);
    setErrore(null);
    try {
      await accediConGoogle();
    } catch {
      setErrore('Non è stato possibile aprire l’accesso con Google. Controlla la connessione e riprova.');
      setAttendi(false);
    }
  }
  return (
    <main className="centrata">
      <img className="logo" src={`${import.meta.env.BASE_URL}icona.svg`} alt="" />
      <h1>Mastercook</h1>
      <p className="tenue">
        {invito ? 'Ti hanno invitato in una famiglia. Accedi con Google per entrare.' : 'Pasti, spesa, casa e scadenze della famiglia, su tutti i vostri dispositivi.'}
      </p>
      {errore && <div className="avviso errore">{errore}</div>}
      <button className="bottone primario pieno" onClick={accedi} disabled={attendi}>
        {attendi ? 'Apro Google…' : 'Accedi con Google'}
      </button>
    </main>
  );
}
