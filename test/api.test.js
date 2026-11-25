import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, HALLE, LEUNA } from './helpers.js';
import { generateTasks, berlinDate, purgeExpiredMedia } from '../server/app.js';

describe('Demo-Instanz (fiktive Daten)', () => {
  let srv;
  before(async () => { srv = await startServer({ demo: true }); });
  after(() => srv.close());

  const completeAll = async (c, branch, shift, skipTitles = []) => {
    for (let i = 0; i < 30; i++) {
      const n = (await c.get(`/api/shift/next?branch=${branch}&shift=${shift}`)).data.next;
      if (!n || skipTitles.includes(n.title_de)) return n;
      const body = {};
      if (n.requires_photo) body.media_id = await c.photo(branch);
      if (n.measure_unit) body.value = 4;
      const r = await c.post(`/api/tasks/${n.id}/complete`, body);
      assert.equal(r.status, 200, JSON.stringify(r.data));
    }
    throw new Error('Endlosschleife');
  };

  test('Öffnung: genau eine nächste Aufgabe, Reihenfolge, Pflichtfoto und Messwert', async () => {
    const c = await srv.client().as('employee_halle');
    const first = (await c.get(`/api/shift/next?branch=${HALLE}&shift=open`)).data;
    assert.equal(first.next.title_de, 'Licht einschalten');
    assert.ok(first.total >= 7);
    assert.equal((await c.post(`/api/tasks/${first.next.id}/complete`)).status, 200);
    const second = (await c.get(`/api/shift/next?branch=${HALLE}&shift=open`)).data.next;
    assert.equal(second.title_de, 'Rundgang: alles in Ordnung?');
    assert.equal(second.requires_photo, true);
    const noPhoto = await c.post(`/api/tasks/${second.id}/complete`);
    assert.equal(noPhoto.status, 400);
    assert.equal(noPhoto.data.error, 'photo_required');
    assert.equal((await c.post(`/api/tasks/${second.id}/complete`, { media_id: await c.photo(HALLE) })).status, 200);
    // weiter bis zum Kühlschrank: Messwert ist Pflicht
    let n = (await c.get(`/api/shift/next?branch=${HALLE}&shift=open`)).data.next;
    await c.post(`/api/tasks/${n.id}/complete`); // Hände waschen
    n = (await c.get(`/api/shift/next?branch=${HALLE}&shift=open`)).data.next;
    assert.equal(n.measure_unit, '°C');
    const noValue = await c.post(`/api/tasks/${n.id}/complete`, { media_id: await c.photo(HALLE) });
    assert.equal(noValue.data.error, 'value_required');
    assert.equal((await c.post(`/api/tasks/${n.id}/complete`, { media_id: await c.photo(HALLE), value: 3.5 })).status, 200);
    // Doppelt erledigen geht nicht
    assert.equal((await c.post(`/api/tasks/${n.id}/complete`, { media_id: await c.photo(HALLE), value: 3.5 })).status, 409);
  });

  test('Keine doppelten Aufgaben bei mehrfacher Erzeugung', () => {
    const d = berlinDate();
    generateTasks(srv.db, HALLE, d);
    const before = srv.db.prepare('SELECT COUNT(*) n FROM task_occurrences WHERE branch_id = ? AND work_date = ?').get(HALLE, d).n;
    assert.equal(generateTasks(srv.db, HALLE, d), 0);
    const after = srv.db.prepare('SELECT COUNT(*) n FROM task_occurrences WHERE branch_id = ? AND work_date = ?').get(HALLE, d).n;
    assert.equal(after, before);
  });

  test('Fritteusen-Aufgabe gesperrt ohne Qualifikation (auch per direktem API-Aufruf)', async () => {
    const c = await srv.client().as('employee_halle');
    const d = (await c.get(`/api/shift/next?branch=${HALLE}&shift=open`)).data;
    const blocked = d.blocked.find((b) => b.required_course_id);
    assert.ok(blocked, 'Fritteuse sollte gesperrt sein');
    const r = await c.post(`/api/tasks/${blocked.id}/complete`);
    assert.equal(r.status, 403);
    assert.equal(r.data.error, 'not_qualified');
  });

  test('Lernablauf: Sprache → Schritte der Reihe nach → Prüfung → praktische Freigabe → Qualifikation', async () => {
    const emp = await srv.client().as('employee_halle');
    const courses = (await emp.get(`/api/courses?branch=${HALLE}`)).data;
    const fryer = courses.find((x) => x.code === 'C-FRYER-GGM');
    assert.equal(fryer.ok, false);
    // Prüfung vor den Schritten gesperrt (serverseitig)
    assert.equal((await emp.get(`/api/courses/${fryer.id}/exam?lang=ar`)).status, 403);
    const c = (await emp.get(`/api/courses/${fryer.id}?branch=${HALLE}&lang=ar`)).data;
    assert.equal(c.lang, 'ar');
    assert.equal(c.translation_reviewed, false);
    assert.match(c.title, /قلاية/);
    // Schritt überspringen nicht erlaubt
    assert.equal((await emp.post(`/api/courses/${fryer.id}/progress`, { lang: 'ar', step: 2 })).status, 409);
    for (let s = 0; s < c.steps.length; s++) assert.equal((await emp.post(`/api/courses/${fryer.id}/progress`, { lang: 'ar', step: s })).status, 200);
    const exam = (await emp.get(`/api/courses/${fryer.id}/exam?lang=ar`)).data;
    assert.ok(exam.questions.every((q) => q.correct === undefined), 'Lösungen dürfen nicht an den Client gehen');
    assert.ok(exam.questions.some((q) => q.image), 'mindestens eine Bildfrage');
    const wrong = (await emp.post(`/api/courses/${fryer.id}/exam`, { branch: HALLE, lang: 'ar', answers: [0, 0, 1] })).data;
    assert.equal(wrong.passed, false);
    assert.equal(wrong.results.filter((r) => !r.correct).length, 3);
    const right = (await emp.post(`/api/courses/${fryer.id}/exam`, { branch: HALLE, lang: 'ar', answers: [1, 2, 0] })).data;
    assert.equal(right.passed, true);
    assert.equal(right.ok, false, 'Quiz allein genügt nicht');
    assert.equal(right.needs_practical, true);
    // Mitarbeiter darf sich nicht selbst freigeben, Filialleitung (ohne Trainerrolle) auch nicht
    assert.equal((await emp.post('/api/signoffs', { branch: HALLE, user_id: 5, course_id: fryer.id })).status, 403);
    const mgr = await srv.client().as('manager_halle');
    assert.equal((await mgr.post('/api/signoffs', { branch: HALLE, user_id: 5, course_id: fryer.id })).status, 403);
    const trainer = await srv.client().as('trainer');
    const me = (await trainer.get('/api/me')).data;
    assert.equal((await trainer.post('/api/signoffs', { branch: HALLE, user_id: me.id, course_id: fryer.id })).status, 403, 'keine Selbstfreigabe');
    assert.equal((await trainer.post('/api/signoffs', { branch: HALLE, user_id: 5, course_id: fryer.id })).status, 200);
    const after = (await emp.get(`/api/courses?branch=${HALLE}`)).data.find((x) => x.id === fryer.id);
    assert.equal(after.ok, true);
    // Schulung erledigt – Stationsaufgaben bleiben gesperrt, bis der Stationscheck an der Station bestanden ist
    const d = (await emp.get(`/api/shift/next?branch=${HALLE}&shift=open`)).data;
    assert.ok(d.blocked.length > 0);
    assert.ok(d.blocked.every((b) => b.reason === 'station'));
  });

  test('Problem melden → Manager fordert Nacharbeit → Aufgabe erscheint zuerst → erledigt → Manager bestätigt', async () => {
    const emp = await srv.client().as('employee_halle');
    const n = (await emp.get(`/api/shift/next?branch=${HALLE}&shift=close`)).data.next;
    assert.equal((await emp.post(`/api/tasks/${n.id}/problem`, { description: 'x' })).status, 400);
    const photo = await emp.photo(HALLE, 'problem');
    const rp = await emp.post(`/api/tasks/${n.id}/problem`, { description: 'Kühlhaus riecht komisch', media_id: photo });
    assert.equal(rp.status, 200);
    const mgr = await srv.client().as('manager_halle');
    const list = (await mgr.get(`/api/problems?branch=${HALLE}&status=open`)).data;
    const p = list.find((x) => x.id === rp.data.problem_id);
    assert.equal(p.media_id, photo);
    assert.ok((await mgr.get(`/api/dashboard?branch=${HALLE}`)).data[0].notifications.some((x) => x.kind === 'problem'));
    assert.equal((await mgr.post(`/api/problems/${p.id}/rework`, { note: 'Bitte nochmal prüfen' })).status, 200);
    const again = (await emp.get(`/api/shift/next?branch=${HALLE}&shift=close`)).data.next;
    assert.equal(again.id, n.id);
    assert.equal(again.status, 'rework');
    assert.equal((await emp.post(`/api/tasks/${n.id}/complete`, { media_id: await emp.photo(HALLE) })).status, 200);
    assert.equal((await mgr.post(`/api/problems/${p.id}/resolve`, {})).status, 400, 'Maßnahme muss beschrieben werden');
    assert.equal((await mgr.post(`/api/problems/${p.id}/resolve`, { note: 'Geprüft, i.O.' })).status, 200);
    // Mitarbeiter sieht keine Managerliste
    assert.equal((await emp.get(`/api/problems?branch=${HALLE}`)).status, 403);
  });

  test('Schließung komplett, Schichtbericht und Managerfreigabe', async () => {
    const emp = await srv.client().as('employee_leuna');
    // Mitarbeiter B braucht Hygiene-Schulung und Stationscheck für die Stationen der Schließung
    const hyg = (await emp.get(`/api/courses?branch=${LEUNA}`)).data.find((c) => c.code === 'C-HYGIENE');
    for (let i = 0; i < hyg.steps; i++) await emp.post(`/api/courses/${hyg.id}/progress`, { lang: 'de', step: i });
    assert.equal((await emp.post(`/api/courses/${hyg.id}/exam`, { branch: LEUNA, lang: 'de', answers: [1, 0, 2] })).data.passed, true);
    const trainer = await srv.client().as('trainer');
    const empId = (await emp.get('/api/me')).data.id;
    const stations = (await emp.get(`/api/stations?branch=${LEUNA}`)).data.stations;
    for (const code of ['pommes', 'panieren']) {
      const st = stations.find((x) => x.code === code);
      const cl = (await trainer.get(`/api/stations/${st.id}/checklist`)).data;
      const r = await trainer.post('/api/observations', { branch: LEUNA, station_id: st.id, user_id: empId, results: cl.items.map((i) => ({ item_id: i.id, ok: true })) });
      assert.equal(r.data.passed, true, JSON.stringify(r.data));
    }
    const left = await completeAll(emp, LEUNA, 'close');
    assert.equal(left, null);
    const mgr = await srv.client().as('manager_leuna');
    const rep = (await mgr.get(`/api/reports/shift?branch=${LEUNA}&shift=close`)).data;
    assert.equal(rep.counts.open, 0);
    assert.ok(rep.counts.photos >= 3);
    assert.ok(rep.tasks.every((t) => t.completed_by));
    const today = berlinDate();
    assert.equal((await mgr.post('/api/shifts/approve', { branch: LEUNA, date: today, shift: 'close' })).status, 200);
    assert.equal((await mgr.post('/api/shifts/approve', { branch: LEUNA, date: today, shift: 'close' })).status, 409, 'nur einmal freigeben');
  });

  test('Schichtfreigabe mit offenen Aufgaben braucht Begründung', async () => {
    const mgr = await srv.client().as('manager_leuna');
    const r = await mgr.post('/api/shifts/approve', { branch: LEUNA, date: berlinDate(), shift: 'run' });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, 'open_tasks');
    assert.equal((await mgr.post('/api/shifts/approve', { branch: LEUNA, date: berlinDate(), shift: 'run', note: 'Personalmangel, Rest morgen' })).status, 200);
  });

  test('Filialtrennung serverseitig (Aufgaben, Probleme, Fotos, Berichte)', async () => {
    const empH = await srv.client().as('employee_halle');
    const mgrL = await srv.client().as('manager_leuna');
    assert.equal((await empH.get(`/api/shift/next?branch=${LEUNA}&shift=open`)).status, 403);
    assert.equal((await mgrL.get(`/api/problems?branch=${HALLE}`)).status, 403);
    assert.equal((await mgrL.get(`/api/reports/shift?branch=${HALLE}&shift=open`)).status, 403);
    // Leuna-Aufgabe mit Halle-Mitarbeiter erledigen
    const empL = await srv.client().as('employee_leuna');
    const nL = (await empL.get(`/api/shift/next?branch=${LEUNA}&shift=open`)).data.next;
    assert.equal((await empH.post(`/api/tasks/${nL.id}/complete`)).status, 403);
    // Foto aus Halle darf nicht als Nachweis in Leuna verwendet werden und nicht von Leuna gesehen werden
    const photoH = await empH.photo(HALLE);
    assert.equal((await empL.get(`/api/media/${photoH}`)).status, 403);
    const nPhoto = (await empL.get(`/api/shift/next?branch=${LEUNA}&shift=open`)).data;
    await empL.post(`/api/tasks/${nPhoto.next.id}/complete`, nPhoto.next.requires_photo ? { media_id: photoH } : {});
    const n2 = (await empL.get(`/api/shift/next?branch=${LEUNA}&shift=open`)).data.next;
    if (n2.requires_photo) assert.equal((await empL.post(`/api/tasks/${n2.id}/complete`, { media_id: photoH })).data.error, 'media');
    // Dashboard des Leuna-Managers enthält nur Leuna
    const dash = (await mgrL.get('/api/dashboard')).data;
    assert.deepEqual(dash.map((d) => d.branch.name), ['Leuna']);
  });

  test('Scanner: bekannter GTIN, METRO-Nummer, unbekannter Code mit Zuordnung, URLs', async () => {
    const emp = await srv.client().as('employee_halle');
    const known = (await emp.post('/api/goods/scan', { branch: HALLE, code: '(01)02000000000015(10)CH-77(17)270115' })).data;
    assert.equal(known.kind, 'gtin');
    assert.equal(known.item.name, 'DEMO Hähnchenschenkel (fiktiv)');
    assert.equal(known.batch, 'CH-77');
    assert.equal(known.bestBefore, '2027-01-15');
    const metro = (await emp.post('/api/goods/scan', { branch: HALLE, code: 'DEMO-100003' })).data;
    assert.equal(metro.kind, 'metro_article');
    assert.equal(metro.item.name, 'DEMO Panade (fiktiv)');
    const unk = (await emp.post('/api/goods/scan', { branch: HALLE, code: '4006381333931' })).data;
    assert.equal(unk.kind, 'gtin');
    assert.equal(unk.item, null);
    assert.ok(unk.unknown_id);
    const bad = (await emp.post('/api/goods/scan', { branch: HALLE, code: 'https://phish.example/metro' })).data;
    assert.equal(bad.open_allowed, false);
    const good = (await emp.post('/api/goods/scan', { branch: HALLE, code: 'https://www.metro.de/marktplatz/product/abc' })).data;
    assert.equal(good.open_allowed, true);
    // Mitarbeiter darf nicht zuordnen, Manager schon
    assert.equal((await emp.post(`/api/goods/unknown/${unk.unknown_id}/assign`, { item_id: 2 })).status, 403);
    const mgr = await srv.client().as('manager_halle');
    assert.equal((await mgr.post(`/api/goods/unknown/${unk.unknown_id}/assign`, { item_id: 2 })).status, 200);
    const now = (await emp.post('/api/goods/scan', { branch: HALLE, code: '4006381333931' })).data;
    assert.equal(now.item.id, 2);
  });

  test('Wareneingang bucht Bestand; Ablehnung bucht nichts; Verderb und Inventur', async () => {
    const emp = await srv.client().as('employee_halle');
    const stock0 = (await emp.get(`/api/stock?branch=${HALLE}`)).data.find((s) => s.id === 1).qty;
    // Kühlware: Temperatur und Foto Pflicht
    assert.equal((await emp.post('/api/goods/receipts', { branch: HALLE, item_id: 1, quantity: 10, decision: 'accepted', media_id: await emp.photo(HALLE, 'goods') })).data.error, 'temperature');
    assert.equal((await emp.post('/api/goods/receipts', { branch: HALLE, item_id: 1, quantity: 10, temperature: 3, decision: 'accepted' })).data.error, 'photo_required');
    const ok = await emp.post('/api/goods/receipts', { branch: HALLE, item_id: 1, quantity: 10, temperature: 3, batch: 'CH-77', best_before: '2027-01-15', condition_ok: true, decision: 'accepted', media_id: await emp.photo(HALLE, 'goods') });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.stock.qty, stock0 + 10);
    const rej = await emp.post('/api/goods/receipts', { branch: HALLE, item_id: 1, quantity: 5, temperature: 12, condition_ok: false, decision: 'rejected', reject_reason: 'zu warm', media_id: await emp.photo(HALLE, 'goods') });
    assert.equal(rej.status, 200);
    assert.equal(rej.data.stock.qty, stock0 + 10);
    assert.equal((await emp.post('/api/stock/movement', { branch: HALLE, item_id: 1, type: 'waste', quantity: 2 })).status, 400, 'Grund nötig');
    assert.equal((await emp.post('/api/stock/movement', { branch: HALLE, item_id: 1, type: 'waste', quantity: 2, note: 'MHD überschritten' })).data.qty, stock0 + 8);
    assert.equal((await emp.post('/api/stock/count', { branch: HALLE, item_id: 1, counted: 1 })).status, 403, 'Inventur nur Leitung');
    const mgr = await srv.client().as('manager_halle');
    const cnt = (await mgr.post('/api/stock/count', { branch: HALLE, item_id: 1, counted: 1 })).data;
    assert.equal(cnt.stock.qty, 1);
    assert.equal(cnt.stock.below_min, true);
    // Leuna-Bestand unverändert
    assert.equal((await (await srv.client().as('manager_leuna')).get(`/api/stock?branch=${LEUNA}`)).data.find((s) => s.id === 1).qty, 15);
    // Beleg-Dubletten werden verhindert
    assert.equal((await mgr.post('/api/goods/documents', { branch: HALLE, receipt_no: 'DEMO-R-1' })).status, 200);
    assert.equal((await mgr.post('/api/goods/documents', { branch: HALLE, receipt_no: 'DEMO-R-1' })).status, 409);
  });

  test('Ölmanager: kein Grenzwert → keine Freigabe; Grenzwert nur mit Quelle; Überschreitung meldet', async () => {
    const emp = await srv.client().as('employee_halle'); // hat inzwischen Fritteusen-Freigabe (Lerntest oben)
    const empL = await srv.client().as('employee_leuna');
    const fryers = (await emp.get(`/api/oil?branch=${HALLE}`)).data;
    const f = fryers[0];
    assert.equal(f.state, 'unknown');
    const fL = (await empL.get(`/api/oil?branch=${LEUNA}`)).data[0];
    assert.equal((await empL.post(`/api/oil/${fL.id}/event`, { type: 'tpm', tpm: 10, media_id: await empL.photo(LEUNA, 'oil') })).data.error, 'not_qualified');
    assert.equal((await emp.post(`/api/oil/${f.id}/event`, { type: 'tpm', tpm: 18 })).data.error, 'photo_required');
    const m1 = (await emp.post(`/api/oil/${f.id}/event`, { type: 'tpm', tpm: 18, media_id: await emp.photo(HALLE, 'oil') })).data;
    assert.equal(m1.status.state, 'unknown');
    assert.equal(m1.status.reason, 'no_limit');
    const mgr = await srv.client().as('manager_halle');
    assert.equal((await mgr.patch(`/api/oil/${f.id}`, { tpm_limit: 24 })).data.error, 'limit_source');
    assert.equal((await mgr.patch(`/api/oil/${f.id}`, { tpm_limit: 24, tpm_warn: 30, limit_source: 'Test' })).data.error, 'tpm_warn');
    assert.equal((await mgr.patch(`/api/oil/${f.id}`, { tpm_limit: 24, tpm_warn: 20, limit_source: 'DEMO-Wert, kein echter Grenzwert' })).status, 200);
    assert.equal((await emp.post(`/api/oil/${f.id}/event`, { type: 'tpm', tpm: 21, media_id: await emp.photo(HALLE, 'oil') })).data.status.state, 'warn');
    assert.equal((await emp.post(`/api/oil/${f.id}/event`, { type: 'tpm', tpm: 25, media_id: await emp.photo(HALLE, 'oil') })).data.status.state, 'change');
    assert.ok((await mgr.get(`/api/problems?branch=${HALLE}`)).data.some((p) => p.source === 'oil'));
  });

  test('Grenzwert bei Messaufgabe erzeugt Abweichung (nur wenn Grenzwert mit Quelle hinterlegt)', async () => {
    const mgr = await srv.client().as('manager_leuna');
    const tpl = (await mgr.get(`/api/templates?branch=${LEUNA}`)).data.find((x) => x.title.de.startsWith('Tiefkühler'));
    assert.equal((await mgr.patch(`/api/templates/${tpl.id}`, { limit_max: -18 })).data.error, 'limit_source');
    assert.equal((await mgr.patch(`/api/templates/${tpl.id}`, { limit_max: -18, limit_source: 'DEMO-HACCP-Plan (fiktiv)' })).status, 200);
    const emp = await srv.client().as('employee_leuna');
    let n;
    for (let i = 0; i < 10; i++) {
      n = (await emp.get(`/api/shift/next?branch=${LEUNA}&shift=open`)).data.next;
      if (n.title_de.startsWith('Tiefkühler')) break;
      if (n.required_course_id) break;
      await emp.post(`/api/tasks/${n.id}/complete`, { media_id: n.requires_photo ? await emp.photo(LEUNA) : undefined, value: n.measure_unit ? 4 : undefined });
    }
    assert.ok(n.title_de.startsWith('Tiefkühler'));
    const r = (await emp.post(`/api/tasks/${n.id}/complete`, { media_id: await emp.photo(LEUNA), value: -12 })).data;
    assert.ok(r.deviation);
    const p = (await mgr.get(`/api/problems?branch=${LEUNA}`)).data.find((x) => x.id === r.deviation);
    assert.equal(p.source, 'limit');
  });

  test('Vorlagen: Reihenfolge ändern wirkt auf heutige Aufgaben; nur Leitung', async () => {
    const emp = await srv.client().as('employee_halle');
    assert.equal((await emp.get(`/api/templates?branch=${HALLE}`)).status, 403);
    const mgr = await srv.client().as('manager_halle');
    const run = (await mgr.get(`/api/templates?branch=${HALLE}`)).data.filter((x) => x.shift === 'run');
    const second = run[1];
    assert.equal((await mgr.post(`/api/templates/${second.id}/move`, { dir: 'up' })).data.moved, true);
    const next = (await emp.get(`/api/shift/next?branch=${HALLE}&shift=run`)).data.next;
    assert.equal(next.title_de, second.title.de);
    const created = (await mgr.post('/api/templates', { branch: HALLE, shift: 'run', title_de: 'Toiletten prüfen', requires_photo: true })).data;
    assert.ok(created.id);
  });

  test('Sprachwechsel: Aufgaben und Anleitungen in AR/TR/EN, Kennzeichnung ungeprüfter Übersetzung', async () => {
    const emp = await srv.client().as('employee_halle');
    const tr = (await emp.get(`/api/shift/next?branch=${HALLE}&shift=open&lang=tr`)).data;
    const ar = (await emp.get(`/api/shift/next?branch=${HALLE}&shift=open&lang=ar`)).data;
    if (tr.next) assert.notEqual(tr.next.title, tr.next.title_de);
    if (ar.next) assert.match(ar.next.title, /[؀-ۿ]/);
    const sops = srv.db.prepare('SELECT id FROM sops WHERE code = ?').get('SOP-HANDS');
    const sop = (await emp.get(`/api/sops/${sops.id}?lang=ar`)).data;
    assert.equal(sop.lang, 'ar');
    assert.equal(sop.translation_reviewed, false);
    const fry = srv.db.prepare('SELECT id FROM sops WHERE code = ?').get('SOP-FRYER-GGM');
    assert.equal((await emp.get(`/api/sops/${fry.id}`)).data.safety_review, 'pending');
    assert.equal((await emp.req('PUT', '/api/me/lang', { lang: 'tr' })).status, 200);
    assert.equal((await emp.get('/api/me')).data.lang, 'tr');
  });

  test('Sicherheit: CSRF-Header, Upload-Typen, unveränderliches Protokoll, keine Anmeldung ohne Sitzung', async () => {
    const anon = srv.client();
    assert.equal((await anon.get(`/api/shift/next?branch=${HALLE}&shift=open`)).status, 401);
    const emp = await srv.client().as('employee_halle');
    const noHeader = await fetch(srv.base + '/api/problems', { method: 'POST', headers: { cookie: emp.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ branch: HALLE, description: 'test' }) });
    assert.equal(noHeader.status, 403);
    const txt = await emp.req('POST', `/api/media?branch=${HALLE}&purpose=evidence`, undefined, { raw: { data: Buffer.from('<script>alert(1)</script>'), type: 'image/jpeg' } });
    assert.equal(txt.data.error, 'file_type');
    const pdfAsEvidence = await emp.req('POST', `/api/media?branch=${HALLE}&purpose=evidence`, undefined, { raw: { data: Buffer.from('%PDF-1.4 test'), type: 'application/pdf' } });
    assert.equal(pdfAsEvidence.data.error, 'file_type');
    assert.throws(() => srv.db.prepare('UPDATE audit_log SET action = ?').run('x'), /unveränderlich/);
    assert.throws(() => srv.db.prepare('DELETE FROM audit_log').run(), /unveränderlich/);
    const html = await fetch(srv.base + '/');
    assert.match(html.headers.get('content-security-policy'), /default-src 'self'/);
    // Pfad-Traversal
    assert.equal((await fetch(srv.base + '/../server/db.js')).status === 200 && (await (await fetch(srv.base + '/../server/db.js')).text()).includes('MIGRATIONS'), false);
  });

  test('Admin: SOP-Version bearbeiten und freigeben; Mitarbeiter sieht nur freigegebene Version', async () => {
    const admin = await srv.client().as('admin');
    const sops = (await admin.get('/api/admin/sops')).data;
    const s = sops.find((x) => x.code === 'SOP-HANDS');
    const content = { ...s.versions[0].content, de: { title: 'Hände waschen (neu)', steps: [{ icon: 'hands', text: 'Neuer Schritt' }] } };
    const v = (await admin.post(`/api/admin/sops/${s.id}/versions`, { content })).data;
    const emp = await srv.client().as('employee_halle');
    assert.equal((await emp.get(`/api/sops/${s.id}?lang=de`)).data.title, 'Hände waschen', 'Entwurf noch nicht sichtbar');
    assert.equal((await emp.post(`/api/admin/sops/${s.id}/publish`, { version_no: v.version_no })).status, 403);
    assert.equal((await admin.post(`/api/admin/sops/${s.id}/publish`, { version_no: v.version_no })).status, 200);
    const now = (await emp.get(`/api/sops/${s.id}?lang=de`)).data;
    assert.equal(now.title, 'Hände waschen (neu)');
    assert.equal(now.version, v.version_no);
    const audit = (await admin.get('/api/audit')).data;
    assert.ok(audit.some((a) => a.action === 'publish' && a.entity === 'sop'));
  });

  test('Datenschutz: Fotos werden nach Aufbewahrungsfrist gelöscht', async () => {
    const emp = await srv.client().as('employee_halle');
    const id = await emp.photo(HALLE);
    srv.db.prepare("UPDATE media SET created_at = '2000-01-01T00:00:00Z' WHERE id = ?").run(id);
    const n = purgeExpiredMedia(srv.db, srv.uploadDir);
    assert.ok(n >= 1);
    assert.equal((await emp.get(`/api/media/${id}`)).status, 404);
  });
});

describe('Produktions-Instanz (ohne Demo)', () => {
  let srv;
  before(async () => { srv = await startServer({ demo: false }); });
  after(() => srv.close());

  test('Demo-Zugang existiert nicht, keine Standard-Benutzer, keine fiktiven Daten', async () => {
    const c = srv.client();
    assert.equal((await c.post('/api/demo/session', { persona: 'admin' })).status, 404);
    const cfg = (await c.get('/api/config')).data;
    assert.equal(cfg.demo, false);
    assert.equal(cfg.has_admin, false);
    assert.equal(srv.db.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
    assert.equal(srv.db.prepare('SELECT COUNT(*) n FROM items').get().n, 0);
    assert.equal((await c.post('/api/login', { username: 'demo.admin', password: 'x' })).status, 401);
  });

  test('Anleitungen starten als Entwurf; Startvorlagen für Halle und Leuna vorhanden', async () => {
    assert.equal(srv.db.prepare("SELECT COUNT(*) n FROM sop_versions WHERE status = 'approved'").get().n, 0);
    assert.ok(srv.db.prepare('SELECT COUNT(*) n FROM task_templates WHERE branch_id = 1').get().n > 10);
    assert.ok(srv.db.prepare('SELECT COUNT(*) n FROM task_templates WHERE branch_id = 2').get().n > 10);
  });

  test('Anmeldung mit Passwort, Sperre nach vielen Fehlversuchen', async () => {
    const { hashPassword } = await import('../server/auth.js');
    srv.db.prepare('INSERT INTO users (username, display_name, password_hash, is_admin) VALUES (?,?,?,1)').run('testadmin', 'Test', hashPassword('sehr-geheimes-pw-123'));
    const c = srv.client();
    assert.equal((await c.post('/api/login', { username: 'testadmin', password: 'sehr-geheimes-pw-123' })).status, 200);
    assert.equal((await c.get('/api/me')).data.is_admin, true);
    const cookieHeader = (await (async () => { const x = srv.client(); const r = await x.req('POST', '/api/login', { username: 'testadmin', password: 'sehr-geheimes-pw-123' }); return r.headers.get('set-cookie'); })());
    assert.match(cookieHeader, /HttpOnly/);
    assert.match(cookieHeader, /SameSite=Strict/);
    const bad = srv.client();
    let last;
    for (let i = 0; i < 9; i++) last = await bad.post('/api/login', { username: 'testadmin', password: 'falsch' });
    assert.equal(last.status, 429);
    // Session-Token wird nur gehasht gespeichert
    const tok = c.cookie.split('=')[1];
    assert.equal(srv.db.prepare('SELECT COUNT(*) n FROM sessions WHERE token_hash = ?').get(tok).n, 0);
  });

  test('Upload-Ordner liegt außerhalb des Web-Verzeichnisses (Datei nicht direkt abrufbar)', async () => {
    writeFileSync(join(srv.uploadDir, 'probe'), 'x');
    assert.notEqual((await fetch(srv.base + '/probe')).headers.get('content-type'), 'application/octet-stream');
    const res = await fetch(srv.base + '/probe');
    assert.ok(!(await res.text()).startsWith('x'));
  });
});
