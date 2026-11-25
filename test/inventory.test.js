import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, HALLE, LEUNA } from './helpers.js';
import { berlinDate } from '../server/app.js';
import { isoWeek, isoWeekday, inventoryStatus, runReminders, dateOfWeekday } from '../server/inventory.js';

test('ISO-Kalenderwoche korrekt, auch am Jahreswechsel', () => {
  assert.equal(isoWeek('2026-11-25'), '2026-W48');
  assert.equal(isoWeek('2021-01-03'), '2020-W53');
  assert.equal(isoWeek('2024-12-30'), '2025-W01');
  assert.equal(isoWeek('2026-01-01'), '2026-W01');
  assert.equal(dateOfWeekday('2026-11-25', 1), '2026-11-23');
});

describe('Wöchentliche Inventur und Erinnerungen', () => {
  let srv;
  before(async () => { srv = await startServer({ demo: true }); });
  after(() => srv.close());

  test('Status: anstehend → heute fällig → überfällig; Erinnerung nur einmal je Anlass', () => {
    // Inventur montags (Standard). Woche 2026-W48: Mo 23.11.
    assert.equal(inventoryStatus(srv.db, HALLE, '2026-11-22').state, 'overdue'); // Sonntag der Vorwoche W47, Mo 16.11. vorbei
    assert.equal(inventoryStatus(srv.db, HALLE, '2026-11-23').state, 'due');
    assert.equal(inventoryStatus(srv.db, HALLE, '2026-11-25').state, 'overdue');
    srv.db.prepare("INSERT INTO branch_settings (branch_id, key, value) VALUES (?, 'inventory_weekday', '5')").run(LEUNA);
    assert.equal(inventoryStatus(srv.db, LEUNA, '2026-11-25').state, 'upcoming');
    const before = srv.db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind = 'inventory'").get().n;
    runReminders(srv.db, HALLE, '2026-11-23');
    runReminders(srv.db, HALLE, '2026-11-23');
    runReminders(srv.db, HALLE, '2026-11-25');
    runReminders(srv.db, HALLE, '2026-11-26');
    const rows = srv.db.prepare("SELECT ref FROM notifications WHERE kind = 'inventory' AND branch_id = ?").all(HALLE).map((r) => r.ref);
    assert.equal(srv.db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind = 'inventory'").get().n - before, 2);
    assert.ok(rows.includes('remind:inventory:due:2026-W48'));
    assert.ok(rows.includes('remind:inventory:overdue:2026-W48'));
  });

  test('Inventur zählen: Mitarbeiter darf zählen, abschließen nur Schichtführer/Leitung, alle Artikel nötig', async () => {
    const emp = await srv.client().as('employee_halle');
    const lead = await srv.client().as('shift_lead_halle');
    const inv = (await emp.get(`/api/inventory?branch=${HALLE}`)).data;
    assert.equal(inv.week, isoWeek(berlinDate()));
    assert.ok(inv.items.length >= 5);
    const [first, ...rest] = inv.items;
    assert.equal((await emp.req('PUT', '/api/inventory/lines', { branch: HALLE, lines: [{ item_id: first.item_id, counted: -1 }] })).data.error, 'counted');
    assert.equal((await emp.req('PUT', '/api/inventory/lines', { branch: HALLE, lines: [{ item_id: first.item_id, counted: first.expected - 2 }] })).data.saved, 1);
    assert.equal((await emp.post('/api/inventory/submit', { branch: HALLE })).status, 403);
    const incomplete = await lead.post('/api/inventory/submit', { branch: HALLE });
    assert.equal(incomplete.data.error, 'inventory_incomplete');
    assert.match(incomplete.data.message, new RegExp(rest[0].name.replace(/[()]/g, '.')));
    await lead.req('PUT', '/api/inventory/lines', { branch: HALLE, lines: rest.map((i) => ({ item_id: i.item_id, counted: i.expected })) });
    const done = (await lead.post('/api/inventory/submit', { branch: HALLE })).data;
    assert.equal(done.diffs, 1);
    const stock = (await emp.get(`/api/stock?branch=${HALLE}`)).data.find((s) => s.id === first.item_id);
    assert.equal(stock.qty, first.expected - 2);
    assert.equal((await lead.post('/api/inventory/submit', { branch: HALLE })).status, 409);
    assert.equal((await emp.req('PUT', '/api/inventory/lines', { branch: HALLE, lines: [{ item_id: first.item_id, counted: 1 }] })).status, 409);
    const after = (await emp.get(`/api/inventory?branch=${HALLE}`)).data;
    assert.equal(after.state, 'done');
    assert.equal(after.history[0].diff_items, 1);
    // Leuna unberührt
    assert.equal((await (await srv.client().as('employee_leuna')).get(`/api/inventory?branch=${LEUNA}`)).data.count_id, null);
  });

  test('Inventur-Aufgabe: erscheint am eingestellten Wochentag nur für Schichtführer und ist erst nach Abschluss erledigbar', async () => {
    const mgr = await srv.client().as('manager_leuna');
    const today = isoWeekday(berlinDate());
    assert.equal((await mgr.req('PUT', '/api/inventory/settings', { branch: LEUNA, weekday: 9 })).data.error, 'weekday');
    assert.equal((await mgr.req('PUT', '/api/inventory/settings', { branch: LEUNA, weekday: today })).status, 200);
    const emp = await srv.client().as('employee_leuna');
    const empTasks = (await emp.get(`/api/shift/tasks?branch=${LEUNA}&shift=close`));
    assert.equal(empTasks.status, 403); // Mitarbeiter sieht keine Managerliste
    const d = (await emp.get(`/api/shift/next?branch=${LEUNA}&shift=close`)).data;
    assert.ok(!JSON.stringify(d).includes('Wöchentliche Inventur'), 'Mitarbeiter sieht die Inventur-Aufgabe nicht');
    const all = (await mgr.get(`/api/shift/tasks?branch=${LEUNA}&shift=close`)).data;
    const invTask = all.find((t) => t.link === 'inventory');
    assert.ok(invTask);
    assert.equal(invTask.role, 'shift_lead');
    assert.equal((await mgr.post(`/api/tasks/${invTask.id}/complete`)).data.error, 'inventory_missing');
    const inv = (await mgr.get(`/api/inventory?branch=${LEUNA}`)).data;
    await mgr.req('PUT', '/api/inventory/lines', { branch: LEUNA, lines: inv.items.map((i) => ({ item_id: i.item_id, counted: i.expected })) });
    assert.equal((await mgr.post('/api/inventory/submit', { branch: LEUNA })).data.diffs, 0);
    assert.equal((await mgr.post(`/api/tasks/${invTask.id}/complete`)).status, 200);
    const dash = (await mgr.get(`/api/dashboard?branch=${LEUNA}`)).data[0];
    assert.equal(dash.inventory.state, 'done');
  });
});

describe('Schulungen: Pflicht, Gültigkeit, Voraussetzungen', () => {
  let srv;
  before(async () => { srv = await startServer({ demo: true }); });
  after(() => srv.close());

  test('Fünf Pflichtschulungen vorhanden, alle in vier Sprachen mit Bildfrage', () => {
    const rows = srv.db.prepare('SELECT code, content FROM courses').all();
    assert.deepEqual(rows.map((r) => r.code).sort(), ['C-ALLERGENS', 'C-CLEANING', 'C-FRYER-GGM', 'C-GOODS', 'C-HYGIENE']);
    for (const r of rows) {
      const c = JSON.parse(r.content);
      assert.deepEqual(Object.keys(c).sort(), ['ar', 'de', 'en', 'tr'], r.code);
      for (const l of Object.keys(c)) {
        assert.equal(c[l].steps.length, c.de.steps.length, `${r.code}/${l} Schritte`);
        assert.equal(c[l].questions.length, c.de.questions.length, `${r.code}/${l} Fragen`);
        c[l].questions.forEach((q, i) => {
          assert.equal(q.correct, c.de.questions[i].correct, `${r.code}/${l} Lösung ${i}`);
          assert.ok(q.correct < q.options.length);
        });
      }
      assert.ok(c.de.questions.some((q) => q.image), `${r.code} Bildfrage`);
    }
  });

  test('Gültigkeit: abgelaufene Schulung zählt nicht mehr und wird erinnert', async () => {
    const admin = await srv.client().as('admin');
    const hyg = srv.db.prepare("SELECT id FROM courses WHERE code = 'C-HYGIENE'").get().id;
    assert.equal((await admin.patch(`/api/courses/${hyg}`, { valid_months: 99 })).data.error, 'valid_months');
    assert.equal((await (await srv.client().as('manager_halle')).patch(`/api/courses/${hyg}`, { valid_months: 12 })).status, 403);
    assert.equal((await admin.patch(`/api/courses/${hyg}`, { valid_months: 12 })).status, 200);
    const emp = await srv.client().as('employee_halle');
    let c = (await emp.get(`/api/courses?branch=${HALLE}`)).data.find((x) => x.id === hyg);
    assert.equal(c.exam, true);
    assert.ok(c.expires_at);
    srv.db.prepare("UPDATE exam_attempts SET created_at = '2020-01-01T00:00:00Z' WHERE course_id = ?").run(hyg);
    c = (await emp.get(`/api/courses?branch=${HALLE}`)).data.find((x) => x.id === hyg);
    assert.equal(c.exam, false);
    assert.equal(c.expired, true);
    const d = (await emp.get(`/api/shift/next?branch=${HALLE}&shift=open`)).data;
    assert.ok(d.open_trainings.some((o) => o.course_id === hyg && o.expired));
    const mgr = await srv.client().as('manager_halle');
    const dash = (await mgr.get(`/api/dashboard?branch=${HALLE}`)).data[0];
    assert.ok(dash.notifications.some((n) => n.kind === 'training'));
  });

  test('Wareneingang nur mit Schulung „Wareneingang & Kühlkette“', async () => {
    const empL = await srv.client().as('employee_leuna');
    const photo = await empL.photo(LEUNA, 'goods');
    const r = await empL.post('/api/goods/receipts', { branch: LEUNA, item_id: 2, quantity: 1, decision: 'accepted', media_id: photo });
    assert.equal(r.data.error, 'not_qualified');
  });

  test('Schichtführer-Aufgaben: Mitarbeiter sieht sie nicht, Schichtführer schon', async () => {
    const emp = await srv.client().as('employee_halle');
    const lead = await srv.client().as('shift_lead_halle');
    const a = (await emp.get(`/api/shift/next?branch=${HALLE}&shift=close`)).data;
    const b = (await lead.get(`/api/shift/next?branch=${HALLE}&shift=close`)).data;
    assert.ok(b.total > a.total, `${b.total} > ${a.total}`);
  });
});
