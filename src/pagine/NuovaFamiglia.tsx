import { type FormEvent, useState } from 'react';
import { VERSIONE_APP } from '../dati/tipi';
import { spiegaMotivo } from '../dati/messaggi';
import { trasportoSupabase } from '../piattaforma/supabase';
import { idDispositivo } from '../dati/contesto';
import { Ripristino } from '../ui/Ripristino';

/** Prima volta: si crea la famiglia. Richiede la rete, perché la famiglia nasce sul server. */
export function NuovaFamiglia({ nomeSuggerito, creata }: { nomeSuggerito: string; creata: (famiglia: string) => void }) {
  const [famiglia, setFamiglia] = useState('');
  const [nome, setNome] = useState(nomeSuggerito);
  const [errore, setErrore] = useState<string | null>(null);
  const [attendi, setAttendi] = useState(false);
  // L'id resta lo stesso anche se si ritenta: la famiglia non può nascere due volte.
  const [comando] = useState(() => ({ id: crypto.randomUUID(), famiglia: crypto.randomUUID(), membro: crypto.randomUUID() }));

  async function crea(e: FormEvent) {
    e.preventDefault();
    setAttendi(true);
    setErrore(null);
    try {
      const esito = await trasportoSupabase.applica({
        id: comando.id,
        famiglia_id: comando.famiglia,
        tipo: 'crea_famiglia',
        dati: { nome: famiglia.trim(), membro: { id: comando.membro, nome: nome.trim() } },
        versione_app: VERSIONE_APP,
        dispositivo: idDispositivo(),
      });
      if (esito.esito === 'applicato') return creata(comando.famiglia);
      setErrore(spiegaMotivo(esito.dettaglio.motivo));
    } catch {
      setErrore('Serve la connessione per creare la famiglia. Riprova appena sei online.');
    }
    setAttendi(false);
  }

  return (
    <main className="centrata">
      <img className="logo" src={`${import.meta.env.BASE_URL}icona.svg`} alt="" />
      <h1>Crea la tua famiglia</h1>
      <p className="tenue">Poi potrai invitare gli altri con un link.</p>
      <form onSubmit={crea}>
        <label className="campo">
          <span>Nome della famiglia</span>
          <input value={famiglia} onChange={(e) => setFamiglia(e.target.value)} placeholder="Casa Rossi" maxLength={80} required />
        </label>
        <label className="campo">
          <span>Il tuo nome</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} required />
        </label>
        {errore && <div className="avviso errore">{errore}</div>}
        <button className="bottone primario pieno" disabled={attendi || !famiglia.trim() || !nome.trim()}>
          {attendi ? 'Creo…' : 'Crea la famiglia'}
        </button>
      </form>
      <details style={{ marginTop: 28 }}>
        <summary className="tenue">Hai un file di esportazione, anche del vecchio Mastercook? Caricalo</summary>
        <div style={{ marginTop: 12 }}>
          <Ripristino nomeUtente={nome.trim()} fatto={creata} />
        </div>
      </details>
    </main>
  );
}
