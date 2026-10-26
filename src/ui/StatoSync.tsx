import { useState } from 'react';
import { useFamiglia, useStatoSync, useVista } from '../dati/contesto';
import { descriviAzione, spiegaMotivo } from '../dati/messaggi';
import { Foglio } from './Foglio';

/** Indicatore sempre visibile: tutto salvato, modifiche in attesa, cose da sistemare, blocchi. */
export function StatoSync() {
  const s = useStatoSync();
  const [aperto, setAperto] = useState(false);
  let testo = 'Tutto salvato';
  let classe = 'ok';
  if (s.bloccato === 'app_da_aggiornare') [testo, classe] = ['Aggiorna l’app', 'errore'];
  else if (s.bloccato === 'accesso_scaduto') [testo, classe] = ['Accedi di nuovo', 'errore'];
  else if (s.bloccato === 'non_autorizzato') [testo, classe] = ['Accesso tolto', 'errore'];
  else if (s.da_sistemare) [testo, classe] = [`${s.da_sistemare} da sistemare`, 'errore'];
  else if (s.in_attesa && s.senza_rete) [testo, classe] = [`Senza rete · ${s.in_attesa} in attesa`, 'attesa'];
  else if (s.in_attesa) [testo, classe] = [`${s.in_attesa} in invio`, 'attesa'];
  else if (s.senza_rete) [testo, classe] = ['Senza rete', 'attesa'];
  return (
    <>
      <button className={`stato-sync ${classe}`} onClick={() => setAperto(true)} aria-label={`Stato del salvataggio: ${testo}`}>
        {testo}
      </button>
      {aperto && <PannelloSync chiudi={() => setAperto(false)} />}
    </>
  );
}

function PannelloSync({ chiudi }: { chiudi: () => void }) {
  const s = useStatoSync();
  const { sync, pianificatore } = useFamiglia();
  const { coda } = useVista();
  const daSistemare = coda.filter((v) => v.stato === 'da_sistemare');
  const inAttesa = coda.filter((v) => v.stato === 'in_attesa');
  const ora = s.ultimo_scarico ? new Date(s.ultimo_scarico).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <Foglio titolo="Salvataggio" chiudi={chiudi}>
      {s.bloccato === 'app_da_aggiornare' && (
        <div className="avviso errore">
          <p>C’è una versione nuova di Mastercook. Le tue modifiche restano sul telefono finché non aggiorni.</p>
          <button className="bottone primario" onClick={() => window.location.reload()}>
            Aggiorna ora
          </button>
        </div>
      )}
      {s.bloccato === 'accesso_scaduto' && (
        <div className="avviso errore">
          <p>L’accesso è scaduto. Le tue modifiche restano sul telefono: accedi di nuovo per salvarle.</p>
          <button className="bottone primario" onClick={() => window.location.reload()}>
            Accedi di nuovo
          </button>
        </div>
      )}
      {s.bloccato === 'non_autorizzato' && <div className="avviso errore">Non fai più parte di questa famiglia.</div>}
      {s.senza_rete && <div className="avviso">Non riesco a raggiungere il server. Le modifiche restano sul telefono e partono appena torna la rete.</div>}
      <p className="tenue">{ora ? `Ultimo aggiornamento dal server alle ${ora}.` : 'Non ancora aggiornato dal server.'}</p>

      {inAttesa.length > 0 && (
        <div className="scheda">
          <h3>In attesa di invio ({inAttesa.length})</h3>
          <ul className="elenco">
            {inAttesa.map((v) => (
              <li key={v.id}>{descriviAzione(v.comando.tipo)}</li>
            ))}
          </ul>
        </div>
      )}

      {daSistemare.map((v) => (
        <div className="scheda" key={v.id}>
          <h3>{descriviAzione(v.comando.tipo)}</h3>
          <p>{spiegaMotivo(v.esito?.dettaglio.motivo)}</p>
          <Conflitto dettaglio={v.esito?.dettaglio} />
          <div className="riga" style={{ flexWrap: 'wrap' }}>
            {v.esito?.esito === 'conflitto' && v.comando.tipo.startsWith('modifica_') && (
              <TieniIlMio id={v.id} tipo={v.comando.tipo} dati={v.comando.dati} />
            )}
            <button className="bottone" onClick={() => sync.scarta(v.id)}>
              {v.esito?.esito === 'conflitto' ? 'Tieni l’altra versione' : 'Lascia perdere'}
            </button>
          </div>
        </div>
      ))}

      {!inAttesa.length && !daSistemare.length && !s.bloccato && <p>Tutte le modifiche sono salvate.</p>}
      <button className="bottone pieno" onClick={() => pianificatore.subito()}>
        Aggiorna adesso
      </button>
    </Foglio>
  );
}

function Conflitto({ dettaglio }: { dettaglio?: Record<string, unknown> }) {
  const campi = (dettaglio?.campi as { campo: string; valore_attuale: unknown }[] | undefined) ?? [];
  if (!campi.length) return null;
  return (
    <ul className="elenco">
      {campi.map((c) => (
        <li key={c.campo}>
          <span className="tenue">{c.campo}: ora è </span>
          <strong>{String(c.valore_attuale ?? '—')}</strong>
        </li>
      ))}
    </ul>
  );
}

/** Ripresenta la propria modifica sopra la versione attuale della riga. */
function TieniIlMio({ id, tipo, dati }: { id: string; tipo: string; dati: Record<string, unknown> }) {
  const { sync, archivio, famiglia, pianificatore } = useFamiglia();
  async function tieni() {
    const [tabella, idRiga] = tipo === 'modifica_famiglia' ? (['famiglia', famiglia] as const) : (['membro', dati.id] as const);
    const riga = (await archivio.righeDi(famiglia, tabella)).find((r) => r.id === idRiga);
    const versione = riga?.versione ?? (dati.versione_attesa as number);
    await sync.sostituisci(id, { ...dati, versione_attesa: versione });
    pianificatore.subito();
  }
  return (
    <button className="bottone primario" onClick={tieni}>
      Tieni la mia
    </button>
  );
}
