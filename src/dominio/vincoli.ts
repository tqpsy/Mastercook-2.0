/**
 * Vincoli alimentari dei membri: allergie (i 14 allergeni del Reg. UE 1169/2011), intolleranze
 * ed esigenze dichiarate. Sono vincoli, non preferenze: in assenza di informazioni sufficienti
 * una ricetta non viene mai presentata come adatta.
 */

export type TipoVincolo = 'allergia' | 'intolleranza' | 'esigenza' | 'indicazione_medica';
export type Severita = 'evitare' | 'evitare_anche_tracce';

export interface VoceVincolo {
  oggetto: string;
  nome: string;
}

export const ALLERGENI_UE: VoceVincolo[] = [
  { oggetto: 'all:glutine', nome: 'Glutine' },
  { oggetto: 'all:crostacei', nome: 'Crostacei' },
  { oggetto: 'all:uova', nome: 'Uova' },
  { oggetto: 'all:pesce', nome: 'Pesce' },
  { oggetto: 'all:arachidi', nome: 'Arachidi' },
  { oggetto: 'all:soia', nome: 'Soia' },
  { oggetto: 'all:latte', nome: 'Latte' },
  { oggetto: 'all:frutta_a_guscio', nome: 'Frutta a guscio' },
  { oggetto: 'all:sedano', nome: 'Sedano' },
  { oggetto: 'all:senape', nome: 'Senape' },
  { oggetto: 'all:sesamo', nome: 'Sesamo' },
  { oggetto: 'all:solfiti', nome: 'Anidride solforosa e solfiti' },
  { oggetto: 'all:lupini', nome: 'Lupini' },
  { oggetto: 'all:molluschi', nome: 'Molluschi' },
];

export const INTOLLERANZE: VoceVincolo[] = [
  { oggetto: 'ing:lattosio', nome: 'Lattosio' },
  { oggetto: 'ing:fruttosio', nome: 'Fruttosio' },
  { oggetto: 'ing:istamina', nome: 'Istamina' },
  { oggetto: 'ing:nichel', nome: 'Nichel' },
  { oggetto: 'ing:sorbitolo', nome: 'Sorbitolo' },
];

export const ESIGENZE: VoceVincolo[] = [
  { oggetto: 'cls:vegetariano', nome: 'Vegetariano' },
  { oggetto: 'cls:vegano', nome: 'Vegano' },
  { oggetto: 'cls:senza_maiale', nome: 'Senza maiale' },
  { oggetto: 'cls:senza_alcol', nome: 'Senza alcol' },
];

const ELENCHI: Record<Exclude<TipoVincolo, 'indicazione_medica'>, VoceVincolo[]> = {
  allergia: ALLERGENI_UE,
  intolleranza: INTOLLERANZE,
  esigenza: ESIGENZE,
};

export function vociPer(tipo: TipoVincolo): VoceVincolo[] {
  return tipo === 'indicazione_medica' ? [] : ELENCHI[tipo];
}

export const NOME_TIPO: Record<TipoVincolo, string> = {
  allergia: 'Allergia',
  intolleranza: 'Intolleranza',
  esigenza: 'Esigenza',
  indicazione_medica: 'Indicazione medica',
};

/** Nome leggibile di un oggetto; per un testo libero (`txt:`) si usa il testo salvato. */
export function nomeOggetto(oggetto: string, testo?: string | null): string {
  for (const elenco of Object.values(ELENCHI)) {
    const v = elenco.find((x) => x.oggetto === oggetto);
    if (v) return v.nome;
  }
  if (testo) return testo;
  return oggetto.replace(/^[a-z]+:/, '').replaceAll('_', ' ');
}

/** Codice per un testo libero inserito dall'utente, stabile per lo stesso testo. */
export function oggettoDaTesto(testo: string): string | null {
  const slug = testo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return slug ? `txt:${slug}` : null;
}
