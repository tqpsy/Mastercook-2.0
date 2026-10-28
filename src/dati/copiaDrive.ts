/**
 * La copia automatica di una famiglia «sul mio Google Drive»: i dati stanno nel database del telefono e,
 * dopo ogni modifica, l'app ne salva l'esportazione nella cartella Mastercook del Drive. Su un telefono
 * nuovo la famiglia si ritrova da lì.
 *
 * Due telefoni con la stessa famiglia vanno usati uno alla volta: prima di sovrascrivere si controlla che
 * sul Drive non ci sia una copia più recente salvata da un altro dispositivo.
 */
import { ErroreDrive, infoCopia, salvaCopia, tokenValido } from '../piattaforma/drive';
import { trasportoLocale } from '../piattaforma/locale/motore';
import { controllaFile, esporta, type FileEsportazione } from './esportazione';
import { idDispositivo } from './contesto';
import { type Esito, type Trasporto, VERSIONE_APP } from './tipi';

export interface Collegamento {
  /** Il file sul Drive (manca finché non si è salvato la prima volta). */
  file?: string;
  /** La versione del file scritta da questo dispositivo: se sul Drive è diversa, l'ha cambiata un altro. */
  version?: string;
  salvata_il?: string;
  /** Impronta dei dati salvati l'ultima volta: se non è cambiato nulla non si riscrive il file. */
  impronta?: string;
}

export type StatoCopia =
  | { tipo: 'aggiornata'; il: string }
  | { tipo: 'in_corso' }
  | { tipo: 'da_salvare' }
  | { tipo: 'serve_permesso' }
  | { tipo: 'conflitto'; modificata: string }
  | { tipo: 'errore'; testo: string };

const chiave = (famiglia: string) => `mc-drive-${famiglia}`;

export function leggiCollegamento(famiglia: string): Collegamento | null {
  try {
    const v = localStorage.getItem(chiave(famiglia));
    return v ? (JSON.parse(v) as Collegamento) : null;
  } catch {
    return null;
  }
}

export function scriviCollegamento(famiglia: string, c: Collegamento | null) {
  try {
    if (c) localStorage.setItem(chiave(famiglia), JSON.stringify(c));
    else localStorage.removeItem(chiave(famiglia));
  } catch {
    // Senza archivio del browser il collegamento vale finché la pagina resta aperta.
  }
  avvisa(famiglia);
}

// Lo stato si condivide tra l'avviso nell'app e le Impostazioni.
const stati = new Map<string, StatoCopia>();
const ascoltatori = new Set<(famiglia: string) => void>();
function avvisa(famiglia: string) {
  ascoltatori.forEach((a) => a(famiglia));
}
const DA_SALVARE: StatoCopia = { tipo: 'da_salvare' };
/** Sempre lo stesso oggetto finché non cambia: si legge con useSyncExternalStore. */
export function statoCopia(famiglia: string): StatoCopia | null {
  if (!leggiCollegamento(famiglia)) return null;
  return stati.get(famiglia) ?? DA_SALVARE;
}
export function imposta(famiglia: string, s: StatoCopia) {
  stati.set(famiglia, s);
  avvisa(famiglia);
}
export function ascoltaCopia(f: (famiglia: string) => void): () => void {
  ascoltatori.add(f);
  return () => ascoltatori.delete(f);
}

function testoErrore(e: unknown): StatoCopia {
  if (e instanceof ErroreDrive && (e.motivo === 'scaduto' || e.motivo === 'negato')) return { tipo: 'serve_permesso' };
  if (e instanceof ErroreDrive && e.motivo === 'rete') return { tipo: 'errore', testo: 'Senza rete: la copia si aggiorna appena torna.' };
  return { tipo: 'errore', testo: 'Il Drive non ha risposto. Riprovo tra poco.' };
}

/**
 * Salva la famiglia sul Drive. Con `sovrascrivi` ignora una copia più recente fatta da un altro dispositivo
 * (dopo che la persona ha scelto di tenere questa).
 */
export function salvaSulDrive(o: { famiglia: string; nome: string; trasporto: Trasporto; sovrascrivi?: boolean }): Promise<StatoCopia> {
  // Un salvataggio alla volta per famiglia: il secondo parte quando il primo ha scritto l'id del file.
  const prima = inCorso.get(o.famiglia) ?? Promise.resolve(null);
  const questo = prima.catch(() => null).then(() => salvaOra(o));
  inCorso.set(o.famiglia, questo);
  return questo;
}

const inCorso = new Map<string, Promise<StatoCopia | null>>();

async function salvaOra(o: { famiglia: string; nome: string; trasporto: Trasporto; sovrascrivi?: boolean }): Promise<StatoCopia> {
  const c = leggiCollegamento(o.famiglia);
  if (!c) return { tipo: 'errore', testo: 'Famiglia non collegata al Drive.' };
  if (!tokenValido()) {
    imposta(o.famiglia, { tipo: 'serve_permesso' });
    return { tipo: 'serve_permesso' };
  }
  imposta(o.famiglia, { tipo: 'in_corso' });
  try {
    let file = c.file;
    if (file) {
      const info = await infoCopia(file);
      if (!info) file = undefined;
      else if (!o.sovrascrivi && c.version && info.version !== c.version) {
        const s: StatoCopia = { tipo: 'conflitto', modificata: info.modificata };
        imposta(o.famiglia, s);
        return s;
      }
    }
    const dati = await esporta(o.trasporto, o.famiglia);
    const impronta = await calcolaImpronta(dati);
    // Niente da salvare: riscrivere farebbe credere a un altro telefono che qui sia cambiato qualcosa.
    if (!o.sovrascrivi && file && impronta === c.impronta) {
      const s: StatoCopia = { tipo: 'aggiornata', il: c.salvata_il ?? new Date().toISOString() };
      imposta(o.famiglia, s);
      return s;
    }
    // Il nome del file è quello della famiglia nell'esportazione: così è sempre quello di adesso.
    const nome = String(dati.tabelle.famiglia[0]?.nome ?? o.nome);
    const r = await salvaCopia({ id: file, nome, famiglia: o.famiglia, testo: JSON.stringify(dati) });
    const il = new Date().toISOString();
    scriviCollegamento(o.famiglia, { file: r.id, version: r.version, salvata_il: il, impronta });
    const s: StatoCopia = { tipo: 'aggiornata', il };
    imposta(o.famiglia, s);
    return s;
  } catch (e) {
    const s = testoErrore(e);
    imposta(o.famiglia, s);
    return s;
  }
}

async function calcolaImpronta(dati: FileEsportazione): Promise<string> {
  const byte = new TextEncoder().encode(JSON.stringify(dati.tabelle));
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', byte));
  return Array.from(h, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Crea sul telefono una famiglia nuova dal file (del Drive o scelto a mano). */
export async function ripristinaSulTelefono(utenteId: string, file: FileEsportazione, nome: string, nomeUtente: string): Promise<{ famiglia: string } | { esito: Esito }> {
  const famiglia = crypto.randomUUID();
  const esito = await trasportoLocale(utenteId).applica({
    id: crypto.randomUUID(),
    famiglia_id: famiglia,
    tipo: 'ripristina_famiglia',
    dati: { file, nome: nome.slice(0, 80), nome_utente: nomeUtente || 'Io' },
    versione_app: VERSIONE_APP,
    dispositivo: idDispositivo(),
  });
  return esito.esito === 'applicato' ? { famiglia } : { esito };
}

/** Il testo di una copia letto dal Drive, controllato come un file scelto a mano. */
export function leggiFile(testo: string): FileEsportazione | null {
  const c = controllaFile(testo);
  return c.valido ? c.file : null;
}
