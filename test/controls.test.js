import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, HALLE, LEUNA } from './helpers.js';
import { berlinToUtc, isDue, ensureRuns, runControlReminders, CONTROL_LISTS } from '../server/controls.js';
import { berlinDate } from '../server/app.js';

const notify = (d, branchId, kind, message, ref, userId = null, audience = 'manager') =>
  d.prepare('INSERT OR IGNORE INTO notifications (branch_id, kind, message, ref, user_id, audience) VALUES (?,?,?,?,?,?)').run(branchId, kind, message, ref, userId, audience).changes;

describe('Kontrolllisten (Issue #20): Intervalle, Fälligkeit, Zuweisung, Pflichtfelder, Erinnerung/Eskalation', () => {
  let srv, emp, mgr, ids = {};
  before(async () => {
    srv = await startServer({ demo: true });
    for (const u of srv.db.prepare('SELECT id, username FROM users').all()) ids[u.username] = u.id;
    emp = await srv.client().as('employee_halle');
    mgr = await srv.client().as('manager_halle');
  });
  after(() => srv.close());
  const list = (code, branch = HALLE) => srv.db.prepare('SELECT * FROM control_lists WHERE branch_id = ? AND code = ?').get(branch, code);

  test('Zeitzone: Fälligkeit Ortszeit Berlin in Sommer- und Winterzeit', () => {
    assert.equal(berlinToUtc('2026-07-15', '17:10').toISOString(), '2026-07-15T15:10:00.000Z');
    assert.equal(berlinToUtc('2026-12-15', '17:10').toISOString(), '2026-12-15T16:10:00.000Z');
    assert.equal(berlinToUtc('2026-12-15', '23:30').toISOString(), '2026-12-15T22:30:00.000Z');
    // Tag der Zeitumstellung (29.03.2026 Sommerzeit, 25.10.2026 Winterzeit)
    assert.equal(berlinToUtc('2026-03-29', '17:10').toISOString(), '2026-03-29T15:10:00.000Z');
    assert.equal(berlinToUtc('2026-10-25', '23:30').toISOString(), '2026-10-25T22:30:00.000Z');
  });

  test('Intervalle: alle 3 Kalendertage ab Startdatum, wöchentlich über Wochenwechsel, täglich', () => {
    const tk = { active: 1, schedule: 'interval', interval_days: 3, start_date: '2026-11-27' };
    assert.deepEqual(['2026-11-26', '2026-11-27', '2026-11-28', '2026-11-30', '2026-12-03', '2026-12-04'].map((d) => isDue(tk, d)), [false, true, false, true, true, false]);
    const wk = { active: 1, schedule: 'weekly', weekday: 1 };
    assert.deepEqual(['2026-11-29', '2026-11-30', '2026-12-06', '2026-12-07'].map((d) => isDue(wk, d)), [false, true, false, true]);
    assert.equal(isDue({ active: 1, schedule: 'daily' }, '2026-12-25'), true);
    assert.equal(isDue({ active: 0, schedule: 'daily' }, '2026-12-25'), false);
  });

  test('Listen aus Betreibervorgaben je Filiale; Wrap nur einmal täglich; offene Mindestwerte nicht erfunden', async () => {
    for (const b of [HALLE, LEUNA]) assert.equal(srv.db.prepare('SELECT COUNT(*) n FROM control_lists WHERE branch_id = ?').get(b).n, CONTROL_LISTS.length);
    const daily = srv.db.prepare(`SELECT i.name FROM control_items i JOIN control_lists l ON l.id = i.list_id WHERE l.branch_id = ? AND l.schedule = 'daily' AND i.name LIKE '%Wrap%'`).all(HALLE);
    assert.equal(daily.length, 1);
    const gran = srv.db.prepare(`SELECT i.min_qty FROM control_items i JOIN control_lists l ON l.id = i.list_id WHERE l.branch_id = ? AND i.name = 'Granatapfel Sauce'`).get(HALLE);
    assert.equal(gran.min_qty, null);
    assert.equal(list('mariniert').due_times, '17:10,23:30');
    const d = (await mgr.get(`/api/controls?branch=${HALLE}`)).data;
    assert.ok(d.missing_min > 0);
    assert.equal((await emp.get(`/api/controls?branch=${HALLE}`)).status, 403);
  });

  test('Mariniertes Fleisch: zwei Termine je Tag (17:10 und 23:30), idempotent auch bei parallelem Aufruf', async () => {
    const date = '2026-12-15';
    await Promise.all([1, 2, 3].map(async () => ensureRuns(srv.db, HALLE, date, notify)));
    ensureRuns(srv.db, HALLE, date, notify);
    const runs = srv.db.prepare('SELECT due_time, due_at FROM control_runs WHERE list_id = ? AND due_date = ? ORDER BY slot').all(list('mariniert').id, date);
    assert.deepEqual(runs.map((r) => r.due_time), ['17:10', '23:30']);
    assert.equal(runs[1].due_at, '2026-12-15T22:30:00.000Z');
  });

  test('Faire Zuweisung an Anwesende, Abwesenheit verteilt neu, Leitung kann zuweisen, Filialtrennung', async () => {
    const today = berlinDate();
    srv.db.prepare('DELETE FROM control_runs WHERE branch_id = ? AND due_date = ?').run(HALLE, today);
    // niemand anwesend → nicht zuweisbar, Meldung an Leitung
    ensureRuns(srv.db, HALLE, today, notify);
    assert.equal(srv.db.prepare('SELECT COUNT(*) n FROM control_runs WHERE branch_id = ? AND due_date = ? AND assigned_to IS NOT NULL').get(HALLE, today).n, 0);
    // Meldung „nicht zuweisbar“ erst ab 60 Minuten vor Fälligkeit
    const soon = new Date(Date.now() + 30 * 60000).toISOString(), later = new Date(Date.now() + 5 * 3600e3).toISOString();
    const two = srv.db.prepare('SELECT id FROM control_runs WHERE branch_id = ? AND due_date = ? ORDER BY id LIMIT 2').all(HALLE, today);
    srv.db.prepare('UPDATE control_runs SET due_at = ? WHERE id = ?').run(soon, two[0].id);
    srv.db.prepare('UPDATE control_runs SET due_at = ? WHERE id = ?').run(later, two[1].id);
    srv.db.prepare("DELETE FROM notifications WHERE ref LIKE 'remind:ctl:%:unassignable'").run();
    ensureRuns(srv.db, HALLE, today, notify);
    assert.equal(srv.db.prepare('SELECT COUNT(*) n FROM notifications WHERE ref = ?').get(`remind:ctl:${two[0].id}:unassignable`).n, 1);
    assert.equal(srv.db.prepare('SELECT COUNT(*) n FROM notifications WHERE ref = ?').get(`remind:ctl:${two[1].id}:unassignable`).n, 0);
    const empId = ids['demo.mitarbeiter.halle'];
    const ins = srv.db.prepare("INSERT OR REPLACE INTO shift_presence (branch_id, work_date, shift, user_id, status, source, updated_by) VALUES (?,?,?,?,?,?,?)");
    ins.run(HALLE, today, 'run', empId, 'present', 'self', empId);
    const others = srv.db.prepare("SELECT m.user_id FROM memberships m WHERE m.branch_id = ? AND m.role IN ('employee','shift_lead') AND m.user_id <> ?").all(HALLE, empId).map((r) => r.user_id);
    assert.ok(others.length >= 1);
    ins.run(HALLE, today, 'run', others[0], 'present', 'self', others[0]);
    ensureRuns(srv.db, HALLE, today, notify);
    const load = srv.db.prepare('SELECT assigned_to, COUNT(*) n FROM control_runs WHERE branch_id = ? AND due_date = ? GROUP BY assigned_to').all(HALLE, today);
    assert.ok(load.every((l) => l.assigned_to != null));
    assert.ok(Math.max(...load.map((l) => l.n)) - Math.min(...load.map((l) => l.n)) <= 1, 'faire Verteilung');
    // Abwesenheit → Läufe gehen an die andere Person
    ins.run(HALLE, today, 'run', others[0], 'absent', 'manager', ids['demo.leitung.halle']);
    ensureRuns(srv.db, HALLE, today, notify);
    assert.equal(srv.db.prepare("SELECT COUNT(*) n FROM control_runs WHERE branch_id = ? AND due_date = ? AND status <> 'done' AND assigned_to = ?").get(HALLE, today, others[0]).n, 0);
    // Leitung weist zu; Mitarbeiter darf nicht; andere Filiale nicht sichtbar
    const run = srv.db.prepare("SELECT id FROM control_runs WHERE branch_id = ? AND due_date = ? AND status = 'open' LIMIT 1").get(HALLE, today);
    assert.equal((await emp.post(`/api/controls/runs/${run.id}/assign`, { user_id: empId })).status, 403);
    assert.equal((await mgr.post(`/api/controls/runs/${run.id}/assign`, { user_id: empId })).status, 200);
    const leunaMgr = await srv.client().as('manager_leuna');
    assert.equal((await leunaMgr.get(`/api/controls/runs/${run.id}`)).status, 403);
  });

  test('Pflichtfelder: leere Menge abgelehnt, Null gültig, Nachbestellhinweis, offener Mindestwert bleibt offen', async () => {
    const today = berlinDate();
    const r = srv.db.prepare('SELECT id FROM control_runs WHERE list_id = ? AND due_date = ? ORDER BY slot LIMIT 1').get(list('kueche').id, today)
      || (() => { srv.db.prepare('UPDATE control_lists SET schedule = ? WHERE id = ?').run('daily', list('kueche').id); ensureRuns(srv.db, HALLE, today, notify); return srv.db.prepare('SELECT id FROM control_runs WHERE list_id = ? AND due_date = ?').get(list('kueche').id, today); })();
    srv.db.prepare('UPDATE control_runs SET assigned_to = ? WHERE id = ?').run(ids['demo.mitarbeiter.halle'], r.id);
    const d = (await emp.get(`/api/controls/runs/${r.id}`)).data;
    const partial = d.items.map((i, k) => ({ item_id: i.id, qty: k === 0 ? '' : 5 }));
    assert.equal((await emp.post(`/api/controls/runs/${r.id}`, { lines: partial })).data.error, 'control_incomplete');
    assert.equal((await emp.post(`/api/controls/runs/${r.id}`, { lines: d.items.map((i) => ({ item_id: i.id, qty: -1 })) })).data.error, 'qty');
    const lines = d.items.map((i) => ({ item_id: i.id, qty: i.name === 'Cheddar-Käsescheiben' ? 0 : i.name === 'Eisberg' ? 1 : 100 }));
    const res = (await emp.post(`/api/controls/runs/${r.id}`, { lines })).data;
    assert.equal(res.ok, true);
    assert.ok(res.below.some((b) => b.startsWith('Cheddar')));
    const after = (await emp.get(`/api/controls/runs/${r.id}`)).data;
    assert.equal(after.items.find((i) => i.name === 'Cheddar-Käsescheiben').qty, 0);
    assert.equal(after.items.find((i) => i.name === 'Cheddar-Käsescheiben').reorder, 1);
    assert.equal(after.items.find((i) => i.name === 'Eisberg').reorder, null);
    assert.equal((await emp.post(`/api/controls/runs/${r.id}`, { lines })).status, 409);
    const ov = (await mgr.get(`/api/controls?branch=${HALLE}`)).data;
    assert.ok(ov.below.some((b) => b.name === 'Cheddar-Käsescheiben'));
    // Managerkontrolle: nicht durch sich selbst, Nacharbeit nur mit Begründung
    assert.equal((await mgr.post(`/api/controls/runs/${r.id}/review`, { ok: false })).data.error, 'note');
    assert.equal((await mgr.post(`/api/controls/runs/${r.id}/review`, { ok: true })).status, 200);
  });

  test('Mariniert: Temperatur, Marinierzeit und Pflichtfoto; Verbrauchsfrist nur mit belegter Quelle', async () => {
    const today = berlinDate();
    ensureRuns(srv.db, HALLE, today, notify);
    const r = srv.db.prepare('SELECT id FROM control_runs WHERE list_id = ? AND due_date = ? AND slot = 0').get(list('mariniert').id, today);
    srv.db.prepare("UPDATE control_runs SET assigned_to = ?, status = 'open' WHERE id = ?").run(ids['demo.mitarbeiter.halle'], r.id);
    const d = (await emp.get(`/api/controls/runs/${r.id}`)).data;
    assert.equal(d.marinated, true); assert.equal(d.photo_required, true); assert.equal(d.use_within_hours, null);
    const before = new Date(Date.now() - 3600e3); const local = `${berlinDate(before)}T${new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false }).format(before)}`;
    const lines = d.items.map((i, k) => ({ item_id: i.id, qty: k === 0 ? 4.5 : 0, marinated_at: k === 0 ? local : '' }));
    assert.equal((await emp.post(`/api/controls/runs/${r.id}`, { lines })).data.error, 'temperature');
    assert.equal((await emp.post(`/api/controls/runs/${r.id}`, { lines: lines.map((l) => ({ ...l, marinated_at: '' })), temperature: 3 })).data.error, 'marinated_at');
    assert.equal((await emp.post(`/api/controls/runs/${r.id}`, { lines, temperature: 3 })).data.error, 'photo_required');
    assert.equal((await mgr.req('PUT', '/api/controls/settings', { branch: HALLE, use_within_hours: 24 })).data.error, 'source');
    assert.equal((await mgr.req('PUT', '/api/controls/settings', { branch: HALLE, use_within_hours: 24, source: 'HACCP-Plan Halle, freigegeben' })).status, 200);
    const ok = await emp.post(`/api/controls/runs/${r.id}`, { lines, temperature: 3, media_id: await emp.photo(HALLE) });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    const after = (await emp.get(`/api/controls/runs/${r.id}`)).data;
    assert.ok(after.items[0].use_by);
    assert.equal(after.temperature, 3);
    await mgr.req('PUT', '/api/controls/settings', { branch: HALLE, use_within_hours: '' });
    assert.equal(ok.data.temp_alarm, false);
  });

  test('Temperatur-Alarm: über +4 °C sofort Meldung an Leitung; Höchstwert nur mit Quelle änderbar', async () => {
    const today = berlinDate();
    ensureRuns(srv.db, HALLE, today, notify);
    const r = srv.db.prepare('SELECT id FROM control_runs WHERE list_id = ? AND due_date = ? AND slot = 1').get(list('mariniert').id, today);
    srv.db.prepare("UPDATE control_runs SET assigned_to = ?, status = 'open' WHERE id = ?").run(ids['demo.mitarbeiter.halle'], r.id);
    const d = (await emp.get(`/api/controls/runs/${r.id}`)).data;
    assert.equal(d.temp_max, 4);
    const lines = d.items.map((i) => ({ item_id: i.id, qty: 0 }));
    const res = (await emp.post(`/api/controls/runs/${r.id}`, { lines, temperature: 6.5, media_id: await emp.photo(HALLE) })).data;
    assert.equal(res.temp_alarm, true);
    const n = srv.db.prepare("SELECT * FROM notifications WHERE ref = ?").get(`ctl:${r.id}:temp`);
    assert.equal(n.audience, 'manager'); assert.match(n.message, /6.5 °C/);
    const ov = (await mgr.get(`/api/controls?branch=${HALLE}`)).data;
    assert.equal(ov.runs.find((x) => x.id === r.id).temp_alarm, true);
    assert.equal((await mgr.req('PUT', '/api/controls/settings', { branch: HALLE, temp_max: 3 })).data.error, 'temp_source');
    assert.equal((await mgr.req('PUT', '/api/controls/settings', { branch: HALLE, temp_max: 30, temp_source: 'x' })).data.error, 'temp_max');
    assert.equal((await mgr.req('PUT', '/api/controls/settings', { branch: HALLE, temp_max: 3, temp_source: 'HACCP-Plan Halle' })).status, 200);
    assert.equal((await emp.get(`/api/controls/runs/${r.id}`)).data.temp_max, 3);
    await mgr.req('PUT', '/api/controls/settings', { branch: HALLE, temp_max: 4, temp_source: 'DIN 10508' });
  });

  test('Erinnerung −10 / 0 / +5 Mitarbeiter, +10 Leitung; nach Neustart keine Flut; Erledigung stoppt Eskalation', async () => {
    const date = '2026-12-16';
    srv.db.prepare("INSERT OR REPLACE INTO shift_presence (branch_id, work_date, shift, user_id, status, source, updated_by) VALUES (?,?,?,?,?,?,?)").run(HALLE, date, 'run', ids['demo.mitarbeiter.halle'], 'present', 'self', ids['demo.mitarbeiter.halle']);
    const due = berlinToUtc(date, '17:10').getTime();
    const at = (min) => new Date(due + min * 60000);
    const mar = list('mariniert').id;
    const cnt = (pat) => srv.db.prepare(`SELECT COUNT(*) n FROM notifications n JOIN control_runs r ON n.ref LIKE 'remind:ctl:' || r.id || ':%' WHERE r.list_id = ? AND r.due_date = ? AND r.slot = 0 AND n.ref LIKE ?`).get(mar, date, pat).n;
    runControlReminders(srv.db, HALLE, at(-30), notify);
    assert.equal(cnt('%'), 0);
    runControlReminders(srv.db, HALLE, at(-9), notify);
    runControlReminders(srv.db, HALLE, at(-8), notify);
    assert.equal(cnt('%:0'), 1, 'eine Vorab-Erinnerung');
    const staffNote = srv.db.prepare(`SELECT n.* FROM notifications n JOIN control_runs r ON n.ref = 'remind:ctl:' || r.id || ':0' WHERE r.list_id = ? AND r.due_date = ? AND r.slot = 0`).get(mar, date);
    assert.equal(staffNote.audience, 'staff'); assert.equal(staffNote.user_id, ids['demo.mitarbeiter.halle']);
    // Küchenliste (ebenfalls 17:10) wird nach der Vorab-Erinnerung erledigt → danach keine weiteren Stufen
    const k = srv.db.prepare('SELECT id FROM control_runs WHERE list_id = ? AND due_date = ?').get(list('kueche').id, date);
    srv.db.prepare("UPDATE control_runs SET status = 'done' WHERE id = ?").run(k.id);
    runControlReminders(srv.db, HALLE, at(0), notify);
    runControlReminders(srv.db, HALLE, at(6), notify);
    assert.equal(cnt('%:1'), 1); assert.equal(cnt('%:2'), 1); assert.equal(cnt('%:3'), 0);
    runControlReminders(srv.db, HALLE, at(11), notify);
    const mgrNote = srv.db.prepare(`SELECT n.* FROM notifications n JOIN control_runs r ON n.ref = 'remind:ctl:' || r.id || ':3' WHERE r.list_id = ? AND r.due_date = ? AND r.slot = 0`).get(mar, date);
    assert.equal(mgrNote.audience, 'manager'); assert.match(mgrNote.message, /Verantwortlich/);
    // Abendtermin: nach "Neustart" erst bei +12 → nur die Leitungsstufe, keine nachgeholten Mitarbeiter-Stufen
    const late = berlinToUtc(date, '23:30').getTime();
    runControlReminders(srv.db, HALLE, new Date(late + 12 * 60000), notify);
    const lateRefs = srv.db.prepare(`SELECT n.ref FROM notifications n JOIN control_runs r ON n.ref LIKE 'remind:ctl:' || r.id || ':%' WHERE r.list_id = ? AND r.due_date = ? AND r.slot = 1`).all(mar, date).map((x) => x.ref.split(':').pop());
    assert.deepEqual(lateRefs, ['3']);
    runControlReminders(srv.db, HALLE, at(20), notify);
    const kRefs = srv.db.prepare("SELECT ref FROM notifications WHERE ref LIKE ?").all(`remind:ctl:${k.id}:%`).map((x) => x.ref.split(':').pop());
    assert.deepEqual(kRefs, ['0']);
    // Mitarbeiter sieht persönliche Erinnerung und kann sie als gelesen markieren
    const mine = (await emp.get(`/api/controls/mine?branch=${HALLE}`)).data;
    assert.ok(Array.isArray(mine.runs));
    assert.equal((await emp.post(`/api/notifications/${staffNote.id}/read`)).status, 200);
  });

  test('Einstellungen: Intervall, Startdatum, Uhrzeiten, Mindestwert und Einheit je Filiale', async () => {
    const tk = list('tiefkuehl');
    assert.equal((await mgr.req('PUT', `/api/controls/lists/${tk.id}`, { interval_days: 1 })).data.error, 'interval');
    assert.equal((await mgr.req('PUT', `/api/controls/lists/${tk.id}`, { due_times: '25:00' })).data.error, 'due_times');
    assert.equal((await mgr.req('PUT', `/api/controls/lists/${tk.id}`, { interval_days: 3, start_date: '2026-12-01', due_times: '16:00' })).status, 200);
    assert.equal(list('tiefkuehl').start_date, '2026-12-01');
    const item = srv.db.prepare('SELECT id FROM control_items WHERE list_id = ? LIMIT 1').get(tk.id);
    assert.equal((await mgr.req('PUT', `/api/controls/items/${item.id}`, { unit: 'Karton', min_qty: 4 })).status, 200);
    assert.equal((await mgr.req('PUT', `/api/controls/items/${item.id}`, { min_qty: -2 })).data.error, 'min_qty');
    assert.equal((await mgr.req('PUT', `/api/controls/items/${item.id}`, { min_qty: '' })).status, 200);
    assert.equal(srv.db.prepare('SELECT min_qty FROM control_items WHERE id = ?').get(item.id).min_qty, null);
    assert.equal((await emp.req('PUT', `/api/controls/items/${item.id}`, { min_qty: 1 })).status, 403);
    const leunaMgr = await srv.client().as('manager_leuna');
    assert.equal((await leunaMgr.req('PUT', `/api/controls/items/${item.id}`, { min_qty: 1 })).status, 403);
    assert.equal((await mgr.req('PUT', '/api/controls/settings', { branch: HALLE, escalation: [{ min: -10, to: 'staff' }, { min: 15, to: 'boss' }] })).data.error, 'escalation');
  });
});
