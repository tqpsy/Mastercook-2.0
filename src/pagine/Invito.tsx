import { type FormEvent, useState } from 'react';
import { idDispositivo } from '../dati/contesto';
import { spiegaMotivo } from '../dati/messaggi';
import { VERSIONE_APP } from '../dati/tipi';
import { trasportoSupabase } from '../piattaforma/supabase';

/** Entrare in una famiglia con il codice dell'invito: basta confermare il proprio nome. */
export function Invito({ codice, nomeSuggerito, entrato, annulla }: { codice: string; nomeSuggerito: string; entrato: (famiglia: string) => void; annulla: () => void }) {
  const [nome, setNome] = useState(nomeSuggerito);
  const [errore, setErrore] = useState<string | null>(null);
  const [attendi, setAttendi] = useState(false);
  const [ids] = useState(() => ({ comando: crypto.randomUUID(), membro: crypto.randomUUID() }));

  async function entra(e: FormEvent) {
    e.preventDefault();
    setAttendi(true);
    setErrore(null);
    try {
      const esito = await trasportoSupabase.entra({
        id: ids.comando,
        famiglia_id: ids.comando,
        tipo: 'entra_con_invito',
        dati: { codice, membro: { id: ids.membro, nome: nome.trim() } },
        versione_app: VERSIONE_APP,
        dispositivo: idDispositivo(),
      });
      if (esito.esito === 'applicato' && esito.famiglia_id) return entrato(esito.famiglia_id);
      setErrore(spiegaMotivo(esito.dettaglio.motivo));
    } catch {
      setErrore('Serve la connessione per entrare nella famiglia. Riprova appena sei online.');
    }
    setAttendi(false);
  }

  return (
    <main className="centrata">
      <img className="logo" src={`${import.meta.env.BASE_URL}icona.svg`} alt="" />
      <h1>Entra in famiglia</h1>
      <form onSubmit={entra}>
        <label className="campo">
          <span>Il tuo nome</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} required />
        </label>
        {errore && <div className="avviso errore">{errore}</div>}
        <button className="bottone primario pieno" disabled={attendi || !nome.trim()}>
          {attendi ? 'Entro…' : 'Entra'}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        <button className="bottone" onClick={annulla}>
          Non ora
        </button>
      </p>
    </main>
  );
}
