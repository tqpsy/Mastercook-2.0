import { useLetturaFoto, chiediApertura } from '../piattaforma/letturaFoto';

/**
 * L'avviso in alto mentre la foto del frigo viene letta (o è pronta da controllare): si vede in ogni scheda, così
 * si può fare altro nell'attesa. Toccandolo si torna alla foto, in Casa.
 */
export function AvvisoLetturaFoto({ vai }: { vai: (s: 'casa') => void }) {
  const { lettura, aperta } = useLetturaFoto();
  if (!lettura || aperta) return null;
  const testo =
    lettura.fase === 'pronta'
      ? 'La foto del frigo è pronta: controlla cosa ho trovato'
      : lettura.fase === 'errore'
        ? 'La lettura della foto del frigo non è riuscita'
        : 'Sto leggendo la foto del frigo… puoi continuare a usare l’app';
  return (
    <button
      className={`stato-sync avviso-sync ${lettura.fase === 'errore' ? 'errore' : lettura.fase === 'pronta' ? 'ok' : 'attesa'}`}
      onClick={() => {
        chiediApertura();
        vai('casa');
      }}
      aria-label={testo}
    >
      {testo}
    </button>
  );
}
