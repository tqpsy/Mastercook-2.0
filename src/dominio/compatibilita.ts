/**
 * Una ricetta va bene per chi mangia a casa? Tre risposte possibili:
 * - «non adatta»: contiene qualcosa che un vincolo esclude;
 * - «da verificare»: mancano le informazioni per dirlo (ingrediente con allergeni non noti, tracce,
 *   intolleranze di cui l'app non ha dati, indicazioni scritte a parole);
 * - «adatta»: solo quando tutte le informazioni ci sono e nessun vincolo è violato.
 * Non è mai una promessa di sicurezza: è un aiuto a non sbagliare.
 */
import { ESIGENZE_CRUDI, righeCrude } from './crudi';
import { classiDi, interpreta } from './interpreta';
import { normalizza, type Indice, type Ricetta } from './ricette';
import { nomeOggetto } from './vincoli';

export type Esito = 'adatta' | 'da_verificare' | 'non_adatta';

export interface Vincolo {
  membro_id: string;
  tipo: string;
  oggetto: string;
  severita?: string | null;
  testo?: string | null;
}

/** Un motivo, con il suo peso: ⛔ da evitare o ❓ da controllare. */
export interface Motivo {
  esito: Exclude<Esito, 'adatta'>;
  testo: string;
}

export interface Valutazione {
  esito: Esito;
  motivi: string[];
  dettagli?: Motivo[];
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
  no_carne: ['carne'],
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
    return { esito: 'adatta', motivi: ['segnata «va bene» da voi'], dettagli: [], verificata: true, verificabile };
  }
  return { ...v, verificabile };
}

function valuta(indice: Indice, r: Ricetta, vincoli: Vincolo[]): Valutazione {
  let esito: Esito = 'adatta';
  const dettagli: Motivo[] = [];
  const segna = (e: Exclude<Esito, 'adatta'>, testo: string) => {
    esito = peggiore(esito, e);
    if (!dettagli.some((d) => d.testo === testo)) dettagli.push({ esito: e, testo });
  };

  const righe = r.ingredienti.map((g) => {
    const ing = indice.ingrediente(g.ingrediente_id);
    return { g, ing, nome: (ing?.nome ?? 'un ingrediente').toLowerCase(), tipo: classiDi(indice, ing) };
  });
  const elenca = (xs: { nome: string }[]) => [...new Set(xs.map((x) => x.nome))].join(', ');
  // Per gli allergeni servono gli allergeni; per carne, crudi, alcol… basta sapere che cos'è l'ingrediente.
  const senzaAllergeni = righe.filter((x) => !x.ing || !x.ing.allergeni_noti);
  const senzaTipo = righe.filter((x) => !x.tipo.note);
  const nonSoCosE = () => {
    if (senzaTipo.length) segna('da_verificare', `non so cos’è ${elenca(senzaTipo)}: è un ingrediente vostro, controllalo tu`);
  };

  /** Ingredienti da evitare (con le loro varietà); per quelli della famiglia conta anche il nome. */
  const evitaIngredienti = (ids: string[], nome: string) => {
    const nomi = ids.flatMap((id) => {
      const i = indice.ingrediente(id);
      return i ? [i.nome, ...i.sinonimi].map(normalizza) : [];
    });
    const violano = righe.filter(
      (x) =>
        indice.antenati(x.g.ingrediente_id).some((a) => ids.includes(a)) ||
        (x.ing && !x.ing.di_sistema && nomi.some((n) => ` ${normalizza(x.ing!.nome)} `.includes(` ${n} `))),
    );
    const obbligatori = violano.filter((x) => !x.g.opzionale);
    if (obbligatori.length) segna('non_adatta', `contiene ${nome.toLowerCase()} (${elenca(obbligatori)})`);
    else if (violano.length) segna('da_verificare', `${elenca(violano)} è facoltativo: non metterlo (${nome.toLowerCase()})`);
  };

  const controlla = (oggetto: string, nome: string, severita?: string | null) => {
    const [prefisso, codice] = oggetto.split(':') as [string, string];

    if (prefisso === 'all') {
      const contengono = righe.filter((x) => x.ing?.allergeni.includes(codice));
      const obbligatori = contengono.filter((x) => !x.g.opzionale);
      if (r.allergeni_dichiarati.includes(codice) || obbligatori.length) {
        segna('non_adatta', `contiene ${nome.toLowerCase()}${obbligatori.length ? ` (${elenca(obbligatori)})` : ''}`);
      } else if (contengono.length) {
        segna('da_verificare', `${nome.toLowerCase()} solo nei facoltativi: non mettere ${elenca(contengono)}`);
      } else if (senzaAllergeni.length) {
        segna('da_verificare', `non so se ${elenca(senzaAllergeni)} contiene ${nome.toLowerCase()}: guarda l’etichetta`);
      } else if (severita === 'evitare_anche_tracce') {
        segna('da_verificare', `possibili tracce di ${nome.toLowerCase()}: controlla le etichette`);
      }
      return;
    }

    const sulCrudo = ESIGENZE_CRUDI.find((e) => e.oggetto === oggetto);
    if (sulCrudo) {
      const crude = righeCrude(indice, r, sulCrudo.crudo);
      const crudi = crude.filter((x) => x.crudo === true);
      const sicuri = crudi.filter((x) => !x.forse && !x.opzionale);
      const etichetta = sulCrudo.nome.toLowerCase();
      if (sicuri.length)
        segna(
          'non_adatta',
          `${etichetta}: ${elenca(sicuri)} senza cottura completa in questa ricetta${sulCrudo.crudo === 'uova' ? ' (con uova pastorizzate potete segnare «Va bene»)' : ''}`,
        );
      else if (crudi.length)
        segna(
          'da_verificare',
          crudi.some((x) => x.forse) ? `${etichetta}: guarda l’etichetta di ${elenca(crudi)} (può essere a latte crudo)` : `${etichetta}: ${elenca(crudi)} è facoltativo, non metterlo`,
        );
      const nonSo = crude.filter((x) => x.crudo === null);
      if (nonSo.length) segna('da_verificare', `${etichetta}: ricetta vostra, non so se ${elenca(nonSo)} viene cotto del tutto`);
      nonSoCosE();
      return;
    }

    if (prefisso === 'cls') {
      const classi = CLASSI_ESCLUSE[codice];
      if (!classi) {
        segna('da_verificare', `da controllare: ${nome}`);
        return;
      }
      const violano = righe.filter((x) => x.tipo.classi.some((c) => classi.includes(c)));
      const obbligatori = violano.filter((x) => !x.g.opzionale);
      const cosa = codice.startsWith('no_') ? `contiene ${nome.toLowerCase()}` : `non ${nome.toLowerCase()}`;
      if (obbligatori.length) segna('non_adatta', `${cosa}: ${elenca(obbligatori)}`);
      else if (violano.length) segna('da_verificare', `${elenca(violano)} è facoltativo: non metterlo (${nome.toLowerCase()})`);
      nonSoCosE();
      return;
    }

    if (prefisso === 'ing') {
      const nota = INTOLLERANZE_NOTE[codice];
      if (nota) {
        const violano = righe.filter((x) => x.tipo.classi.includes(nota.classe as never) && !x.g.opzionale);
        if (violano.length) segna('non_adatta', `${nome.toLowerCase()}: contiene ${elenca(violano)}`);
        else nonSoCosE();
        return;
      }
      if (!indice.ingrediente(oggetto)) {
        segna('da_verificare', `l’app non ha dati su ${nome.toLowerCase()}: controlla tu`);
        return;
      }
      evitaIngredienti([oggetto], nome);
      return;
    }
    segna('da_verificare', `da controllare: ${nome}`);
  };

  for (const v of vincoli) {
    if (v.oggetto.startsWith('txt:') && v.tipo !== 'indicazione_medica') {
      // Scritto a parole: si traduce in allergeni, esigenze e ingredienti, e si controlla come quelli.
      const testo = v.testo ?? nomeOggetto(v.oggetto);
      const { capiti, nonCapiti } = interpreta(indice, testo);
      for (const c of capiti) {
        if (c.oggetto) controlla(c.oggetto, c.oggetto.startsWith('cls:no_') ? c.nome : nomeOggetto(c.oggetto, c.nome), v.severita);
        else evitaIngredienti(c.ingredienti ?? [], c.ingredienti?.length === 1 ? c.testo : c.nome);
      }
      for (const n of nonCapiti) segna('da_verificare', `non ho capito «${n}»: controlla tu`);
      if (!capiti.length && !nonCapiti.length) segna('da_verificare', `da controllare: ${testo}`);
      continue;
    }
    if (v.oggetto.startsWith('txt:')) {
      // Indicazione del medico: l'app la mostra ma non la interpreta.
      segna('da_verificare', `indicazione del medico: ${v.testo ?? nomeOggetto(v.oggetto)}`);
      continue;
    }
    const ing = v.oggetto.startsWith('ing:') ? indice.ingrediente(v.oggetto) : undefined;
    controlla(v.oggetto, ing?.nome ?? nomeOggetto(v.oggetto, v.testo), v.severita);
  }
  return { esito, motivi: dettagli.map((d) => d.testo), dettagli };
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
