// Periodische Bestands-Kontrolllisten (Issue #20, Nachtrag des Betreibers): einfache Ist-Mengen-Kontrolle als persönliche
// Aufgabe – keine Warenwirtschaft, keine Buchungen, keine Preise, keine automatischen Bestellungen, keine POS-Anbindung.
// Intervalle je Filiale: täglich, wöchentlich (Wochentag) oder alle N Kalendertage ab Startdatum; ein oder mehrere Fälligkeitszeiten.
// Erinnerungen/Eskalation serverseitig relativ zur Fälligkeit (Standard −10 / 0 / +5 Mitarbeiter, +10 Filialleitung).
// Kein Telefonanruf (Entscheidung des Betreibers); externe Kanäle nur, wenn eingerichtet.
import { tx, audit } from './db.js';
import { berlinDate } from './app.js';
import { evaluateStock, escalateZeroAlerts } from './stock.js';

// Artikel aus den Betreiberlisten und Produktfotos (Issue #20). min: null = Mindestwert offen (nicht erfunden).
// unit 'offen' = Einheit noch zu klären. o: { sup: Lieferant, crit: zeitkritisch, urgent: zusätzliche dringende Schwelle,
// art: verifizierte Artikelnummer (nur vom Etikett/Foto), pack: Gebinde laut Etikett }.
const SAUCE = { crit: 1 };
export const CONTROL_LISTS = [
  { code: 'regal1', name: 'Regal 1 (Marinaden, Panade, Gewürz, Öl)', schedule: 'weekly', weekday: 1, due: '17:10', items: [
    ['Milde Marinade', 'Tüten', 50, { crit: 1 }], ['Pikante Marinade (Hot)', 'Tüten', 50, { crit: 1 }], ['Panda Panade (Mehl)', 'kg', 50],
    ['Pommesgewürz', 'Tüten', 3], ['aro Frittieröl 10 L', 'Kanister', null, { pack: '10 L' }]] },
  { code: 'regal2', name: 'Regal 2 (Saucen)', schedule: 'weekly', weekday: 1, due: '17:10', items: [
    ['Knoblauch Sauce', 'Flaschen', 10, SAUCE], ['BBQ Sauce', 'Flaschen', 10, SAUCE], ['Mayo', 'Flaschen', 10, SAUCE], ['Ketchup', 'Flaschen', 10, SAUCE],
    ['Remoulade', 'Flaschen', 10, SAUCE], ['Mexikanische Sauce', 'Flaschen', 10, SAUCE], ['Cheese Sauce', 'Flaschen', 10, SAUCE],
    ['SALOMON FoodWorld Chili Cheese Burger Sauce', 'Flaschen', 10, { crit: 1, pack: '2 L' }],
    ['Smoky Sauce', 'Flaschen', 5, { crit: 1, sup: 'METRO' }], ['Sweet Sauce', 'Flaschen', 5, { crit: 1, sup: 'METRO' }], ['Trüffel Sauce', 'Flaschen', 2, SAUCE],
    ['Granatapfel Sauce', 'Flaschen', null, SAUCE],
    // Portionsprodukte getrennt von Großflaschen
    ['Heinz Tomato Ketchup Portionen 100 × 20 g', 'Karton', null, { crit: 1, pack: '100 × 20 g (2 kg)' }],
    ['Heinz Salat Mayonnaise Portionen 100 × 17 g', 'Karton', null, { crit: 1, pack: '100 × 17 g (1,7 kg)' }],
    ['Heinz Sweet & Sour Portionen 100 × 25 g', 'Karton', null, { crit: 1, pack: '100 × 25 g (2,5 kg)' }]] },
  { code: 'hygiene', name: 'Reinigungsmittel & Hygieneartikel', schedule: 'weekly', weekday: 1, due: '17:10', items: [
    ['METRO PROFESSIONAL Handspülmittel 5 L', 'Gebinde', 1], ['Dr. Becher Fritteusen-Reiniger Tabs', 'Packung', 1], ['Edelstahlreiniger METRO', 'Flasche', 1],
    ['METRO PROFESSIONAL Fettlöser 750 ml Sprühflasche', 'Flasche', 1], ['METRO PROFESSIONAL Fettlöser Konzentrat 5 L', 'Kanister', 1],
    ['aro Vollglanz Bodenreiniger 5 L', 'Kanister', 1], ['Glasreiniger', 'Flasche', 1],
    ['Tork Xpressnap Spenderservietten N4 weiß', 'Karton', 1, { art: '10840', pack: '1125 Stück' }], ['Toilettenpapier', 'Packung', 1],
    ['Tork Papierhandtücher', 'Karton', 1], ['Tork M1 Papierwischtücher weiß 1-lagig', 'Karton', 1, { art: '610133', pack: '3 × 120 m' }],
    ['Flüssigseife', 'Gebinde', 1], ['Desinfektionsmittel', 'Gebinde', 1], ['Reinigungslappen / Putzlappen', 'Packung', 1]] },
  { code: 'verpackung', name: 'Verpackung', schedule: 'weekly', weekday: 1, due: '17:10', items: [
    ['PAPSTAR Hamburger-Tüten Newsprint', 'Packung', null, { pack: '1000 Stück' }],
    ['METRO PROFESSIONAL Servietten Cream 33 × 33 cm', 'Packung', null, { pack: '250 Stück' }],
    ['PAPSTAR Dressingbecher PP 100 ml', 'Packung', null, { pack: '50 Stück' }]] },
  { code: 'tiefkuehl', name: 'Tiefkühlware', schedule: 'interval', interval: 3, due: '17:10', items: [
    ['METRO Chef Mozzarella Sticks TK', 'Beutel', null, { pack: '1 kg' }], ['METRO Chef Chili Cheese Nuggets TK', 'Beutel', null, { pack: '1 kg' }],
    ['METRO Chef Onion Rings TK', 'Beutel', null, { pack: '1 kg' }], ['Maiskolben', 'offen', null],
    ['METRO Chef Sweet Potato Fries TK', 'Beutel', null, { pack: '2,5 kg' }]] },
  { code: 'kueche', name: 'Küche / Burger-Zutaten', schedule: 'daily', due: '17:10', items: [
    ['Cheddar-Käsescheiben', 'Packungen', 10], ['Frischpack Ziegenkäse 50 % Scheiben', 'Packungen', 5, { pack: '500 g' }],
    ['aro Schmelzkäse würzig-pikant', 'Packungen', null, { pack: '10 × 25 g (250 g)' }], ['Parmesan', 'Packungen', 2],
    ['METRO Chef Weizen Wraps Mexican Style 25 cm', 'Stück', 50, { pack: '12 Stück (740 g)' }],
    ['Brioche Burger Buns', 'Stück', 80, { urgent: 60 }], ['Red Burger Buns', 'Stück', 60], ['Schwarze Burger Buns', 'Stück', 60],
    ['Adria Jalapeños grün geschnitten (3-kg-Dose)', 'kg', 2, { pack: '3 kg Dose – Messbasis (Abtropfgewicht?) klären' }],
    ['Sauergurken', 'kg', 3], ['Tulip Chicken Bacon', 'Packungen (500 g)', 3, { pack: '500 g' }], ['Sucuk', 'Packungen (500 g)', 3],
    ['Eisberg', 'offen', null], ['Tomaten', 'offen', null]] },
  // Wrap steht nur in „Küche“ – keine doppelte tägliche Kontrolle
  { code: 'frisch', name: 'Frische Ware (Fleisch roh, Pommes)', schedule: 'daily', due: '17:10', items: [
    ['Hähnchen-Brustfilet roh (Halal, ohne Haut/Knochen)', 'kg', null, { crit: 1 }], ['Wings roh', 'kg', null, { crit: 1 }],
    ['Unterschenkel roh', 'kg', null, { crit: 1 }],
    ['Aviko Super Crunch Fresh 11 mm (gekühlt)', 'kg', 40, { crit: 1, pack: '9 kg (2 × 4,5 kg), 0–4 °C' }]] },
  { code: 'getraenke', name: 'Getränke', schedule: 'daily', due: '17:10', items: [
    ['Coca-Cola Original 330 ml Dose', 'Dosen', null], ['Fanta Orange 330 ml Dose', 'Dosen', null],
    ['Capri-Sun Monster Alarm 10 × 200 ml', 'Packungen', null, { pack: '10 × 200 ml' }]] },
  // Mariniert getrennt von roh – keine Doppelzählung
  { code: 'mariniert', name: 'Mariniertes Fleisch', schedule: 'daily', due: '17:10,23:30', marinated: true, photo: true, items: [
    ['Hähnchenbrust mild', 'kg', null, { crit: 1 }], ['Hähnchenbrust pikant', 'kg', null, { crit: 1 }], ['Wings mild', 'kg', null, { crit: 1 }],
    ['Wings pikant', 'kg', null, { crit: 1 }], ['Unterschenkel mild', 'kg', null, { crit: 1 }], ['Unterschenkel pikant', 'kg', null, { crit: 1 }]] },
];

// Höchsttemperatur für Geflügelfleisch und Geflügelfleischzubereitungen (z. B. mariniertes Geflügel): +4 °C laut DIN 10508.
// Je Filiale änderbar, aber nur mit Quelle.
export const DEFAULT_TEMP_MAX = 4;
export const DEFAULT_TEMP_SOURCE = 'DIN 10508 – Höchsttemperatur Geflügelfleisch/-zubereitungen +4 °C';
export const DEFAULT_ESCALATION = [{ min: -10, to: 'staff' }, { min: 0, to: 'staff' }, { min: 5, to: 'staff' }, { min: 10, to: 'manager' }];

// --- Zeit (Europe/Berlin, inkl. Sommerzeit) -------------------------------------------
function berlinOffsetMin(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(d).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(d.getTime() / 60000) * 60000) / 60000;
}
/** Ortszeit Berlin (Datum + HH:MM) → UTC-Zeitpunkt. */
export function berlinToUtc(dateStr, hhmm) {
  const [y, mo, d] = dateStr.split('-').map(Number), [h, m] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, m);
  let t = guess - berlinOffsetMin(new Date(guess)) * 60000;
  const off2 = berlinOffsetMin(new Date(t));
  t = guess - off2 * 60000;
  return new Date(t);
}
const dayNo = (s) => Math.round(Date.parse(s + 'T12:00:00Z') / 86400000);
const isoWeekday = (s) => ((new Date(s + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDue(list, date) {
  if (!list.active) return false;
  if (list.schedule === 'daily') return true;
  if (list.schedule === 'weekly') return isoWeekday(date) === list.weekday;
  if (list.schedule === 'interval') return !!list.start_date && date >= list.start_date && (dayNo(date) - dayNo(list.start_date)) % list.interval_days === 0;
  return false;
}
const dueTimes = (list) => list.due_times.split(',').map((x) => x.trim()).filter((x) => TIME.test(x)).sort();

const setting = (db, branchId, key, fallback) => db.prepare('SELECT value FROM branch_settings WHERE branch_id = ? AND key = ?').get(branchId, key)?.value ?? fallback;
export function escalationRules(db, branchId) {
  try { const r = JSON.parse(setting(db, branchId, 'control_escalation', '')); if (Array.isArray(r) && r.length) return r; } catch { /* Standard */ }
  return DEFAULT_ESCALATION;
}

export function seedControls(db, branchId, today = berlinDate()) {
  if (db.prepare('SELECT 1 FROM control_lists WHERE branch_id = ?').get(branchId)) return;
  tx(db, () => {
    CONTROL_LISTS.forEach((l, i) => {
      const id = Number(db.prepare(`INSERT INTO control_lists (branch_id, code, name, schedule, weekday, interval_days, start_date, due_times, photo_required, marinated, position)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(branchId, l.code, l.name, l.schedule, l.weekday ?? null, l.interval ?? null, l.schedule === 'interval' ? today : null,
        l.due, l.photo ? 1 : 0, l.marinated ? 1 : 0, (i + 1) * 10).lastInsertRowid);
      l.items.forEach(([name, unit, min, o = {}], k) => db.prepare(`INSERT INTO control_items (list_id, name, unit, min_qty, position, supplier, critical, urgent_below, article_no, pack_info)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, name, unit, min, (k + 1) * 10, o.sup ?? null, o.crit ? 1 : 0, o.urgent ?? null, o.art ?? null, o.pack ?? null));
    });
  });
}

/** Läufe für ein Datum anlegen (idempotent) und fair zuweisen. */
export function ensureRuns(db, branchId, date = berlinDate(), notify = null) {
  const lists = db.prepare('SELECT * FROM control_lists WHERE branch_id = ? AND active = 1').all(branchId);
  const ins = db.prepare('INSERT OR IGNORE INTO control_runs (list_id, branch_id, due_date, slot, due_time, due_at) VALUES (?,?,?,?,?,?)');
  tx(db, () => {
    for (const l of lists) {
      if (!isDue(l, date)) continue;
      dueTimes(l).forEach((t, slot) => ins.run(l.id, branchId, date, slot, t, berlinToUtc(date, t).toISOString()));
    }
  });
  assignRuns(db, branchId, date, notify);
}

function candidates(db, branchId, date, role) {
  const roles = role === 'shift_lead' ? ['shift_lead'] : ['employee', 'shift_lead'];
  return db.prepare(`SELECT DISTINCT p.user_id id FROM shift_presence p JOIN users u ON u.id = p.user_id AND u.active = 1
    JOIN memberships m ON m.user_id = p.user_id AND m.branch_id = p.branch_id AND m.role IN (${roles.map(() => '?').join(',')})
    WHERE p.branch_id = ? AND p.work_date = ? AND p.status = 'present'
      AND NOT EXISTS (SELECT 1 FROM shift_presence a WHERE a.branch_id = p.branch_id AND a.work_date = p.work_date AND a.user_id = p.user_id AND a.status = 'absent')`)
    .all(...roles, branchId, date).map((r) => r.id);
}

export function assignRuns(db, branchId, date, notify) {
  tx(db, () => {
    // Abwesende verlieren automatische Zuweisungen offener Läufe; Leitungs-Zuweisung bleibt, außer die Person ist abwesend
    db.prepare(`UPDATE control_runs SET assigned_to = NULL, assignment_mode = NULL WHERE branch_id = ? AND due_date = ? AND status IN ('open','rework') AND assigned_to IS NOT NULL
      AND EXISTS (SELECT 1 FROM shift_presence a WHERE a.branch_id = control_runs.branch_id AND a.work_date = control_runs.due_date AND a.user_id = control_runs.assigned_to AND a.status = 'absent')`).run(branchId, date);
    const open = db.prepare(`SELECT r.id, r.due_at, l.role, l.name FROM control_runs r JOIN control_lists l ON l.id = r.list_id
      WHERE r.branch_id = ? AND r.due_date = ? AND r.assigned_to IS NULL AND r.status IN ('open','rework') ORDER BY r.due_at, r.id`).all(branchId, date);
    for (const r of open) {
      const pool = candidates(db, branchId, date, r.role);
      if (!pool.length) {
        // erst kurz vor Fälligkeit melden (60 Minuten), nicht schon beim Anlegen um Mitternacht
        if (Date.now() < new Date(r.due_at).getTime() - 60 * 60000) continue;
        notify?.(db, branchId, 'control', `Kontrolle „${r.name}“ (${date}) kann niemandem zugewiesen werden – keine anwesende, berechtigte Person.`, `remind:ctl:${r.id}:unassignable`, null, 'manager');
        continue;
      }
      const load = (uid) => db.prepare('SELECT COUNT(*) n FROM control_runs WHERE branch_id = ? AND due_date = ? AND assigned_to = ?').get(branchId, date, uid).n;
      const pick = pool.map((id) => ({ id, n: load(id) })).sort((a, b) => a.n - b.n || a.id - b.id)[0];
      db.prepare("UPDATE control_runs SET assigned_to = ?, assignment_mode = 'auto' WHERE id = ? AND assigned_to IS NULL").run(pick.id, r.id);
    }
  });
}

const runState = (r, now = new Date()) => r.status === 'done' ? (r.on_time ? 'done' : 'late_done') : r.status === 'rework' ? 'rework' : now > new Date(r.due_at) ? 'overdue' : 'open';

/** Erinnerung/Eskalation: je Lauf nur die zuletzt erreichte Stufe senden (nach Neustart kein Nachholen aller Stufen). */
export function runControlReminders(db, branchId, now = new Date(), notify) {
  ensureRuns(db, branchId, berlinDate(now), notify);
  const rules = escalationRules(db, branchId).slice().sort((a, b) => a.min - b.min);
  const runs = db.prepare(`SELECT r.*, l.name, u.display_name who FROM control_runs r JOIN control_lists l ON l.id = r.list_id LEFT JOIN users u ON u.id = r.assigned_to
    WHERE r.branch_id = ? AND r.status IN ('open','rework') AND r.due_at > ?`).all(branchId, new Date(now.getTime() - 24 * 3600e3).toISOString());
  let sent = 0;
  for (const r of runs) {
    const due = new Date(r.due_at).getTime();
    let k = -1;
    rules.forEach((s, i) => { if (now.getTime() >= due + s.min * 60000) k = i; });
    if (k < 0) continue;
    const s = rules[k];
    const ref = `remind:ctl:${r.id}:${k}`;
    const time = r.due_time;
    const msg = s.to === 'manager'
      ? `Kontrolle „${r.name}“ (fällig ${time} Uhr) ist ${s.min} Minuten nach Fälligkeit noch offen. Verantwortlich: ${r.who || 'nicht zugewiesen'}.`
      : s.min < 0 ? `Erinnerung: Kontrolle „${r.name}“ ist um ${time} Uhr fällig.`
      : s.min === 0 ? `Jetzt fällig: Kontrolle „${r.name}“ (${time} Uhr).`
      : `Überfällig: Kontrolle „${r.name}“ war um ${time} Uhr fällig. Bitte jetzt erledigen.`;
    sent += notify(db, branchId, 'control', msg, ref, s.to === 'staff' ? r.assigned_to : null, s.to) ? 1 : 0;
  }
  sent += escalateZeroAlerts(db, branchId, now, notify);
  return sent;
}

export function registerControls({ route, db, needUser, needBranch, HttpError, bad, notFound, can, mediaInBranch }) {
  const notify = (d, branchId, kind, message, ref, userId = null, audience = 'manager') =>
    d.prepare('INSERT OR IGNORE INTO notifications (branch_id, kind, message, ref, user_id, audience) VALUES (?,?,?,?,?,?)').run(branchId, kind, message, ref, userId, audience).changes;

  const runRow = (id) => db.prepare(`SELECT r.*, l.name, l.code, l.marinated, l.photo_required, l.role, u.display_name assigned_name, c.display_name completed_name
    FROM control_runs r JOIN control_lists l ON l.id = r.list_id LEFT JOIN users u ON u.id = r.assigned_to LEFT JOIN users c ON c.id = r.completed_by WHERE r.id = ?`).get(Number(id));
  const items = (listId) => db.prepare('SELECT * FROM control_items WHERE list_id = ? AND active = 1 ORDER BY position, id').all(listId);
  const summary = (r) => ({ id: r.id, list: r.name, code: r.code, due_date: r.due_date, due_time: r.due_time, due_at: r.due_at, state: runState(r),
    assigned_to: r.assigned_to, assigned_name: r.assigned_name, completed_name: r.completed_name, completed_at: r.completed_at,
    reviewed: !!r.reviewed_at, marinated: !!r.marinated, temp_alarm: !!r.temp_alarm, temperature: r.temperature });

  route('GET', '/api/controls/mine', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    ensureRuns(db, branchId, berlinDate(), notify);
    const runs = db.prepare(`SELECT r.*, l.name, l.code, l.marinated, l.photo_required, l.role, u.display_name assigned_name, NULL completed_name
      FROM control_runs r JOIN control_lists l ON l.id = r.list_id LEFT JOIN users u ON u.id = r.assigned_to
      WHERE r.branch_id = ? AND r.due_date = ? AND (r.assigned_to = ? OR (r.assigned_to IS NULL AND r.status <> 'done')) ORDER BY r.due_at`).all(branchId, berlinDate(), u.id);
    const notes = db.prepare("SELECT id, message, created_at FROM notifications WHERE branch_id = ? AND audience = 'staff' AND (user_id = ? OR user_id IS NULL) AND read_at IS NULL ORDER BY id DESC LIMIT 5").all(branchId, u.id);
    return { runs: runs.map(summary), reminders: notes };
  });

  route('POST', '/api/notifications/:id/read', (ctx) => {
    const u = needUser(ctx);
    const n = db.prepare('SELECT * FROM notifications WHERE id = ?').get(Number(ctx.params.id));
    if (!n) throw notFound();
    needBranch(ctx, n.branch_id);
    if (n.user_id && n.user_id !== u.id) throw notFound();
    db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL').run(new Date().toISOString(), n.id);
    return { ok: true };
  });

  route('GET', '/api/controls/runs/:id', (ctx) => {
    needUser(ctx);
    const r = runRow(ctx.params.id); if (!r) throw notFound();
    needBranch(ctx, r.branch_id);
    const lines = new Map(db.prepare('SELECT * FROM control_run_lines WHERE run_id = ?').all(r.id).map((l) => [l.item_id, l]));
    const hours = Number(setting(db, r.branch_id, 'marinade_use_within_hours', '')) || null;
    return { ...summary(r), photo_required: !!r.photo_required, temperature: r.temperature, note: r.note, media_id: r.media_id, review_note: r.review_note,
      use_within_hours: hours, temp_max: Number(setting(db, r.branch_id, 'marinated_temp_max', DEFAULT_TEMP_MAX)),
      items: items(r.list_id).map((i) => ({ id: i.id, name: i.name, unit: i.unit, min_qty: i.min_qty, pack_info: i.pack_info, image_media_id: i.image_media_id, critical: !!i.critical, storage_hint: i.storage_hint, qty: lines.get(i.id)?.qty ?? null,
        reorder: lines.get(i.id)?.reorder ?? null, marinated_at: lines.get(i.id)?.marinated_at ?? null, use_by: lines.get(i.id)?.use_by ?? null })) };
  });

  route('POST', '/api/controls/runs/:id', (ctx) => {
    const u = needUser(ctx);
    const r = runRow(ctx.params.id); if (!r) throw notFound();
    const branchId = needBranch(ctx, r.branch_id);
    if (!['open', 'rework'].includes(r.status)) throw new HttpError(409, 'not_open', 'Diese Kontrolle ist bereits abgeschlossen');
    const lead = can(u, branchId, 'shift_lead', 'manager', 'admin');
    if (r.assigned_to && r.assigned_to !== u.id && !lead) throw new HttpError(403, 'assigned_other', 'Diese Kontrolle ist einer anderen Person zugewiesen');
    if (r.role === 'shift_lead' && !lead) throw new HttpError(403, 'shift_lead_only', 'Diese Kontrolle ist für Schichtführer');
    const list = items(r.list_id);
    const given = new Map((Array.isArray(ctx.body.lines) ? ctx.body.lines : []).map((l) => [Number(l.item_id), l]));
    const missing = [];
    const parsed = list.map((i) => {
      const l = given.get(i.id) || {};
      const raw = l.qty;
      const qty = raw === '' || raw == null ? NaN : Number(raw);
      if (!Number.isFinite(qty)) { missing.push(i.name); return null; }
      if (qty < 0) throw bad('qty', `${i.name}: Menge muss 0 oder größer sein`);
      return { i, qty, marinated_at: l.marinated_at ? String(l.marinated_at) : null };
    });
    if (missing.length) throw bad('control_incomplete', `Noch nicht eingetragen: ${missing.join(', ')}`);
    let temperature = null;
    const hours = Number(setting(db, branchId, 'marinade_use_within_hours', '')) || null;
    if (r.marinated) {
      temperature = Number(ctx.body.temperature);
      if (ctx.body.temperature === '' || ctx.body.temperature == null || !Number.isFinite(temperature)) throw bad('temperature', 'Kühltemperatur eintragen');
      for (const p of parsed) {
        if (p.qty > 0 && !p.marinated_at) throw bad('marinated_at', `${p.i.name}: Marinierdatum und Uhrzeit eintragen`);
        if (p.marinated_at) {
          const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(p.marinated_at);
          if (!m) throw bad('marinated_at', 'Format Datum und Uhrzeit');
          const at = berlinToUtc(m[1], m[2]);
          if (at.getTime() > Date.now() + 5 * 60000) throw bad('marinated_at', `${p.i.name}: Marinierzeit liegt in der Zukunft`);
          p.use_by = hours ? new Date(at.getTime() + hours * 3600e3).toISOString() : null;
        }
      }
    }
    const tempMax = Number(setting(db, branchId, 'marinated_temp_max', DEFAULT_TEMP_MAX));
    const tempAlarm = r.marinated && temperature > tempMax;
    const media = mediaInBranch(ctx.body.media_id, branchId);
    if (r.photo_required && !media) throw bad('photo_required', 'Foto ist Pflicht');
    const now = new Date();
    const onTime = now <= new Date(r.due_at);
    let alerts = [];
    tx(db, () => {
      db.prepare('DELETE FROM control_run_lines WHERE run_id = ?').run(r.id);
      const ins = db.prepare('INSERT INTO control_run_lines (run_id, item_id, qty, reorder, marinated_at, use_by) VALUES (?,?,?,?,?,?)');
      for (const p of parsed) {
        const reorder = p.i.min_qty == null ? (p.qty === 0 ? 1 : null) : p.qty < p.i.min_qty ? 1 : 0;
        ins.run(r.id, p.i.id, p.qty, reorder, p.marinated_at, p.use_by ?? null);
      }
      const upd = db.prepare(`UPDATE control_runs SET status = 'done', completed_by = ?, completed_at = ?, on_time = ?, temperature = ?, temp_alarm = ?, media_id = ?, note = ?,
        assigned_to = COALESCE(assigned_to, ?) WHERE id = ? AND status IN ('open','rework')`)
        .run(u.id, now.toISOString(), onTime ? 1 : 0, temperature, tempAlarm ? 1 : 0, media ?? null, String(ctx.body.note || '').slice(0, 300) || null, u.id, r.id);
      if (!upd.changes) throw new HttpError(409, 'not_open', 'Diese Kontrolle ist bereits abgeschlossen');
      if (tempAlarm) notify(db, branchId, 'temperature', `TEMPERATUR ZU HOCH: ${r.name} – ${temperature} °C (Höchstwert ${tempMax} °C), eingetragen von ${u.display_name}. Sofort prüfen und nach freigegebenem Verfahren handeln.`, `ctl:${r.id}:temp`);
      audit(db, { actor: u.id, branch: branchId, action: 'control_done', entity: 'control_run', id: r.id, payload: { on_time: onTime } });
    });
    alerts = evaluateStock(db, { branchId, runId: r.id, userId: u.id, entries: parsed.map((p) => ({ item: p.i, qty: p.qty })), notify });
    const below = alerts.map((a) => `${a.item.name} (${a.qty}${a.item.min_qty != null ? '/' + a.item.min_qty : ''} ${a.item.unit})`);
    return { ok: true, on_time: onTime, below, critical: alerts.filter((a) => a.level === 'zero').map((a) => a.item.name), temp_alarm: !!tempAlarm, temp_max: tempMax };
  });

  route('POST', '/api/controls/runs/:id/review', (ctx) => {
    const u = needUser(ctx);
    const r = runRow(ctx.params.id); if (!r) throw notFound();
    const branchId = needBranch(ctx, r.branch_id, 'shift_lead', 'manager', 'admin');
    if (r.status !== 'done') throw new HttpError(409, 'not_done', 'Erst abschließen lassen');
    if (r.completed_by === u.id) throw new HttpError(403, 'self', 'Eigene Kontrolle nicht selbst prüfen');
    const ok = ctx.body.ok !== false;
    const note = String(ctx.body.note || '').trim().slice(0, 300);
    if (!ok && !note) throw bad('note', 'Begründung für Nacharbeit angeben');
    if (ok) db.prepare('UPDATE control_runs SET reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?').run(u.id, new Date().toISOString(), note || null, r.id);
    else {
      db.prepare("UPDATE control_runs SET status = 'rework', review_note = ?, reviewed_by = NULL, reviewed_at = NULL WHERE id = ?").run(note, r.id);
      notify(db, branchId, 'control', `Nacharbeit: Kontrolle „${r.name}“ – ${note}`, `ctl:${r.id}:rework:${Date.now()}`, r.completed_by, 'staff');
    }
    audit(db, { actor: u.id, branch: branchId, action: 'control_review', entity: 'control_run', id: r.id, payload: { ok } });
    return { ok: true };
  });

  route('POST', '/api/controls/runs/:id/assign', (ctx) => {
    const u = needUser(ctx);
    const r = runRow(ctx.params.id); if (!r) throw notFound();
    const branchId = needBranch(ctx, r.branch_id, 'shift_lead', 'manager', 'admin');
    if (!['open', 'rework'].includes(r.status)) throw new HttpError(409, 'not_open');
    const uid = Number(ctx.body.user_id);
    if (!db.prepare("SELECT 1 FROM memberships m JOIN users x ON x.id = m.user_id AND x.active = 1 WHERE m.user_id = ? AND m.branch_id = ? AND m.role IN ('employee','shift_lead')").get(uid, branchId)) throw bad('user_id');
    db.prepare("UPDATE control_runs SET assigned_to = ?, assignment_mode = 'manager' WHERE id = ?").run(uid, r.id);
    audit(db, { actor: u.id, branch: branchId, action: 'control_assign', entity: 'control_run', id: r.id, payload: { user: uid } });
    return { ok: true };
  });

  // Leitung: Tagesübersicht, Unterbestand, fehlende Mindestwerte, Einstellungen
  route('GET', '/api/controls', (ctx) => {
    needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'), 'shift_lead', 'manager', 'admin');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.get('date') || '') ? ctx.query.get('date') : berlinDate();
    if (date === berlinDate()) ensureRuns(db, branchId, date, notify);
    const runs = db.prepare(`SELECT r.*, l.name, l.code, l.marinated, u.display_name assigned_name, c.display_name completed_name FROM control_runs r
      JOIN control_lists l ON l.id = r.list_id LEFT JOIN users u ON u.id = r.assigned_to LEFT JOIN users c ON c.id = r.completed_by
      WHERE r.branch_id = ? AND r.due_date = ? ORDER BY r.due_at, l.position`).all(branchId, date);
    const below = db.prepare(`SELECT i.name, i.unit, i.min_qty, x.qty, l.name list, r.completed_at FROM control_run_lines x JOIN control_runs r ON r.id = x.run_id
      JOIN control_items i ON i.id = x.item_id JOIN control_lists l ON l.id = r.list_id
      WHERE r.branch_id = ? AND x.reorder = 1 AND r.id = (SELECT r2.id FROM control_runs r2 JOIN control_run_lines x2 ON x2.run_id = r2.id
        WHERE x2.item_id = x.item_id AND r2.status = 'done' ORDER BY r2.completed_at DESC LIMIT 1) ORDER BY l.position, i.position`).all(branchId);
    const lists = db.prepare('SELECT * FROM control_lists WHERE branch_id = ? ORDER BY position').all(branchId).map((l) => ({
      ...l, active: !!l.active, photo_required: !!l.photo_required, marinated: !!l.marinated,
      items: db.prepare('SELECT id, name, unit, min_qty, active, supplier, critical, urgent_below, target_qty, article_no, pack_info, storage_hint, image_media_id FROM control_items WHERE list_id = ? ORDER BY position, id').all(l.id) }));
    const staff = db.prepare(`SELECT DISTINCT u.id, u.display_name FROM memberships m JOIN users u ON u.id = m.user_id AND u.active = 1
      WHERE m.branch_id = ? AND m.role IN ('employee','shift_lead') ORDER BY u.display_name`).all(branchId);
    return { date, runs: runs.map(summary), below, lists, staff, escalation: escalationRules(db, branchId),
      missing_min: lists.reduce((n, l) => n + l.items.filter((i) => i.active && i.min_qty == null).length, 0),
      use_within_hours: Number(setting(db, branchId, 'marinade_use_within_hours', '')) || null,
      temp_max: Number(setting(db, branchId, 'marinated_temp_max', DEFAULT_TEMP_MAX)), temp_source: setting(db, branchId, 'marinated_temp_source', DEFAULT_TEMP_SOURCE) };
  });

  route('GET', '/api/controls/lists', (ctx) => {
    needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    return db.prepare('SELECT id, name, marinated FROM control_lists WHERE branch_id = ? AND active = 1 ORDER BY position').all(branchId);
  });

  // Zusätzliche Kontrolle jederzeit (sofort ausgewertet), z. B. wenn ein Artikel knapp wirkt
  route('POST', '/api/controls/lists/:id/extra', (ctx) => {
    const u = needUser(ctx);
    const l = db.prepare('SELECT * FROM control_lists WHERE id = ?').get(Number(ctx.params.id)); if (!l) throw notFound();
    const branchId = needBranch(ctx, l.branch_id);
    if (!l.active) throw bad('inactive');
    const date = berlinDate();
    const slot = 100 + db.prepare('SELECT COUNT(*) n FROM control_runs WHERE list_id = ? AND due_date = ? AND slot >= 100').get(l.id, date).n;
    if (slot > 120) throw new HttpError(429, 'too_many', 'Zu viele Zusatzkontrollen heute');
    const due = new Date(Date.now() + 30 * 60000);
    const hhmm = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false }).format(due);
    const id = Number(db.prepare("INSERT INTO control_runs (list_id, branch_id, due_date, slot, due_time, due_at, assigned_to, assignment_mode) VALUES (?,?,?,?,?,?,?, 'manager')")
      .run(l.id, branchId, date, slot, hhmm, due.toISOString(), u.id).lastInsertRowid);
    audit(db, { actor: u.id, branch: branchId, action: 'control_extra', entity: 'control_run', id, payload: { list: l.id } });
    return { id };
  });

  route('PUT', '/api/controls/lists/:id', (ctx) => {
    const u = needUser(ctx);
    const l = db.prepare('SELECT * FROM control_lists WHERE id = ?').get(Number(ctx.params.id)); if (!l) throw notFound();
    const branchId = needBranch(ctx, l.branch_id, 'manager', 'admin');
    const b = ctx.body || {};
    const schedule = b.schedule ?? l.schedule;
    if (!['daily', 'weekly', 'interval'].includes(schedule)) throw bad('schedule');
    const weekday = b.weekday != null ? Number(b.weekday) : l.weekday;
    if (schedule === 'weekly' && !(weekday >= 1 && weekday <= 7)) throw bad('weekday', 'Wochentag 1–7');
    const interval = b.interval_days != null ? Number(b.interval_days) : l.interval_days;
    const start = b.start_date ?? l.start_date;
    if (schedule === 'interval' && (!(interval >= 2 && interval <= 60) || !/^\d{4}-\d{2}-\d{2}$/.test(start || ''))) throw bad('interval', 'Intervall 2–60 Tage und Startdatum nötig');
    const times = b.due_times != null ? String(b.due_times).split(',').map((x) => x.trim()).filter(Boolean) : l.due_times.split(',');
    if (!times.length || times.length > 4 || times.some((t) => !TIME.test(t))) throw bad('due_times', 'Uhrzeiten im Format HH:MM, durch Komma getrennt');
    db.prepare('UPDATE control_lists SET schedule = ?, weekday = ?, interval_days = ?, start_date = ?, due_times = ?, photo_required = ?, active = ?, role = ? WHERE id = ?')
      .run(schedule, schedule === 'weekly' ? weekday : null, schedule === 'interval' ? interval : null, schedule === 'interval' ? start : null, [...new Set(times)].sort().join(','),
        b.photo_required != null ? (b.photo_required ? 1 : 0) : l.photo_required, b.active != null ? (b.active ? 1 : 0) : l.active,
        ['all', 'shift_lead'].includes(b.role) ? b.role : l.role, l.id);
    audit(db, { actor: u.id, branch: branchId, action: 'control_list_edit', entity: 'control_list', id: l.id, payload: b });
    return { ok: true };
  });

  route('PUT', '/api/controls/items/:id', (ctx) => {
    const u = needUser(ctx);
    const i = db.prepare('SELECT i.*, l.branch_id FROM control_items i JOIN control_lists l ON l.id = i.list_id WHERE i.id = ?').get(Number(ctx.params.id)); if (!i) throw notFound();
    const branchId = needBranch(ctx, i.branch_id, 'manager', 'admin');
    const b = ctx.body || {};
    const unit = b.unit != null ? String(b.unit).trim().slice(0, 30) : i.unit;
    if (!unit) throw bad('unit');
    let min = i.min_qty;
    if (b.min_qty !== undefined) { min = b.min_qty === '' || b.min_qty === null ? null : Number(b.min_qty); if (min != null && (!Number.isFinite(min) || min < 0)) throw bad('min_qty', 'Mindestwert 0 oder größer, leer = offen'); }
    const optNum = (v, cur, key) => { if (v === undefined) return cur; if (v === '' || v === null) return null; const n = Number(v); if (!Number.isFinite(n) || n < 0) throw bad(key); return n; };
    const urgent = optNum(b.urgent_below, i.urgent_below, 'urgent_below'), target = optNum(b.target_qty, i.target_qty, 'target_qty');
    const txt = (v, cur, n) => (v === undefined ? cur : String(v).trim().slice(0, n) || null);
    let image = i.image_media_id;
    if (b.image_media_id !== undefined) {
      if (b.image_media_id === null || b.image_media_id === '') image = null;
      else { const m = db.prepare("SELECT id FROM media WHERE id = ? AND branch_id = ? AND purged_at IS NULL").get(Number(b.image_media_id), branchId); if (!m) throw bad('image'); image = m.id; }
    }
    db.prepare(`UPDATE control_items SET unit = ?, min_qty = ?, active = ?, supplier = ?, critical = ?, urgent_below = ?, target_qty = ?, article_no = ?, pack_info = ?, storage_hint = ?, image_media_id = ? WHERE id = ?`)
      .run(unit, min, b.active != null ? (b.active ? 1 : 0) : i.active, txt(b.supplier, i.supplier, 80), b.critical != null ? (b.critical ? 1 : 0) : i.critical,
        urgent, target, txt(b.article_no, i.article_no, 40), txt(b.pack_info, i.pack_info, 120), txt(b.storage_hint, i.storage_hint, 300), image, i.id);
    audit(db, { actor: u.id, branch: branchId, action: 'control_item_edit', entity: 'control_item', id: i.id, payload: { unit, min } });
    return { ok: true };
  });

  route('POST', '/api/controls/lists/:id/items', (ctx) => {
    const u = needUser(ctx);
    const l = db.prepare('SELECT * FROM control_lists WHERE id = ?').get(Number(ctx.params.id)); if (!l) throw notFound();
    const branchId = needBranch(ctx, l.branch_id, 'manager', 'admin');
    const name = String(ctx.body.name || '').trim().slice(0, 80), unit = String(ctx.body.unit || 'offen').trim().slice(0, 30);
    if (!name) throw bad('name');
    const min = ctx.body.min_qty === '' || ctx.body.min_qty == null ? null : Number(ctx.body.min_qty);
    if (min != null && (!Number.isFinite(min) || min < 0)) throw bad('min_qty');
    const pos = (db.prepare('SELECT MAX(position) p FROM control_items WHERE list_id = ?').get(l.id).p || 0) + 10;
    const id = Number(db.prepare('INSERT INTO control_items (list_id, name, unit, min_qty, position) VALUES (?,?,?,?,?)').run(l.id, name, unit, min, pos).lastInsertRowid);
    audit(db, { actor: u.id, branch: branchId, action: 'control_item_new', entity: 'control_item', id, payload: { list: l.id } });
    return { id };
  });

  route('PUT', '/api/controls/settings', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'manager', 'admin');
    const put = (k, v) => db.prepare('INSERT INTO branch_settings (branch_id, key, value) VALUES (?,?,?) ON CONFLICT (branch_id, key) DO UPDATE SET value = excluded.value').run(branchId, k, v);
    if (ctx.body.escalation !== undefined) {
      const e = ctx.body.escalation;
      if (!Array.isArray(e) || !e.length || e.length > 8 || e.some((s) => !Number.isInteger(s.min) || s.min < -120 || s.min > 240 || !['staff', 'manager'].includes(s.to))) throw bad('escalation', 'Stufen: Minuten −120…240, an staff oder manager');
      put('control_escalation', JSON.stringify(e));
    }
    if (ctx.body.use_within_hours !== undefined) {
      const h = ctx.body.use_within_hours === '' || ctx.body.use_within_hours === null ? '' : Number(ctx.body.use_within_hours);
      if (h !== '' && !(h > 0 && h <= 168)) throw bad('use_within_hours', '1–168 Stunden oder leer');
      if (h !== '' && !String(ctx.body.source || '').trim()) throw bad('source', 'Quelle der Verbrauchsfrist angeben (z. B. HACCP-Plan)');
      put('marinade_use_within_hours', String(h));
      if (h !== '') put('marinade_use_within_source', String(ctx.body.source).trim().slice(0, 200));
    }
    if (ctx.body.temp_max !== undefined) {
      const t = Number(ctx.body.temp_max);
      if (!Number.isFinite(t) || t < -5 || t > 10) throw bad('temp_max', 'Höchsttemperatur −5 bis +10 °C');
      if (!String(ctx.body.temp_source || '').trim()) throw bad('temp_source', 'Quelle der Höchsttemperatur angeben');
      put('marinated_temp_max', String(t)); put('marinated_temp_source', String(ctx.body.temp_source).trim().slice(0, 200));
    }
    audit(db, { actor: u.id, branch: branchId, action: 'control_settings', entity: 'branch', id: branchId, payload: ctx.body });
    return { ok: true };
  });

  return { notify };
}
