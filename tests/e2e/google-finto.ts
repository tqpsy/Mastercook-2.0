/**
 * Google finto per i test: la libreria dell'accesso (che dà subito il permesso drive.file) e un Drive in memoria
 * con le poche chiamate che l'app usa. Lo stesso Drive vale per più contesti, come due telefoni dello stesso account.
 */
import type { BrowserContext, Route } from '@playwright/test';

export const PERMESSO = 'https://www.googleapis.com/auth/drive.file';

interface File {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties: Record<string, string>;
  version: number;
  modifiedTime: string;
  contenuto: string;
}

export class DriveFinto {
  file = new Map<string, File>();
  private n = 0;
  /** Quante volte Google ha chiesto il permesso. */
  permessi = 0;

  copie() {
    return [...this.file.values()].filter((f) => f.appProperties.mastercook === 'famiglia');
  }

  private nuovo(dati: Partial<File>): File {
    const f: File = { id: `f${++this.n}`, name: '', mimeType: '', parents: [], appProperties: {}, version: 1, modifiedTime: new Date().toISOString(), contenuto: '', ...dati };
    this.file.set(f.id, f);
    return f;
  }

  private info(f: File) {
    return { id: f.id, name: f.name, version: String(f.version), modifiedTime: f.modifiedTime, appProperties: f.appProperties };
  }

  private static parti(corpo: string): [Record<string, unknown>, string] {
    const confine = corpo.slice(2, corpo.indexOf('\r\n'));
    const pezzi = corpo.split(`--${confine}`).slice(1, 3).map((p) => p.slice(p.indexOf('\r\n\r\n') + 4, p.lastIndexOf('\r\n')));
    return [JSON.parse(pezzi[0]) as Record<string, unknown>, pezzi[1]];
  }

  async collega(contesto: BrowserContext) {
    await contesto.route('https://accounts.google.com/gsi/client', (r) => {
      this.permessi++;
      return r.fulfill({
        contentType: 'text/javascript',
        body: `window.google = { accounts: { oauth2: {
          initTokenClient: (o) => ({ requestAccessToken: () => setTimeout(() => o.callback({ access_token: 'token-finto', expires_in: 3600, scope: '${PERMESSO}' }), 0) }),
          revoke: () => undefined } } };`,
      });
    });
    await contesto.route('https://www.googleapis.com/**', (r) => this.rispondi(r));
  }

  private async rispondi(route: Route) {
    const req = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.headers().authorization !== 'Bearer token-finto') return route.fulfill({ status: 401, headers: cors });
    const url = new URL(req.url());
    const json = (dati: unknown) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(dati) });
    const id = url.pathname.match(/\/files\/([^/]+)$/)?.[1];
    if (url.pathname === '/drive/v3/files' && req.method() === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      if (q.includes('google-apps.folder')) return json({ files: [...this.file.values()].filter((f) => f.mimeType.endsWith('folder')).map((f) => ({ id: f.id })) });
      return json({ files: this.copie().sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime)).map((f) => this.info(f)) });
    }
    if (url.pathname === '/drive/v3/files' && req.method() === 'POST') {
      const d = JSON.parse(req.postData() ?? '{}') as Partial<File>;
      return json({ id: this.nuovo(d).id });
    }
    if (url.pathname.startsWith('/drive/v3/files/') && id && req.method() === 'GET') {
      const f = this.file.get(id);
      if (!f) return route.fulfill({ status: 404, headers: cors });
      if (url.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: f.contenuto });
      return json(this.info(f));
    }
    if (url.pathname === '/upload/drive/v3/files' && req.method() === 'POST') {
      const [m, contenuto] = DriveFinto.parti(req.postData() ?? '');
      return json(this.info(this.nuovo({ ...(m as Partial<File>), contenuto })));
    }
    if (url.pathname.startsWith('/upload/drive/v3/files/') && id && req.method() === 'PATCH') {
      const f = this.file.get(id);
      if (!f) return route.fulfill({ status: 404, headers: cors });
      const [m, contenuto] = DriveFinto.parti(req.postData() ?? '');
      Object.assign(f, m, { contenuto, version: f.version + 1, modifiedTime: new Date(Date.now() + f.version).toISOString() });
      return json(this.info(f));
    }
    return route.fulfill({ status: 400, headers: cors });
  }
}
