// Wöchentliche Inventur und automatische Erinnerungen (Inventur fällig/überfällig, offene Pflichtschulungen).
// Erinnerungen erscheinen in der App (Übersicht/Benachrichtigungen). Externe Kanäle nur, wenn konfiguriert.
import { tx, audit } from './db.js';
import { berlinDate, qualification } from './app.js';
import { runDailyReminders } from './daily.js';

export function isoWeekday(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return ((d.getUTCDay() + 6) % 7) + 1;
}

/** ISO-Woche 'YYYY-Www' für ein Datum 'YYYY-MM-DD'. */
export function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // Donnerstag derselben Woche bestimmt das Jahr
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400e3 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function dateOfWeekday(dateStr, weekday) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + (weekday - isoWeekday(dateStr)));
  return d.toISOString().slice(0, 10);
}

export function branchSetting(db, branchId, key, fallback) {
  return db.prepare('SELECT value FROM branch_settings WHERE branch_id = ? AND key = ?').get(branchId, key)?.value ?? fallback;
}

function stock(db, branchId) {
  return db.prepare(`SELECT i.id, i.name, i.unit, COALESCE((SELECT SUM(qty_delta) FROM stock_movements m WHERE m.item_id = i.id AND m.branch_id = ?), 0) AS qty
    FROM items i WHERE i.active = 1 ORDER BY i.category, i.name`).all(branchId);
}

export function inventoryStatus(db, branchId, today = berlinDate()) {
  const week = isoWeek(today);
  const weekday = Number(branchSetting(db, branchId, 'inventory_weekday', '1'));
  const due = dateOfWeekday(today, weekday);
  const count = db.prepare('SELECT * FROM inventory_counts WHERE branch_id = ? AND week = ?').get(branchId, week);
  const done = count?.status === 'submitted';
  const state = done ? 'done' : today > due ? 'overdue' : today === due ? 'due' : 'upcoming';
  return { week, weekday, due_date: due, state, count_id: count?.id ?? null, submitted_at: count?.submitted_at ?? null };
}

const remind = (db, branchId, ref, kind, message) =>
  db.prepare('INSERT OR IGNORE INTO notifications (branch_id, kind, message, ref) VALUES (?,?,?,?)').run(branchId, kind, message, ref).changes;

/** Erzeugt fällige Erinnerungen (idempotent – jede Erinnerung nur einmal je Anlass). */
export function runReminders(db, branchId, today = berlinDate(), now = new Date()) {
  let created = runDailyReminders(db, branchId, now);
  const inv = inventoryStatus(db, branchId, today);
  if (inv.state === 'due') created += remind(db, branchId, `remind:inventory:due:${inv.week}`, 'inventory', `Wöchentliche Inventur ist heute fällig (${inv.week}).`);
  if (inv.state === 'overdue') created += remind(db, branchId, `remind:inventory:overdue:${inv.week}`, 'inventory', `Inventur ${inv.week} ist überfällig (fällig am ${inv.due_date}).`);
  // Wöchentliche Schulungserinnerung (montags bzw. beim ersten Aufruf der Woche)
  const open = openTrainings(db, branchId);
  if (open.length) {
    const names = [...new Set(open.map((o) => o.display_name))];
    created += remind(db, branchId, `remind:training:${inv.week}`, 'training',
      `${open.length} offene oder abgelaufene Pflichtschulungen: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ' …' : ''}`);
  }
  return created;
}

export function openTrainings(db, branchId) {
  const people = db.prepare(`SELECT DISTINCT u.id, u.display_name FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.branch_id = ? AND m.role IN ('employee','shift_lead') AND u.active = 1`).all(branchId);
  const courses = db.prepare('SELECT id, code, content FROM courses WHERE active = 1 AND required = 1').all();
  const out = [];
  for (const p of people) for (const c of courses) {
    const q = qualification(db, p.id, c.id, branchId);
    if (!q.exam) out.push({ user_id: p.id, display_name: p.display_name, course_id: c.id, title: JSON.parse(c.content).de.title, expired: q.expired });
  }
  return out;
}

export function registerInventory({ route, db, needUser, needBranch, HttpError, bad }) {
  route('GET', '/api/inventory', (ctx) => {
    needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    const st = inventoryStatus(db, branchId);
    const lines = st.count_id ? new Map(db.prepare('SELECT * FROM inventory_lines WHERE count_id = ?').all(st.count_id).map((l) => [l.item_id, l])) : new Map();
    const items = stock(db, branchId).map((i) => ({ item_id: i.id, name: i.name, unit: i.unit, expected: st.state === 'done' ? lines.get(i.id)?.expected ?? null : i.qty,
      counted: lines.get(i.id)?.counted ?? null }));
    const history = db.prepare(`SELECT c.week, c.status, c.submitted_at, u.display_name AS by,
        (SELECT COUNT(*) FROM inventory_lines l WHERE l.count_id = c.id AND l.expected IS NOT NULL AND ABS(l.counted - l.expected) > 0.0001) AS diff_items
      FROM inventory_counts c LEFT JOIN users u ON u.id = c.submitted_by WHERE c.branch_id = ? ORDER BY c.week DESC LIMIT 8`).all(branchId);
    return { ...st, items, history };
  });

  route('PUT', '/api/inventory/lines', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch);
    const st = inventoryStatus(db, branchId);
    if (st.state === 'done') throw new HttpError(409, 'inventory_done', 'Inventur dieser Woche ist bereits abgeschlossen');
    const lines = Array.isArray(ctx.body.lines) ? ctx.body.lines : [];
    return tx(db, () => {
      let countId = st.count_id;
      if (!countId) countId = Number(db.prepare('INSERT INTO inventory_counts (branch_id, week, started_by) VALUES (?,?,?)').run(branchId, st.week, u.id).lastInsertRowid);
      const up = db.prepare(`INSERT INTO inventory_lines (count_id, item_id, counted, counted_by) VALUES (?,?,?,?)
        ON CONFLICT (count_id, item_id) DO UPDATE SET counted = excluded.counted, counted_by = excluded.counted_by`);
      let saved = 0;
      for (const l of lines) {
        if (l.counted === '' || l.counted == null) continue;
        const v = Number(l.counted);
        if (!Number.isFinite(v) || v < 0) throw bad('counted', 'Menge muss 0 oder größer sein');
        if (!db.prepare('SELECT 1 FROM items WHERE id = ? AND active = 1').get(Number(l.item_id))) throw bad('item');
        up.run(countId, Number(l.item_id), v, u.id); saved++;
      }
      return { ok: true, saved, count_id: countId };
    });
  });

  route('POST', '/api/inventory/submit', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'shift_lead', 'manager', 'admin');
    const st = inventoryStatus(db, branchId);
    if (st.state === 'done') throw new HttpError(409, 'inventory_done', 'Inventur dieser Woche ist bereits abgeschlossen');
    if (!st.count_id) throw bad('inventory_empty', 'Noch nichts gezählt');
    const current = stock(db, branchId);
    const lines = new Map(db.prepare('SELECT * FROM inventory_lines WHERE count_id = ?').all(st.count_id).map((l) => [l.item_id, l]));
    const missing = current.filter((i) => !lines.has(i.id));
    if (missing.length) throw bad('inventory_incomplete', `Noch nicht gezählt: ${missing.map((m) => m.name).join(', ')}`);
    return tx(db, () => {
      let diffs = 0;
      for (const i of current) {
        const l = lines.get(i.id);
        const diff = Math.round((l.counted - i.qty) * 1000) / 1000;
        db.prepare('UPDATE inventory_lines SET expected = ? WHERE count_id = ? AND item_id = ?').run(i.qty, st.count_id, i.id);
        if (diff !== 0) {
          diffs++;
          db.prepare("INSERT INTO stock_movements (branch_id, item_id, qty_delta, type, note, created_by) VALUES (?,?,?,'count',?,?)")
            .run(branchId, i.id, diff, `Wöchentliche Inventur ${st.week}: gezählt ${l.counted}, Soll ${i.qty}`, u.id);
        }
      }
      db.prepare("UPDATE inventory_counts SET status = 'submitted', submitted_by = ?, submitted_at = ? WHERE id = ?").run(u.id, new Date().toISOString(), st.count_id);
      audit(db, { actor: u.id, branch: branchId, action: 'inventory_submit', entity: 'inventory_count', id: st.count_id, payload: { week: st.week, diffs } });
      return { ok: true, week: st.week, diffs };
    });
  });

  route('PUT', '/api/inventory/settings', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'manager', 'admin');
    const wd = Number(ctx.body.weekday);
    if (!Number.isInteger(wd) || wd < 1 || wd > 7) throw bad('weekday', 'Wochentag 1–7');
    tx(db, () => {
      db.prepare("INSERT INTO branch_settings (branch_id, key, value) VALUES (?, 'inventory_weekday', ?) ON CONFLICT (branch_id, key) DO UPDATE SET value = excluded.value").run(branchId, String(wd));
      // Inventur-Aufgabe folgt dem eingestellten Wochentag
      db.prepare("UPDATE task_templates SET weekdays = ? WHERE branch_id = ? AND link = 'inventory'").run(String(wd), branchId);
      audit(db, { actor: u.id, branch: branchId, action: 'inventory_weekday', entity: 'branch', id: branchId, payload: { weekday: wd } });
    });
    return { ok: true };
  });
}
