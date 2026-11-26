import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, HALLE, LEUNA } from './helpers.js';

describe('Marinaden-Protokoll', () => {
  let srv;
  before(async () => { srv = await startServer({ demo: true }); });
  after(() => srv.close());
  const meatId = (name) => srv.db.prepare('SELECT id FROM items WHERE name = ?').get(name).id;

  test('Rezeptur nur durch Betreiber; Änderung erzeugt neue Version; Frist nur mit Quelle', async () => {
    const mgr = await srv.client().as('manager_halle');
    const admin = await srv.client().as('admin');
    const body = { name: 'Testmarinade', ingredients: [{ name: 'Zutat X', per_kg: 30, unit: 'g' }], allergens: 'laut Liste' };
    assert.equal((await mgr.post('/api/admin/marinades', body)).status, 403);
    assert.equal((await admin.post('/api/admin/marinades', { ...body, ingredients: [] })).data.error, 'ingredients');
    assert.equal((await admin.post('/api/admin/marinades', { ...body, use_within_hours: 24 })).data.error, 'use_source');
    const id = (await admin.post('/api/admin/marinades', body)).data.id;
    assert.equal((await admin.post('/api/admin/marinades', body)).status, 409);
    assert.equal((await admin.req('PUT', `/api/admin/marinades/${id}`, { ingredients: [{ name: 'Zutat X', per_kg: 35, unit: 'g' }] })).data.version, 2);
    const list = (await admin.get('/api/admin/marinades')).data.find((m) => m.id === id);
    assert.equal(list.version, 2);
    assert.equal(list.versions.length, 2);
  });

  test('Charge: Mengen werden berechnet, Zutaten fest, Toleranz geprüft, Fleisch wird verbucht, Etikett-Code', async () => {
    const emp = await srv.client().as('employee_halle'); // freigegeben für Panierstation
    const d = (await emp.get(`/api/marinades?branch=${HALLE}`)).data;
    const r = d.recipes.find((x) => x.name.startsWith('DEMO Marinade'));
    assert.equal(d.meat_items.length, 3);
    const breast = meatId('Hähnchenbrust');
    const stock0 = (await emp.get(`/api/stock?branch=${HALLE}`)).data.find((s) => s.id === breast).qty;
    const base = { branch: HALLE, marinade_id: r.id, meat_item_id: breast, meat_kg: 10 };
    assert.equal((await emp.post('/api/marinades/batches', { ...base, actuals: [500, 200] })).data.error, 'actuals');
    const out = await emp.post('/api/marinades/batches', { ...base, actuals: [600, 200, 1000] });
    assert.equal(out.data.error, 'out_of_tolerance');
    const ok = (await emp.post('/api/marinades/batches', { ...base, actuals: [505, 200, 1000] })).data;
    assert.match(ok.batch_code, /^MAR-HAL-\d{8}-01$/);
    assert.deepEqual(ok.ingredients.map((i) => i.target), [500, 200, 1000]);
    assert.equal(ok.deviations, 1);
    assert.ok(ok.use_by);
    assert.equal((await emp.get(`/api/stock?branch=${HALLE}`)).data.find((s) => s.id === breast).qty, stock0 - 10);
    const mgr = await srv.client().as('manager_halle');
    assert.ok((await mgr.get(`/api/dashboard?branch=${HALLE}`)).data[0].notifications.some((n) => n.message.includes('weichen von der Rezeptur ab')));
    // Restmenge, dann aufgebraucht
    assert.equal((await emp.post(`/api/marinades/batches/${ok.id}/rest`, { remaining_kg: 11 })).data.error, 'remaining_kg');
    assert.equal((await emp.post(`/api/marinades/batches/${ok.id}/rest`, { remaining_kg: 4 })).data.status, 'active');
    assert.equal((await emp.post(`/api/marinades/batches/${ok.id}/rest`, { remaining_kg: 0 })).data.status, 'used');
    assert.equal((await emp.post(`/api/marinades/batches/${ok.id}/rest`, { remaining_kg: 0 })).status, 409);
  });

  test('Abgelaufene Charge: Rest nur entsorgen, mit Grund und Meldung', async () => {
    const emp = await srv.client().as('employee_halle');
    const r = (await emp.get(`/api/marinades?branch=${HALLE}`)).data.recipes.find((x) => x.name.startsWith('DEMO Marinade'));
    const b = (await emp.post('/api/marinades/batches', { branch: HALLE, marinade_id: r.id, meat_item_id: meatId('Chicken Wings'), meat_kg: 2, actuals: [100, 40, 200] })).data;
    assert.equal(b.deviations, 0);
    srv.db.prepare("UPDATE marinade_batches SET use_by = '2000-01-01T00:00:00Z' WHERE id = ?").run(b.id);
    const list = (await emp.get(`/api/marinades?branch=${HALLE}`)).data.active.find((x) => x.id === b.id);
    assert.equal(list.expired, true);
    assert.equal((await emp.post(`/api/marinades/batches/${b.id}/rest`, { remaining_kg: 1 })).data.error, 'expired');
    assert.equal((await emp.post(`/api/marinades/batches/${b.id}/discard`, {})).data.error, 'reason');
    assert.equal((await emp.post(`/api/marinades/batches/${b.id}/discard`, { reason: 'Frist abgelaufen' })).status, 200);
    assert.equal((await (await srv.client().as('manager_halle')).get(`/api/dashboard?branch=${HALLE}`)).data[0].marinade_batches.n, 0);
  });

  test('Ohne Freigabe für die Panierstation kein Marinieren; Filialtrennung', async () => {
    const empL = await srv.client().as('employee_leuna');
    const r = (await empL.get(`/api/marinades?branch=${LEUNA}`)).data.recipes[0];
    assert.equal((await empL.post('/api/marinades/batches', { branch: LEUNA, marinade_id: r.id, meat_item_id: meatId('Hähnchenbrust'), meat_kg: 1, actuals: [50, 20, 100] })).data.error, 'not_certified');
    const batches = (await empL.get(`/api/marinades?branch=${LEUNA}`)).data;
    assert.equal(batches.active.length + batches.recent.length, 0);
    const halleBatch = srv.db.prepare('SELECT id FROM marinade_batches WHERE branch_id = ? LIMIT 1').get(HALLE).id;
    assert.equal((await empL.post(`/api/marinades/batches/${halleBatch}/discard`, { reason: 'x y' })).status, 403);
  });

  test('Produktion: keine Rezepturen im Code', async () => {
    const prod = await startServer({ demo: false });
    assert.equal(prod.db.prepare('SELECT COUNT(*) n FROM marinades').get().n, 0);
    await prod.close();
  });
});
