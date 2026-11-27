import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, HALLE, LEUNA } from './helpers.js';
import { START_ITEMS, END_ITEMS } from '../server/drivers.js';

const allYes = (keys) => Object.fromEntries(keys.map((k) => [k, 'yes']));

describe('Fahrer & Fahrzeuge', () => {
  let srv, drv, mgr, emp, v1, v2;
  before(async () => {
    srv = await startServer({ demo: true });
    drv = await srv.client().as('driver_halle');
    mgr = await srv.client().as('manager_halle');
    emp = await srv.client().as('employee_halle');
    const me = (await drv.get(`/api/drivers/me?branch=${HALLE}`)).data;
    [v1, v2] = me.vehicles.map((v) => v.id);
  });
  after(() => srv.close());

  const photos = async (c) => ({ fuel_media_id: await c.photo(HALLE), interior_media_id: await c.photo(HALLE) });

  test('Nur eingetragene Fahrer; Leuna-Fahrzeuge sind nicht sichtbar', async () => {
    assert.equal((await emp.get(`/api/drivers/me?branch=${HALLE}`)).data.driver, false);
    const r = await emp.post('/api/drivers/checks', { branch: HALLE, vehicle_id: v1, shift: 'early', kind: 'start', answers: allYes(START_ITEMS), ...(await photos(emp)) });
    assert.equal(r.data.error, 'not_driver');
    const me = (await drv.get(`/api/drivers/me?branch=${HALLE}`)).data;
    assert.equal(me.driver, true); assert.equal(me.licence.ok, true); assert.equal(me.vehicles.length, 2);
    assert.equal((await drv.get(`/api/drivers/me?branch=${LEUNA}`)).status, 403);
  });

  test('Startkontrolle: Tank- und Innenraumfoto Pflicht, jeder Punkt Ja/Nein', async () => {
    const base = { branch: HALLE, vehicle_id: v1, shift: 'early', kind: 'start' };
    assert.equal((await drv.post('/api/drivers/checks', { ...base, answers: allYes(START_ITEMS) })).data.error, 'fuel_photo');
    assert.equal((await drv.post('/api/drivers/checks', { ...base, answers: { lights: 'yes' }, ...(await photos(drv)) })).data.error, 'incomplete');
    const ok = await drv.post('/api/drivers/checks', { ...base, answers: allYes(START_ITEMS), fuel_level: '3_4', ...(await photos(drv)) });
    assert.equal(ok.status, 200); assert.equal(ok.data.blocked, false);
    assert.equal((await drv.post('/api/drivers/checks', { ...base, answers: allYes(START_ITEMS), ...(await photos(drv)) })).data.error, 'taken');
  });

  test('Endkontrolle nur durch denselben Fahrer, nur nach Start', async () => {
    const r = await mgr.post('/api/drivers/checks', { branch: HALLE, vehicle_id: v1, shift: 'early', kind: 'end', answers: allYes(END_ITEMS), ...(await photos(mgr)) });
    assert.equal(r.data.error, 'not_driver'); // Leitung kann nicht „für“ den Fahrer abgeben
    assert.equal((await drv.post('/api/drivers/checks', { branch: HALLE, vehicle_id: v1, shift: 'late', kind: 'end', answers: allYes(END_ITEMS), ...(await photos(drv)) })).data.error, 'no_start');
    const ok = await drv.post('/api/drivers/checks', { branch: HALLE, vehicle_id: v1, shift: 'early', kind: 'end', answers: allYes(END_ITEMS), fuel_level: '1_2', ...(await photos(drv)) });
    assert.equal(ok.status, 200);
    const me = (await drv.get(`/api/drivers/me?branch=${HALLE}`)).data;
    assert.deepEqual(me.vehicles.find((v) => v.id === v1).shifts.early, { driver: 'Demo Fahrer Halle (fiktiv)', mine: true, started: true, ended: true });
  });

  test('Sicherheitsmangel sperrt das Fahrzeug; nur Leitung entsperrt mit Notiz', async () => {
    const answers = { ...allYes(START_ITEMS), brakes: 'no' };
    const base = { branch: HALLE, vehicle_id: v2, shift: 'early', kind: 'start', answers };
    assert.equal((await drv.post('/api/drivers/checks', { ...base, ...(await photos(drv)) })).data.error, 'note');
    const r = await drv.post('/api/drivers/checks', { ...base, note: 'Bremse quietscht stark (fiktiv)', ...(await photos(drv)) });
    assert.equal(r.data.blocked, true);
    assert.ok(srv.db.prepare("SELECT 1 FROM notifications WHERE kind = 'critical' AND message LIKE '%gesperrt%'").get());
    const late = await drv.post('/api/drivers/checks', { ...base, shift: 'late', answers: allYes(START_ITEMS), ...(await photos(drv)) });
    assert.equal(late.data.error, 'vehicle_blocked');
    assert.equal((await drv.post(`/api/vehicles/${v2}/unblock`, { note: 'x' })).status, 403);
    assert.equal((await mgr.post(`/api/vehicles/${v2}/unblock`, {})).data.error, 'note');
    assert.equal((await mgr.post(`/api/vehicles/${v2}/unblock`, { note: 'Werkstatt hat Bremse geprüft (fiktiv)' })).status, 200);
    assert.equal((await drv.post('/api/drivers/checks', { ...base, shift: 'late', answers: allYes(START_ITEMS), ...(await photos(drv)) })).status, 200);
  });

  test('Führerscheinkontrolle: nicht selbst, nicht in der Zukunft; Intervall ist Betreiber-Einstellung', async () => {
    const d = (await mgr.get(`/api/drivers?branch=${HALLE}`)).data;
    assert.equal(d.licence_check_months, null);
    const empId = d.staff.find((s) => s.display_name.startsWith('Demo Mitarbeiter A')).id;
    const mgrId = d.staff.find((s) => s.display_name.startsWith('Demo Filialleitung')).id;
    assert.equal((await mgr.post('/api/drivers', { branch: HALLE, user_id: mgrId, licence_class: 'B', licence_checked_on: '2026-01-01' })).data.error, 'self');
    assert.equal((await mgr.post('/api/drivers', { branch: HALLE, user_id: empId, licence_class: 'B', licence_checked_on: '2999-01-01' })).data.error, 'licence_checked_on');
    // Ohne Prüfung eingetragen: darf noch nicht fahren
    assert.equal((await mgr.post('/api/drivers', { branch: HALLE, user_id: empId })).status, 200);
    const r = await emp.post('/api/drivers/checks', { branch: HALLE, vehicle_id: v1, shift: 'late', kind: 'start', answers: allYes(START_ITEMS), ...(await photos(emp)) });
    assert.equal(r.data.error, 'licence_unchecked');
    assert.equal((await mgr.post('/api/drivers', { branch: HALLE, user_id: empId, licence_class: 'B', licence_checked_on: '2026-01-02' })).status, 200);
    // Intervall 6 Monate gesetzt → Prüfung vom 02.01. ist im November fällig
    assert.equal((await mgr.req('PUT', '/api/drivers/settings', { branch: HALLE, licence_check_months: 99 })).data.error, 'licence_check_months');
    assert.equal((await mgr.req('PUT', '/api/drivers/settings', { branch: HALLE, licence_check_months: 6 })).status, 200);
    const me = (await emp.get(`/api/drivers/me?branch=${HALLE}`)).data;
    assert.equal(me.licence.ok, false); assert.equal(me.licence.reason, 'licence_due');
    // Kein Speicherort für Führerscheinnummer oder -kopie
    const cols = srv.db.prepare('PRAGMA table_info(driver_profiles)').all().map((c) => c.name);
    assert.ok(!cols.some((c) => /number|nummer|media|photo/.test(c)));
  });

  test('Mitarbeiter sieht die Leitungsübersicht nicht', async () => {
    assert.equal((await drv.get(`/api/drivers?branch=${HALLE}`)).status, 403);
    assert.equal((await drv.post('/api/vehicles', { branch: HALLE, label: 'X' })).status, 403);
  });
});
