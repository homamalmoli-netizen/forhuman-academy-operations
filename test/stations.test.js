import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, HALLE, LEUNA } from './helpers.js';
import { berlinDate } from '../server/app.js';

describe('Stationen, Stationscheck, Stufen, Positionsplan, Timer', () => {
  let srv, ids = {};
  before(async () => {
    srv = await startServer({ demo: true });
    for (const u of srv.db.prepare('SELECT id, username FROM users').all()) ids[u.username] = u.id;
  });
  after(() => srv.close());
  const station = (branch, code) => srv.db.prepare('SELECT id FROM stations WHERE branch_id = ? AND code = ?').get(branch, code).id;
  const allOk = (items) => items.map((i) => ({ item_id: i.id, ok: true }));

  test('Jede Filiale hat Stationen mit Checkliste; Aufgaben sind Stationen zugeordnet', async () => {
    const emp = await srv.client().as('employee_halle');
    const d = (await emp.get(`/api/stations?branch=${HALLE}`)).data;
    assert.deepEqual(d.stations.map((s) => s.code), ['panieren', 'druckfritteuse', 'pommes', 'burger', 'theke', 'ausgabe']);
    assert.equal(d.level.level, 'crew');
    assert.equal(d.stations.find((s) => s.code === 'theke').certified, true);
    assert.ok(srv.db.prepare('SELECT COUNT(*) n FROM task_templates WHERE station_id IS NOT NULL AND branch_id = ?').get(HALLE).n >= 8);
  });

  test('Stationscheck: kritischer Punkt nicht erfüllt → nicht bestanden; alles erfüllt → Station freigegeben', async () => {
    const trainer = await srv.client().as('trainer');
    const sid = station(HALLE, 'ausgabe');
    const cl = (await trainer.get(`/api/stations/${sid}/checklist`)).data;
    const crit = cl.items.find((i) => i.critical);
    const target = ids['demo.mitarbeiter.halle2'];
    // Schulung (Hygiene) fehlt → erst Kurs
    assert.equal((await trainer.post('/api/observations', { branch: HALLE, station_id: sid, user_id: target, results: allOk(cl.items) })).data.error, 'course_missing');
    srv.db.prepare("INSERT INTO exam_attempts (user_id, course_id, course_version, branch_id, lang, score, total, passed, answers) VALUES (?, (SELECT id FROM courses WHERE code='C-HYGIENE'), 1, ?, 'de', 3, 3, 1, '[]')").run(target, HALLE);
    assert.equal((await trainer.post('/api/observations', { branch: HALLE, station_id: sid, user_id: target, results: allOk(cl.items).slice(1) })).data.error, 'results');
    const fail = (await trainer.post('/api/observations', { branch: HALLE, station_id: sid, user_id: target, results: cl.items.map((i) => ({ item_id: i.id, ok: i.id !== crit.id })) })).data;
    assert.equal(fail.passed, false);
    assert.equal(fail.critical_failed, 1);
    assert.equal(fail.level.level, 'new');
    const ok = (await trainer.post('/api/observations', { branch: HALLE, station_id: sid, user_id: target, results: allOk(cl.items) })).data;
    assert.equal(ok.passed, true);
    assert.equal(ok.level.level, 'crew');
  });

  test('Stationscheck: nur Trainer, nicht bei sich selbst, Beobachter muss Station beherrschen, Filialgrenzen', async () => {
    const sid = station(HALLE, 'theke');
    const emp = await srv.client().as('employee_halle');
    const mgr = await srv.client().as('manager_halle');
    const trainer = await srv.client().as('trainer');
    const cl = (await trainer.get(`/api/stations/${sid}/checklist`)).data;
    const body = { branch: HALLE, station_id: sid, user_id: ids['demo.mitarbeiter.halle2'], results: allOk(cl.items) };
    assert.equal((await emp.post('/api/observations', body)).status, 403);
    assert.equal((await mgr.post('/api/observations', body)).status, 403, 'Filialleitung ohne Trainerrolle');
    assert.equal((await trainer.post('/api/observations', { ...body, user_id: ids['demo.trainer'] })).data.error, 'self_observation');
    assert.equal((await trainer.post('/api/observations', { ...body, station_id: station(LEUNA, 'theke') })).status, 404, 'Station gehört nicht zur Filiale');
    srv.db.prepare('DELETE FROM station_certifications WHERE user_id = ? AND station_id = ?').run(ids['demo.trainer'], sid);
    assert.equal((await trainer.post('/api/observations', body)).data.error, 'observer_not_certified');
  });

  test('Stufen: Neu, Crew, Trainer, Schichtführer', async () => {
    const lead = await srv.client().as('shift_lead_halle');
    const m = (await lead.get(`/api/stations/matrix?branch=${HALLE}`)).data;
    const lvl = Object.fromEntries(m.people.map((p) => [p.display_name, p.level]));
    assert.equal(lvl['Demo Schichtführer Halle (fiktiv)'], 'shift_lead');
    assert.equal(lvl['Demo Trainer (fiktiv)'], 'trainer');
    assert.equal(lvl['Demo Mitarbeiter A (fiktiv)'], 'crew');
    const emp = await srv.client().as('employee_halle');
    assert.equal((await emp.get(`/api/stations/matrix?branch=${HALLE}`)).status, 403);
  });

  test('Positionsplan: nur freigegebene Personen, Einarbeitung nur mit Freigegebenem an derselben Station', async () => {
    const lead = await srv.client().as('shift_lead_halle');
    const date = berlinDate();
    const empA = ids['demo.mitarbeiter.halle'], empC = ids['demo.mitarbeiter.halle2'], lead_ = ids['demo.schichtfuehrer.halle'];
    const notCert = await lead.req('PUT', '/api/positions', { branch: HALLE, date, shift: 'open', assignments: [{ station_id: station(HALLE, 'pommes'), user_id: empA }] });
    assert.equal(notCert.status, 409);
    assert.equal(notCert.data.error, 'not_certified');
    const noCoach = await lead.req('PUT', '/api/positions', { branch: HALLE, date, shift: 'open', assignments: [{ station_id: station(HALLE, 'pommes'), user_id: empA, training: true }] });
    assert.equal(noCoach.data.error, 'training_without_coach');
    const ok = await lead.req('PUT', '/api/positions', { branch: HALLE, date, shift: 'open', assignments: [
      { station_id: station(HALLE, 'theke'), user_id: empA },
      { station_id: station(HALLE, 'pommes'), user_id: lead_ },
      { station_id: station(HALLE, 'pommes'), user_id: empC, training: true },
    ] });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    const plan = (await lead.get(`/api/positions?branch=${HALLE}&shift=open`)).data;
    assert.equal(plan.stations.find((s) => s.id === station(HALLE, 'pommes')).assigned.length, 2);
    // Mitarbeiter darf den Plan nicht ändern, Leuna-Leitung sieht Halle nicht
    const emp = await srv.client().as('employee_halle');
    assert.equal((await emp.get(`/api/positions?branch=${HALLE}&shift=open`)).status, 403);
    assert.equal((await (await srv.client().as('manager_leuna')).get(`/api/positions?branch=${HALLE}&shift=open`)).status, 403);
  });

  test('Aufgaben strukturiert: Mitarbeiter sieht zuerst die eigene Station, fremde Stationen ausgeblendet', async () => {
    const emp = await srv.client().as('employee_halle'); // laut Plan: Theke
    const mine = (await emp.get(`/api/my-stations?branch=${HALLE}&shift=open`)).data;
    assert.deepEqual(mine.map((s) => s.id), [station(HALLE, 'theke')]);
    const d = (await emp.get(`/api/shift/next?branch=${HALLE}&shift=open`)).data;
    assert.equal(d.next.station_id, station(HALLE, 'theke'), 'eigene Station zuerst');
    assert.ok(d.other_station_tasks > 0);
    assert.ok(d.groups[0].station_id === station(HALLE, 'theke'));
    assert.ok(d.groups.some((g) => g.station_id === null), 'allgemeine Aufgaben bleiben sichtbar');
    // Person in Einarbeitung an der Pommes-Station darf deren Aufgaben erledigen
    const c = await srv.client();
    // Login als Mitarbeiter C über Sitzung direkt (keine Demo-Persona vorhanden)
    const { createSession } = await import('../server/auth.js');
    c.cookie = 'fh_session=' + createSession(srv.db, ids['demo.mitarbeiter.halle2']);
    const dc = (await c.get(`/api/shift/next?branch=${HALLE}&shift=open`)).data;
    assert.equal(dc.personal, true, 'mit Positionsplan: persönliche Aufgaben');
    assert.ok(dc.next);
    assert.equal((await c.post(`/api/tasks/${dc.next.id}/complete`, dc.next.requires_photo ? { media_id: await c.photo(HALLE) } : {})).status, 200);
    // Stationsaufgabe der Pommes-Station ging an eine Person, die laut Plan dort ist
    const pommesTask = srv.db.prepare(`SELECT o.assigned_to FROM task_occurrences o JOIN task_templates t ON t.id = o.template_id
      WHERE t.station_id = ? AND o.shift = 'open' AND o.work_date = ?`).get(station(HALLE, 'pommes'), berlinDate());
    assert.ok([ids['demo.schichtfuehrer.halle'], ids['demo.mitarbeiter.halle2']].includes(pommesTask.assigned_to));
  });

  test('Haltezeit-Timer: Wert nur mit Quelle, Start, abgelaufen → nur Entsorgen, Übersicht zählt', async () => {
    const mgr = await srv.client().as('manager_halle');
    const products = (await mgr.get(`/api/products?branch=${HALLE}`)).data;
    const pom = products.find((p) => p.name_de === 'Pommes');
    assert.match(pom.value_source, /DEMO/);
    assert.equal((await mgr.patch(`/api/products/${pom.id}`, { hold_minutes: 8, value_source: '' })).data.error, 'value_source');
    assert.equal((await mgr.patch(`/api/products/${pom.id}`, { hold_minutes: 0, value_source: 'x' })).data.error, 'hold_minutes');
    const created = (await mgr.post('/api/products', { branch: HALLE, name_de: 'Neues Produkt' })).data;
    const emp = await srv.client().as('employee_halle');
    assert.equal((await emp.post('/api/timers', { branch: HALLE, product_id: created.id })).data.error, 'no_value');
    // Mitarbeiter A ist nicht für Pommes freigegeben und dort nicht eingeteilt
    assert.equal((await emp.post('/api/timers', { branch: HALLE, product_id: pom.id })).data.error, 'not_certified');
    const lead = await srv.client().as('shift_lead_halle');
    const t = (await lead.post('/api/timers', { branch: HALLE, product_id: pom.id, kind: 'hold' })).data;
    assert.equal(t.state, 'running');
    assert.ok(t.remaining_s > 400 && t.remaining_s <= 420);
    assert.equal((await lead.post(`/api/timers/${t.id}/end`, { action: 'done' })).status, 200);
    const t2 = (await lead.post('/api/timers', { branch: HALLE, product_id: pom.id, kind: 'hold' })).data;
    srv.db.prepare("UPDATE timers SET ends_at = '2000-01-01T00:00:00Z' WHERE id = ?").run(t2.id);
    const list = (await emp.get(`/api/timers?branch=${HALLE}`)).data.timers;
    assert.equal(list.find((x) => x.id === t2.id).state, 'expired');
    assert.equal((await mgr.get(`/api/dashboard?branch=${HALLE}`)).data[0].timers_expired, 1);
    assert.equal((await lead.post(`/api/timers/${t2.id}/end`, { action: 'done' })).data.error, 'expired');
    assert.equal((await lead.post(`/api/timers/${t2.id}/end`, { action: 'discarded' })).status, 200);
    assert.equal((await mgr.get(`/api/dashboard?branch=${HALLE}`)).data[0].timers_expired, 0);
    // Filialtrennung bei Timern
    assert.equal((await (await srv.client().as('employee_leuna')).post(`/api/timers/${t2.id}/end`, { action: 'discarded' })).status, 403);
  });
});

describe('Produktion: Stationen ohne Zeiten', () => {
  let srv;
  before(async () => { srv = await startServer({ demo: false }); });
  after(() => srv.close());
  test('Stationen und Produkte angelegt, aber keine Haltezeiten (nur Leitung trägt sie mit Quelle ein)', () => {
    assert.equal(srv.db.prepare('SELECT COUNT(*) n FROM stations').get().n, 12);
    assert.equal(srv.db.prepare('SELECT COUNT(*) n FROM products WHERE hold_minutes IS NOT NULL OR cook_seconds IS NOT NULL').get().n, 0);
    assert.equal(srv.db.prepare('SELECT COUNT(*) n FROM station_certifications').get().n, 0);
  });
});
