import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, HALLE } from './helpers.js';
import { AREA_GUIDES } from '../server/guides.js';

describe('Anleitungen je Bereich (gesperrte Entwürfe) und Reinigungsmittel-Stamm', () => {
  let srv, emp, admin;
  before(async () => {
    srv = await startServer({ demo: true });
    emp = await srv.client().as('employee_halle');
    admin = await srv.client().as('admin');
  });
  after(() => srv.close());

  test('13 Bereichsanleitungen als Entwurf: für Mitarbeiter nicht sichtbar, nicht in der Hilfesuche', async () => {
    assert.equal(AREA_GUIDES.length, 13);
    const sop = srv.db.prepare("SELECT id FROM sops WHERE code = 'bereich-marinieren'").get();
    assert.equal((await emp.get(`/api/sops/${sop.id}`)).data.published, false);
    const all = (await admin.get('/api/admin/sops')).data;
    assert.equal(all.filter((s) => s.code.startsWith('bereich-') && s.versions[0].status === 'draft').length, 13);
    const help = (await emp.get('/api/help?q=Marinieren&lang=de')).data.results;
    assert.ok(!help.some((h) => h.link === `#/sop/${sop.id}`));
  });

  test('Reinigungsmittel: ohne Freigabe unsichtbar; Freigabe nur mit Dosierung, Einwirkzeit, Schutzausrüstung, Anwendung und Sicherheitsdatenblatt', async () => {
    assert.deepEqual((await emp.get(`/api/cleaning-products?branch=${HALLE}`)).data, []);
    const list = (await admin.get('/api/cleaning-products')).data;
    const p = list.find((x) => x.name.startsWith('aro Vollglanz'));
    assert.equal(p.dosage, null);
    assert.equal((await admin.post(`/api/cleaning-products/${p.id}/approve`)).data.error, 'incomplete');
    assert.equal((await admin.req('PUT', `/api/cleaning-products/${p.id}`, { sds_url: 'http://unsicher.example' })).data.error, 'sds_url');
    assert.equal((await emp.req('PUT', `/api/cleaning-products/${p.id}`, { dosage: 'x' })).status, 403);
    const fields = { application: 'TESTWERT (fiktiv) – Boden', dosage: 'TESTWERT (fiktiv)', contact_time: 'TESTWERT (fiktiv)', ppe: 'TESTWERT (fiktiv)', sds_url: 'https://example.org/sdb.pdf' };
    assert.equal((await admin.req('PUT', `/api/cleaning-products/${p.id}`, fields)).status, 200);
    assert.equal((await admin.post(`/api/cleaning-products/${p.id}/approve`)).status, 200);
    assert.equal((await emp.get(`/api/cleaning-products?branch=${HALLE}`)).data.length, 1);
    // Änderung → wieder Entwurf
    await admin.req('PUT', `/api/cleaning-products/${p.id}`, { dosage: 'TESTWERT 2 (fiktiv)' });
    assert.deepEqual((await emp.get(`/api/cleaning-products?branch=${HALLE}`)).data, []);
  });
});
