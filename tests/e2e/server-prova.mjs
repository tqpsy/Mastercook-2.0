/**
 * Server di prova per i test dell'interfaccia: risponde come Supabase alle poche chiamate che l'app fa
 * (`/rest/v1/rpc/<funzione>` e le foto in `/storage/v1/object/foto/…`), eseguendo le funzioni vere su un Postgres di prova con l'utente
 * indicato dal token. Non verifica la firma del token: serve solo nei test, mai in produzione.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import pg from 'pg';

const RADICE = join(import.meta.dirname, '..', '..');
const INDIRIZZO = process.env.MC_DATABASE_URL ?? 'postgres://postgres@localhost:54329/postgres?host=/tmp/pg';
const PORTA = Number(process.env.PORTA ?? 14400);

const nome = `mc_e2e_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const admin = new pg.Client({ connectionString: INDIRIZZO });
await admin.connect();
await admin.query(`create database ${nome}`);
await admin.end();
const url = new URL(INDIRIZZO);
url.pathname = `/${nome}`;
const pool = new pg.Pool({ connectionString: url.toString(), max: 10 });
pool.on('error', () => undefined);
await pool.query(readFileSync(join(RADICE, 'supabase', 'tests', 'supabase-finto.sql'), 'utf8'));
const cartella = join(RADICE, 'supabase', 'migrations');
for (const f of readdirSync(cartella).filter((f) => f.endsWith('.sql')).sort()) await pool.query(readFileSync(join(cartella, f), 'utf8'));

const FUNZIONI = {
  applica_comando: (a) => ['select public.applica_comando($1) as r', [a.comando]],
  entra_con_invito: (a) => ['select public.entra_con_invito($1) as r', [a.comando]],
  scarica_modifiche: (a) => ['select public.scarica_modifiche($1, $2, $3) as r', [a.p_famiglia, a.p_dopo, a.p_limite]],
  imposta_chiave_gemini: (a) => ['select public.imposta_chiave_gemini($1, $2) as r', [a.p_famiglia, a.p_chiave]],
  stato_chiave_gemini: (a) => ['select public.stato_chiave_gemini($1) as r', [a.p_famiglia]],
  mie_famiglie: () => ['select coalesce(jsonb_agg(to_jsonb(f)), \'[]\'::jsonb) as r from public.mie_famiglie() f', []],
};

/** I file delle foto, in memoria: il deposito vero è Supabase Storage. Le regole sono quelle del database. */
const FILE = new Map();

/** Esegue una query come l'utente del token, con le regole di accesso (RLS) del database. */
async function comeUtente(sub, testo, valori) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated' })]);
    const r = await client.query(testo, valori);
    await client.query('commit');
    return r;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

async function grezzo(req) {
  const parti = [];
  for await (const c of req) parti.push(c);
  return Buffer.concat(parti);
}

function utenteDalToken(req) {
  const t = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  try {
    return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).sub ?? null;
  } catch {
    return null;
  }
}

async function corpo(req) {
  let s = '';
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
}

function rispondi(res, stato, dati) {
  res.writeHead(stato, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(dati === undefined ? '' : JSON.stringify(dati));
}

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
    });
    return res.end();
  }
  try {
    const percorso = new URL(req.url, 'http://x').pathname;
    if (percorso === '/prova/utente' && req.method === 'POST') {
      const { nome: n = 'Prova' } = await corpo(req);
      const id = randomUUID();
      await pool.query('insert into auth.users (id, email) values ($1, $2)', [id, `${id}@prova.test`]);
      const payload = { sub: id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 };
      const token = `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.prova`;
      return rispondi(res, 200, { id, token, email: `${id}@prova.test`, nome: n });
    }
    if (percorso === '/prova/sql' && req.method === 'POST') {
      const { testo, valori } = await corpo(req);
      return rispondi(res, 200, (await pool.query(testo, valori)).rows);
    }
    if (percorso.startsWith('/auth/v1/')) return rispondi(res, 204);
    // Foto del frigo: al posto di Gemini una risposta fissa; il controllo su chi fa parte della famiglia è vero.
    if (percorso === '/functions/v1/foto-frigo' && req.method === 'POST') {
      const sub = utenteDalToken(req);
      const { famiglia_id, immagine } = await corpo(req);
      const r = sub && typeof immagine === 'string' && immagine.length > 0 ? await comeUtente(sub, 'select 1 from famiglia where id = $1', [famiglia_id]) : { rowCount: 0 };
      if (!r.rowCount) return rispondi(res, 403, { errore: 'non_autorizzato' });
      // Come la funzione vera: serve la chiave della famiglia (o quella del progetto per chi gestisce l'app).
      const scelta = (await pool.query('select public.chiave_gemini_per_foto($1) as r', [famiglia_id])).rows[0].r;
      if (!scelta.chiave && !scelta.condivisa) return rispondi(res, 503, { errore: 'non_configurata' });
      return rispondi(res, 200, {
        modello: 'prova',
        alimenti: [
          { nome: 'latte', quantita: 1000, unita: 'ml' },
          { nome: 'uova', quantita: 6, unita: 'pz' },
          { nome: 'zucchina', quantita: null, unita: null },
          { nome: 'oggetto misterioso', quantita: null, unita: null },
        ],
      });
    }
    const f = percorso.match(/^\/storage\/v1\/object\/(?:authenticated\/)?foto\/(.+)$/);
    if (f) {
      const sub = utenteDalToken(req);
      if (!sub) return rispondi(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'token mancante' });
      const nome = decodeURIComponent(f[1]);
      if (req.method === 'POST' || req.method === 'PUT') {
        const dati = await grezzo(req);
        try {
          await comeUtente(sub, `insert into storage.objects (bucket_id, name) values ('foto', $1) on conflict (bucket_id, name) do update set created_at = now()`, [nome]);
        } catch (e) {
          return rispondi(res, 400, { statusCode: '403', error: 'Unauthorized', message: String(e) });
        }
        FILE.set(nome, { dati, tipo: req.headers['content-type'] ?? 'image/jpeg' });
        return rispondi(res, 200, { Key: `foto/${nome}` });
      }
      const r = await comeUtente(sub, `select 1 from storage.objects where bucket_id = 'foto' and name = $1`, [nome]);
      const file = FILE.get(nome);
      if (!r.rowCount || !file) return rispondi(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      res.writeHead(200, { 'content-type': file.tipo, 'access-control-allow-origin': '*' });
      return res.end(file.dati);
    }
    const m = percorso.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (!m || !FUNZIONI[m[1]]) return rispondi(res, 404, { message: 'non trovato' });
    const sub = utenteDalToken(req);
    if (!sub) return rispondi(res, 401, { message: 'JWT mancante', code: 'PGRST301' });
    const [testo, valori] = FUNZIONI[m[1]](await corpo(req));
    try {
      const r = await comeUtente(sub, testo, valori);
      return rispondi(res, 200, r.rows[0].r);
    } catch (e) {
      return rispondi(res, 500, { message: String(e) });
    }
  } catch (e) {
    return rispondi(res, 500, { message: String(e) });
  }
}).listen(PORTA, () => console.log(`server di prova su ${PORTA}, database ${nome}`));
