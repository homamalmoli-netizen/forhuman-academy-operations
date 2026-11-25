import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { seedBase, seedDemo } from '../server/seed.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function startServer({ demo = true } = {}) {
  const db = openDb(':memory:');
  if (demo) seedDemo(db); else seedBase(db);
  const uploadDir = mkdtempSync(join(tmpdir(), 'fh-test-'));
  const app = createApp({ db, demo, uploadDir, publicDir: join(root, 'public'), sharedDir: join(root, 'shared'), log: () => {} });
  const server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, uploadDir, base, close: () => new Promise((r) => server.close(r)), client: () => new Client(base) };
}

export class Client {
  constructor(base) { this.base = base; this.cookie = ''; }
  async req(method, path, body, { raw, headers = {} } = {}) {
    const h = { 'x-fh-request': '1', ...headers };
    if (this.cookie) h.cookie = this.cookie;
    let payload;
    if (raw) { payload = raw.data; h['content-type'] = raw.type; } else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
    const res = await fetch(this.base + path, { method, headers: h, body: payload });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  get(p) { return this.req('GET', p); }
  post(p, b = {}) { return this.req('POST', p, b); }
  patch(p, b = {}) { return this.req('PATCH', p, b); }
  async as(persona) { const r = await this.post('/api/demo/session', { persona }); if (r.status !== 200) throw new Error('login ' + r.status); return this; }
  async photo(branch, purpose = 'evidence') {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
    const r = await this.req('POST', `/api/media?branch=${branch}&purpose=${purpose}`, undefined, { raw: { data: jpeg, type: 'image/jpeg' } });
    if (r.status !== 200) throw new Error('upload ' + r.status + JSON.stringify(r.data));
    return r.data.id;
  }
}

export const HALLE = 1, LEUNA = 2;
