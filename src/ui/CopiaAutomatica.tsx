import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { idDispositivo, righeAttive, useFamiglia, useVista } from '../dati/contesto';
import {
  ascoltaCopia,
  leggiCollegamento,
  leggiFile,
  ripristinaSulTelefono,
  salvaSulDrive,
  scriviCollegamento,
  statoCopia,
  type StatoCopia,
} from '../dati/copiaDrive';
import { VERSIONE_APP } from '../dati/tipi';
import { collegaDrive, leggiCopia, tokenValido } from '../piattaforma/drive';
import { spiegaErroreDrive } from './Drive';

/** Dopo una modifica si aspetta un po' prima di salvare: più modifiche di fila diventano un solo salvataggio. */
const ATTESA = 15_000;

export function useStatoCopia(famiglia: string): StatoCopia | null {
  return useSyncExternalStore(
    useCallback((avviso: () => void) => ascoltaCopia((f) => f === famiglia && avviso()), [famiglia]),
    () => statoCopia(famiglia),
  );
}

/**
 * Per le famiglie «sul mio Google Drive»: salva la copia da sola dopo ogni modifica. Si fa vedere solo quando
 * serve un tocco (Google chiede di nuovo il permesso, circa ogni ora) o quando sul Drive c'è una copia più
 * recente salvata da un altro dispositivo.
 */
export function CopiaAutomatica({ apriFamiglia }: { apriFamiglia: (famiglia: string) => void }) {
  const { famiglia, dove, trasporto, utenteId } = useFamiglia();
  const vista = useVista();
  const stato = useStatoCopia(famiglia);
  const nome = String(righeAttive(vista, 'famiglia')[0]?.nome ?? 'Famiglia');
  const collegata = dove === 'locale' && stato !== null;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [errore, setErrore] = useState<string | null>(null);

  // Ogni volta che cambiano i dati (e la prima volta, se la copia non c'è ancora) si programma un salvataggio.
  useEffect(() => {
    if (!collegata || !vista.pronta) return;
    clearTimeout(timer.current);
    const subito = !leggiCollegamento(famiglia)?.file;
    timer.current = setTimeout(
      () => {
        // Con una copia più recente sul Drive non si sovrascrive finché la persona non sceglie.
        if (statoCopia(famiglia)?.tipo !== 'conflitto') void salvaSulDrive({ famiglia, nome, trasporto });
      },
      subito ? 0 : ATTESA,
    );
    return () => clearTimeout(timer.current);
  }, [collegata, vista.righe, vista.pronta, famiglia, nome, trasporto]);

  if (!collegata || !stato) return null;

  async function aggiorna() {
    setErrore(null);
    try {
      await collegaDrive(false);
    } catch (e) {
      return setErrore(spiegaErroreDrive(e));
    }
    await salvaSulDrive({ famiglia, nome, trasporto });
  }

  /** Si passa alla copia del Drive: diventa la famiglia sul telefono, quella di prima si toglie. */
  async function usaQuellaDelDrive() {
    setErrore(null);
    try {
      if (!tokenValido()) await collegaDrive(false);
      const c = leggiCollegamento(famiglia);
      if (!c?.file) return;
      const { info, testo } = await leggiCopia(c.file);
      const file = leggiFile(testo);
      if (!file) return setErrore('La copia sul Drive non è leggibile: tengo questa.');
      const io = righeAttive(vista, 'membro').find((m) => m.utente_id === utenteId);
      const r = await ripristinaSulTelefono(utenteId, file, String(file.tabelle.famiglia[0].nome), String(io?.nome ?? ''));
      if ('esito' in r) return setErrore('Non sono riuscito a usare la copia del Drive.');
      scriviCollegamento(r.famiglia, { file: info.id, version: info.version, salvata_il: info.modificata });
      scriviCollegamento(famiglia, null);
      await trasporto.applica({ id: crypto.randomUUID(), famiglia_id: famiglia, tipo: 'elimina_famiglia', dati: { nome }, versione_app: VERSIONE_APP, dispositivo: idDispositivo() });
      apriFamiglia(r.famiglia);
    } catch (e) {
      setErrore(spiegaErroreDrive(e));
    }
  }

  if (stato.tipo === 'serve_permesso')
    return (
      <div className="avviso info" role="status">
        🗂️ Per aggiornare la copia sul tuo Drive, Google chiede di confermare.{' '}
        <button className="bottone piccolo primario" onClick={() => void aggiorna()}>
          Aggiorna la copia
        </button>
        {errore && <p style={{ marginBottom: 0 }}>{errore}</p>}
      </div>
    );
  if (stato.tipo === 'conflitto')
    return (
      <div className="avviso errore" role="alert">
        <p style={{ marginTop: 0 }}>
          Sul tuo Drive c’è una copia più recente di «{nome}», salvata da un altro dispositivo il{' '}
          {new Date(stato.modificata).toLocaleString('it-IT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}. Quale tieni?
        </p>
        <div className="riga" style={{ flexWrap: 'wrap' }}>
          <button className="bottone piccolo primario" onClick={() => void usaQuellaDelDrive()}>
            Usa quella del Drive
          </button>
          <button className="bottone piccolo" onClick={() => void salvaSulDrive({ famiglia, nome, trasporto, sovrascrivi: true })}>
            Tieni questa
          </button>
        </div>
        {errore && <p style={{ marginBottom: 0 }}>{errore}</p>}
      </div>
    );
  return null;
}
