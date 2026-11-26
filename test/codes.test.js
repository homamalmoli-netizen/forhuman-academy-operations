import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCode, gs1CheckDigitValid } from '../shared/codes.js';

test('GS1-Prüfziffer: gültige und ungültige EAN-13', () => {
  assert.equal(gs1CheckDigitValid('4006381333931'), true); // bekanntes Beispiel aus der GS1-Dokumentation
  assert.equal(gs1CheckDigitValid('4006381333932'), false);
  assert.equal(gs1CheckDigitValid('96385074'), true); // EAN-8 Beispiel
});

test('EAN-13 wird als GTIN erkannt und auf 14 Stellen normalisiert', () => {
  const r = classifyCode('4006381333931');
  assert.equal(r.kind, 'gtin');
  assert.equal(r.gtin, '04006381333931');
});

test('Falsche Prüfziffer ist kein GTIN (unbekannt, keine Schätzung)', () => {
  assert.equal(classifyCode('4006381333932').kind, 'unknown');
  assert.equal(classifyCode('123456').kind, 'unknown');
});

test('GS1-Elementstring mit Charge und MHD', () => {
  const r = classifyCode('(01)04006381333931(17)261231(10)LOT42');
  assert.equal(r.kind, 'gtin');
  assert.equal(r.gtin, '04006381333931');
  assert.equal(r.batch, 'LOT42');
  assert.equal(r.bestBefore, '2026-12-31');
  const raw = classifyCode('01040063813339311726120010ABC');
  assert.equal(raw.gtin, '04006381333931');
  assert.equal(raw.bestBefore, '2026-12-31'); // Tag 00 = Monatsende
  assert.equal(raw.batch, 'ABC');
});

test('QR-Link: vertrauenswürdig nur bei https und erlaubter Domain', () => {
  assert.equal(classifyCode('https://www.metro.de/produkt/123').trusted, true);
  assert.equal(classifyCode('http://www.metro.de/produkt/123').trusted, false);
  assert.equal(classifyCode('https://metro.de.boese.example/x').trusted, false);
  assert.equal(classifyCode('https://evilmetro.de/x').trusted, false);
});

test('GS1 Digital Link liefert GTIN aus der URL', () => {
  const r = classifyCode('https://id.example.com/01/04006381333931/10/ABC?17=270131');
  assert.equal(r.kind, 'url');
  assert.equal(r.gtin, '04006381333931');
  assert.equal(r.batch, 'ABC');
  assert.equal(r.bestBefore, '2027-01-31');
  assert.equal(r.trusted, false);
});
