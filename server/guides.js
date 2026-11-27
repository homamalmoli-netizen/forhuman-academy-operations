// Anleitungen je Arbeitsbereich (als gesperrte Entwürfe) und Reinigungsmittel-Stamm (Issue #20).
// Keine erfundenen Dosierungen, Einwirkzeiten, Temperaturen oder Geräteabläufe: Diese Felder bleiben leer, bis der Betreiber
// sie aus Etikett, Sicherheitsdatenblatt bzw. Herstellerangabe einträgt und freigibt. Mitarbeiter sehen nur Freigegebenes.
import { tx, audit } from './db.js';

const S = (text, icon = 'check') => ({ text, icon });
const OPEN = S('Fotos, Videos und filialspezifische Werte folgen – Entwurf, erst nach Freigabe durch den Betreiber sichtbar.', 'warn');
export const AREA_GUIDES = [
  ['bereich-fleisch-annahme', 'Fleisch', 'shield', 'Fleisch annehmen, prüfen und lagern', ['Lieferschein, Verpackung und Haltbarkeit prüfen.', 'Temperatur nach HACCP-Plan messen und eintragen.', 'Sofort in die Kühlung: unten, abgedeckt, getrennt von verzehrfertiger Ware.', 'Bei Abweichung: nicht annehmen bzw. sperren, Foto, Leitung informieren.']],
  ['bereich-marinieren', 'Fleisch', 'prep', 'Marinieren', ['Nur nach freigegebener Rezeptur im Marinierprotokoll.', 'Rohware-Seite getrennt halten, Handschuhe und Werkzeug nach Vorgabe.', 'Charge im Protokoll eintragen, Behälter beschriften.', 'Gekühlt lagern; Verbrauchsfrist laut freigegebenem Plan.']],
  ['bereich-fritteuse', 'Küche', 'fryer', 'Fritteuse bedienen', ['Schutzkleidung nach Vorgabe.', 'Programm und Garzeit nur laut Herstelleranleitung bzw. freigegebener Anleitung.', 'Gesperrte Fritteuse nicht benutzen.', 'Fertige Ware prüfen und Timer starten.']],
  ['bereich-oel-filter', 'Geräte', 'oil', 'Öl prüfen, filtern und wechseln', ['Ölprüfung täglich eintragen (echter Messwert).', 'Filtern und Wechsel nur laut Herstelleranleitung, mit Schutzkleidung.', 'Kein Wasser an heißes Öl.', 'Wechsel mit Grund in der App erfassen.']],
  ['bereich-pommes', 'Küche', 'fryer', 'Pommes zubereiten', ['Gekühlte bzw. TK-Pommes nach Etikett lagern.', 'Menge nach Bedarf und Warmhalte-Timer.', 'Programm laut freigegebener Anleitung.', 'Abgelaufene Haltezeit: nach Vorgabe entsorgen und erfassen.']],
  ['bereich-burger-wraps', 'Küche', 'prep', 'Burger und Wraps bauen', ['Nach freigegebener Bauanleitung (Foto) bauen.', 'Allergen-Bestellungen nach Allergen-Ablauf.', 'Saubere Hände bzw. Handschuhe.', 'Sofort verpacken und weitergeben.']],
  ['bereich-verpackung', 'Ausgabe', 'box', 'Verpacken', ['Warm und kalt getrennt.', 'Bestellung mit Bon vergleichen.', 'Saubere, passende Verpackung.', 'Allergen-Bestellungen kennzeichnen.']],
  ['bereich-ausgabe', 'Ausgabe', 'store', 'Ausgabe an Gäste und Fahrer', ['Nummer bzw. Plattform prüfen.', 'Vollständigkeit prüfen.', 'Freundlich übergeben.', 'Fehler sofort melden und lösen.']],
  ['bereich-reinigung', 'Reinigung', 'spray', 'Reinigen und desinfizieren', ['Nach Reinigungsplan: grob reinigen, waschen, spülen, desinfizieren.', 'Mittel nur laut freigegebenem Reinigungsmittel-Eintrag (Dosierung, Einwirkzeit, Schutzausrüstung).', 'Nie Mittel mischen.', 'Nur Erledigtes bestätigen.']],
  ['bereich-lager', 'Lager', 'box', 'Lager ordnen (FIFO/FEFO)', ['Zuerst rein, zuerst raus bzw. zuerst ablaufend, zuerst raus.', 'Nichts auf dem Boden, Chemie getrennt.', 'Beschriften und abdecken.', 'Kühltüren sofort schließen.']],
  ['bereich-kontrolllisten', 'Lager', 'box', 'Inventur und Kontrolllisten', ['Zählen, was wirklich da ist.', 'Kein Feld leer lassen – 0 ist gültig.', 'Unter Mindestwert: wird sofort gemeldet.', 'Unklare Mengen melden statt raten.']],
  ['bereich-kuehlung', 'HACCP', 'shield', 'Kühlgeräte und Temperaturen', ['Temperaturen nach Plan messen und eintragen.', 'Grenzwerte laut HACCP-Plan.', 'Abweichung: Leitung informieren, Korrekturmaßnahme nach Plan.', 'Türen geschlossen halten, Dichtungen sauber.']],
  ['bereich-notfall', 'Sicherheit', 'warn', 'Notfall und Problem melden', ['Bei Gefahr: Menschen zuerst, Notruf 112.', 'Notfallplan der Filiale befolgen.', 'Problem in der App melden, Foto.', 'Leitung informieren.']],
];

// Reinigungsmittel aus den Betreiberangaben – alle fachlichen Felder offen.
export const CLEANING_PRODUCTS = [
  ['aro Vollglanz Bodenreiniger 5 L', 'METRO (Eigenmarke aro)'], ['METRO PROFESSIONAL Fettlöser 750 ml', 'METRO'],
  ['METRO PROFESSIONAL Fettlöser Konzentrat 5 L', 'METRO'], ['METRO PROFESSIONAL Handspülmittel 5 L', 'METRO'],
  ['Dr. Becher Fritteusen-Reiniger Tabs', 'Dr. Becher'], ['Edelstahlreiniger METRO', 'METRO'], ['Glasreiniger', null], ['Desinfektionsmittel', null],
];

export function seedGuides(db) {
  tx(db, () => {
    const insS = db.prepare("INSERT OR IGNORE INTO sops (code, category, icon, safety_review) VALUES (?,?,?,'pending')");
    for (const [code, cat, icon, title, steps] of AREA_GUIDES) {
      insS.run(code, cat, icon);
      const sid = db.prepare('SELECT id FROM sops WHERE code = ?').get(code).id;
      if (db.prepare('SELECT 1 FROM sop_versions WHERE sop_id = ?').get(sid)) continue;
      const content = { de: { title, steps: [...steps.map((t) => S(t)), OPEN] } };
      db.prepare("INSERT INTO sop_versions (sop_id, version_no, status, content, reviewed_langs) VALUES (?, 1, 'draft', ?, 'de')").run(sid, JSON.stringify(content));
    }
    const insP = db.prepare('INSERT INTO cleaning_products (name, manufacturer) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM cleaning_products WHERE name = ?)');
    for (const [n, m] of CLEANING_PRODUCTS) insP.run(n, m, n);
  });
}

const FIELDS = ['name', 'manufacturer', 'product_url', 'article_no', 'application', 'dosage', 'contact_time', 'ppe', 'material_notes', 'sds_url', 'sop_code'];
const REQUIRED_FOR_APPROVAL = ['application', 'dosage', 'contact_time', 'ppe'];

export function registerGuides({ route, db, needUser, needBranch, needAdmin, HttpError, bad, notFound }) {
  route('GET', '/api/cleaning-products', (ctx) => {
    const u = needUser(ctx);
    if (u.is_admin) return db.prepare('SELECT * FROM cleaning_products ORDER BY status, name').all();
    needBranch(ctx, ctx.query.get('branch'));
    return db.prepare("SELECT * FROM cleaning_products WHERE status = 'approved' ORDER BY name").all();
  });

  route('POST', '/api/cleaning-products', (ctx) => {
    const a = needAdmin(ctx);
    const name = String(ctx.body.name || '').trim().slice(0, 120);
    if (!name) throw bad('name');
    const id = Number(db.prepare('INSERT INTO cleaning_products (name, manufacturer) VALUES (?,?)').run(name, String(ctx.body.manufacturer || '').trim().slice(0, 80) || null).lastInsertRowid);
    audit(db, { actor: a.id, action: 'cleaning_product_new', entity: 'cleaning_product', id });
    return { id };
  });

  // Jede Änderung setzt den Eintrag zurück auf Entwurf – Freigabe erneut nötig
  route('PUT', '/api/cleaning-products/:id', (ctx) => {
    const a = needAdmin(ctx);
    const p = db.prepare('SELECT * FROM cleaning_products WHERE id = ?').get(Number(ctx.params.id)); if (!p) throw notFound();
    const v = {};
    for (const f of FIELDS) v[f] = ctx.body[f] === undefined ? p[f] : (String(ctx.body[f]).trim().slice(0, f === 'application' || f === 'material_notes' ? 600 : 200) || null);
    for (const f of ['product_url', 'sds_url']) if (v[f] && !/^https:\/\/\S+$/.test(v[f])) throw bad(f, 'Nur https-Links');
    if (!v.name) throw bad('name');
    db.prepare(`UPDATE cleaning_products SET ${FIELDS.map((f) => `${f} = ?`).join(', ')}, status = 'draft', approved_by = NULL, approved_at = NULL WHERE id = ?`).run(...FIELDS.map((f) => v[f]), p.id);
    audit(db, { actor: a.id, action: 'cleaning_product_edit', entity: 'cleaning_product', id: p.id });
    return { ok: true };
  });

  route('POST', '/api/cleaning-products/:id/approve', (ctx) => {
    const a = needAdmin(ctx);
    const p = db.prepare('SELECT * FROM cleaning_products WHERE id = ?').get(Number(ctx.params.id)); if (!p) throw notFound();
    const missing = REQUIRED_FOR_APPROVAL.filter((f) => !p[f]);
    if (!p.sds_url) missing.push('sds_url');
    if (missing.length) throw new HttpError(409, 'incomplete', `Für die Freigabe fehlen: ${missing.join(', ')} (aus Etikett bzw. Sicherheitsdatenblatt)`);
    db.prepare("UPDATE cleaning_products SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?").run(a.id, new Date().toISOString(), p.id);
    audit(db, { actor: a.id, action: 'cleaning_product_approve', entity: 'cleaning_product', id: p.id });
    return { ok: true };
  });
}
