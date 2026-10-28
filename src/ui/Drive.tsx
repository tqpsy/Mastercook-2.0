import { useEffect, useState } from 'react';
import { leggiFile, ripristinaSulTelefono, scriviCollegamento } from '../dati/copiaDrive';
import { spiegaMotivo } from '../dati/messaggi';
import { caricaGoogle, collegaDrive, type CopiaDrive, elencaCopie, leggiCopia } from '../piattaforma/drive';
import { Foglio } from './Foglio';

/**
 * Prima di chiedere il permesso a Google: cosa farà Mastercook con il Drive e cosa non farà mai.
 * Il tocco su «Continua» apre subito la finestra di Google (serve un tocco, per i blocchi dei popup).
 */
export function SpiegazioneDrive({ continua, chiudi }: { continua: () => void; chiudi: () => void }) {
  useEffect(() => {
    // La libreria di Google si carica ora, così al tocco la finestra si apre subito.
    void caricaGoogle().catch(() => undefined);
  }, []);
  return (
    <Foglio titolo="Il tuo Google Drive" chiudi={chiudi}>
      <p style={{ marginTop: 0 }}>
        Mastercook crea nel tuo Drive una cartella chiamata <strong>«Mastercook»</strong> e ci salva la copia dei dati della famiglia, da sola, ogni volta che
        cambia qualcosa.
      </p>
      <ul className="elenco-spiegazione" aria-label="Cosa fa Mastercook con il tuo Drive">
        <li>
          <span aria-hidden>✅</span> Usa <strong>solo i file che crea lei</strong>, in quella cartella.
        </li>
        <li>
          <span aria-hidden>🚫</span> <strong>Non vede, non legge e non tocca</strong> nessun altro file o cartella del tuo Drive. Lo garantisce Google: il
          permesso che chiediamo vale solo per i file creati da Mastercook.
        </li>
        <li>
          <span aria-hidden>🔒</span> La copia va dal telefono al tuo Drive: <strong>non passa dal server di Mastercook</strong> e nessun altro la vede.
        </li>
        <li>
          <span aria-hidden>📱</span> Su un telefono nuovo accedi con lo stesso account Google e ritrovi la famiglia.
        </li>
        <li>
          <span aria-hidden>↩️</span> Puoi scollegare quando vuoi, da Impostazioni o dal tuo account Google. La cartella resta tua.
        </li>
      </ul>
      <p className="tenue">Ora si apre una finestra di Google che ti chiede proprio questo permesso: solo i file di Drive che usi con Mastercook.</p>
      <div className="riga" style={{ flexWrap: 'wrap' }}>
        <button className="bottone primario" onClick={continua}>
          Ho capito, continua
        </button>
        <button className="bottone" onClick={chiudi}>
          Non ora
        </button>
      </div>
    </Foglio>
  );
}

export function spiegaErroreDrive(e: unknown): string {
  const motivo = (e as { motivo?: string })?.motivo;
  if (motivo === 'negato') return 'Google non ha dato il permesso: senza, Mastercook non può salvare la copia. Puoi riprovare quando vuoi.';
  if (motivo === 'rete') return 'Serve la connessione per collegare il Drive.';
  return 'Il Drive non ha risposto. Riprova tra poco.';
}

/** Su un telefono nuovo: ritrovare dal Drive una famiglia salvata lì. */
export function TrovaSulDrive({ utenteId, nomeUtente, trovata }: { utenteId: string; nomeUtente: string; trovata: (famiglia: string) => void }) {
  const [spiega, setSpiega] = useState(false);
  const [copie, setCopie] = useState<CopiaDrive[] | null>(null);
  const [attendi, setAttendi] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  async function collega() {
    setSpiega(false);
    setErrore(null);
    try {
      await collegaDrive(true);
      setCopie(await elencaCopie());
    } catch (e) {
      setErrore(spiegaErroreDrive(e));
    }
  }

  async function usa(c: CopiaDrive) {
    setAttendi(true);
    setErrore(null);
    try {
      const { info, testo } = await leggiCopia(c.id);
      const file = leggiFile(testo);
      if (!file) throw new Error('file');
      const r = await ripristinaSulTelefono(utenteId, file, String(file.tabelle.famiglia[0].nome), nomeUtente);
      if ('esito' in r) {
        setErrore(spiegaMotivo(r.esito.dettaglio.motivo));
        return setAttendi(false);
      }
      scriviCollegamento(r.famiglia, { file: info.id, version: info.version, salvata_il: info.modificata });
      trovata(r.famiglia);
    } catch (e) {
      setErrore(e instanceof Error && e.message === 'file' ? 'Questo file non è una copia di Mastercook leggibile.' : spiegaErroreDrive(e));
      setAttendi(false);
    }
  }

  return (
    <div style={{ textAlign: 'left' }}>
      {copie === null ? (
        <button className="bottone pieno" onClick={() => setSpiega(true)}>
          Cerca nel mio Google Drive
        </button>
      ) : copie.length === 0 ? (
        <p className="tenue">Nella cartella Mastercook del tuo Drive non ci sono famiglie salvate.</p>
      ) : (
        <ul className="elenco" aria-label="Famiglie sul Drive">
          {copie.map((c) => (
            <li key={c.id} className="riga">
              <span className="cresce">
                {c.nome.replace(/\.json$/, '')}
                <span className="tenue" style={{ display: 'block' }}>
                  salvata il {new Date(c.modificata).toLocaleString('it-IT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                </span>
              </span>
              <button className="bottone primario piccolo" disabled={attendi} onClick={() => void usa(c)}>
                Usa questa
              </button>
            </li>
          ))}
        </ul>
      )}
      {errore && <div className="avviso errore">{errore}</div>}
      {spiega && <SpiegazioneDrive continua={() => void collega()} chiudi={() => setSpiega(false)} />}
    </div>
  );
}
