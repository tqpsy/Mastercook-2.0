import { type FormEvent, useState } from 'react';
import { VERSIONE_APP } from '../dati/tipi';
import { spiegaMotivo } from '../dati/messaggi';
import { trasportoLocale } from '../piattaforma/locale/motore';
import { type Dove, trasportoSupabase } from '../piattaforma/supabase';
import { idDispositivo } from '../dati/contesto';
import { Ripristino } from '../ui/Ripristino';

const SCELTE: { dove: Dove; icona: string; titolo: string; testo: string }[] = [
  {
    dove: 'server',
    icona: '☁️',
    titolo: 'Sul server di Mastercook',
    testo: 'Potete usarla in tanti, ognuno con il suo telefono: inviti gli altri con un link. I dati stanno su un server in Europa.',
  },
  {
    dove: 'locale',
    icona: '📱',
    titolo: 'Solo su questo telefono',
    testo: 'Niente esce dal telefono e funziona anche senza rete. La usi solo tu, da qui. Se cambi telefono ti serve una copia: la salvi da Impostazioni.',
  },
];

/** Prima volta: si crea la famiglia, scegliendo dove tenere i dati. Sul server serve la rete. */
export function NuovaFamiglia({ nomeSuggerito, creata, utenteId }: { nomeSuggerito: string; creata: (famiglia: string) => void; utenteId: string }) {
  const [dove, setDove] = useState<Dove>('server');
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
      const trasporto = dove === 'locale' ? trasportoLocale(utenteId) : trasportoSupabase;
      const esito = await trasporto.applica({
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
      setErrore(dove === 'locale' ? 'Non sono riuscito a preparare i dati sul telefono. Riprova.' : 'Serve la connessione per creare la famiglia. Riprova appena sei online.');
    }
    setAttendi(false);
  }

  return (
    <main className="centrata">
      <img className="logo" src={`${import.meta.env.BASE_URL}icona.svg`} alt="" />
      <h1>Crea la tua famiglia</h1>
      <form onSubmit={crea}>
        <fieldset className="campo scelta-dove">
          <legend>Dove tenere i dati</legend>
          {SCELTE.map((s) => (
            <label key={s.dove} className={`scheda scelta${dove === s.dove ? ' scelta-attiva' : ''}`}>
              <input type="radio" name="dove" value={s.dove} checked={dove === s.dove} onChange={() => setDove(s.dove)} />
              <span>
                <strong>
                  <span aria-hidden>{s.icona}</span> {s.titolo}
                </strong>
                <span className="tenue" style={{ display: 'block' }}>
                  {s.testo}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
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
          {attendi ? (dove === 'locale' ? 'Preparo il telefono…' : 'Creo…') : 'Crea la famiglia'}
        </button>
      </form>
      <details style={{ marginTop: 28 }}>
        <summary className="tenue">Hai un file di esportazione, anche del vecchio Mastercook? Caricalo</summary>
        <div style={{ marginTop: 12 }}>
          <Ripristino nomeUtente={nome.trim()} fatto={creata} trasporto={dove === 'locale' ? trasportoLocale(utenteId) : undefined} />
        </div>
      </details>
    </main>
  );
}
