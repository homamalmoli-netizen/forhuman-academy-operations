import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, HALLE, LEUNA } from './helpers.js';
import { AREAS_EXTRA } from '../server/training-content-6.js';

describe('Hilfe bei Aufgaben, Anleitungsfotos, Allergene, neue Schulungsbereiche', () => {
  let srv, emp, adm, empLeuna;
  before(async () => {
    srv = await startServer({ demo: true });
    emp = await srv.client().as('employee_halle');
    adm = await srv.client().as('admin');
    empLeuna = await srv.client().as('employee_leuna');
    await emp.get(`/api/shift/next?branch=${HALLE}&shift=open`);
  });
  after(() => srv.close());

  test('Aufgaben-Hilfe liefert DE und AR; freigegebene Anleitung mit Schritten; fremde Filiale gesperrt', async () => {
    const occ = srv.db.prepare('SELECT o.id FROM task_occurrences o JOIN task_templates t ON t.id = o.template_id WHERE o.branch_id = ? AND t.sop_id IS NOT NULL LIMIT 1').get(HALLE);
    const h = (await emp.get(`/api/tasks/${occ.id}/help`)).data;
    assert.ok(h.task.de.title); assert.ok(h.task.ar.title, 'Aufgabe hat arabischen Titel');
    assert.ok(h.sop && h.sop.de && h.sop.de.steps.length > 0);
    assert.equal((await empLeuna.get(`/api/tasks/${occ.id}/help`)).status, 403);
  });

  test('Nicht freigegebene Anleitung wird nicht ausgeliefert', async () => {
    const sop = srv.db.prepare("SELECT id FROM sops WHERE code LIKE 'bereich-%' LIMIT 1").get();
    const tpl = srv.db.prepare('SELECT o.id, o.template_id FROM task_occurrences o WHERE o.branch_id = ? LIMIT 1').get(HALLE);
    srv.db.prepare('UPDATE task_templates SET sop_id = ? WHERE id = ?').run(sop.id, tpl.template_id);
    const h = (await emp.get(`/api/tasks/${tpl.id}/help`)).data;
    assert.equal(h.sop.published, false); assert.equal(h.sop.de, undefined);
  });

  test('Anleitungsfotos: nur Betreiber lädt hoch, Schritt-Foto nur mit SOP-Zweck, für alle Filialen sichtbar', async () => {
    assert.equal((await emp.req('POST', `/api/media?branch=${HALLE}&purpose=sop`, undefined, { raw: { data: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(50, 1)]), type: 'image/jpeg' } })).status, 403);
    const photo = await adm.photo(HALLE, 'sop');
    const evidence = await emp.photo(HALLE);
    const sop = srv.db.prepare("SELECT id FROM sops WHERE code = 'SOP-HANDS'").get();
    const content = { de: { title: 'Hände waschen (Test)', steps: [{ icon: 'hands', text: 'Schritt mit Foto', media_id: photo }] } };
    assert.equal((await adm.post(`/api/admin/sops/${sop.id}/versions`, { content: { de: { ...content.de, steps: [{ icon: 'hands', text: 'x', media_id: evidence }] } } })).data.error, 'media');
    const v = (await adm.post(`/api/admin/sops/${sop.id}/versions`, { content })).data.version_no;
    assert.equal((await adm.post(`/api/admin/sops/${sop.id}/publish`, { version_no: v })).status, 200);
    const s = (await empLeuna.get(`/api/sops/${sop.id}?lang=de`)).data;
    assert.equal(s.steps[0].media_id, photo);
    assert.equal((await empLeuna.get(`/api/media/${photo}`)).status, 200);
    assert.equal((await empLeuna.get(`/api/media/${evidence}`)).status, 403);
  });

  test('Allergene: 14 Codes nach LMIV, nur gültige Codes, ohne Mengen für Mitarbeiter', async () => {
    const r = (await emp.get(`/api/allergens?branch=${HALLE}`)).data;
    assert.equal(r.codes.length, 14);
    const m = r.marinades[0];
    assert.equal(m.ingredients, undefined);
    assert.equal((await adm.req('PUT', `/api/admin/marinades/${m.id}`, { ingredients: [{ name: 'DEMO Zutat A', per_kg: 50, unit: 'g' }], allergen_codes: ['unbekannt'] })).data.error, 'allergen_codes');
    assert.equal((await adm.req('PUT', `/api/admin/marinades/${m.id}`, { ingredients: [{ name: 'DEMO Zutat A', per_kg: 50, unit: 'g' }], allergen_codes: ['mustard', 'celery', 'mustard'] })).status, 200);
    assert.deepEqual((await emp.get(`/api/allergens?branch=${HALLE}`)).data.marinades[0].allergen_codes, ['celery', 'mustard']);
    // Neue Version ohne Angabe übernimmt die Codes
    await adm.req('PUT', `/api/admin/marinades/${m.id}`, { ingredients: [{ name: 'DEMO Zutat A', per_kg: 40, unit: 'g' }] });
    assert.deepEqual((await emp.get(`/api/allergens?branch=${HALLE}`)).data.marinades[0].allergen_codes, ['celery', 'mustard']);
  });

  test('Neue Schulungsbereiche: Arbeitsschutz und Allergene, je Stufe mind. 5 Fragen, richtige Antwort einmalig', async () => {
    for (const a of AREAS_EXTRA) for (const lv of a.levels) {
      assert.ok(lv.questions.length >= 5, `${a.code}: zu wenige Fragen`);
      for (const [, q] of lv.questions) for (const L of ['de', 'en', 'ar']) {
        assert.equal(q[L].length, 5); assert.equal(new Set(q[L].slice(1, 4)).size, 3);
      }
    }
    const train = (await emp.get(`/api/train?branch=${HALLE}`)).data;
    assert.ok(train.find((a) => a.code === 'arbeitsschutz')); assert.ok(train.find((a) => a.code === 'allergene'));
  });
});
