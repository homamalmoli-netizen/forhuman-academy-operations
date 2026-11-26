import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, HALLE, LEUNA } from './helpers.js';
import { berlinDate, generateTasks, addDays } from '../server/app.js';
import { oilStatus } from '../server/oil.js';

describe('Ölwechsel nach Intervall, Sperre bei schlechtem Öl, Import', () => {
  let srv, ids = {}, fryer;
  before(async () => {
    srv = await startServer({ demo: true });
    for (const u of srv.db.prepare('SELECT id, username FROM users').all()) ids[u.username] = u.id;
    fryer = srv.db.prepare("SELECT * FROM fryers WHERE branch_id = ? AND name = 'Hähnchen 1'").get(HALLE);
    // Mitarbeiter A für die Fritteuse qualifizieren (Prüfung + praktische Freigabe)
    const c = srv.db.prepare("SELECT id FROM courses WHERE code = 'C-FRYER-GGM'").get().id;
    srv.db.prepare("INSERT INTO exam_attempts (user_id, course_id, course_version, branch_id, lang, score, total, passed, answers) VALUES (?,?,1,?,'de',3,3,1,'[]')").run(ids['demo.mitarbeiter.halle'], c, HALLE);
    srv.db.prepare('INSERT INTO practical_signoffs (user_id, course_id, branch_id, signed_by) VALUES (?,?,?,?)').run(ids['demo.mitarbeiter.halle'], c, HALLE, ids['demo.trainer']);
  });
  after(() => srv.close());
  const addEvent = (type, at, extra = {}) => srv.db.prepare(`INSERT INTO oil_events (fryer_id, branch_id, type, reason, created_by, created_at) VALUES (?,?,?,?,?,?)`)
    .run(fryer.id, HALLE, type, extra.reason ?? null, ids['demo.mitarbeiter.halle'], at);
  const st = (today) => oilStatus(srv.db, srv.db.prepare('SELECT * FROM fryers WHERE id = ?').get(fryer.id), today);

  test('Dienstag → Dienstag: Wechsel am Di, Intervall 7 Tage → fällig am nächsten Di, danach überfällig', () => {
    addEvent('change', '2026-11-24T10:00:00Z', { reason: 'planned' });
    assert.equal(st('2026-11-30').change_state, 'ok');
    assert.equal(st('2026-12-01').next_change_due, '2026-12-01');
    assert.equal(st('2026-12-01').change_state, 'due');
    assert.equal(st('2026-12-02').change_state, 'overdue');
  });

  test('Filtern, Nachfüllen und Messen setzen den Termin nicht zurück', () => {
    addEvent('filter', '2026-11-26T10:00:00Z');
    addEvent('topup', '2026-11-27T10:00:00Z');
    addEvent('tpm', '2026-11-27T11:00:00Z');
    assert.equal(st('2026-11-28').next_change_due, '2026-12-01');
  });

  test('Vorzeitiger Wechsel am Samstag → nächster Termin Samstag', () => {
    addEvent('change', '2026-11-28T09:00:00Z', { reason: 'early' });
    assert.equal(st('2026-11-29').next_change_due, '2026-12-05');
    assert.equal(st('2026-12-01').change_state, 'ok');
  });

  test('Zeitzone: Wechsel 23:30 UTC zählt als nächster Tag in Berlin', () => {
    addEvent('change', '2026-11-28T23:30:00Z', { reason: 'early' }); // = So 00:30 Berlin
    assert.equal(st('2026-11-30').next_change_due, '2026-12-06');
  });

  test('Ölwechsel-Aufgabe wird bei Fälligkeit erzeugt – nur einmal, bleibt bis zum Wechsel offen', () => {
    generateTasks(srv.db, HALLE, '2026-12-05');
    const tpl = srv.db.prepare('SELECT id FROM task_templates WHERE fryer_id = ?').get(fryer.id)?.id;
    assert.ok(tpl, 'Vorlage je Fritteuse angelegt');
    assert.equal(srv.db.prepare('SELECT COUNT(*) n FROM task_occurrences WHERE template_id = ? AND work_date < ?').get(tpl, '2026-12-06').n, 0);
    generateTasks(srv.db, HALLE, '2026-12-06');
    generateTasks(srv.db, HALLE, '2026-12-06');
    generateTasks(srv.db, HALLE, '2026-12-07'); // überfällig: keine zweite Aufgabe, die alte bleibt offen
    assert.equal(srv.db.prepare("SELECT COUNT(*) n FROM task_occurrences WHERE template_id = ? AND status = 'open'").get(tpl).n, 1);
    srv.db.prepare('DELETE FROM task_occurrences WHERE template_id = ?').run(tpl);
  });

  test('Schlechtes Öl: sofort gesperrt, sofortige Wechsel-Aufgabe, kein Filtern; Wechsel hebt Sperre auf und erledigt Aufgabe', async () => {
    srv.db.prepare('DELETE FROM oil_events WHERE fryer_id = ?').run(fryer.id); // Kalender-Testdaten (teils in der Zukunft) entfernen
    const emp = await srv.client().as('employee_halle');
    const photo = await emp.photo(HALLE, 'oil');
    const r = (await emp.post(`/api/oil/${fryer.id}/event`, { type: 'tpm', tpm: 12, temperature: 170, quality_ok: false, media_id: photo })).data;
    assert.equal(r.status.blocked, true);
    assert.equal(r.status.change_state, 'now');
    assert.equal((await emp.post(`/api/oil/${fryer.id}/event`, { type: 'filter' })).data.error, 'blocked');
    const tpl = srv.db.prepare('SELECT id FROM task_templates WHERE fryer_id = ?').get(fryer.id).id;
    const occ = srv.db.prepare("SELECT * FROM task_occurrences WHERE template_id = ? AND work_date = ?").get(tpl, berlinDate());
    assert.ok(occ, 'Wechsel-Aufgabe heute');
    assert.equal((await emp.post(`/api/tasks/${occ.id}/complete`)).data.error, 'oil_change_missing');
    const ch = (await emp.post(`/api/oil/${fryer.id}/event`, { type: 'change', quantity_l: 25, temperature: 20 })).data;
    assert.equal(ch.status.blocked, false);
    assert.equal(ch.status.next_change_due, addDays(berlinDate(), 7));
    assert.equal(srv.db.prepare('SELECT status FROM task_occurrences WHERE id = ?').get(occ.id).status, 'done');
    const ev = srv.db.prepare("SELECT * FROM oil_events WHERE fryer_id = ? AND type = 'change' ORDER BY id DESC LIMIT 1").get(fryer.id);
    assert.equal(ev.reason, 'quality');
    assert.equal(ev.quantity_l, 25);
    assert.equal((await emp.post(`/api/oil/${fryer.id}/event`, { type: 'change' })).data.error, 'reason', 'Grund ist Pflicht');
  });

  test('Tägliche Ölprüfung: Aufgabe erst erledigt, wenn jede Fritteuse heute geprüft ist', async () => {
    const c = srv.db.prepare("SELECT id FROM courses WHERE code = 'C-FRYER-GGM'").get().id;
    srv.db.prepare("INSERT INTO exam_attempts (user_id, course_id, course_version, branch_id, lang, score, total, passed, answers) VALUES (?,?,1,?,'de',3,3,1,'[]')").run(ids['demo.schichtfuehrer.halle'], c, HALLE);
    srv.db.prepare('INSERT INTO practical_signoffs (user_id, course_id, branch_id, signed_by) VALUES (?,?,?,?)').run(ids['demo.schichtfuehrer.halle'], c, HALLE, ids['demo.trainer']);
    const lead = await srv.client().as('shift_lead_halle');
    const t = (await lead.get(`/api/shift/tasks?branch=${HALLE}&shift=run`)).data.find((x) => x.link === 'oil_check');
    const r = await lead.post(`/api/tasks/${t.id}/complete`);
    assert.equal(r.data.error, 'oil_check_missing');
    assert.match(r.data.message, /Pommes 1/);
  });

  test('Import: Gerätezuordnung, Duplikatschutz, unbekannte Geräte, Testdaten sperren nichts', async () => {
    const mgr = await srv.client().as('manager_halle');
    const pommes = srv.db.prepare("SELECT * FROM fryers WHERE branch_id = ? AND name = 'Pommes 1'").get(HALLE);
    await mgr.patch(`/api/oil/${pommes.id}`, { tpm_limit: 24, limit_source: 'DEMO (fiktiv)' });
    assert.equal((await mgr.patch(`/api/oil/${pommes.id}`, { device_serial: fryer.device_serial })).data.error, 'serial_taken');
    const rows = [
      { device_serial: pommes.device_serial, measured_at: '2026-11-26T08:00:00Z', tpm: 14, temperature: 175 },
      { device_serial: pommes.device_serial, measured_at: '2026-11-26T08:00:00Z', tpm: 14, temperature: 175 },
      { device_serial: 'UNBEKANNT-1', measured_at: '2026-11-26T08:00:00Z', tpm: 10 },
      { device_serial: pommes.device_serial, measured_at: 'kein Datum', tpm: 10 },
    ];
    const r = (await mgr.post('/api/oil/import', { branch: HALLE, rows })).data;
    assert.deepEqual([r.imported, r.duplicates, r.invalid], [1, 1, 1]);
    assert.deepEqual(r.unknown_devices, ['UNBEKANNT-1']);
    const t = (await mgr.post('/api/oil/import', { branch: HALLE, source: 'test', rows: [{ device_serial: pommes.device_serial, measured_at: '2026-11-26T09:00:00Z', tpm: 30 }] })).data;
    assert.equal(t.imported, 1);
    assert.equal(srv.db.prepare('SELECT blocked FROM fryers WHERE id = ?').get(pommes.id).blocked, 0, 'Testdaten sperren nicht');
    assert.match(srv.db.prepare("SELECT note FROM oil_events WHERE source = 'test'").get().note, /TESTDATEN/);
    const real = (await mgr.post('/api/oil/import', { branch: HALLE, rows: [{ device_serial: pommes.device_serial, measured_at: '2026-11-26T10:00:00Z', tpm: 26 }] })).data;
    assert.deepEqual(real.blocked, ['Pommes 1']);
    assert.equal((await (await srv.client().as('employee_halle')).post('/api/oil/import', { branch: HALLE, rows })).status, 403);
    assert.equal((await (await srv.client().as('manager_leuna')).post('/api/oil/import', { branch: HALLE, rows })).status, 403);
  });
});

describe('Persönliche Aufgabenverteilung, Reinigungsplan, Nachreinigung, Wochenbericht', () => {
  let srv, ids = {};
  before(async () => {
    srv = await startServer({ demo: true });
    for (const u of srv.db.prepare('SELECT id, username FROM users').all()) ids[u.username] = u.id;
  });
  after(() => srv.close());

  test('Faire Verteilung an eingeteilte, qualifizierte Personen; jede Aufgabe genau einmal; Schichtführer-Aufgaben nur an Schichtführer', async () => {
    const empA = await srv.client().as('employee_halle');
    const lead = await srv.client().as('shift_lead_halle');
    assert.equal((await empA.post('/api/presence', { branch: HALLE, shift: 'close' })).status, 200);
    assert.equal((await empA.post('/api/presence', { branch: HALLE, shift: 'close', status: 'absent' })).data.error, 'self_absent');
    const r = (await lead.post('/api/presence', { branch: HALLE, shift: 'close' })).data;
    assert.equal(r.active, true);
    const occ = srv.db.prepare(`SELECT o.*, t.role FROM task_occurrences o JOIN task_templates t ON t.id = o.template_id WHERE o.branch_id = ? AND o.shift = 'close' AND o.work_date = ? AND o.status = 'open'`).all(HALLE, berlinDate());
    assert.ok(occ.length > 10);
    for (const o of occ.filter((x) => x.assigned_to)) assert.ok([ids['demo.mitarbeiter.halle'], ids['demo.schichtfuehrer.halle']].includes(o.assigned_to));
    for (const o of occ.filter((x) => x.role === 'shift_lead')) assert.equal(o.assigned_to, ids['demo.schichtfuehrer.halle']);
    const loadA = occ.filter((o) => o.assigned_to === ids['demo.mitarbeiter.halle']).length;
    assert.ok(loadA > 0, 'Mitarbeiter A bekommt Aufgaben');
    // persönliche Ansicht
    const mine = (await empA.get(`/api/shift/next?branch=${HALLE}&shift=close`)).data;
    assert.equal(mine.personal, true);
    assert.equal(mine.next.assigned_to, ids['demo.mitarbeiter.halle']);
    assert.ok(mine.team_open > 0);
    // fremde Aufgabe nicht erledigen
    const other = srv.db.prepare(`SELECT o.id FROM task_occurrences o JOIN task_templates t ON t.id = o.template_id WHERE o.branch_id = ? AND o.shift = 'close' AND o.work_date = ?
      AND o.status = 'open' AND o.assigned_to = ? AND t.role = 'all' AND t.station_id IS NULL AND t.action IS NULL LIMIT 1`).get(HALLE, berlinDate(), ids['demo.schichtfuehrer.halle']);
    if (other) assert.equal((await empA.post(`/api/tasks/${other.id}/complete`, { media_id: await empA.photo(HALLE) })).data.error, 'assigned_other');
  });

  test('Abwesenheit: Aufgaben werden neu verteilt; nicht zuweisbare Aufgaben werden eskaliert', async () => {
    const mgr = await srv.client().as('manager_halle');
    assert.equal((await mgr.post('/api/presence', { branch: HALLE, shift: 'close', user_id: ids['demo.schichtfuehrer.halle'], status: 'absent' })).status, 200);
    const occ = srv.db.prepare(`SELECT o.*, t.role FROM task_occurrences o JOIN task_templates t ON t.id = o.template_id WHERE o.branch_id = ? AND o.shift = 'close' AND o.work_date = ? AND o.status = 'open'`).all(HALLE, berlinDate());
    assert.equal(occ.filter((o) => o.assigned_to === ids['demo.schichtfuehrer.halle']).length, 0);
    assert.ok(occ.filter((o) => o.role === 'shift_lead').every((o) => o.assigned_to === null), 'Schichtführer-Aufgaben ohne Schichtführer: nicht zuweisbar');
    const notes = srv.db.prepare("SELECT message FROM notifications WHERE branch_id = ? AND kind = 'unassigned'").all(HALLE).map((n) => n.message);
    assert.ok(notes.some((m) => m.includes('Türen abschließen')));
    // Presence-Liste für die Leitung
    const p = (await mgr.get(`/api/presence?branch=${HALLE}&shift=close`)).data;
    assert.equal(p.people.find((x) => x.id === ids['demo.schichtfuehrer.halle']).status, 'absent');
  });

  test('Manuelle Zuweisung nur an berechtigte Personen; Mitarbeiter dürfen nicht zuweisen', async () => {
    const mgr = await srv.client().as('manager_halle');
    const empA = await srv.client().as('employee_halle');
    const leadTask = srv.db.prepare(`SELECT o.id FROM task_occurrences o JOIN task_templates t ON t.id = o.template_id WHERE o.branch_id = ? AND o.shift = 'close' AND t.role = 'shift_lead' AND o.status = 'open' LIMIT 1`).get(HALLE).id;
    assert.equal((await mgr.post(`/api/tasks/${leadTask}/assign`, { user_id: ids['demo.mitarbeiter.halle'] })).data.error, 'not_eligible');
    assert.equal((await empA.post(`/api/tasks/${leadTask}/assign`, { user_id: ids['demo.mitarbeiter.halle'] })).status, 403);
    assert.equal((await mgr.post(`/api/tasks/${leadTask}/assign`, { user_id: ids['demo.schichtfuehrer.halle'] })).status, 200);
    assert.equal(srv.db.prepare('SELECT assignment_mode FROM task_occurrences WHERE id = ?').get(leadTask).assignment_mode, 'manual');
  });

  test('Reinigungsplan: Status offen / in Arbeit / erledigt / überfällig, Nachreinigung durch Leitung', async () => {
    const empA = await srv.client().as('employee_halle');
    const mgr = await srv.client().as('manager_halle');
    // überfällige Wochenreinigung von gestern
    const weekly = srv.db.prepare("SELECT * FROM task_templates WHERE branch_id = ? AND category = 'cleaning' AND carry_over = 1 AND role = 'all' LIMIT 1").get(HALLE);
    srv.db.prepare('INSERT INTO task_occurrences (template_id, branch_id, shift, work_date, position) VALUES (?,?,?,?,?)').run(weekly.id, HALLE, weekly.shift, addDays(berlinDate(), -1), weekly.position);
    let c = (await empA.get(`/api/cleaning?branch=${HALLE}`)).data;
    assert.ok(c.tasks.some((t) => t.status === 'overdue' && t.title === JSON.parse(weekly.title).de));
    assert.ok(c.tasks.length >= 15);
    const mine = c.tasks.find((t) => t.status === 'open' && t.assigned === 'Demo Mitarbeiter A (fiktiv)' && !t.requires_photo);
    assert.equal((await empA.post(`/api/tasks/${mine.id}/start`)).status, 200);
    c = (await empA.get(`/api/cleaning?branch=${HALLE}`)).data;
    assert.equal(c.tasks.find((t) => t.id === mine.id).status, 'in_progress');
    assert.equal((await empA.post(`/api/tasks/${mine.id}/complete`)).status, 200);
    c = (await empA.get(`/api/cleaning?branch=${HALLE}`)).data;
    const done = c.tasks.find((t) => t.id === mine.id);
    assert.equal(done.status, 'done');
    assert.equal(done.completed_by, 'Demo Mitarbeiter A (fiktiv)');
    assert.ok(done.completed_at);
    assert.equal((await empA.post(`/api/tasks/${mine.id}/return`, { note: 'nochmal' })).status, 403);
    assert.equal((await mgr.post(`/api/tasks/${mine.id}/return`, { note: '' })).data.error, 'note');
    assert.equal((await mgr.post(`/api/tasks/${mine.id}/return`, { note: 'Ecken nicht sauber' })).status, 200);
    const back = srv.db.prepare('SELECT * FROM task_occurrences WHERE id = ?').get(mine.id);
    assert.equal(back.status, 'rework');
    assert.equal(back.assigned_to, ids['demo.mitarbeiter.halle']);
    assert.match(back.note, /Ecken nicht sauber/);
    // ereignisbasierte Reinigung (nach Benutzung) beliebig oft
    assert.equal((await empA.post('/api/cleaning/log', { branch: HALLE, area: 'Panierstation nach Benutzung' })).status, 200);
    assert.equal((await empA.post('/api/cleaning/log', { branch: HALLE, area: 'Panierstation nach Benutzung' })).status, 200);
    assert.equal((await empA.post('/api/cleaning/log', { branch: HALLE, area: 'Erfunden' })).data.error, 'area');
    c = (await empA.get(`/api/cleaning?branch=${HALLE}`)).data;
    assert.equal(c.event_areas.find((a) => a.area === 'Panierstation nach Benutzung').last.by, 'Demo Mitarbeiter A (fiktiv)');
    // Filialtrennung
    assert.equal((await (await srv.client().as('employee_leuna')).post(`/api/tasks/${mine.id}/start`)).status, 403);
  });

  test('Intervall-Wartung: fällig ab letzter Erledigung + Intervall', () => {
    const t = srv.db.prepare("INSERT INTO task_templates (branch_id, shift, position, category, icon, title, interval_days, carry_over) VALUES (?, 'close', 999, 'maintenance', 'build', ?, 14, 1)")
      .run(LEUNA, JSON.stringify({ de: 'Wartung X (Test)' })).lastInsertRowid;
    generateTasks(srv.db, LEUNA, '2026-12-01');
    const o = srv.db.prepare('SELECT * FROM task_occurrences WHERE template_id = ?').get(t);
    assert.equal(o.work_date, '2026-12-01', 'nie erledigt → sofort fällig');
    srv.db.prepare("UPDATE task_occurrences SET status = 'done', completed_at = '2026-12-01T10:00:00Z' WHERE id = ?").run(o.id);
    generateTasks(srv.db, LEUNA, '2026-12-14');
    assert.equal(srv.db.prepare('SELECT COUNT(*) n FROM task_occurrences WHERE template_id = ?').get(t).n, 1);
    generateTasks(srv.db, LEUNA, '2026-12-15');
    assert.equal(srv.db.prepare('SELECT COUNT(*) n FROM task_occurrences WHERE template_id = ?').get(t).n, 2);
  });

  test('Wochenbericht je Filiale mit Verantwortlichen, Reinigung, Öl, Überfälligem', async () => {
    const mgr = await srv.client().as('manager_halle');
    const w = (await mgr.get(`/api/reports/week?branch=${HALLE}`)).data;
    assert.equal(w.days.length, 7);
    assert.ok(w.open_assigned.some((p) => p.name === 'Demo Mitarbeiter A (fiktiv)' && p.n >= 1), 'offene Aufgaben je Verantwortlichem');
    assert.ok(w.cleaning.total > 0);
    assert.ok(w.overdue.length >= 1);
    assert.equal((await (await srv.client().as('employee_halle')).get(`/api/reports/week?branch=${HALLE}`)).status, 403);
    assert.equal((await (await srv.client().as('manager_leuna')).get(`/api/reports/week?branch=${HALLE}`)).status, 403);
  });
});
