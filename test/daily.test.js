import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, HALLE, LEUNA } from './helpers.js';
import { runDailyReminders } from '../server/daily.js';
import { PEST_AREAS, ONBOARDING_AREAS, DAILY_ITEMS } from '../server/handbook.js';

describe('Tägliche Inventur, Schädlingskontrolle, Handbuch', () => {
  let srv, ids = {};
  before(async () => {
    srv = await startServer({ demo: true });
    for (const u of srv.db.prepare('SELECT id, username FROM users').all()) ids[u.username] = u.id;
  });
  after(() => srv.close());

  test('Tagesinventur: Liste der Vorlage, Frist, Abgabe nur vollständig, rechtzeitig/verspätet sichtbar', async () => {
    const mgr = await srv.client().as('manager_halle');
    assert.equal((await mgr.req('PUT', '/api/daily/settings', { branch: HALLE, early: '25:00' })).data.error, 'deadline');
    assert.equal((await mgr.req('PUT', '/api/daily/settings', { branch: HALLE, early: '23:59', late: '00:00' })).status, 200);
    const emp = await srv.client().as('employee_halle');
    const d = (await emp.get(`/api/daily?branch=${HALLE}&shift=early`)).data;
    assert.deepEqual(d.items.map((i) => i.name).sort(), DAILY_ITEMS.map((x) => x[0]).sort());
    assert.equal(d.items.filter((i) => i.meat).length, 3);
    assert.equal(d.deadline, '23:59');
    const partial = await emp.post('/api/daily', { branch: HALLE, shift: 'early', submit: true, lines: [{ item_id: d.items[0].item_id, counted: 10 }] });
    assert.equal(partial.data.error, 'daily_incomplete');
    assert.match(partial.data.message, /Noch nicht eingetragen/);
    // Zwischenspeichern geht auch unvollständig
    assert.equal((await emp.post('/api/daily', { branch: HALLE, shift: 'early', lines: [{ item_id: d.items[0].item_id, counted: 10 }] })).data.saved, 1);
    const lines = d.items.map((i) => ({ item_id: i.item_id, counted: i.meat ? 20 : 5, marinated: i.meat ? 4 : undefined }));
    const ok = (await emp.post('/api/daily', { branch: HALLE, shift: 'early', submit: true, lines })).data;
    assert.equal(ok.on_time, true);
    assert.equal((await emp.post('/api/daily', { branch: HALLE, shift: 'early', submit: true, lines })).status, 409);
    // Spätschicht nach Frist (00:00) → verspätet, mit Meldung an die Leitung
    const breast = d.items.find((i) => i.name === 'Hähnchenbrust');
    await emp.post('/api/goods/receipts', { branch: HALLE, item_id: breast.item_id, quantity: 8, decision: 'accepted', condition_ok: true, media_id: await emp.photo(HALLE, 'goods') });
    const late = (await emp.post('/api/daily', { branch: HALLE, shift: 'late', submit: true,
      lines: d.items.map((i) => ({ item_id: i.item_id, counted: i.name === 'Hähnchenbrust' ? 15 : i.meat ? 20 : 5, unusable: i.name === 'Hähnchenbrust' ? 1 : undefined })) })).data;
    assert.equal(late.on_time, false);
    const rep = (await mgr.get(`/api/daily/report?branch=${HALLE}`)).data;
    assert.equal(rep.days[0].early.state, 'on_time');
    assert.equal(rep.days[0].late.state, 'late_done');
    assert.equal(rep.days[0].early.by, 'Demo Mitarbeiter A (fiktiv)');
    // Fleisch: Anfang 20 + Zugang 8 − Rest 15 − nicht verwendbar 1 = Verbrauch 12
    const m = rep.meat.lines.find((l) => l.item === 'Hähnchenbrust');
    assert.deepEqual([m.start, m.incoming, m.rest, m.unusable, m.usage], [20, 8, 15, 1, 12]);
    const notes = (await mgr.get(`/api/dashboard?branch=${HALLE}`)).data[0].notifications.map((n) => n.message).join(' | ');
    assert.match(notes, /Nicht verwendbare Ware gemeldet: Hähnchenbrust/);
    assert.match(notes, /verspätet/);
    // Mitarbeiter sieht die Auswertung nicht; Leuna-Leitung sieht Halle nicht
    assert.equal((await emp.get(`/api/daily/report?branch=${HALLE}`)).status, 403);
    assert.equal((await (await srv.client().as('manager_leuna')).get(`/api/daily/report?branch=${HALLE}`)).status, 403);
  });

  test('Erinnerung: Frist verpasst → einmalige Meldung', async () => {
    const mgr = await srv.client().as('manager_leuna');
    await mgr.req('PUT', '/api/daily/settings', { branch: LEUNA, early: '00:00' });
    const a = runDailyReminders(srv.db, LEUNA);
    const b = runDailyReminders(srv.db, LEUNA);
    assert.ok(a >= 1);
    assert.equal(b, 0);
    const n = srv.db.prepare("SELECT message FROM notifications WHERE branch_id = ? AND kind = 'daily_inventory'").all(LEUNA).map((r) => r.message);
    assert.ok(n.some((m) => m.includes('Frühschicht nicht bis 00:00')));
    assert.equal((await mgr.get(`/api/daily/report?branch=${LEUNA}`)).data.days[0].early.state, 'missed');
  });

  test('Tagesinventur-Aufgabe erst nach Abgabe erledigbar', async () => {
    const empL = await srv.client().as('employee_leuna');
    const task = (await (await srv.client().as('manager_leuna')).get(`/api/shift/tasks?branch=${LEUNA}&shift=run`)).data.find((t) => t.link === 'daily_early');
    assert.ok(task);
    assert.equal((await empL.post(`/api/tasks/${task.id}/complete`)).data.error, 'daily_missing');
    const d = (await empL.get(`/api/daily?branch=${LEUNA}&shift=early`)).data;
    await empL.post('/api/daily', { branch: LEUNA, shift: 'early', submit: true, lines: d.items.map((i) => ({ item_id: i.item_id, counted: 1 })) });
    assert.equal((await empL.post(`/api/tasks/${task.id}/complete`)).status, 200);
  });

  test('Schädlingskontrolle: alle 10 Bereiche, bei Befall Beschreibung + Foto, Meldung an Leitung', async () => {
    const emp = await srv.client().as('employee_halle');
    const p = (await emp.get(`/api/pest?branch=${HALLE}`)).data;
    assert.deepEqual(p.areas, PEST_AREAS);
    assert.ok(p.guide.found.some((x) => x.includes('Keine eigenen Schädlingsbekämpfungsmittel')));
    const all = (finding) => PEST_AREAS.map((a) => ({ area: a, finding: finding && a === 'Lager / Privatraum', note: '', done: true }));
    assert.equal((await emp.post('/api/pest', { branch: HALLE, areas: all(false).slice(1) })).data.error, 'pest_incomplete');
    assert.equal((await emp.post('/api/pest', { branch: HALLE, areas: all(true) })).data.error, 'photo_required');
    const photo = await emp.photo(HALLE, 'problem');
    assert.equal((await emp.post('/api/pest', { branch: HALLE, areas: all(true), media_id: photo })).data.error, 'finding_note');
    const areas = all(true).map((a) => (a.finding ? { ...a, note: 'Kotspuren hinter Regal', measure: 'Bereich gesperrt' } : a));
    const r = (await emp.post('/api/pest', { branch: HALLE, areas, media_id: photo, exterminator_needed: true })).data;
    assert.equal(r.infestation, true);
    const mgr = await srv.client().as('manager_halle');
    const probs = (await mgr.get(`/api/problems?branch=${HALLE}`)).data;
    assert.ok(probs.some((x) => x.description.includes('Kotspuren') && x.description.includes('Schädlingsbekämpfer erforderlich')));
    const dash = (await mgr.get(`/api/dashboard?branch=${HALLE}`)).data[0];
    assert.equal(dash.last_pest_check.infestation, 1);
    assert.equal((await emp.get(`/api/pest?branch=${HALLE}`)).data.history[0].areas.length, 10);
  });

  test('Handbuch und Einarbeitungsbestätigung: erst Trainer, dann Mitarbeiter; keine Selbstbestätigung', async () => {
    const emp = await srv.client().as('employee_halle');
    const h = (await emp.get(`/api/handbook?branch=${HALLE}`)).data;
    assert.equal(h.chapters.length, 12);
    assert.deepEqual(h.areas, ONBOARDING_AREAS);
    assert.equal(h.confirmation, null);
    assert.equal((await emp.post('/api/onboarding/confirm', { branch: HALLE })).data.error, 'no_onboarding');
    assert.equal((await emp.post('/api/onboarding', { branch: HALLE, user_id: ids['demo.mitarbeiter.halle'], areas: ['HACCP'] })).status, 403);
    const trainer = await srv.client().as('trainer');
    assert.equal((await trainer.post('/api/onboarding', { branch: HALLE, user_id: ids['demo.trainer'], areas: ['HACCP'] })).data.error, 'self_onboarding');
    assert.equal((await trainer.post('/api/onboarding', { branch: HALLE, user_id: ids['demo.mitarbeiter.halle'], areas: [] })).data.error, 'areas');
    assert.equal((await trainer.post('/api/onboarding', { branch: HALLE, user_id: ids['demo.mitarbeiter.halle'], areas: ['Persönliche Hygiene', 'HACCP', 'Erfunden'] })).status, 200);
    assert.equal((await emp.post('/api/onboarding/confirm', { branch: HALLE })).status, 200);
    const list = (await trainer.get(`/api/onboarding?branch=${HALLE}`)).data.people.find((p) => p.id === ids['demo.mitarbeiter.halle']);
    assert.deepEqual(list.confirmation.areas, ['Persönliche Hygiene', 'HACCP']);
    assert.ok(list.confirmation.employee_confirmed_at && list.confirmation.trainer_confirmed_at);
  });
});
