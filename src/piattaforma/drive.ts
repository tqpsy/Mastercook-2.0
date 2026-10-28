/**
 * La copia della famiglia sul Google Drive di chi la usa.
 *
 * Permesso chiesto a Google: solo `drive.file`, cioè «i file creati da questa app». Con questo permesso
 * Mastercook non può vedere, leggere né toccare nessun altro file o cartella del Drive: è Google a impedirlo.
 * L'app crea una cartella «Mastercook» e ci scrive un file per famiglia. Il token dura circa un'ora e resta
 * solo in memoria: nessun server in mezzo, nessun segreto.
 */
import { GOOGLE_CLIENT_ID } from '../config';

export const PERMESSO_DRIVE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const CARTELLA = 'Mastercook';
const TIPO_CARTELLA = 'application/vnd.google-apps.folder';

interface RispostaToken {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}
interface Gis {
  accounts: {
    oauth2: {
      initTokenClient(o: {
        client_id: string;
        scope: string;
        callback: (r: RispostaToken) => void;
        error_callback?: (e: { type: string }) => void;
      }): { requestAccessToken(o?: { prompt?: '' | 'consent' | 'select_account'; login_hint?: string }): void };
      revoke(token: string, fatto?: () => void): void;
    };
  };
}

declare global {
  interface Window {
    google?: Gis;
  }
}

export class ErroreDrive extends Error {
  constructor(readonly motivo: 'rete' | 'negato' | 'scaduto' | 'drive') {
    super(motivo);
    this.name = 'ErroreDrive';
  }
}

let caricamento: Promise<Gis> | undefined;

/** Carica la libreria di Google. Conviene chiamarla prima del tocco che chiede il permesso. */
export function caricaGoogle(): Promise<Gis> {
  caricamento ??= new Promise<Gis>((ok, ko) => {
    if (window.google?.accounts) return ok(window.google);
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (window.google ? ok(window.google) : ko(new ErroreDrive('rete')));
    s.onerror = () => {
      caricamento = undefined;
      ko(new ErroreDrive('rete'));
    };
    document.head.appendChild(s);
  });
  return caricamento;
}

let token: { valore: string; scade: number } | null = null;

export function tokenValido(): string | null {
  return token && token.scade > Date.now() + 60_000 ? token.valore : null;
}

/**
 * Chiede a Google il permesso (la prima volta) o un token nuovo. Va chiamata da un tocco: apre la finestra
 * di Google, che dopo il primo consenso di solito si chiude da sola.
 */
export async function collegaDrive(primaVolta = false): Promise<void> {
  const gis = await caricaGoogle();
  await new Promise<void>((ok, ko) => {
    const client = gis.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: PERMESSO_DRIVE,
      callback: (r) => {
        if (!r.access_token) return ko(new ErroreDrive('negato'));
        // Nella finestra di Google la casella si può lasciare vuota: senza permesso non si salva nulla.
        if (!(r.scope ?? '').split(' ').includes(PERMESSO_DRIVE)) {
          gis.accounts.oauth2.revoke(r.access_token);
          return ko(new ErroreDrive('negato'));
        }
        token = { valore: r.access_token, scade: Date.now() + (r.expires_in ?? 3600) * 1000 };
        ok();
      },
      error_callback: () => ko(new ErroreDrive('negato')),
    });
    client.requestAccessToken({ prompt: primaVolta ? 'select_account' : '' });
  });
}

/** Toglie il permesso dato a Mastercook su questo account Google. */
export async function scollegaDrive(): Promise<void> {
  const valore = token?.valore;
  token = null;
  if (valore) (await caricaGoogle().catch(() => null))?.accounts.oauth2.revoke(valore);
}

async function chiama(url: string, init: RequestInit = {}): Promise<Response> {
  const valore = tokenValido();
  if (!valore) throw new ErroreDrive('scaduto');
  let r: Response;
  try {
    r = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${valore}` } });
  } catch {
    throw new ErroreDrive('rete');
  }
  if (r.status === 401) {
    token = null;
    throw new ErroreDrive('scaduto');
  }
  if (!r.ok) throw new ErroreDrive('drive');
  return r;
}

/** La cartella «Mastercook» creata dall'app (con questo permesso è l'unica cartella che l'app vede). */
async function cartella(): Promise<string> {
  const cerca = `name='${CARTELLA}' and mimeType='${TIPO_CARTELLA}' and trashed=false`;
  const r = await chiama(`${API}?q=${encodeURIComponent(cerca)}&fields=files(id)&spaces=drive`);
  const trovata = ((await r.json()) as { files: { id: string }[] }).files[0];
  if (trovata) return trovata.id;
  const nuova = await chiama(`${API}?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: CARTELLA, mimeType: TIPO_CARTELLA }),
  });
  return ((await nuova.json()) as { id: string }).id;
}

export interface CopiaDrive {
  id: string;
  nome: string;
  famiglia: string;
  version: string;
  modificata: string;
}

const CAMPI = 'id,name,version,modifiedTime,appProperties';
type FileDrive = { id: string; name: string; version: string; modifiedTime: string; appProperties?: Record<string, string> };
const copia = (f: FileDrive): CopiaDrive => ({ id: f.id, nome: f.name, famiglia: f.appProperties?.famiglia ?? '', version: f.version, modificata: f.modifiedTime });

/** Le copie di famiglie che l'app ha salvato su questo Drive, dalla più recente. */
export async function elencaCopie(): Promise<CopiaDrive[]> {
  const cerca = `appProperties has { key='mastercook' and value='famiglia' } and trashed=false`;
  const r = await chiama(`${API}?q=${encodeURIComponent(cerca)}&orderBy=modifiedTime desc&fields=files(${CAMPI})&spaces=drive`);
  return ((await r.json()) as { files: FileDrive[] }).files.map(copia);
}

export async function leggiCopia(id: string): Promise<{ info: CopiaDrive; testo: string }> {
  const [info, dati] = await Promise.all([chiama(`${API}/${id}?fields=${CAMPI}`), chiama(`${API}/${id}?alt=media`)]);
  return { info: copia((await info.json()) as FileDrive), testo: await dati.text() };
}

export async function infoCopia(id: string): Promise<CopiaDrive | null> {
  try {
    return copia((await (await chiama(`${API}/${id}?fields=${CAMPI},trashed`)).json()) as FileDrive & { trashed?: boolean });
  } catch (e) {
    if (e instanceof ErroreDrive && e.motivo === 'drive') return null;
    throw e;
  }
}

/** Salva (o aggiorna, con `id`) il file della famiglia nella cartella Mastercook. */
export async function salvaCopia(o: { id?: string; nome: string; famiglia: string; testo: string }): Promise<CopiaDrive> {
  const metadati = { name: `${o.nome.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Famiglia'}.json`, appProperties: { mastercook: 'famiglia', famiglia: o.famiglia }, mimeType: 'application/json' };
  const confine = `mastercook${crypto.randomUUID()}`;
  const corpo = (m: object) =>
    new Blob([
      `--${confine}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(m),
      `\r\n--${confine}\r\nContent-Type: application/json\r\n\r\n`,
      o.testo,
      `\r\n--${confine}--`,
    ]);
  const headers = { 'Content-Type': `multipart/related; boundary=${confine}` };
  const r = o.id
    ? await chiama(`${UPLOAD}/${o.id}?uploadType=multipart&fields=${CAMPI}`, { method: 'PATCH', headers, body: corpo(metadati) })
    : await chiama(`${UPLOAD}?uploadType=multipart&fields=${CAMPI}`, { method: 'POST', headers, body: corpo({ ...metadati, parents: [await cartella()] }) });
  return copia((await r.json()) as FileDrive);
}
