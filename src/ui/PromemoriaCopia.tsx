import { useEffect, useState } from 'react';
import { useFamiglia } from '../dati/contesto';
import { salvaCopiaFile } from '../dati/copiaFile';
import { leggiCollegamento } from '../dati/copiaDrive';
import { leggiStatoCopia, rinviaPromemoria, segnaCopiaSalvata, segnaPrimaVolta } from '../dati/promemoriaCopia';
import { GIORNI_RINVIO, serveRicordareCopia } from '../dominio/promemoriaCopia';
import { oggi, piuGiorni } from '../dominio/scadenze';

/**
 * Per le famiglie «solo su questo telefono»: se da due settimane non c'è una copia, lo ricorda una volta ogni
 * tanto, perché perso il telefono (o cancellati i dati del browser) la famiglia sparisce. Salva con un tocco.
 */
export function PromemoriaCopia({ nomeFamiglia }: { nomeFamiglia: string }) {
  const { famiglia, dove, trasporto } = useFamiglia();
  const giorno = oggi();
  const [versione, setVersione] = useState(0);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    if (dove === 'locale') segnaPrimaVolta(famiglia, giorno);
  }, [dove, famiglia, giorno]);

  void versione; // si rilegge l'archivio dopo ogni scelta
  const serve = serveRicordareCopia({ dove, conDrive: leggiCollegamento(famiglia) !== null, ...leggiStatoCopia(famiglia) }, giorno);
  if (!serve) return null;

  async function salva() {
    setErrore(null);
    try {
      const esito = await salvaCopiaFile(trasporto, famiglia, nomeFamiglia, giorno);
      if (esito.tipo === 'annullata') return;
      segnaCopiaSalvata(famiglia, giorno);
      setVersione((v) => v + 1);
    } catch {
      setErrore('Non sono riuscito a preparare il file. Riprova.');
    }
  }

  return (
    <div className="avviso info" role="status">
      <p style={{ marginTop: 0 }}>
        📱 I dati di «{nomeFamiglia}» stanno solo su questo telefono e da un po’ non ne hai una copia. Se il telefono si perde, si perdono anche i menu, le ricette e la casa.
      </p>
      <div className="riga" style={{ flexWrap: 'wrap' }}>
        <button className="bottone piccolo primario" onClick={() => void salva()}>
          Salva una copia
        </button>
        <button
          className="bottone piccolo"
          onClick={() => {
            rinviaPromemoria(famiglia, piuGiorni(giorno, GIORNI_RINVIO));
            setVersione((v) => v + 1);
          }}
        >
          Più tardi
        </button>
      </div>
      {errore && <p style={{ marginBottom: 0 }}>{errore}</p>}
    </div>
  );
}
