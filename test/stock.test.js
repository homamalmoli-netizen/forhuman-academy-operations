import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, HALLE } from './helpers.js';
import { escalateZeroAlerts } from '../server/stock.js';

const notify = (d, branchId, kind, message, ref, userId = null, audience = 'manager') =>
  d.prepare('INSERT OR IGNORE INTO notifications (branch_id, kind, message, ref, user_id, audience) VALUES (?,?,?,?,?,?)').run(branchId, kind, message, ref, userId, audience).changes;

describe('Bestandsalarme und Nachbestellliste (ohne Preise, keine automatische Bestellung)', () => {
  let srv, emp, mgr, admin;
  before(async () => {
    srv = await startServer({ demo: true });
    emp = await srv.client().as('employee_halle');
    mgr = await srv.client().as('manager_halle');
    admin = await srv.client().as('admin');
  });
  after(() => srv.close());
  const listId = (code) => srv.db.prepare('SELECT id FROM control_lists WHERE branch_id = ? AND code = ?').get(HALLE, code).id;
  // Zusatzkontrolle anlegen und mit Mengen ausfüllen (Standard 100, einzelne Artikel per Name überschreiben)
  async function check(code, over = {}, extra = {}) {
    const id = (await emp.post(`/api/controls/lists/${listId(code)}/extra`, {})).data.id;
    const r = (await emp.get(`/api/controls/runs/${id}`)).data;
    const lines = r.items.map((i) => ({ item_id: i.id, qty: i.name in over ? over[i.name] : 100 }));
    const res = await emp.post(`/api/controls/runs/${id}`, { lines, ...extra });
    return { id, res };
  }
  const alerts = () => srv.db.prepare("SELECT a.*, i.name FROM stock_alerts a JOIN control_items i ON i.id = a.item_id WHERE a.branch_id = ? AND a.status <> 'resolved'").all(HALLE);
  const notes = (pat) => srv.db.prepare('SELECT * FROM notifications WHERE message LIKE ? ORDER BY id').all(pat);

  test('Saucen-Minimum 10: 9 → Alarm an Leitung und Betreiber, 10 → kein Alarm, 0 → kritisch, leer → abgelehnt', async () => {
    const { res } = await check('regal2', { Ketchup: 9, Mayo: 10, 'BBQ Sauce': 0 });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.deepEqual(res.data.critical, ['BBQ Sauce']);
    const a = alerts();
    assert.equal(a.find((x) => x.name === 'Ketchup').level, 'below');
    assert.equal(a.find((x) => x.name === 'Ketchup').shortfall, 1);
    assert.ok(!a.some((x) => x.name === 'Mayo'));
    assert.equal(a.find((x) => x.name === 'BBQ Sauce').level, 'zero');
    const below = notes('Unter Mindestbestand%Ketchup%');
    assert.ok(below.some((n) => n.audience === 'manager'));
    const adminId = srv.db.prepare("SELECT id FROM users WHERE is_admin = 1").get().id;
    assert.ok(below.some((n) => n.audience === 'admin' && n.user_id === adminId), 'persönliche Meldung an Betreiber');
    assert.match(below[0].message, /Halle/); assert.match(below[0].message, /Fehlmenge 1/); assert.match(below[0].message, /Gemeldet von/);
    assert.ok(notes('KRITISCH%BBQ Sauce%').length >= 2);
    // leeres Feld ist unbekannt, nie 0
    const id = (await emp.post(`/api/controls/lists/${listId('regal2')}/extra`, {})).data.id;
    const r = (await emp.get(`/api/controls/runs/${id}`)).data;
    assert.equal((await emp.post(`/api/controls/runs/${id}`, { lines: r.items.map((i, k) => ({ item_id: i.id, qty: k === 0 ? '' : 20 })) })).data.error, 'control_incomplete');
  });

  test('Aviko 20 kg < 40 kg → Fehlmenge 20; Brioche 70 → unter 80, 50 → dringend (unter 60); Red 60 → kein Alarm', async () => {
    await check('frisch', { 'Aviko Super Crunch Fresh 11 mm (gekühlt)': 20 });
    const av = alerts().find((x) => x.name.startsWith('Aviko'));
    assert.equal(av.level, 'below'); assert.equal(av.shortfall, 20);
    await check('kueche', { 'Brioche Burger Buns': 70, 'Red Burger Buns': 60 });
    assert.equal(alerts().find((x) => x.name === 'Brioche Burger Buns').level, 'below');
    assert.ok(!alerts().some((x) => x.name === 'Red Burger Buns'));
    await check('kueche', { 'Brioche Burger Buns': 50 });
    assert.equal(alerts().find((x) => x.name === 'Brioche Burger Buns').level, 'urgent');
    assert.ok(notes('%Brioche Burger Buns%dringend%').length >= 1);
  });

  test('Deduplizierung: gleiche Kontrolle nicht schlechter → keine neue Meldung; schlechter oder neue Periode → neue Meldung; ausreichend → aufgelöst', async () => {
    const { id } = await check('regal2', { Remoulade: 8 });
    const before = notes('%Remoulade%').length;
    // Nacharbeit, gleicher Wert erneut gespeichert
    await mgr.post(`/api/controls/runs/${id}/review`, { ok: false, note: 'Bitte nachzählen' });
    const r = (await emp.get(`/api/controls/runs/${id}`)).data;
    const lines = (v) => r.items.map((i) => ({ item_id: i.id, qty: i.name === 'Remoulade' ? v : 100 }));
    assert.equal((await emp.post(`/api/controls/runs/${id}`, { lines: lines(8) })).status, 200);
    assert.equal(notes('%Remoulade%').length, before, 'keine doppelte Meldung');
    await mgr.post(`/api/controls/runs/${id}/review`, { ok: false, note: 'nochmal' });
    await emp.post(`/api/controls/runs/${id}`, { lines: lines(5) });
    assert.equal(notes('%Remoulade%').length, before + 2, 'Verschlechterung → neue Meldung (Leitung + Betreiber)');
    await check('regal2', { Remoulade: 5 });
    assert.equal(notes('%Remoulade%').length, before + 4, 'neue Kontrollperiode → neue Meldung');
    await check('regal2', { Remoulade: 12 });
    assert.ok(!alerts().some((x) => x.name === 'Remoulade'), 'aufgelöst bei ausreichendem Bestand');
  });

  test('Kritische Nullmeldung: Bestätigung durch Leitung; ohne Bestätigung nach 30 Minuten erneute Meldung', async () => {
    await check('regal1', { 'Pikante Marinade (Hot)': 0 });
    const z = alerts().find((x) => x.name === 'Pikante Marinade (Hot)');
    assert.equal(z.level, 'zero');
    assert.equal(escalateZeroAlerts(srv.db, HALLE, new Date(Date.now() + 10 * 60000), notify), 0);
    assert.ok(escalateZeroAlerts(srv.db, HALLE, new Date(Date.now() + 31 * 60000), notify) >= 1);
    assert.equal(escalateZeroAlerts(srv.db, HALLE, new Date(Date.now() + 40 * 60000), notify), 0, 'nur einmal');
    assert.equal((await emp.post(`/api/stock/alerts/${z.id}/ack`)).status, 403);
    const leuna = await srv.client().as('manager_leuna');
    assert.equal((await leuna.post(`/api/stock/alerts/${z.id}/ack`)).status, 403);
    assert.equal((await mgr.post(`/api/stock/alerts/${z.id}/ack`)).status, 200);
    assert.equal((await mgr.post(`/api/stock/alerts/${z.id}/ack`)).status, 409);
  });

  test('Nachbestellliste je Lieferant, Bestellung erfassen, Teillieferung mit Bestandsbestätigung; Bestellung allein schließt keinen Alarm', async () => {
    const d = (await mgr.get(`/api/stock/reorder?branch=${HALLE}`)).data;
    const all = Object.values(d.groups).flat();
    const av = all.find((x) => x.name.startsWith('Aviko'));
    assert.equal(av.suggest, 20);
    assert.ok(d.groups.METRO === undefined || Array.isArray(d.groups.METRO));
    assert.ok(Object.keys(d.groups).includes('Lieferant offen'));
    assert.ok(!JSON.stringify(d).match(/preis|price|eur/i), 'keine Preise');
    assert.equal((await emp.post('/api/stock/orders', { branch: HALLE, item_id: av.item_id, qty: 18 })).status, 403);
    assert.equal((await mgr.post('/api/stock/orders', { branch: HALLE, item_id: av.item_id, qty: 0 })).data.error, 'qty');
    const o = (await mgr.post('/api/stock/orders', { branch: HALLE, item_id: av.item_id, qty: 18, supplier: 'Großhandel (fiktiv)', expected_on: '2026-12-01' })).data;
    assert.equal(Object.values((await mgr.get(`/api/stock/reorder?branch=${HALLE}`)).data.groups).flat().find((x) => x.item_id === av.item_id).suggest, 2, 'offene Bestellung wird abgezogen');
    assert.ok(alerts().some((x) => x.name.startsWith('Aviko')), 'Bestellung schließt Alarm nicht');
    assert.equal((await emp.post(`/api/stock/orders/${o.id}/receive`, { qty: 9 })).data.error, 'stock_after');
    const p1 = (await emp.post(`/api/stock/orders/${o.id}/receive`, { qty: 9, stock_after: 29 })).data;
    assert.equal(p1.status, 'partial'); assert.equal(p1.open_qty, 9);
    assert.ok(alerts().some((x) => x.name.startsWith('Aviko')), 'noch unter Minimum');
    const p2 = (await emp.post(`/api/stock/orders/${o.id}/receive`, { qty: 9, stock_after: 41 })).data;
    assert.equal(p2.status, 'received');
    assert.ok(!alerts().some((x) => x.name.startsWith('Aviko')), 'Bestand bestätigt ≥ Minimum → aufgelöst');
    assert.equal((await emp.post(`/api/stock/orders/${o.id}/receive`, { qty: 1, stock_after: 42 })).status, 409);
  });

  test('Export als CSV (Einkaufsliste), Produktdaten je Filiale pflegbar', async () => {
    const res = await fetch(`${srv.base}/api/stock/reorder?branch=${HALLE}&format=csv`, { headers: { cookie: mgr.cookie } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    const body = await res.text();
    assert.match(body, /"Lieferant";"Artikel"/);
    const item = srv.db.prepare("SELECT i.id FROM control_items i JOIN control_lists l ON l.id = i.list_id WHERE l.branch_id = ? AND i.name = 'Sweet Sauce'").get(HALLE);
    assert.equal(srv.db.prepare('SELECT supplier FROM control_items WHERE id = ?').get(item.id).supplier, 'METRO');
    assert.equal((await mgr.req('PUT', `/api/controls/items/${item.id}`, { target_qty: 12, urgent_below: 2, article_no: '', storage_hint: 'Kühl und trocken laut Etikett' })).status, 200);
    assert.equal((await mgr.req('PUT', `/api/controls/items/${item.id}`, { target_qty: -1 })).data.error, 'target_qty');
    const pic = await admin.photo(HALLE, 'product');
    assert.equal((await mgr.req('PUT', `/api/controls/items/${item.id}`, { image_media_id: pic })).status, 200);
  });
});
