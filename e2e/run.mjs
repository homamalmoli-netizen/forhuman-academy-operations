// End-to-End-Test im echten Browser (Chrome, Handy-Ansicht 390×844) mit Screenshots.
// Startet eine Demo-Instanz und eine Produktions-Instanz (temporäre Datenbank) und prüft die Abläufe über die Oberfläche.
// Aufruf: npm run e2e   (benötigt Playwright + Chrome; Pfad über PLAYWRIGHT_MODULE / CHROME_PATH änderbar)
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.PLAYWRIGHT_MODULE || '/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
const shots = join(root, 'docs', 'screenshots');
mkdirSync(shots, { recursive: true });

function start(env, port) {
  const p = spawn(process.execPath, ['--no-warnings', join(root, 'server/index.js')], { env: { ...process.env, ...env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  return new Promise((res) => p.stdout.on('data', (d) => { if (String(d).includes('Port')) res(p); }));
}

// Kleines echtes JPEG als "Kamerafoto" (1×1 Pixel)
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const tmp = mkdtempSync(join(tmpdir(), 'fh-e2e-'));
const photoPath = join(tmp, 'foto.jpg');
writeFileSync(photoPath, JPEG);

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['✅', name]); console.log('✅', name); }
  catch (e) { results.push(['❌', name, e.message]); console.log('❌', name, '\n   ', e.message); }
}

const demo = await start({ DEMO_MODE: '1' }, 3931);
const prod = await start({ DATABASE_FILE: join(tmp, 'prod.db'), UPLOAD_DIR: join(tmp, 'uploads') }, 3932);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const D = 'http://127.0.0.1:3931';

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, locale: 'de-DE' });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  return page;
}
const shot = (page, name) => page.screenshot({ path: join(shots, name + '.png'), fullPage: false });
const shotFull = (page, name) => page.screenshot({ path: join(shots, name + '.png'), fullPage: true });

try {
  const p = await newPage();
  await step('Startseite: Sprache wählen und Demo ohne Login', async () => {
    await p.goto(D + '/');
    await p.getByText('Demo ausprobieren als').waitFor();
    await shot(p, '01-start');
  });

  await step('Öffnung: eine Aufgabe pro Bildschirm, Erledigt', async () => {
    await p.click('[data-persona=employee_halle]');
    await p.locator('.task-title', { hasText: 'Licht einschalten' }).waitFor();
    assert.equal(await p.locator('.task-card').count(), 1);
    await shot(p, '02-mitarbeiter-naechste-aufgabe');
    await p.click('.done-btn');
    await p.locator('.task-title', { hasText: 'Rundgang' }).waitFor();
  });

  await step('Pflichtfoto: ohne Foto abgelehnt, mit Foto gespeichert', async () => {
    await p.click('.done-btn');
    await p.locator('.flash.error', { hasText: 'Foto ist Pflicht' }).waitFor();
    await p.setInputFiles('input[data-change=photo]', photoPath);
    await p.locator('.photo-field.ready').waitFor();
    await shot(p, '03-pflichtfoto-bereit');
    await p.click('.done-btn');
    await p.locator('.task-title', { hasText: 'Hände waschen' }).waitFor();
  });

  await step('Anleitung öffnen (feste, freigegebene Hilfe statt Chatbot)', async () => {
    await p.click('a.act[href^="#/sop/"]');
    await p.locator('.sop h1', { hasText: 'Hände waschen' }).waitFor();
    await shot(p, '04-anleitung');
    await p.goBack();
    await p.click('.done-btn');
  });

  await step('Messwert Kühlschrank mit Foto', async () => {
    await p.locator('.task-title', { hasText: 'Kühlschrank' }).waitFor();
    await p.fill('#value', '4');
    await p.setInputFiles('input[data-change=photo]', photoPath);
    await p.locator('.photo-field.ready').waitFor();
    await shot(p, '05-messwert-temperatur');
    await p.click('.done-btn');
    await p.locator('.task-title', { hasText: 'Tiefkühler' }).waitFor();
  });

  await step('Problem melden mit Foto', async () => {
    await p.click('a.act.warn');
    await p.fill('textarea[name=description]', 'Tiefkühler-Tür schließt nicht richtig');
    await p.setInputFiles('input[data-change=photo]', photoPath);
    await p.locator('.photo-field.ready').waitFor();
    await shot(p, '06-problem-melden');
    await p.click('form[data-submit=problem] button.primary');
    await p.locator('.flash.ok', { hasText: 'Problem gemeldet' }).waitFor();
  });

  await step('Sprachwechsel Arabisch: RTL und übersetzte Aufgabe', async () => {
    await p.selectOption('select[data-change=lang]', 'ar');
    await p.waitForFunction(() => document.documentElement.dir === 'rtl');
    await p.locator('.task-title').waitFor();
    const title = await p.locator('.task-title').innerText();
    assert.match(title, /[؀-ۿ]/);
    await shot(p, '07-arabisch-rtl');
    await p.selectOption('select[data-change=lang]', 'tr');
    await p.waitForFunction(() => document.documentElement.dir === 'ltr');
    await shot(p, '08-tuerkisch');
    await p.selectOption('select[data-change=lang]', 'de');
  });

  await step('Fritteuse gesperrt ohne Qualifikation', async () => {
    await p.locator('text=Brauchen Schulung/Freigabe').waitFor();
    await p.locator('li', { hasText: 'Fritteuse bereit machen' }).waitFor();
  });

  await step('Academy: Sprache wählen, Schritte, Prüfung gesperrt, Bildfrage, Ergebnis', async () => {
    await p.click('a.tab[href="#/learn"]');
    await p.locator('.course', { hasText: 'Hochdruckfritteuse' }).click();
    await p.locator('button:has-text("Prüfung erst nach allen Schritten")').waitFor();
    await shot(p, '09-academy-lernschritt');
    for (let i = 0; i < 4; i++) { await p.click('button[data-action=learn-step]'); await p.waitForTimeout(150); }
    await p.click('a:has-text("Prüfung starten")');
    await p.locator('.q-image').first().waitFor();
    await p.check('input[name=q0][value="0"]'); await p.check('input[name=q1][value="0"]'); await p.check('input[name=q2][value="1"]');
    await shotFull(p, '10-pruefung-bildfrage');
    await p.click('form[data-submit=exam] button.primary');
    await p.locator('.exam-result.fail').waitFor();
    await shot(p, '11-pruefung-nicht-bestanden');
    await p.click('a:has-text("Wiederholen")');
    await p.click('a:has-text("Prüfung starten")');
    await p.check('input[name=q0][value="1"]'); await p.check('input[name=q1][value="2"]'); await p.check('input[name=q2][value="0"]');
    await p.click('form[data-submit=exam] button.primary');
    await p.locator('.exam-result.ok').waitFor();
    await p.locator('text=Praktische Freigabe fehlt').waitFor();
    await shot(p, '12-pruefung-bestanden-praxis-fehlt');
  });

  await step('Wareneingang: bekannter GTIN mit Charge/MHD, Annahme mit Foto bucht Bestand', async () => {
    await p.click('a.tab[href="#/goods"]');
    await p.fill('input[name=code]', '(01)02000000000015(10)CH-77(17)270115');
    await p.click('form[data-submit=scan] button.primary');
    await p.locator('.match', { hasText: 'Hähnchenschenkel' }).waitFor();
    assert.equal(await p.inputValue('input[name=batch]'), 'CH-77');
    assert.equal(await p.inputValue('input[name=best_before]'), '2027-01-15');
    await p.fill('input[name=quantity]', '12');
    await p.fill('input[name=temperature]', '3');
    await p.setInputFiles('input[data-change=photo]', photoPath);
    await p.locator('.photo-field.ready').waitFor();
    await shotFull(p, '13-wareneingang-scan');
    await p.click('button[value=accepted]');
    await p.locator('.flash.ok').waitFor();
    await p.locator('#stock td', { hasText: '37 kg' }).waitFor();
  });

  await step('Scanner: unbekannter Code und nicht vertrauenswürdiger Link', async () => {
    await p.fill('input[name=code]', '4006381333931');
    await p.click('form[data-submit=scan] button.primary');
    await p.locator('.scan-result', { hasText: 'Unbekannter Code' }).waitFor();
    await p.fill('input[name=code]', 'https://phish.example/metro');
    await p.click('form[data-submit=scan] button.primary');
    await p.locator('text=Link nicht vertrauenswürdig').waitFor();
    await shot(p, '14-unbekannter-link');
  });

  await step('Ölmanager: kein Grenzwert → keine Freigabe (nur Hinweis)', async () => {
    await p.click('a.tab[href="#/oil"]');
    await p.locator('.fryer').first().waitFor();
    await shot(p, '15-oelmanager');
    // Ohne praktische Freigabe gesperrt
    await p.fill('.fryer >> nth=0 >> input[name=tpm]', '15');
    await p.setInputFiles('.fryer >> nth=0 >> input[data-change=photo]', photoPath);
    await p.locator('.fryer >> nth=0 >> .photo-field.ready').waitFor();
    await p.click('.fryer >> nth=0 >> button[value=tpm]');
    await p.locator('.flash.error', { hasText: 'Freigabe' }).waitFor();
  });
  assert.deepEqual(p.errors, [], 'JavaScript-Fehler auf der Mitarbeiterseite: ' + p.errors.join('; '));

  // --- Trainer gibt praktisch frei ---
  const tr = await newPage();
  await step('Trainer: praktische Freigabe nach bestandener Prüfung', async () => {
    await tr.goto(D + '/');
    await tr.click('[data-persona=trainer]');
    await tr.click('a[href="#/manage/training"]');
    await tr.locator('button[data-action=signoff]').first().waitFor();
    await shot(tr, '16-trainer-freigabe');
    await tr.click('button[data-action=signoff]');
    await tr.locator('.flash.ok', { hasText: 'Praktische Freigabe' }).waitFor();
  });

  // --- Filialleitung Halle ---
  const m = await newPage();
  await step('Leitung: Übersicht mit offenen Aufgaben, Problemen, Öl, Bestand', async () => {
    await m.goto(D + '/');
    await m.click('[data-persona=manager_halle]');
    await m.locator('.stats').first().waitFor();
    await shotFull(m, '17-leitung-uebersicht');
    assert.equal(await m.locator('select[data-change=branch]').count(), 0, 'Halle-Leitung sieht keine Filialauswahl');
  });

  await step('Leitung: Problem mit Foto ansehen und Nacharbeit anfordern', async () => {
    await m.click('a[href="#/manage/problems"]');
    await m.locator('.problem img.evidence').first().waitFor();
    await m.fill('form[data-submit=problem-action] input[name=note]', 'Tür prüfen und neu schließen');
    await shot(m, '18-leitung-problem');
    await m.click('form[data-submit=problem-action] button[value=rework]');
    await m.locator('.flash.ok').waitFor();
  });

  await step('Mitarbeiter sieht Nacharbeit zuerst und erledigt sie', async () => {
    await p.click('a.tab[href="#/shift"]');
    await p.locator('.task-card.rework').waitFor();
    await shot(p, '19-nacharbeit');
    await p.fill('#value', '-19');
    await p.setInputFiles('input[data-change=photo]', photoPath);
    await p.locator('.photo-field.ready').waitFor();
    await p.click('.done-btn');
    await p.locator('.flash.ok').waitFor();
  });

  await step('Leitung: Schichtbericht mit Fotos und Freigabe', async () => {
    await m.click('a[href="#/manage/report"]');
    await m.locator('img.mini').first().waitFor();
    await shotFull(m, '20-schichtbericht');
    await m.fill('form[data-submit=approve-shift] input[name=note]', 'Restliche Aufgaben übernimmt die nächste Schicht');
    await m.click('form[data-submit=approve-shift] button');
    await m.locator('.banner.ok', { hasText: 'Freigegeben' }).waitFor();
  });

  await step('Leitung: Vorlagen-Reihenfolge ändern', async () => {
    await m.click('a[href="#/manage/templates"]');
    const firstRun = m.locator('h2:has-text("Betrieb") + ul li').nth(1);
    const title = await firstRun.locator('b').innerText();
    await firstRun.locator('button[data-dir=up]').click();
    await m.locator('h2:has-text("Betrieb") + ul li >> nth=0', { hasText: title }).waitFor();
    await shot(m, '21-vorlagen');
  });

  await step('Leitung: unbekannten Code zuordnen, Nachbestellliste', async () => {
    await m.click('a[href="#/manage/stock"]');
    await m.selectOption('form[data-submit=assign-code] select', { index: 2 });
    await m.click('form[data-submit=assign-code] button');
    await m.locator('.flash.ok', { hasText: 'zugeordnet' }).waitFor();
    await shotFull(m, '22-bestand-codes');
  });
  assert.deepEqual(m.errors, [], 'JavaScript-Fehler auf der Leitungsseite: ' + m.errors.join('; '));

  const l = await newPage();
  await step('Filialtrennung in der Oberfläche: Leitung Leuna sieht nur Leuna', async () => {
    await l.goto(D + '/');
    await l.click('[data-persona=manager_leuna]');
    await l.locator('h1', { hasText: 'Leuna' }).waitFor();
    assert.equal(await l.locator('h1', { hasText: 'Halle' }).count(), 0);
    await l.click('a[href="#/manage/problems"]');
    await l.locator('text=Keine Probleme.').waitFor();
  });

  const a = await newPage();
  await step('Admin: Anleitung (SOP) mit Prüfstatus und Versionen', async () => {
    await a.goto(D + '/');
    await a.click('[data-persona=admin]');
    await a.click('a[href="#/manage/sops"]');
    await a.locator('select[data-change=sop-review]').first().waitFor();
    await shotFull(a, '23-admin-sop');
  });

  // --- Produktion: keine Demo, keine Umgehung ---
  const pr = await newPage();
  await step('Produktion: nur Anmeldung, keine Demo-Buttons, keine Standardkonten', async () => {
    await pr.goto('http://127.0.0.1:3932/');
    await pr.locator('form[data-submit=login]').waitFor();
    assert.equal(await pr.locator('[data-persona]').count(), 0);
    await pr.locator('text=Noch kein Betreiber-Konto').waitFor();
    await shot(pr, '24-produktion-login');
    await pr.fill('input[name=username]', 'demo.admin');
    await pr.fill('input[name=password]', 'irgendwas');
    await pr.click('form[data-submit=login] button');
    await pr.locator('.flash.error').waitFor();
    const r = await pr.evaluate(() => fetch('/api/demo/session', { method: 'POST', headers: { 'x-fh-request': '1', 'content-type': 'application/json' }, body: '{"persona":"admin"}' }).then((x) => x.status));
    assert.equal(r, 404);
  });

  await step('Offline: keine falsche Erfolgsmeldung', async () => {
    const o = await newPage();
    await o.goto(D + '/');
    await o.click('[data-persona=employee_leuna]');
    await o.locator('.task-title').waitFor();
    await o.context().setOffline(true);
    await o.click('.done-btn');
    await o.locator('.flash.error', { hasText: 'NICHT gespeichert' }).waitFor();
    assert.equal(await o.locator('.flash.ok').count(), 0);
    assert.equal(await o.locator('.done-btn').count(), 1, 'Aufgabe bleibt sichtbar');
    assert.equal(await o.locator('#offline-banner').isVisible(), true);
    await shot(o, '25-offline-nicht-gespeichert');
    await o.context().setOffline(false);
    await o.click('.done-btn');
    await o.locator('.flash.ok').waitFor();
  });
} finally {
  await browser.close();
  demo.kill(); prod.kill();
}

const failed = results.filter((r) => r[0] === '❌');
writeFileSync(join(root, 'docs', 'E2E_RESULTS.md'), `# End-to-End-Ergebnis\n\nAusgeführt: ${new Date().toISOString()} · Chrome · Handy-Ansicht 390×844\n\n${results.map((r) => `- ${r[0]} ${r[1]}${r[2] ? ` – ${r[2]}` : ''}`).join('\n')}\n\n**${results.length - failed.length} von ${results.length} bestanden.** Screenshots: \`docs/screenshots/\`\n`);
console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
process.exit(failed.length ? 1 : 0);
