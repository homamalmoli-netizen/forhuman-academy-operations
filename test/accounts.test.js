import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, HALLE, LEUNA } from './helpers.js';

describe('Persönliche Zugänge und Nachweise', () => {
  let srv, ids = {};
  before(async () => {
    srv = await startServer({ demo: true });
    for (const u of srv.db.prepare('SELECT id, username FROM users').all()) ids[u.username] = u.id;
  });
  after(() => srv.close());
  let invite, newId;

  test('Leitung legt Konto an → Einladungscode; keine Manager-Rolle durch Filialleitung; Benutzername eindeutig', async () => {
    const mgr = await srv.client().as('manager_halle');
    assert.equal((await mgr.post('/api/staff', { branch: HALLE, username: 'x.y', display_name: 'X', role: 'manager' })).data.error, 'role');
    const r = (await mgr.post('/api/staff', { branch: HALLE, username: 'Neu.Mitarbeiter', display_name: 'Neuer Mitarbeiter (fiktiv)', role: 'employee' })).data;
    assert.match(r.invite_code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    invite = r.invite_code; newId = r.user_id;
    assert.equal(r.username, 'neu.mitarbeiter');
    assert.equal((await mgr.post('/api/staff', { branch: HALLE, username: 'neu.mitarbeiter', display_name: 'X', role: 'employee' })).status, 409);
    assert.equal((await mgr.post('/api/staff', { branch: LEUNA, username: 'z.z', display_name: 'X', role: 'employee' })).status, 403);
    assert.equal((await (await srv.client().as('employee_halle')).post('/api/staff', { branch: HALLE, username: 'q.q', display_name: 'Q', role: 'employee' })).status, 403);
    // Code wird nur als Hash gespeichert
    assert.equal(srv.db.prepare('SELECT COUNT(*) n FROM invites WHERE code_hash LIKE ?').get('%' + invite.slice(0, 4) + '%').n, 0);
    const list = (await mgr.get(`/api/staff?branch=${HALLE}`)).data.find((p) => p.id === newId);
    assert.equal(list.has_password, false);
  });

  test('Einladung einlösen: eigenes Passwort, danach angemeldet; Code nur einmal', async () => {
    const c = srv.client();
    assert.equal((await c.post('/api/invite/redeem', { code: invite, password: 'kurz' })).data.error, 'password');
    assert.equal((await c.post('/api/invite/redeem', { code: 'AAAA-AAAA-AAAA', password: 'langes-passwort-1' })).data.error, 'invalid_code');
    assert.equal((await c.post('/api/invite/redeem', { code: invite.toLowerCase(), password: 'mein-eigenes-pw-1' })).status, 200);
    assert.equal((await c.get('/api/me')).data.username, 'neu.mitarbeiter');
    assert.equal((await srv.client().post('/api/invite/redeem', { code: invite, password: 'noch-ein-pw-123' })).data.error, 'invalid_code');
    const l = srv.client();
    assert.equal((await l.post('/api/login', { username: 'neu.mitarbeiter', password: 'mein-eigenes-pw-1' })).status, 200);
  });

  test('Startpasswort vom Betreiber muss vor allem anderen geändert werden', async () => {
    const admin = await srv.client().as('admin');
    await admin.post('/api/admin/users', { username: 'start.pw', display_name: 'Start (fiktiv)', password: 'start-passwort-1', memberships: [{ branch_id: HALLE, role: 'employee' }] });
    const c = srv.client();
    await c.post('/api/login', { username: 'start.pw', password: 'start-passwort-1' });
    assert.equal((await c.get('/api/me')).data.must_change_password, true);
    assert.equal((await c.get(`/api/shift/next?branch=${HALLE}&shift=open`)).data.error, 'password_change_required');
    assert.equal((await c.post('/api/password', { old_password: 'falsch', new_password: 'neues-passwort-1' })).data.error, 'old_password');
    assert.equal((await c.post('/api/password', { old_password: 'start-passwort-1', new_password: 'start-passwort-1' })).data.error, 'password');
    assert.equal((await c.post('/api/password', { old_password: 'start-passwort-1', new_password: 'neues-passwort-1' })).status, 200);
    assert.equal((await c.get(`/api/shift/next?branch=${HALLE}&shift=open`)).status, 200);
  });

  test('Zurücksetzen: alter Zugang gesperrt, neuer Code; Deaktivieren beendet Sitzungen und löst Aufgaben', async () => {
    const mgr = await srv.client().as('manager_halle');
    const user = srv.client();
    await user.post('/api/login', { username: 'neu.mitarbeiter', password: 'mein-eigenes-pw-1' });
    const r = (await mgr.post(`/api/staff/${newId}/reset`)).data;
    assert.ok(r.invite_code);
    assert.equal((await user.get('/api/me')).status, 401, 'Sitzung beendet');
    assert.equal((await srv.client().post('/api/login', { username: 'neu.mitarbeiter', password: 'mein-eigenes-pw-1' })).status, 401);
    assert.equal((await srv.client().post('/api/invite/redeem', { code: r.invite_code, password: 'wieder-neu-pw-1' })).status, 200);
    // Filialleitung darf andere Filialleitung / Betreiber nicht zurücksetzen
    assert.equal((await mgr.post(`/api/staff/${ids['demo.leitung.leuna']}/reset`)).status, 403);
    assert.equal((await mgr.post(`/api/staff/${ids['demo.admin']}/reset`)).status, 403);
    // Deaktivieren
    const u2 = srv.client();
    await u2.post('/api/login', { username: 'neu.mitarbeiter', password: 'wieder-neu-pw-1' });
    assert.equal((await mgr.post(`/api/staff/${newId}/active`, { active: false })).status, 200);
    assert.equal((await u2.get('/api/me')).status, 401);
    assert.equal((await srv.client().post('/api/login', { username: 'neu.mitarbeiter', password: 'wieder-neu-pw-1' })).status, 401);
    assert.equal((await mgr.post(`/api/staff/${newId}/active`, { active: true })).status, 200);
    // Rollen setzen (eigene Filiale, keine Manager-Rolle)
    assert.equal((await mgr.req('PUT', `/api/staff/${newId}/roles`, { branch: HALLE, roles: ['employee', 'shift_lead', 'manager'] })).status, 200);
    assert.deepEqual(srv.db.prepare('SELECT role FROM memberships WHERE user_id = ? ORDER BY role').all(newId).map((r) => r.role), ['employee', 'shift_lead']);
  });

  test('Nachweise: §43 und METRO hochladen, privat, Prüfung durch Leitung (nicht selbst), METRO ersetzt §43 nicht', async () => {
    const emp = await srv.client().as('employee_halle');
    const w0 = (await emp.get(`/api/welcome?branch=${HALLE}`)).data;
    assert.equal(w0.ifsg43.state, 'missing');
    assert.match(w0.links.metro_hygiene.text, /ersetzt die Belehrung nach §43 IfSG nicht/);
    const pdf = await emp.req('POST', `/api/media?branch=${HALLE}&purpose=certificate`, undefined, { raw: { data: Buffer.from('%PDF-1.4 Bescheinigung (fiktiv)'), type: 'application/pdf' } });
    assert.equal(pdf.status, 200);
    assert.equal((await emp.post('/api/certificates', { branch: HALLE, type: 'ifsg43', media_id: pdf.data.id })).data.error, 'issued_on');
    const c1 = (await emp.post('/api/certificates', { branch: HALLE, type: 'ifsg43', issued_on: '2026-10-01', media_id: pdf.data.id })).data;
    const metroFile = await emp.photo(HALLE, 'certificate');
    await emp.post('/api/certificates', { branch: HALLE, type: 'metro_hygiene', issued_on: '2026-10-02', media_id: metroFile });
    // Datei privat: andere Mitarbeiter der Filiale sehen sie nicht, Leitung schon
    const lead = await srv.client().as('shift_lead_halle');
    assert.equal((await lead.get(`/api/media/${pdf.data.id}`)).status, 403);
    const mgr = await srv.client().as('manager_halle');
    assert.equal((await mgr.get(`/api/media/${pdf.data.id}`)).status, 200);
    assert.equal((await emp.get(`/api/media/${pdf.data.id}`)).status, 200);
    // fremde Datei als Nachweis verwenden geht nicht
    const leadFile = await lead.photo(HALLE, 'certificate');
    assert.equal((await emp.post('/api/certificates', { branch: HALLE, type: 'ifsg43', issued_on: '2026-10-01', media_id: leadFile })).data.error, 'media');
    const list = (await mgr.get(`/api/certificates?branch=${HALLE}`)).data;
    assert.equal(list.pending.length, 2);
    assert.equal((await mgr.post(`/api/certificates/${c1.id}/review`, { status: 'rejected' })).data.error, 'note');
    assert.equal((await mgr.post(`/api/certificates/${c1.id}/review`, { status: 'approved' })).status, 200);
    assert.equal((await mgr.post(`/api/certificates/${c1.id}/review`, { status: 'approved' })).status, 409);
    const w1 = (await emp.get(`/api/welcome?branch=${HALLE}`)).data;
    assert.equal(w1.ifsg43.state, 'approved');
    assert.equal(w1.metro_hygiene.state, 'pending');
    // Leuna-Leitung sieht Halle-Nachweise nicht
    assert.equal((await (await srv.client().as('manager_leuna')).get(`/api/certificates?branch=${HALLE}`)).status, 403);
    assert.equal((await (await srv.client().as('manager_leuna')).get(`/api/media/${pdf.data.id}`)).status, 403);
    // Folgebelehrung dokumentieren
    assert.equal((await mgr.post('/api/certificates/followup', { branch: HALLE, user_id: ids['demo.mitarbeiter.halle'], issued_on: '2026-11-20' })).status, 200);
    assert.equal((await mgr.get(`/api/certificates?branch=${HALLE}`)).data.people.find((p) => p.id === ids['demo.mitarbeiter.halle']).last_followup, '2026-11-20');
    const dash = (await mgr.get(`/api/dashboard?branch=${HALLE}`)).data[0];
    assert.equal(dash.certificates.pending, 1);
    assert.ok(dash.certificates.missing_ifsg43 >= 1);
  });

  test('Offizielle Links nur https und nur durch Betreiber', async () => {
    const admin = await srv.client().as('admin');
    assert.equal((await admin.req('PUT', '/api/admin/cert-links', { ifsg43: { url: 'http://unsicher.example' } })).data.error, 'url');
    assert.equal((await admin.req('PUT', '/api/admin/cert-links', { ifsg43: { url: 'https://gesundheitsamt.example/belehrung', text: 'Termin beim Gesundheitsamt' } })).status, 200);
    assert.equal((await (await srv.client().as('manager_halle')).req('PUT', '/api/admin/cert-links', {})).status, 403);
    const emp = await srv.client().as('employee_halle');
    assert.equal((await emp.get(`/api/welcome?branch=${HALLE}`)).data.links.ifsg43.url, 'https://gesundheitsamt.example/belehrung');
  });
});
