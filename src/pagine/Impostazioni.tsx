import { useState } from 'react';
import { righeAttive, useFamiglia, useVista } from '../dati/contesto';
import { VERSIONE_APP } from '../dati/tipi';

export function Impostazioni({ email, esci }: { email: string; esci: () => void }) {
  const { ruolo, utenteId } = useFamiglia();
  const vista = useVista();
  const famiglia = righeAttive(vista, 'famiglia')[0];
  const amministratore = ruolo === 'amministratore';

  return (
    <>
      <h2>Famiglia</h2>
      <div className="scheda">
        {famiglia && amministratore ? <NomeFamiglia nome={String(famiglia.nome)} versione={famiglia.versione ?? 1} /> : <p>{String(famiglia?.nome ?? '')}</p>}
      </div>

      {amministratore && <Inviti />}
      <Accessi amministratore={amministratore} io={utenteId} />

      <h2>Questo dispositivo</h2>
      <div className="scheda">
        <p>
          Accesso come <strong>{email}</strong>
        </p>
        <p className="tenue">Versione dell’app {VERSIONE_APP}</p>
        <button className="bottone pieno" onClick={esci}>
          Esci
        </button>
      </div>
    </>
  );
}

function NomeFamiglia({ nome, versione }: { nome: string; versione: number }) {
  const { esegui } = useFamiglia();
  const [testo, setTesto] = useState(nome);
  return (
    <form
      className="campo"
      style={{ margin: 0 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (testo.trim() && testo.trim() !== nome) void esegui('modifica_famiglia', { versione_attesa: versione, campi: { nome: testo.trim() } });
      }}
    >
      <span>Nome della famiglia</span>
      <div className="riga">
        <input className="cresce" value={testo} onChange={(e) => setTesto(e.target.value)} maxLength={80} required />
        {testo.trim() !== nome && <button className="bottone primario piccolo">Salva</button>}
      </div>
    </form>
  );
}

function linkInvito(codice: string) {
  return `${window.location.origin}${import.meta.env.BASE_URL}#invito=${codice}`;
}

function Inviti() {
  const { esegui } = useFamiglia();
  const vista = useVista();
  const [copiato, setCopiato] = useState<string | null>(null);
  const [adesso] = useState(() => Date.now());
  const inviti = righeAttive(vista, 'invito').filter(
    (i) => !i.revocato && (i.in_attesa || (new Date(String(i.scade_il)).getTime() > adesso && Number(i.usi) < Number(i.usi_massimi))),
  );

  async function condividi(codice: string) {
    const url = linkInvito(codice);
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Mastercook', text: 'Entra nella nostra famiglia su Mastercook', url });
        return;
      }
    } catch {
      // Condivisione annullata: si prova a copiare.
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopiato(codice);
    } catch {
      window.prompt('Copia questo link e mandalo:', url);
    }
  }

  return (
    <>
      <h2>Inviti</h2>
      <div className="scheda">
        <p className="tenue">Manda il link a chi vuoi far entrare: accede con Google ed è dentro. Ogni link vale 7 giorni e per 5 persone.</p>
        <ul className="elenco">
          {inviti.map((i) => (
            <li key={i.id}>
              {i.in_attesa || !i.codice ? (
                <span className="tenue">Creo il link…</span>
              ) : (
                <div className="riga" style={{ flexWrap: 'wrap' }}>
                  <span className="cresce tenue">
                    Scade il {new Date(String(i.scade_il)).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })} · usato {String(i.usi)} di {String(i.usi_massimi)}
                  </span>
                  <button className="bottone primario piccolo" onClick={() => condividi(String(i.codice))}>
                    {copiato === i.codice ? 'Copiato' : 'Condividi'}
                  </button>
                  <button className="bottone pericolo piccolo" onClick={() => esegui('revoca_invito', { id: i.id })}>
                    Annulla
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <button className="bottone pieno" onClick={() => esegui('crea_invito', { id: crypto.randomUUID(), giorni: 7, usi_massimi: 5 })}>
          Crea un link d’invito
        </button>
      </div>
    </>
  );
}

function Accessi({ amministratore, io }: { amministratore: boolean; io: string }) {
  const { esegui } = useFamiglia();
  const vista = useVista();
  const accessi = righeAttive(vista, 'utente_famiglia');
  const membri = righeAttive(vista, 'membro');
  return (
    <>
      <h2>Chi usa l’app</h2>
      <div className="scheda">
        <ul className="elenco">
          {accessi.map((a) => {
            const m = membri.find((x) => x.utente_id === a.utente_id);
            return (
              <li key={a.id} className="riga">
                <span className="emoji">{String(m?.emoji ?? '🙂')}</span>
                <span className="cresce">
                  <strong>{String(m?.nome ?? 'Senza nome')}</strong>
                  {a.utente_id === io && ' (tu)'}
                  <span className="tenue" style={{ display: 'block' }}>
                    {a.ruolo === 'amministratore' ? 'Amministra la famiglia' : 'Familiare'}
                  </span>
                </span>
                {amministratore && a.utente_id !== io && (
                  <button
                    className="bottone pericolo piccolo"
                    onClick={() => {
                      if (window.confirm(`Togliere l’accesso a ${String(m?.nome ?? 'questa persona')}? Il suo profilo resta tra chi mangia a casa.`)) {
                        void esegui('rimuovi_accesso', { id: a.id });
                      }
                    }}
                  >
                    Togli
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
