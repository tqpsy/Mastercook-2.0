import { chiediApertura, useLetture } from '../piattaforma/letturaFoto';

/**
 * L'avviso in alto mentre una foto viene letta (foto del frigo o verifica con le foto), o è pronta da controllare:
 * si vede in ogni scheda, così si può fare altro nell'attesa. Toccandolo si torna alla foto, in Casa.
 */
export function AvvisoLetturaFoto({ vai }: { vai: (s: 'casa') => void }) {
  const { frigo, zone, aperte } = useLetture();
  const cosa = frigo && !aperte.frigo ? 'foto' : zone.length && !aperte.verifica ? 'verifica' : null;
  if (!cosa) return null;
  const fasi = cosa === 'foto' ? [frigo!.fase] : zone.map((z) => z.fase);
  const finita = fasi.every((f) => f === 'pronta' || f === 'errore');
  const errore = finita && fasi.some((f) => f === 'errore');
  const cosaTesto = cosa === 'foto' ? 'la foto del frigo' : 'le foto della verifica';
  const testo = !finita
    ? `Sto leggendo ${cosaTesto}… puoi continuare a usare l’app`
    : errore
      ? `La lettura di ${cosaTesto} non è riuscita`
      : cosa === 'foto'
        ? 'La foto del frigo è pronta: controlla cosa ho trovato'
        : 'La verifica è pronta: controlla cosa non torna';
  return (
    <button
      className={`stato-sync avviso-sync ${errore ? 'errore' : finita ? 'ok' : 'attesa'}`}
      onClick={() => {
        chiediApertura(cosa);
        vai('casa');
      }}
      aria-label={testo}
    >
      {testo}
    </button>
  );
}
