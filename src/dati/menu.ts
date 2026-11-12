/** I dati del menu letti dalla vista (persone, vincoli, portate, ospiti…) e come si descrive un piatto: servono a Menu, Oggi, Ricette, Proposte. */
import { useEffect, useMemo, useRef } from 'react';
import { useFamiglia, useVista, type Vista } from './contesto';
import type { Verifica, Vincolo } from '../dominio/compatibilita';
import { alPasto, type CategoriaPasto, categorieDellaFamiglia, type Eccezione, type Gusto, gustiPerPiatto, type OspitiPasto, ospitiDel, type Persona, type PortataMenu, valutaPortata } from '../dominio/menu';
import { avanziDi, porzioniPortata } from '../dominio/consumi';
import { type Indice, numeroONull } from '../dominio/ricette';
import { oggi, piuGiorni } from '../dominio/scadenze';
import { leggiSenza, testoSenza } from '../dominio/senza';

export interface DatiMenu {
  persone: Persona[];
  vincoli: Vincolo[];
  verifiche: Verifica[];
  gusti: Gusto[];
  categorie: CategoriaPasto[];
  portate: PortataMenu[];
  eccezioni: Eccezione[];
  ospiti: OspitiPasto[];
}


export function useDatiMenu(vista: Vista): DatiMenu {
  // Solo le tabelle del menu: un cambio in casa o nella spesa non rifà questi calcoli.
  const { membro, vincolo_alimentare, ricetta_verificata, gusto, categoria_pasto, portata, eccezione_membro, ospiti_pasto } = vista.righe;
  return useMemo(() => {
    const r = { membro, vincolo_alimentare, ricetta_verificata, gusto, categoria_pasto, portata, eccezione_membro, ospiti_pasto };
    const attive = (t: keyof typeof r) => (r[t] ?? []).filter((x) => !x.eliminato_il);
    return {
      persone: attive('membro')
        .filter((m) => !m.archiviato)
        .map((m) => ({
          id: m.id,
          nome: String(m.nome),
          porzione: Number(m.porzione ?? 1),
        })),
      vincoli: attive('vincolo_alimentare') as unknown as Vincolo[],
      verifiche: attive('ricetta_verificata').map((v) => ({
        membro_id: String(v.membro_id),
        ricetta_id: String(v.ricetta_id),
        versione_ricetta: Number(v.versione_ricetta),
        va_bene: v.va_bene !== false,
      })),
      gusti: attive('gusto') as unknown as Gusto[],
      categorie: categorieDellaFamiglia(attive('categoria_pasto')),
      portate: attive('portata')
        .map((p) => ({
          ...(p as unknown as PortataMenu),
          porzioni: numeroONull(p.porzioni),
          ordine: Number(p.ordine ?? 0),
          bloccata: !!p.bloccata,
          ricetta_id: (p.ricetta_id as string | null) ?? null,
          testo: (p.testo as string | null) ?? null,
          senza: leggiSenza(p.senza),
        }))
        .sort((a, b) => a.ordine - b.ordine || String(a.id).localeCompare(String(b.id))),
      eccezioni: attive('eccezione_membro').map((e) => ({
        ...(e as unknown as Eccezione),
        porzioni: numeroONull(e.porzioni),
      })),
      ospiti: attive('ospiti_pasto').map((o) => ({
        ...(o as unknown as OspitiPasto),
        adulti: Number(o.adulti ?? 0),
        bambini: Number(o.bambini ?? 0),
        oggetti: (o.oggetti as string[] | null) ?? [],
      })),
    };
  }, [membro, vincolo_alimentare, ricetta_verificata, gusto, categoria_pasto, portata, eccezione_membro, ospiti_pasto]);
}

/** I dati del menu visti da un pasto: gli ospiti di quel pasto contano come una persona in più, con le loro esigenze. */
export function datiAlPasto(dati: DatiMenu, data: string, categoria: string): DatiMenu {
  return {
    ...dati,
    ...alPasto(dati.persone, dati.vincoli, ospitiDel(dati.ospiti, data, categoria)),
  };
}

/** Come si presenta un piatto: nome, esito per chi lo mangia (ospiti compresi), gusti contrari, porzioni. */
export function descrivi(indice: Indice, dati: DatiMenu, p: PortataMenu) {
  const ricetta = p.ricetta_id ? (indice.perId.get(p.ricetta_id) ?? null) : null;
  const eccezioni = dati.eccezioni.filter((e) => e.portata_id === p.id);
  const alTavolo = alPasto(dati.persone, dati.vincoli, ospitiDel(dati.ospiti, p.data, p.categoria));
  const valutazione = alTavolo.vincoli.length ? valutaPortata(indice, ricetta, alTavolo.persone, alTavolo.vincoli, eccezioni, dati.verifiche, p.senza) : null;
  const mangiano = dati.persone.filter((x) => !eccezioni.some((e) => e.membro_id === x.id));
  const gusti = ricetta ? gustiPerPiatto(indice, ricetta, mangiano, dati.gusti) : [];
  return {
    ricetta,
    titolo: ricetta?.titolo ?? p.testo ?? 'Piatto',
    /** «senza panna per Sara»: cosa è tolto dal piatto. */
    senza: ricetta ? testoSenza(indice, p.senza, dati.persone) : '',
    eccezioni,
    valutazione,
    gusti,
    nonPiace: gusti.filter((g) => g.valore === 'non_piace'),
    porzioni: porzioniPortata(p, dati.persone, dati.eccezioni, dati.ospiti),
    /** Porzioni messe da parte per i giorni dopo (piatto che dura più giorni). */
    dopo: avanziDi(p, dati.portate).reduce((t, a) => t + porzioniPortata(a, dati.persone, dati.eccezioni, dati.ospiti), 0),
  };
}

/**
 * Chiede al database di creare i giorni dei piatti fissi che mancano fino a `fino` (al più 60 giorni avanti).
 * Lo chiede una volta per data limite: il comando è idempotente, più dispositivi non creano doppioni.
 */
export function useProlungaFissi(fino: string) {
  const vista = useVista();
  const { esegui } = useFamiglia();
  const chiesto = useRef(new Set<string>());
  const { pasto_fisso: regole, portata: portate } = vista.righe;
  const pronta = vista.pronta;
  const inCoda = vista.coda.some((v) => v.comando.tipo === 'prolunga_pasti_fissi' || v.comando.tipo === 'fissa_pasto');
  useEffect(() => {
    if (!pronta || inCoda) return;
    const giorno = oggi();
    const massimo = piuGiorni(giorno, 60);
    const limite = fino < massimo ? fino : massimo;
    const presenti = new Set((portate ?? []).filter((p) => p.fisso_id).map((p) => `${String(p.fisso_id)}|${String(p.data)}`));
    const manca = (regole ?? []).some((f) => {
      if (f.eliminato_il) return false;
      const al = f.al ? String(f.al) : limite;
      const fine = al < limite ? al : limite;
      for (let d = String(f.dal) > giorno ? String(f.dal) : giorno; d <= fine; d = piuGiorni(d, 1)) if (!presenti.has(`${f.id}|${d}`)) return true;
      return false;
    });
    if (!manca || chiesto.current.has(limite)) return;
    chiesto.current.add(limite);
    void esegui('prolunga_pasti_fissi', { fino_a: limite });
  }, [pronta, inCoda, regole, portate, fino, esegui]);
}

/** «per Luca e Anna» quando non tutti mangiano il piatto. */
export function chiLoMangia(dati: DatiMenu, eccezioni: Eccezione[]): string {
  const nomi = dati.persone.filter((x) => !eccezioni.some((e) => e.membro_id === x.id)).map((x) => x.nome);
  if (!nomi.length) return 'nessuno della famiglia';
  return `per ${nomi.length > 1 ? `${nomi.slice(0, -1).join(', ')} e ${nomi[nomi.length - 1]}` : nomi[0]}`;
}

export function nomeCategoria(dati: DatiMenu, valore: string) {
  return dati.categorie.find((c) => c.valore === valore)?.nome ?? 'Pasto';
}
