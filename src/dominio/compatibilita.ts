/**
 * Una ricetta va bene per chi mangia a casa? Tre risposte possibili:
 * - «non adatta»: contiene qualcosa che un vincolo esclude;
 * - «da verificare»: mancano le informazioni per dirlo (ingrediente con allergeni non noti, tracce,
 *   intolleranze di cui l'app non ha dati, indicazioni scritte a parole);
 * - «adatta»: solo quando tutte le informazioni ci sono e nessun vincolo è violato.
 * Non è mai una promessa di sicurezza: è un aiuto a non sbagliare.
 */
import { ESIGENZE_CRUDI, righeCrude } from './crudi';
import { nomeOggetto } from './vincoli';
import type { Indice, Ricetta } from './ricette';

export type Esito = 'adatta' | 'da_verificare' | 'non_adatta';

export interface Vincolo {
  membro_id: string;
  tipo: string;
  oggetto: string;
  severita?: string | null;
  testo?: string | null;
}

export interface Valutazione {
  esito: Esito;
  motivi: string[];
  /** La famiglia ha controllato e segnato «va bene» (per questa versione della ricetta). */
  verificata?: boolean;
  /** Si può segnare «va bene»: niente allergie o intolleranze che la escludono. */
  verificabile?: boolean;
}

/** Una ricetta segnata «va bene» per un membro, valida finché la ricetta non cambia. */
export interface Verifica {
  membro_id: string;
  ricetta_id: string;
  versione_ricetta: number;
}

/** La versione verificata della ricetta per quel membro, se c'è. */
export function verificataPer(verifiche: Verifica[] | undefined, membro_id: string, ricetta_id: string): number | undefined {
  return verifiche?.find((v) => v.membro_id === membro_id && v.ricetta_id === ricetta_id)?.versione_ricetta;
}

const CLASSI_ESCLUSE: Record<string, string[]> = {
  vegetariano: ['carne', 'pesce'],
  vegano: ['carne', 'pesce', 'latticini', 'uova', 'miele'],
  senza_maiale: ['maiale'],
  senza_alcol: ['alcol'],
};

/** Intolleranze che l'app sa ricondurre ai dati degli ingredienti. Le altre restano «da verificare». */
const INTOLLERANZE_NOTE: Record<string, { classe: string; nome: string }> = {
  lattosio: { classe: 'latticini', nome: 'latticini' },
};

const PEGGIORE: Record<Esito, number> = {
  adatta: 0,
  da_verificare: 1,
  non_adatta: 2,
};

function peggiore(a: Esito, b: Esito): Esito {
  return PEGGIORE[a] >= PEGGIORE[b] ? a : b;
}

/**
 * La valutazione con il «va bene» della famiglia: vale per i dubbi e per le esigenze (crudi, vegetariano…),
 * mai contro un'allergia o un'intolleranza che esclude la ricetta, e decade se la ricetta cambia.
 */
export function valutaPerVincoli(indice: Indice, r: Ricetta, vincoli: Vincolo[], versioneVerificata?: number): Valutazione {
  const v = valuta(indice, r, vincoli);
  if (v.esito === 'adatta') return v;
  const verificabile = v.esito === 'da_verificare' || valuta(indice, r, vincoli.filter((x) => x.tipo !== 'esigenza')).esito !== 'non_adatta';
  if (verificabile && versioneVerificata !== undefined && versioneVerificata === (r.versione ?? 1)) {
    return { esito: 'adatta', motivi: ['segnata «va bene» da voi'], verificata: true, verificabile };
  }
  return { ...v, verificabile };
}

function valuta(indice: Indice, r: Ricetta, vincoli: Vincolo[]): Valutazione {
  let esito: Esito = 'adatta';
  const motivi: string[] = [];
  const segna = (e: Esito, motivo: string) => {
    esito = peggiore(esito, e);
    if (!motivi.includes(motivo)) motivi.push(motivo);
  };

  const righe = r.ingredienti.map((g) => ({
    g,
    ing: indice.ingrediente(g.ingrediente_id),
  }));
  const sconosciuti = righe.filter((x) => !x.ing || !x.ing.allergeni_noti);

  for (const v of vincoli) {
    const [prefisso, codice] = v.oggetto.split(':') as [string, string];
    const nome = nomeOggetto(v.oggetto, v.testo);

    if (prefisso === 'all') {
      const contengono = righe.filter((x) => x.ing?.allergeni.includes(codice));
      const obbligatori = contengono.filter((x) => !x.g.opzionale);
      if (r.allergeni_dichiarati.includes(codice) || obbligatori.length) {
        segna('non_adatta', `contiene ${nome.toLowerCase()}${obbligatori.length ? ` (${obbligatori.map((x) => x.ing!.nome.toLowerCase()).join(', ')})` : ''}`);
      } else if (contengono.length) {
        segna('da_verificare', `${nome.toLowerCase()} negli ingredienti facoltativi (${contengono.map((x) => x.ing!.nome.toLowerCase()).join(', ')})`);
      } else if (sconosciuti.length) {
        segna('da_verificare', `allergeni non noti per ${sconosciuti.map((x) => (x.ing?.nome ?? 'un ingrediente').toLowerCase()).join(', ')}`);
      } else if (v.severita === 'evitare_anche_tracce') {
        segna('da_verificare', `possibili tracce di ${nome.toLowerCase()}: controlla le etichette`);
      }
      continue;
    }

    const sulCrudo = ESIGENZE_CRUDI.find((e) => e.oggetto === v.oggetto);
    if (sulCrudo) {
      const righe = righeCrude(indice, r, sulCrudo.crudo);
      const elenca = (xs: typeof righe) => xs.map((x) => x.nome).join(', ');
      const crudi = righe.filter((x) => x.crudo === true);
      const sicuri = crudi.filter((x) => !x.forse && !x.opzionale);
      if (sicuri.length) segna('non_adatta', `${nome.toLowerCase()}: ${elenca(sicuri)} non si cuoce`);
      else if (crudi.length)
        segna('da_verificare', `${nome.toLowerCase()}: controlla ${elenca(crudi)} (${crudi.some((x) => x.forse) ? 'guarda l’etichetta' : 'è facoltativo'})`);
      const nonSo = righe.filter((x) => x.crudo === null);
      if (nonSo.length) segna('da_verificare', `${nome.toLowerCase()}: controlla se ${elenca(nonSo)} si cuoce`);
      else if (sconosciuti.length)
        segna('da_verificare', `ingredienti senza informazioni: ${sconosciuti.map((x) => (x.ing?.nome ?? '?').toLowerCase()).join(', ')}`);
      continue;
    }

    if (prefisso === 'cls') {
      const classi = CLASSI_ESCLUSE[codice];
      if (!classi) {
        segna('da_verificare', `da controllare: ${nome}`);
        continue;
      }
      const violano = righe.filter((x) => x.ing?.classi.some((c) => classi.includes(c)));
      const obbligatori = violano.filter((x) => !x.g.opzionale);
      if (obbligatori.length) segna('non_adatta', `non ${nome.toLowerCase()}: ${obbligatori.map((x) => x.ing!.nome.toLowerCase()).join(', ')}`);
      else if (violano.length) segna('da_verificare', `non ${nome.toLowerCase()} se aggiungi ${violano.map((x) => x.ing!.nome.toLowerCase()).join(', ')}`);
      else if (sconosciuti.length)
        segna('da_verificare', `ingredienti senza informazioni: ${sconosciuti.map((x) => (x.ing?.nome ?? '?').toLowerCase()).join(', ')}`);
      continue;
    }

    if (prefisso === 'ing') {
      const nota = INTOLLERANZE_NOTE[codice];
      if (nota) {
        const violano = righe.filter((x) => x.ing?.classi.includes(nota.classe as never) && !x.g.opzionale);
        if (violano.length) segna('non_adatta', `${nome.toLowerCase()}: contiene ${violano.map((x) => x.ing!.nome.toLowerCase()).join(', ')}`);
        else if (sconosciuti.length) segna('da_verificare', `${nome.toLowerCase()}: ingredienti senza informazioni`);
        continue;
      }
      if (!indice.ingrediente(v.oggetto)) {
        segna('da_verificare', `l’app non ha dati su ${nome.toLowerCase()}`);
        continue;
      }
      const violano = righe.filter((x) => indice.antenati(x.g.ingrediente_id).includes(v.oggetto));
      if (violano.some((x) => !x.g.opzionale)) segna('non_adatta', `contiene ${nome.toLowerCase()}`);
      else if (violano.length) segna('da_verificare', `${nome.toLowerCase()} tra i facoltativi`);
      continue;
    }

    // Testo libero o indicazione del medico: l'app non può valutarla da sola.
    segna('da_verificare', `da controllare: ${v.testo ?? nome}`);
  }
  return { esito, motivi };
}

export interface ValutazioneFamiglia {
  esito: Esito;
  perMembro: { membro_id: string; nome: string; valutazione: Valutazione }[];
}

/** Valuta la ricetta per ognuno; l'esito complessivo è il peggiore. */
export function valutaPerFamiglia(
  indice: Indice,
  r: Ricetta,
  membri: { id: string; nome: string }[],
  vincoli: Vincolo[],
  verifiche?: Verifica[],
): ValutazioneFamiglia {
  const perMembro = membri.map((m) => ({
    membro_id: m.id,
    nome: m.nome,
    valutazione: valutaPerVincoli(
      indice,
      r,
      vincoli.filter((v) => v.membro_id === m.id),
      verificataPer(verifiche, m.id, r.id),
    ),
  }));
  return {
    esito: perMembro.reduce<Esito>((e, x) => peggiore(e, x.valutazione.esito), 'adatta'),
    perMembro,
  };
}

export const NOME_ESITO: Record<Esito, string> = {
  adatta: 'Adatta a tutti',
  da_verificare: 'Da verificare',
  non_adatta: 'Non adatta a tutti',
};
