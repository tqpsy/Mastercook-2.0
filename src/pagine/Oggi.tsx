import { righeAttive, useVista } from '../dati/contesto';

/**
 * Nella Fase 1 la schermata Oggi dice onestamente cosa c'è già e cosa arriverà, senza dati finti.
 */
export function Oggi() {
  const vista = useVista();
  const famiglia = righeAttive(vista, 'famiglia')[0];
  const persone = righeAttive(vista, 'membro').filter((m) => !m.archiviato).length;
  const oggi = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <>
      <p className="tenue" style={{ textTransform: 'capitalize' }}>
        {oggi}
      </p>
      <h2>{famiglia ? `Ciao, ${String(famiglia.nome)}` : 'Ciao'}</h2>
      <div className="scheda">
        <p>
          {persone === 1 ? 'C’è 1 persona' : `Ci sono ${persone} persone`} in famiglia. Aggiungi chi mangia a casa, le allergie e le esigenze dalla scheda <strong>Famiglia</strong>, e invita gli altri da <strong>Impostazioni</strong>.
        </p>
      </div>
      <div className="avviso info">
        Menu della settimana, ricette, frigorifero e dispensa, lista della spesa e scadenze arriveranno nelle prossime fasi. Questa versione serve a creare la famiglia e a provare che tutto si salva e si sincronizza tra i dispositivi.
      </div>
    </>
  );
}
