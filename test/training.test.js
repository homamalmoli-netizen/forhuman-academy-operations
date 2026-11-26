import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, HALLE } from './helpers.js';

// Richtige Antwort je angezeigter Frage aus dem gespeicherten Plan ermitteln (options[0] = richtig)
function key(db, attemptId) {
  const plan = JSON.parse(db.prepare('SELECT plan FROM train_attempts WHERE id = ?').get(attemptId).plan);
  return plan.map((p) => ({ right: p.order.indexOf(0), safety: !!db.prepare('SELECT safety FROM train_questions WHERE id = ?').get(p.q).safety }));
}

describe('Schulungsbereiche: 10 Bereiche × 3 Stufen, Prüfung, Freigabe, Zertifikat, Hilfe', () => {
  let srv, emp, trainer, admin, ids = {};
  before(async () => {
    srv = await startServer({ demo: true });
    for (const u of srv.db.prepare('SELECT id, username FROM users').all()) ids[u.username] = u.id;
    emp = await srv.client().as('employee_halle');
    trainer = await srv.client().as('trainer');
    admin = await srv.client().as('admin');
  });
  after(() => srv.close());
  const L1 = () => srv.db.prepare("SELECT m.id FROM train_modules m JOIN train_areas a ON a.id = m.area_id WHERE a.code = 'fleisch' AND m.level = 1").get().id;
  const L2 = () => srv.db.prepare("SELECT m.id FROM train_modules m JOIN train_areas a ON a.id = m.area_id WHERE a.code = 'fleisch' AND m.level = 2").get().id;

  test('Struktur: 10 Bereiche mit je 3 Stufen, Inhalte DE/EN/AR, Stufe 2 gesperrt', async () => {
    const r = await emp.get(`/api/train?branch=${HALLE}&lang=ar`);
    assert.equal(r.status, 200);
    assert.equal(r.data.length, 10);
    assert.ok(r.data.every((a) => a.levels.length === 3));
    assert.equal(r.data[0].levels[0].state, 'open');
    assert.equal(r.data[0].levels[1].state, 'locked');
    assert.match(r.data[0].title, /[؀-ۿ]/);
    const m = await emp.get(`/api/train/modules/${L1()}?branch=${HALLE}&lang=en`);
    assert.equal(m.data.translation_reviewed, false);
    assert.ok(m.data.steps.length >= 3);
    assert.equal((await emp.post(`/api/train/modules/${L2()}/start`, { branch: HALLE })).data.error, 'locked');
  });

  test('Prüfung: keine Lösung im Client, Reihenfolge zufällig, nur eigene Versuche sichtbar', async () => {
    const a = (await emp.post(`/api/train/modules/${L1()}/start`, { branch: HALLE, lang: 'de' })).data.attempt_id;
    const b = (await emp.post(`/api/train/modules/${L1()}/start`, { branch: HALLE, lang: 'de' })).data.attempt_id;
    const qa = (await emp.get(`/api/train/attempts/${a}?lang=de`)).data;
    assert.equal(qa.questions.length, 20);
    assert.ok(!JSON.stringify(qa).includes('explain'));
    assert.ok(qa.questions.every((q) => !('correct' in q) && !('right' in q)));
    const pa = srv.db.prepare('SELECT plan FROM train_attempts WHERE id = ?').get(a).plan;
    const pb = srv.db.prepare('SELECT plan FROM train_attempts WHERE id = ?').get(b).plan;
    assert.notEqual(pa, pb, 'zwei Versuche sollten unterschiedlich gemischt sein');
    assert.equal((await trainer.get(`/api/train/attempts/${a}`)).status, 404);
  });

  test('80 % erreicht, aber eine Sicherheitsfrage falsch → nicht bestanden, mit Erklärung', async () => {
    const id = (await emp.post(`/api/train/modules/${L1()}/start`, { branch: HALLE, lang: 'de' })).data.attempt_id;
    const k = key(srv.db, id);
    const wrongIdx = k.findIndex((x) => x.safety);
    const answers = k.map((x, i) => (i === wrongIdx ? (x.right + 1) % 3 : x.right));
    const r = (await emp.post(`/api/train/attempts/${id}/submit`, { answers, lang: 'de' })).data;
    assert.equal(r.score, 19);
    assert.equal(r.safety_ok, false);
    assert.equal(r.passed, false);
    const wrong = r.results.find((x) => !x.correct);
    assert.ok(wrong.explain && wrong.right);
    assert.equal((await emp.post(`/api/train/attempts/${id}/submit`, { answers, lang: 'de' })).status, 409);
  });

  test('unter 80 % → nicht bestanden; Wiederholen und alles richtig → bestanden, wartet auf Praxis-Freigabe', async () => {
    let id = (await emp.post(`/api/train/modules/${L1()}/start`, { branch: HALLE })).data.attempt_id;
    let k = key(srv.db, id);
    // fünf Nicht-Sicherheitsfragen falsch → 15/20 = 75 %
    let n = 0;
    const answers = k.map((x) => (!x.safety && n++ < 5 ? (x.right + 1) % 3 : x.right));
    assert.ok(n >= 5);
    let r = (await emp.post(`/api/train/attempts/${id}/submit`, { answers })).data;
    assert.equal(r.passed, false); assert.equal(r.safety_ok, true);
    id = (await emp.post(`/api/train/modules/${L1()}/start`, { branch: HALLE })).data.attempt_id;
    k = key(srv.db, id);
    r = (await emp.post(`/api/train/attempts/${id}/submit`, { answers: k.map((x) => x.right) })).data;
    assert.equal(r.passed, true); assert.equal(r.needs_practical, true); assert.equal(r.certificate, null);
    const st = (await emp.get(`/api/train?branch=${HALLE}`)).data[0];
    assert.equal(st.levels[0].state, 'needs_practical');
    assert.equal(st.levels[1].state, 'open', 'Stufe 2 nach bestandener Stufe 1 entsperrt');
    assert.equal(st.levels[2].state, 'locked');
  });

  test('Praktische Freigabe: nur Trainer/Leitung, nicht selbst; dann Zertifikat und Übersicht', async () => {
    assert.equal((await emp.post(`/api/train/modules/${L1()}/signoff`, { branch: HALLE, user_id: ids['demo.mitarbeiter.halle'] })).status, 403);
    const pend = (await trainer.get(`/api/train/overview?branch=${HALLE}`)).data;
    const empId = srv.db.prepare("SELECT user_id FROM train_attempts WHERE passed = 1 LIMIT 1").get().user_id;
    assert.ok(pend.pending.some((p) => p.user_id === empId && p.module_id === L1()));
    assert.equal((await trainer.post(`/api/train/modules/${L1()}/signoff`, { branch: HALLE, user_id: ids['demo.trainer'] })).status, 403);
    const s = (await trainer.post(`/api/train/modules/${L1()}/signoff`, { branch: HALLE, user_id: empId, note: 'Station sauber gezeigt' })).data;
    assert.match(s.certificate, /^FH-[0-9A-F]{10}$/);
    const certs = (await emp.get('/api/train/certificates?lang=de')).data;
    assert.equal(certs[0].title, 'Fleisch & Hähnchen · Grundlagen');
    assert.equal(certs[0].signed_by, 'Demo Trainer (fiktiv)');
    const ov = (await trainer.get(`/api/train/overview?branch=${HALLE}`)).data;
    const areaId = ov.areas.find((a) => a.code === 'fleisch').id;
    assert.equal(ov.people.find((p) => p.id === empId).levels[areaId], 1);
    assert.equal(ov.pending.length, 0);
  });

  test('Betreiber bearbeitet Inhalte und Fragen; Prüfung prüft Eingaben; Mitarbeiter darf nicht', async () => {
    const m = L2();
    assert.equal((await emp.req('PUT', `/api/train/modules/${m}`, { video_url: 'https://example.org/v' })).status, 403);
    assert.equal((await admin.req('PUT', `/api/train/modules/${m}`, { video_url: 'http://unsicher' })).data.error, 'video_url');
    assert.equal((await admin.req('PUT', `/api/train/modules/${m}`, { video_url: 'https://example.org/video', reviewed_langs: ['en'] })).status, 200);
    assert.equal((await admin.post(`/api/train/modules/${m}/questions`, { content: { de: { q: 'Nur eine Antwort?', options: ['a'] } } })).data.error, 'content');
    assert.equal((await admin.post(`/api/train/modules/${m}/questions`, { content: { de: { q: 'F', options: ['a', 'b'] }, en: { q: 'Q', options: ['a'] } } })).data.error, 'content');
    for (let i = 0; i < 5; i++) {
      const r = await admin.post(`/api/train/modules/${m}/questions`, { safety: i === 0, content: { de: { q: `Frage ${i}`, options: ['richtig', 'falsch', 'auch falsch'], explain: 'Weil.' } } });
      assert.equal(r.status, 200);
    }
    const ed = (await admin.get(`/api/train/modules/${m}/edit`)).data;
    assert.equal(ed.questions.length, 10); assert.equal(ed.video_url, 'https://example.org/video');
    // 6 Fragen auf „offen“ → 4 aktive < 5 → noch nicht prüfbar
    for (const q of ed.questions.slice(0, 6)) assert.equal((await admin.req('PUT', `/api/train/questions/${q.id}`, { status: 'open' })).status, 200);
    assert.equal((await emp.get(`/api/train/modules/${m}?branch=${HALLE}`)).data.state, 'preparing');
    assert.equal((await emp.post(`/api/train/modules/${m}/start`, { branch: HALLE })).data.error, 'not_ready');
    await admin.req('PUT', `/api/train/questions/${ed.questions[0].id}`, { status: 'active' });
    const st = (await emp.get(`/api/train/modules/${m}?branch=${HALLE}&lang=ar`)).data;
    assert.equal(st.state, 'open'); assert.equal(st.video_url, 'https://example.org/video');
    // Fragen ohne arabische Übersetzung fallen auf Deutsch zurück
    const id = (await emp.post(`/api/train/modules/${m}/start`, { branch: HALLE, lang: 'ar' })).data.attempt_id;
    assert.equal((await emp.get(`/api/train/attempts/${id}?lang=ar`)).data.questions.length, 5);
  });

  test('Mitgelieferte Fragen: neuer Seed ergänzt fehlende, überschreibt keine geänderten oder archivierten', async () => {
    const { seedTraining } = await import('../server/training.js');
    const m = L1();
    const q = srv.db.prepare('SELECT id FROM train_questions WHERE module_id = ? ORDER BY position LIMIT 1').get(m);
    await admin.req('PUT', `/api/train/questions/${q.id}`, { status: 'archived' });
    const before = srv.db.prepare('SELECT COUNT(*) n FROM train_questions').get().n;
    srv.db.prepare("DELETE FROM train_questions WHERE seed_key = 'fleisch:1:19'").run();
    seedTraining(srv.db);
    assert.equal(srv.db.prepare('SELECT COUNT(*) n FROM train_questions').get().n, before);
    assert.equal(srv.db.prepare('SELECT status FROM train_questions WHERE id = ?').get(q.id).status, 'archived');
    await admin.req('PUT', `/api/train/questions/${q.id}`, { status: 'active' });
  });

  test('Hilfe „Wie mache ich das?“ findet Schulung, Handbuch und Anleitungen', async () => {
    const r = (await emp.get('/api/help?q=%C3%96l%20filtern&lang=de')).data.results;
    assert.ok(r.some((x) => x.kind === 'training' && /Öl/.test(x.title)));
    assert.ok(r.some((x) => x.kind === 'handbook'));
    const ar = (await emp.get(`/api/help?q=${encodeURIComponent('الحساسية')}&lang=ar`)).data.results;
    assert.ok(ar.length > 0);
    assert.deepEqual((await emp.get('/api/help?q=x')).data.results, []);
  });
});
