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
const pages = [];
async function step(name, fn) {
  try { await fn(); results.push(['✅', name]); console.log('✅', name); }
  catch (e) {
    results.push(['❌', name, e.message.split('\n')[0]]); console.log('❌', name, '\n   ', e.message.split('\n').slice(0, 4).join('\n    '));
    for (const [i, pg] of pages.entries()) await pg.screenshot({ path: join(tmp, `fail-${results.length}-${i}.png`) }).catch(() => {});
  }
}

const demo = await start({ DEMO_MODE: '1' }, 3931);
const prod = await start({ DATABASE_FILE: join(tmp, 'prod.db'), UPLOAD_DIR: join(tmp, 'uploads') }, 3932);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const D = 'http://127.0.0.1:3931';

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, locale: 'de-DE' });
  const page = await ctx.newPage();
  page.errors = [];
  pages.push(page);
  page.on('pageerror', (e) => page.errors.push(String(e)));
  return page;
}
const nav = (page, hash) => page.evaluate((h) => { location.hash = h; }, hash);
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
    // auf die neu gerenderte, übersetzte Karte warten (nicht den alten deutschen Stand lesen)
    await p.waitForFunction(() => /[\u0600-\u06FF]/.test(document.querySelector('.task-title')?.textContent || ''), null, { timeout: 15000 });
    await shot(p, '07-arabisch-rtl');
    await p.selectOption('select[data-change=lang]', 'tr');
    await p.waitForFunction(() => document.documentElement.dir === 'ltr');
    await shot(p, '08-tuerkisch');
    await p.selectOption('select[data-change=lang]', 'de');
    await p.waitForFunction(() => document.documentElement.lang === 'de' && !/[\u0600-\u06FF]/.test(document.querySelector('main')?.textContent || ''), null, { timeout: 15000 });
  });

  await step('Fritteuse gesperrt ohne Qualifikation', async () => {
    await p.locator('text=Brauchen Schulung/Freigabe').waitFor();
    await p.locator('li', { hasText: 'Fritteuse bereit machen' }).waitFor();
  });

  await step('Academy: Sprache wählen, Schritte, Prüfung gesperrt, Bildfrage, Ergebnis', async () => {
    await p.click('a.tab[href="#/learn"]');
    await p.locator('a.course', { hasText: 'Hochdruckfritteuse' }).click();
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
    await nav(p, '#/goods');
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
    await nav(p, '#/oil');
    await p.locator('.fryer').first().waitFor();
    await shot(p, '15-oelmanager');
    // Ohne praktische Freigabe gesperrt
    const f0 = p.locator('form[data-submit=oil]').first();
    await f0.locator('input[name=tpm]').fill('15');
    await f0.locator('input[data-change=photo]').setInputFiles(photoPath);
    await f0.locator('.photo-field.ready').waitFor();
    await f0.locator('button[value=tpm]').click();
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

  await step('Zugänge: Leitung legt Konto an, Einladungscode, Mitarbeiter setzt eigenes Passwort', async () => {
    await m.click('a[href="#/manage/staff"]');
    await m.fill('form[data-submit=staff-new] input[name=display_name]', 'Neuer Mitarbeiter (fiktiv)');
    await m.fill('form[data-submit=staff-new] input[name=username]', 'neu.e2e');
    await m.click('form[data-submit=staff-new] button');
    const code = (await m.locator('.invite-code').innerText()).trim();
    assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    await shot(m, '48-zugang-einladungscode');
    const n = await newPage();
    await n.goto(D + '/');
    await n.locator('summary', { hasText: 'Einladungscode' }).click();
    await n.fill('form[data-submit=redeem] input[name=code]', code);
    await n.fill('form[data-submit=redeem] input[name=password]', 'mein-sicheres-pw-1');
    await n.fill('form[data-submit=redeem] input[name=password2]', 'mein-sicheres-pw-1');
    await n.click('form[data-submit=redeem] button');
    await n.locator('h1', { hasText: 'Willkommen' }).waitFor();
    await n.selectOption('form[data-submit=certificate] select[name=type]', 'ifsg43');
    await n.fill('form[data-submit=certificate] input[name=issued_on]', '2026-11-01');
    await n.setInputFiles('form[data-submit=certificate] input[data-change=photo]', photoPath);
    await n.locator('form[data-submit=certificate] .photo-field.ready').waitFor();
    await n.click('form[data-submit=certificate] button.primary');
    await n.locator('.flash.ok', { hasText: 'Nachweis gesendet' }).waitFor();
    await shotFull(n, '49-willkommen-nachweise');
  });

  await step('Nachweise: Leitung prüft und bestätigt §43-Belehrung', async () => {
    await m.click('a[href="#/manage/certs"]');
    const f = m.locator('form[data-submit=cert-review]', { hasText: 'Neuer Mitarbeiter' });
    await f.waitFor();
    await shotFull(m, '50-nachweise-pruefen');
    await f.locator('button[value=approved]').click();
    await m.locator('.flash.ok').waitFor();
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


  // --- Stationen, Positionsplan, Stationscheck, Timer ---
  const sl = await newPage();
  await step('Schichtführer: Positionsplan nur mit freigegebenen Personen', async () => {
    await sl.goto(D + '/');
    await sl.click('[data-persona=shift_lead_halle]');
    await sl.click('a[href="#/manage/positions"]');
    await sl.locator('.plan-station').first().waitFor();
    const theke = sl.locator('.plan-station', { hasText: 'Kasse & Theke' });
    await theke.locator('select[name=user_id]').selectOption({ label: '✓ Demo Mitarbeiter A (fiktiv)' });
    await theke.locator('form[data-submit=plan-add] button').click();
    await sl.locator('.plan-station', { hasText: 'Kasse & Theke' }).locator('li', { hasText: 'Mitarbeiter A' }).waitFor();
    const pommes = sl.locator('.plan-station', { hasText: 'Pommes-Fritteuse' });
    await pommes.locator('select[name=user_id]').selectOption({ label: '○ Demo Mitarbeiter A (fiktiv)' });
    await pommes.locator('form[data-submit=plan-add] button').click();
    await sl.locator('.plan-station', { hasText: 'Pommes-Fritteuse' }).locator('li', { hasText: 'Mitarbeiter A' }).waitFor();
    await sl.click('button[data-action=plan-save]');
    await sl.locator('.flash.error', { hasText: 'nicht freigegeben' }).waitFor();
    await sl.locator('.plan-station', { hasText: 'Pommes-Fritteuse' }).locator('button[data-action=plan-remove]').click();
    await sl.locator('.plan-station', { hasText: 'Pommes-Fritteuse' }).locator('li', { hasText: 'Mitarbeiter A' }).waitFor({ state: 'detached' });
    const pom2 = sl.locator('.plan-station', { hasText: 'Pommes-Fritteuse' });
    await pom2.locator('select[name=user_id]').selectOption({ label: '✓ Demo Schichtführer Halle (fiktiv)' });
    await pom2.locator('form[data-submit=plan-add] button').click();
    await sl.locator('.plan-station', { hasText: 'Pommes-Fritteuse' }).locator('li', { hasText: 'Schichtführer' }).waitFor();
    await sl.click('button[data-action=plan-save]');
    await sl.locator('.flash.ok', { hasText: 'Positionsplan gespeichert' }).waitFor();
    await shotFull(sl, '26-positionsplan');
  });

  await step('Mitarbeiter: eigene Station oben, Aufgaben nach Station strukturiert', async () => {
    await p.click('a.tab[href="#/learn"]');
    await p.click('a.tab[href="#/shift"]');
    await p.click('button[data-shift=open]');
    await p.locator('.station-head', { hasText: 'Kasse & Theke' }).waitFor();
    await p.locator('.groups .group').first().waitFor();
    await shot(p, '27-meine-station-aufgaben');
  });

  const tr2 = await newPage();
  await step('Trainer: Stationscheck – kritischer Punkt nicht erfüllt, dann bestanden', async () => {
    await tr2.goto(D + '/');
    await tr2.click('[data-persona=trainer]');
    await tr2.click('a[href="#/manage/observe"]');
    await tr2.selectOption('select[data-change=observe-station]', { label: 'Burger & Wraps' });
    await tr2.locator('form[data-submit=observe]').waitFor();
    const fill = async (failCritical) => {
      await tr2.selectOption('form[data-submit=observe] select[name=user_id]', { label: 'Demo Mitarbeiter A (fiktiv)' });
      const items = tr2.locator('.checklist li');
      const n = await items.count();
      for (let i = 0; i < n; i++) {
        const li = items.nth(i);
        const crit = (await li.getAttribute('class'))?.includes('critical');
        await li.locator(failCritical && crit && i === 0 ? 'label.no' : 'label.yes').click();
      }
    };
    await fill(true);
    await shotFull(tr2, '28-stationscheck');
    await tr2.click('form[data-submit=observe] button.primary');
    await tr2.locator('.flash.error', { hasText: 'Nicht bestanden' }).waitFor();
    await fill(false);
    await tr2.click('form[data-submit=observe] button.primary');
    await tr2.locator('.flash.ok', { hasText: 'Bestanden' }).waitFor();
    await tr2.click('a[href="#/manage/stations"]');
    await tr2.locator('.matrix').waitFor();
    await shotFull(tr2, '29-stationen-stufen');
  });

  await step('Mitarbeiter: Stufe und Stationen in „Lernen“', async () => {
    await p.click('a.tab[href="#/learn"]');
    await p.locator('.level-card').waitFor();
    await shot(p, '30-stufe-stationen');
  });

  await step('Timer: Haltezeit starten, Ablauf → nur Entsorgen', async () => {
    await p.click('a.tab[href="#/timer"]');
    await p.locator('.product', { hasText: 'Burger-Filet' }).locator('button[data-kind=hold]').click();
    await p.locator('.timer', { hasText: 'Burger-Filet' }).waitFor();
    await p.locator('.product', { hasText: 'DEMO Test-Timer' }).locator('button[data-kind=hold]').click();
    await p.locator('.timer', { hasText: 'DEMO Test-Timer' }).waitFor();
    await shot(p, '31-timer-laeuft');
    await p.locator('.timer.expired', { hasText: 'DEMO Test-Timer' }).waitFor({ timeout: 75000 });
    assert.equal(await p.locator('.timer.expired button[data-end=done]').isDisabled(), true);
    await shot(p, '32-timer-abgelaufen');
    await p.locator('.timer.expired button[data-end=discarded]').click();
    await p.locator('.flash.ok').waitFor();
    assert.equal(await p.locator('.timer', { hasText: 'DEMO Test-Timer' }).count(), 0);
  });

  await step('Leitung: Haltezeiten nur mit Quelle', async () => {
    await m.click('a[href="#/manage/products"]');
    const f = m.locator('form[data-submit=product]').first();
    await f.locator('input[name=value_source]').fill('');
    await f.locator('button').click();
    await m.locator('.flash.error', { hasText: 'Quelle' }).waitFor();
    await shot(m, '33-haltezeiten');
  });

  await step('Wöchentliche Inventur: Erinnerung, unvollständig abgelehnt, vollständig abgeschlossen', async () => {
    await sl.click('a[href="#/manage/dashboard"]');
    await sl.locator('.stat', { hasText: 'Inventur 20' }).waitFor();
    await sl.locator('li', { hasText: 'Inventur' }).first().waitFor(); // automatische Erinnerung in den Benachrichtigungen
    await sl.locator('.stat', { hasText: 'Inventur 20' }).locator('a').click();
    await sl.locator('form[data-submit=inventory]').waitFor();
    const inputs = sl.locator('form[data-submit=inventory] input[type=number]');
    const n = await inputs.count();
    await inputs.nth(0).fill('20');
    await sl.click('button[value=submit]');
    await sl.locator('.flash.error', { hasText: 'Noch nicht gezählt' }).waitFor();
    for (let i = 1; i < n; i++) await inputs.nth(i).fill(String(10 + i));
    await shotFull(sl, '34-inventur');
    await sl.click('button[value=submit]');
    await sl.locator('.flash.ok', { hasText: 'Inventur' }).waitFor();
    await sl.locator('.inv-head .badge', { hasText: 'Erledigt' }).waitFor();
  });

  await step('Mitarbeiter: offene Pflichtschulungen werden auf der Aufgabenseite erinnert', async () => {
    await p.click('a.tab[href="#/shift"]');
    await p.locator('.banner-card', { hasText: 'Offene Pflichtschulungen' }).waitFor();
    await shot(p, '35-erinnerung-schulung');
  });

  await step('Tagesinventur Frühschicht: vollständig ausfüllen, Abgabe mit Zeit und Name', async () => {
    await nav(p, '#/goods');
    await p.click('a[href="#/daily/early"]');
    await p.locator('form[data-submit=daily]').waitFor();
    await p.click('button[value=submit]');
    await p.locator('.flash.error', { hasText: 'Noch nicht eingetragen' }).waitFor();
    const inputs = p.locator('form[data-submit=daily] input[name^=c]');
    const n = await inputs.count();
    for (let i = 0; i < n; i++) await inputs.nth(i).fill(String(5 + i));
    await p.locator('form[data-submit=daily] .meat input[name^=m]').first().fill('3');
    await shotFull(p, '36-tagesinventur');
    await p.click('button[value=submit]');
    await p.locator('.flash', { hasText: 'Tagesinventur' }).waitFor();
    await p.locator('.inv-head .badge', { hasText: 'Demo Mitarbeiter A' }).waitFor();
  });

  await step('Schädlingskontrolle: 10 Bereiche, Befund mit Foto wird an Leitung gemeldet', async () => {
    await nav(p, '#/goods');
    await p.click('a[href="#/pest"]');
    await p.locator('form[data-submit=pest]').waitFor();
    const areas = p.locator('.pest-area');
    assert.equal(await areas.count(), 10);
    for (let i = 0; i < 10; i++) await areas.nth(i).locator(i === 1 ? 'label.no' : 'label.yes').click();
    await areas.nth(1).locator('input[name=n1]').fill('Angenagte Verpackung im Regal');
    await areas.nth(1).locator('input[name=m1]').fill('Ware aussortiert, Leitung informiert');
    await p.setInputFiles('form[data-submit=pest] input[data-change=photo]', photoPath);
    await p.locator('form[data-submit=pest] .photo-field.ready').waitFor();
    await shotFull(p, '37-schaedlingskontrolle');
    await p.click('form[data-submit=pest] button.primary');
    await p.locator('.flash.error', { hasText: 'Befall gemeldet' }).waitFor();
  });

  await step('Handbuch: Trainer trägt Einweisung ein, Mitarbeiter bestätigt', async () => {
    await tr2.click('a[href="#/manage/onboarding"]');
    const f = tr2.locator('form[data-submit=onboarding-trainer]', { hasText: 'Demo Mitarbeiter A' });
    for (const a of ['Persönliche Hygiene', 'HACCP', 'Fleischinventur', 'Reinigung']) await f.locator(`input[value="${a}"]`).check();
    await f.locator('button').click();
    await tr2.locator('.flash.ok', { hasText: 'Einweisung eingetragen' }).waitFor();
    await p.click('a.tab[href="#/learn"]');
    await p.click('a[href="#/handbook"]');
    await p.locator('details.chapter').first().click();
    await p.click('button[data-action=onboarding-confirm]');
    await p.locator('.banner.ok', { hasText: 'Bestätigt' }).waitFor();
    await shotFull(p, '38-handbuch');
  });

  await step('Leitung: Tagesinventur-Übersicht – wer hat rechtzeitig abgegeben', async () => {
    await m.click('a[href="#/manage/daily"]');
    await m.locator('td', { hasText: 'Demo Mitarbeiter A' }).first().waitFor();
    await shotFull(m, '39-tagesinventur-leitung');
  });

  await step('Marinieren: feste Rezeptur, Mengen berechnet, Charge mit Etikett', async () => {
    await nav(p, '#/goods');
    await p.click('a[href="#/marinade"]');
    await p.locator('form[data-submit=batch]').waitFor();
    await p.fill('input[name=meat_kg]', '4');
    await p.press('input[name=meat_kg]', 'Tab');
    await p.locator('td', { hasText: '200 g' }).waitFor();
    await p.fill('input[name=a0]', '200'); await p.fill('input[name=a1]', '80'); await p.fill('input[name=a2]', '400');
    await shotFull(p, '40-marinieren');
    await p.click('form[data-submit=batch] button.primary');
    await p.locator('.ok-card .label-card', { hasText: 'MAR-HAL-' }).waitFor();
    await shot(p, '41-marinade-etikett');
  });

  await step('Reinigungsplan: eigener Menüpunkt mit Status, Verantwortlichem, „nach Benutzung“', async () => {
    await p.click('a.tab[href="#/cleaning"]');
    await p.locator('.clean-list').first().waitFor();
    await p.locator('.event-grid button').first().click();
    await p.locator('.flash.ok').waitFor();
    const startBtn = p.locator('.clean-row', { hasText: 'Küche reinigen' }).locator('button[data-action=task-start]');
    await startBtn.click();
    await p.locator('.clean-row.st-in_progress').first().waitFor();
    await shot(p, '43-reinigungsplan');
  });

  await step('Persönliche Aufgaben: Schichtführer teilt ein, Mitarbeiter sieht nur seine Aufgaben', async () => {
    await sl.click('a.tab[href="#/manage"]');
    await sl.click('a[href="#/manage/staffing"]');
    await sl.locator('a.seg[href="#/manage/staffing/close"]').click();
    const row = sl.locator('tr', { hasText: 'Demo Mitarbeiter A' });
    await row.locator('button[data-status=present]').click();
    await sl.locator('.flash.ok', { hasText: 'neu verteilt' }).waitFor();
    await sl.locator('tr', { hasText: 'Demo Schichtführer' }).locator('button[data-status=present]').click();
    await sl.locator('.flash.ok', { hasText: 'neu verteilt' }).waitFor();
    await shotFull(sl, '44-besetzung-verteilung');
    await p.click('a.tab[href="#/shift"]');
    await p.click('button[data-shift=close]');
    await p.locator('.personal-head', { hasText: 'Meine Aufgaben' }).waitFor();
    await shot(p, '45-meine-aufgaben');
  });

  await step('Öl: tägliche Prüfung „nicht zulässig“ sperrt Fritteuse, Wechsel hebt Sperre auf', async () => {
    await nav(p, '#/oil');
    const f0 = p.locator('form[data-submit=oil]').first();
    await f0.locator('input[name=tpm]').fill('11');
    await f0.locator('input[name=temperature]').fill('170');
    await f0.locator('label.no').click();
    await f0.locator('input[data-change=photo]').setInputFiles(photoPath);
    await f0.locator('.photo-field.ready').waitFor();
    await f0.locator('button[value=tpm]').click();
    await p.locator('.banner.danger', { hasText: 'GESPERRT' }).waitFor();
    await shot(p, '46-fritteuse-gesperrt');
    const ch = p.locator('form[data-submit=oil-change]').first();
    await ch.locator('input[name=quantity_l]').fill('25');
    await ch.locator('button').last().click();
    await p.locator('.flash.ok').waitFor();
    assert.equal(await p.locator('.banner.danger', { hasText: 'GESPERRT' }).count(), 0);
    await p.locator('.fryer', { hasText: 'Nächster Ölwechsel' }).first().waitFor();
  });

  await step('Wochenbericht je Filiale', async () => {
    await sl.click('a[href="#/manage/week"]');
    await sl.locator('h1', { hasText: 'Wochenbericht' }).waitFor();
    await shotFull(sl, '47-wochenbericht');
  });

  await step('Schulungsbereiche: 10 Bereiche × 3 Stufen, Stufe 2 gesperrt', async () => {
    await nav(p, '#/train');
    await p.locator('.area').first().waitFor();
    assert.equal(await p.locator('.area').count(), 10);
    assert.equal(await p.locator('.area').first().locator('.level-pill').count(), 3);
    await shotFull(p, '51-schulungsbereiche');
  });

  await step('Schulung: Lernschritte, Prüfung mit gemischten Fragen, Ergebnis mit Erklärungen', async () => {
    await p.locator('.area').first().locator('.level-pill').first().click();
    await p.locator('button[data-action=train-start]').waitFor();
    await shotFull(p, '52-schulung-stufe');
    await p.click('button[data-action=train-start]');
    await p.locator('form[data-submit=train-exam] fieldset').first().waitFor();
    const n = await p.locator('form[data-submit=train-exam] fieldset').count();
    assert.equal(n, 20);
    await shot(p, '53-schulung-pruefung');
    for (let i = 0; i < n; i++) await p.locator(`input[name=q${i}]`).first().check();
    await p.click('form[data-submit=train-exam] button.primary');
    await p.locator('.exam-result').waitFor();
    await shotFull(p, '54-schulung-ergebnis');
  });

  await step('Hilfe „Wie mache ich das?“ – Suche in Schulung, Handbuch, Anleitungen', async () => {
    await nav(p, '#/help');
    await p.fill('form[data-submit=help] input[name=q]', 'Öl filtern');
    await p.click('form[data-submit=help] button');
    await p.locator('.course-list .course').first().waitFor();
    await shotFull(p, '55-hilfe-suche');
  });

  await step('Kontrollliste: Mitarbeiter trägt Ist-Mengen ein (0 gültig) und schließt ab', async () => {
    await nav(p, '#/controls');
    const link = p.locator('a.course:not(:has-text("Mariniertes"))').first();
    await link.waitFor();
    await shot(p, '57-meine-kontrollen');
    await link.click();
    await p.locator('form[data-submit=control]').waitFor();
    const inputs = p.locator('form[data-submit=control] input[type=number]');
    const n = await inputs.count();
    for (let i = 0; i < n; i++) await inputs.nth(i).fill(i === 0 ? '0' : '100');
    await shotFull(p, '58-kontrollliste-ausfuellen');
    await p.click('form[data-submit=control] button.primary');
    await p.locator('.flash').waitFor();
    assert.match(await p.locator('.flash').innerText(), /Gespeichert/);
  });

  await step('Zusatzkontrolle Saucen jederzeit: Unterbestand wird sofort gemeldet', async () => {
    await nav(p, '#/controls');
    await p.locator('button[data-action=ctl-extra]', { hasText: 'Regal 2' }).click();
    await p.locator('form[data-submit=control]').waitFor();
    const inputs = p.locator('form[data-submit=control] input[type=number]');
    const n = await inputs.count();
    for (let i = 0; i < n; i++) await inputs.nth(i).fill(i === 0 ? '9' : '20');
    await p.click('form[data-submit=control] button.primary');
    await p.locator('.flash.warn').waitFor();
    await shot(p, '61-unterbestand-gemeldet');
  });

  await step('Kontrollliste mariniertes Fleisch auf Arabisch (RTL)', async () => {
    await p.selectOption('select[data-change=lang]', 'ar').catch(() => {});
    await nav(p, '#/controls');
    await p.locator('button[data-action=ctl-extra]', { hasText: 'Mariniertes' }).click();
    await p.locator('form[data-submit=control] input[name=temperature]').waitFor();
    assert.equal(await p.evaluate(() => document.documentElement.dir), 'rtl');
    await shotFull(p, '59-mariniert-arabisch');
    await p.selectOption('select[data-change=lang]', 'de').catch(() => {});
  });
  assert.deepEqual(p.errors.concat(sl.errors, tr2.errors), [], 'JavaScript-Fehler: ' + p.errors.concat(sl.errors, tr2.errors).join('; '));

  const a = await newPage();
  await step('Admin: Anleitung (SOP) mit Prüfstatus und Versionen', async () => {
    await a.goto(D + '/');
    await a.click('[data-persona=admin]');
    await a.click('a[href="#/manage/sops"]');
    await a.locator('select[data-change=sop-review]').first().waitFor();
    await shotFull(a, '23-admin-sop');
    await a.click('a[href="#/manage/recipes"]');
    await a.locator('h2', { hasText: 'DEMO Marinade' }).waitFor();
    await a.click('a[href="#/manage/recipes/neu"]');
    await a.locator('form[data-submit=recipe]').waitFor();
    await shotFull(a, '42-rezeptur-bearbeiten');
  });

  await step('Nachbestellliste je Lieferant, Bestellung erfassen, Lieferung mit Bestandsbestätigung', async () => {
    await nav(a, '#/manage/controls');
    await a.locator('.alert-row').first().waitFor();
    await shotFull(a, '62-bestandsalarme');
    await nav(a, '#/manage/reorder');
    const f = a.locator('form[data-submit=order]').first();
    await f.waitFor();
    await shotFull(a, '63-nachbestellliste');
    await f.locator('button').click();
    await a.locator('.flash.ok', { hasText: 'Bestellung erfasst' }).waitFor();
    await nav(a, '#/receive');
    const r = a.locator('form[data-submit=receive]').first();
    await r.waitFor();
    await r.locator('input[name=qty]').fill('5');
    await r.locator('input[name=stock_after]').fill('14');
    await shot(a, '64-lieferung-annehmen');
    await r.locator('button').click();
    await a.locator('.flash.ok').waitFor();
    await nav(a, '#/manage/dashboard');
  });

  await step('Leitung: Kontrolllisten – Tagesübersicht, Unterbestand, Mindestwerte, Intervalle', async () => {
    await a.click('a[href="#/manage/controls"]');
    await a.locator('h2', { hasText: 'Unter Mindestbestand' }).waitFor();
    await shotFull(a, '60-leitung-kontrolllisten');
  });

  await step('Betreiber: Schulungsbereiche – Übersicht, Fragenpool, Inhalte und Fragen bearbeiten', async () => {
    await a.click('a[href="#/manage/academy"]');
    await a.locator('h2', { hasText: 'Fragenpool' }).waitFor();
    await a.locator('a[href^="#/manage/academy/"]').nth(1).click();
    await a.locator('form[data-submit=train-module]').waitFor();
    await shotFull(a, '56-schulung-bearbeiten');
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
