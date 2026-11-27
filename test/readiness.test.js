import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, HALLE } from './helpers.js';
import { ONBOARDING_AREAS } from '../server/handbook.js';
import { purgeHygiene, HYGIENE_ITEMS } from '../server/readiness.js';
import { berlinDate } from '../server/app.js';

const monthsAgo = (m) => { const d = new Date(); d.setMonth(d.getMonth() - m); return d.toISOString().slice(0, 10); };

describe('Einarbeitungs-Freigabe und Hygiene-Check (serverseitige Sperre)', () => {
  let srv, mgr, trainer, neu, neuId;
  before(async () => {
    srv = await startServer({ demo: true });
    mgr = await srv.client().as('manager_halle');
    trainer = await srv.client().as('trainer');
    const r = (await mgr.post('/api/staff', { branch: HALLE, username: 'neu.einarbeitung', display_name: 'Neu Einarbeitung (fiktiv)', role: 'employee' })).data;
    neuId = r.user_id;
    neu = srv.client();
    assert.equal((await neu.post('/api/invite/redeem', { code: r.invite_code, password: 'eigenes-passwort-1' })).status, 200);
    // Pflichtkurse sind hier nicht Gegenstand des Tests
    srv.db.prepare('UPDATE courses SET required = 0').run();
  });
  after(() => srv.close());

  test('Ohne Freigabe: keine Aufgaben, Abschließen gesperrt; Lernbereiche bleiben offen', async () => {
    const s = (await neu.get(`/api/shift/next?branch=${HALLE}&shift=open`)).data;
    assert.equal(s.locked, true); assert.equal(s.gate.reason, 'not_released'); assert.equal(s.tasks.length, 0);
    const occ = srv.db.prepare("SELECT id FROM task_occurrences WHERE branch_id = ? AND status = 'open' LIMIT 1").get(HALLE)
      || (await (await srv.client().as('employee_halle')).get(`/api/shift/next?branch=${HALLE}&shift=open`), srv.db.prepare("SELECT id FROM task_occurrences WHERE branch_id = ? AND status = 'open' LIMIT 1").get(HALLE));
    assert.equal((await neu.post(`/api/tasks/${occ.id}/complete`, {})).data.error, 'not_released');
    assert.equal((await neu.get(`/api/train?branch=${HALLE}`)).status, 200);
    assert.equal((await neu.get(`/api/handbook?branch=${HALLE}`)).status, 200);
    const me = (await neu.get(`/api/readiness/me?branch=${HALLE}`)).data;
    assert.equal(me.released, false);
    assert.deepEqual(me.items.filter((i) => !i.ok).map((i) => i.key).sort(), ['annual_hygiene', 'employer_instruction', 'ifsg43', 'onboarding']);
    assert.equal((await neu.get(`/api/readiness?branch=${HALLE}`)).status, 403);
  });

  test('Freigabe erst bei erfüllten Pflichtpunkten; §43-Belehrung älter als 3 Monate nur mit Notiz zur früheren Aufnahme', async () => {
    assert.equal((await mgr.post(`/api/readiness/${neuId}/release`, { branch: HALLE })).data.error, 'not_ready');
    // §43-Nachweis (4 Monate alt) hochladen und bestätigen lassen
    const cert = (await neu.post('/api/certificates', { branch: HALLE, type: 'ifsg43', issued_on: monthsAgo(4), media_id: await neu.photo(HALLE, 'certificate') })).data;
    assert.equal((await mgr.post(`/api/certificates/${cert.id}/review`, { status: 'approved' })).status, 200);
    // Arbeitgeberbelehrung durch die Leitung
    assert.equal((await mgr.post('/api/certificates/followup', { branch: HALLE, user_id: neuId, issued_on: berlinDate() })).status, 200);
    // Einweisung durch Trainer, dann Bestätigung durch die Person
    assert.equal((await trainer.post('/api/onboarding', { branch: HALLE, user_id: neuId, areas: ONBOARDING_AREAS })).status, 200);
    assert.equal((await neu.post('/api/onboarding/confirm', { branch: HALLE })).status, 200);
    assert.equal((await mgr.post(`/api/readiness/${neuId}/release`, { branch: HALLE })).data.error, 'ifsg_too_old');
    assert.equal((await mgr.post(`/api/readiness/${neuId}/release`, { branch: HALLE, prior_activity: true })).data.error, 'note');
    assert.equal((await mgr.post(`/api/readiness/${neuId}/release`, { branch: HALLE, prior_activity: true, note: 'Seit Juli bei uns tätig, Belehrung lag damals rechtzeitig vor (fiktiv)' })).status, 200);
    const s = (await neu.get(`/api/shift/next?branch=${HALLE}&shift=open`)).data;
    assert.ok(!s.locked, 'nach Freigabe entsperrt');
    // Entzug mit Grund sperrt wieder
    assert.equal((await mgr.post(`/api/readiness/${neuId}/revoke`, { branch: HALLE })).data.error, 'note');
    assert.equal((await mgr.post(`/api/readiness/${neuId}/revoke`, { branch: HALLE, note: 'Nachweis abgelaufen (fiktiv)' })).status, 200);
    assert.equal((await neu.get(`/api/shift/next?branch=${HALLE}&shift=open`)).data.locked, true);
    await mgr.post(`/api/readiness/${neuId}/release`, { branch: HALLE, prior_activity: true, note: 'wieder freigegeben (fiktiv)' });
  });

  test('Hygiene-Check: Pflicht vor Schichtbeginn je Schicht, keine Vorauswahl, „Nein“ → vertrauliche Leitungsprüfung', async () => {
    assert.equal((await mgr.req('PUT', '/api/readiness/settings', { branch: HALLE, gate_hygiene: true })).status, 200);
    assert.equal((await neu.get(`/api/shift/next?branch=${HALLE}&shift=open`)).data.gate.reason, 'hygiene_check_required');
    const yes = Object.fromEntries(HYGIENE_ITEMS.map((k) => [k, 'yes']));
    assert.equal((await neu.post('/api/hygiene', { branch: HALLE, shift: 'open', answers: { clothes: 'yes' } })).data.error, 'hygiene_incomplete');
    assert.equal((await neu.post('/api/hygiene', { branch: HALLE, shift: 'open', answers: yes })).data.all_ok, true);
    assert.ok(!(await neu.get(`/api/shift/next?branch=${HALLE}&shift=open`)).data.locked);
    assert.equal((await neu.get(`/api/shift/next?branch=${HALLE}&shift=close`)).data.gate.reason, 'hygiene_check_required', 'je Schicht neu');
    // Nägel nicht in Ordnung → Prüfung durch Leitung, Meldung ohne Details
    const r = (await neu.post('/api/hygiene', { branch: HALLE, shift: 'close', answers: { ...yes, nails: 'no' } })).data;
    assert.equal(r.review, 'pending');
    assert.equal((await neu.get(`/api/shift/next?branch=${HALLE}&shift=close`)).data.gate.reason, 'hygiene_pending');
    const note = srv.db.prepare("SELECT message FROM notifications WHERE kind = 'hygiene' ORDER BY id DESC LIMIT 1").get();
    assert.match(note.message, /Neu Einarbeitung/); assert.doesNotMatch(note.message, /Nägel|nails/i);
    const p = (await mgr.get(`/api/readiness?branch=${HALLE}`)).data.pending.find((x) => x.user_id === neuId);
    assert.deepEqual(p.no, ['nails']); assert.equal(p.can_clear, true);
    assert.equal((await (await srv.client().as('employee_halle')).post(`/api/hygiene/${p.id}/review`, { decision: 'cleared' })).status, 403);
    assert.equal((await mgr.post(`/api/hygiene/${p.id}/review`, { decision: 'cleared' })).status, 200);
    assert.ok(!(await neu.get(`/api/shift/next?branch=${HALLE}&shift=close`)).data.locked);
  });

  test('Mögliches Tätigkeitsverbot („no_ban“ = Nein) ist nicht übersteuerbar; gesperrt bleibt gesperrt', async () => {
    const yes = Object.fromEntries(HYGIENE_ITEMS.map((k) => [k, 'yes']));
    await neu.post('/api/hygiene', { branch: HALLE, shift: 'run', answers: { ...yes, no_ban: 'no' } });
    const p = (await mgr.get(`/api/readiness?branch=${HALLE}`)).data.pending.find((x) => x.user_id === neuId && x.shift === 'run');
    assert.equal(p.can_clear, false);
    assert.equal((await mgr.post(`/api/hygiene/${p.id}/review`, { decision: 'cleared' })).data.error, 'legal_ban');
    assert.equal((await mgr.post(`/api/hygiene/${p.id}/review`, { decision: 'blocked' })).status, 200);
    assert.equal((await neu.get(`/api/shift/next?branch=${HALLE}&shift=run`)).data.gate.reason, 'hygiene_blocked');
    assert.equal((await neu.post('/api/hygiene', { branch: HALLE, shift: 'run', answers: yes })).data.error, 'hygiene_blocked');
    // Kontrolllisten sind ebenfalls gesperrt
    const extra = (await neu.post(`/api/controls/lists/${srv.db.prepare("SELECT id FROM control_lists WHERE branch_id = ? AND code = 'regal2'").get(HALLE).id}/extra`, {})).data;
    assert.equal((await neu.post(`/api/controls/runs/${extra.id}`, { lines: [] })).data.error, 'hygiene_blocked');
  });

  test('Datensparsam: Antworten werden nach der Aufbewahrungsfrist gelöscht; Leitung, Trainer, Betreiber sind ausgenommen', async () => {
    srv.db.prepare("UPDATE hygiene_checks SET work_date = '2026-01-01' WHERE user_id = ? AND shift = 'open'").run(neuId);
    purgeHygiene(srv.db);
    assert.equal(srv.db.prepare("SELECT answers FROM hygiene_checks WHERE user_id = ? AND shift = 'open'").get(neuId).answers, null);
    assert.equal(srv.db.prepare("SELECT answers IS NOT NULL a FROM hygiene_checks WHERE user_id = ? AND shift = 'close'").get(neuId).a, 1);
    assert.ok(!(await mgr.get(`/api/shift/next?branch=${HALLE}&shift=open`)).data.locked);
    assert.equal((await mgr.req('PUT', '/api/readiness/settings', { branch: HALLE, retention_days: 0 })).data.error, 'retention_days');
    await mgr.req('PUT', '/api/readiness/settings', { branch: HALLE, gate_hygiene: false });
  });
});
