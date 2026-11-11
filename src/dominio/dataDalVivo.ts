/**
 * Lettura della data dal vivo: la fotocamera guarda un fotogramma dopo l'altro e ogni lettura può sbagliare una cifra.
 * Una data vale solo quando la stessa compare in almeno due delle ultime letture: una cifra storta non si ripete uguale.
 */
import type { DataLetta } from './dataDaTesto';

export interface ConfermaData {
  /** Registra una lettura (null se in quel fotogramma non c'era nessuna data). Rende la data se è confermata. */
  registra(lettura: DataLetta | null): DataLetta | null;
}

export function nuovaConferma(finestra = 4, servono = 2): ConfermaData {
  let recenti: (DataLetta | null)[] = [];
  return {
    registra(lettura) {
      recenti = [...recenti, lettura].slice(-finestra);
      if (!lettura) return null;
      const uguali = recenti.filter((r): r is DataLetta => r?.data === lettura.data);
      if (uguali.length < servono) return null;
      const tipo = uguali.find((r) => r.tipo)?.tipo;
      return { data: lettura.data, ...(tipo ? { tipo } : {}) };
    },
  };
}
