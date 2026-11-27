// Persönliche Aufgabenverteilung (ohne Zeiterfassung), Reinigungsplan-Ansicht, Nachreinigung, Wochenbericht.
// Verteilung: nur an Personen, die für die Schicht eingeteilt/anwesend sind, die Rolle/Schulung/Station haben;
// faire Verteilung nach aktueller Aufgabenlast; jede Aufgabe genau einer Person; nicht zuweisbar → Eskalation an die Leitung.
import { tx, audit } from './db.js';
import { workGate } from './readiness.js';
import { berlinDate, qualification, addDays, generateTasks } from './app.js';
import { can } from './auth.js';
import { stationAccess } from './stations.js';
import { isoWeek, isoWeekday } from './inventory.js';
import { dailyStatus } from './daily.js';

const SHIFTS = ['open', 'run', 'close'];

export function shiftCandidates(db, branchId, date, shift) {
  // Positionsplan zählt als eingeteilt; ausdrücklich "abwesend" schließt aus
  const fromPlan = db.prepare(`SELECT DISTINCT a.user_id FROM position_plans p JOIN position_assignments a ON a.plan_id = p.id
    WHERE p.branch_id = ? AND p.work_date = ? AND p.shift = ?`).all(branchId, date, shift).map((r) => r.user_id);
  const pres = db.prepare('SELECT user_id, status FROM shift_presence WHERE branch_id = ? AND work_date = ? AND shift = ?').all(branchId, date, shift);
  const absent = new Set(pres.filter((p) => p.status === 'absent').map((p) => p.user_id));
  const ids = new Set([...fromPlan, ...pres.filter((p) => p.status === 'present').map((p) => p.user_id)]);
  return [...ids].filter((id) => !absent.has(id));
}

function userObj(db, userId) {
  const u = db.prepare('SELECT id, is_admin FROM users WHERE id = ? AND active = 1').get(userId);
  if (!u) return null;
  return { id: u.id, is_admin: !!u.is_admin, memberships: db.prepare('SELECT branch_id, role FROM memberships WHERE user_id = ?').all(userId) };
}

export function eligible(db, userId, occ) {
  const u = userObj(db, userId);
  if (!u || (!u.is_admin && !u.memberships.some((m) => m.branch_id === occ.branch_id))) return false;
  if (occ.role === 'shift_lead' && !can(u, occ.branch_id, 'shift_lead', 'manager', 'admin')) return false;
  if (occ.required_course_id && !qualification(db, userId, occ.required_course_id, occ.branch_id).ok) return false;
  if (!stationAccess(db, u, occ.station_id, occ.branch_id)) return false;
  return true;
}

const OPEN_OCC = `SELECT o.*, t.role, t.required_course_id, t.station_id, t.title, t.carry_over FROM task_occurrences o JOIN task_templates t ON t.id = o.template_id
  WHERE o.branch_id = ? AND o.shift = ? AND o.status IN ('open','rework') AND (o.work_date = ? OR (o.work_date < ? AND t.carry_over = 1))`;

/** Verteilt offene, nicht zugewiesene Aufgaben einer Schicht fair. Gibt Anzahl zugewiesen / nicht zuweisbar zurück. */
export function autoAssign(db, branchId, date, shift, notify, { rebalance = false } = {}) {
  const cands = shiftCandidates(db, branchId, date, shift);
  if (!cands.length) return { assigned: 0, unassignable: 0, active: false };
  const res = { assigned: 0, unassignable: 0, active: true };
  tx(db, () => {
    // Zuweisungen an Personen, die nicht (mehr) eingeteilt sind, lösen (auch manuelle bei Abwesenheit)
    const occs = db.prepare(OPEN_OCC).all(branchId, shift, date, date);
    // Bei Änderung der Besetzung: automatisch vergebene, noch nicht begonnene Aufgaben neu und fair verteilen
    if (rebalance) {
      for (const o of occs) {
        if (o.assignment_mode === 'auto' && !o.started_at && o.status === 'open') {
          db.prepare('UPDATE task_occurrences SET assigned_to = NULL, assignment_mode = NULL WHERE id = ?').run(o.id);
          o.assigned_to = null;
        }
      }
    }
    for (const o of occs) {
      if (o.assigned_to && !cands.includes(o.assigned_to)) {
        db.prepare('UPDATE task_occurrences SET assigned_to = NULL, assignment_mode = NULL WHERE id = ?').run(o.id);
        o.assigned_to = null;
      }
    }
    const load = new Map(cands.map((c) => [c, 0]));
    for (const o of occs) if (o.assigned_to) load.set(o.assigned_to, (load.get(o.assigned_to) || 0) + 1);
    const planStation = new Map(db.prepare(`SELECT a.user_id, a.station_id FROM position_plans p JOIN position_assignments a ON a.plan_id = p.id
      WHERE p.branch_id = ? AND p.work_date = ? AND p.shift = ?`).all(branchId, date, shift).map((r) => [`${r.user_id}:${r.station_id}`, true]));
    for (const o of occs.filter((x) => !x.assigned_to).sort((a, b) => a.work_date.localeCompare(b.work_date) || a.position - b.position)) {
      const ok = cands.filter((c) => eligible(db, c, o));
      if (!ok.length) {
        res.unassignable++;
        db.prepare('INSERT OR IGNORE INTO notifications (branch_id, kind, message, ref) VALUES (?,?,?,?)')
          .run(branchId, 'unassigned', `Keine eingeteilte, qualifizierte Person für: ${JSON.parse(o.title).de}`, `remind:unassigned:${o.id}`);
        continue;
      }
      // Stationsaufgaben bevorzugt an Personen, die laut Plan an dieser Station sind; sonst geringste Last
      const pref = o.station_id ? ok.filter((c) => planStation.has(`${c}:${o.station_id}`)) : [];
      const pool = pref.length ? pref : ok;
      pool.sort((a, b) => load.get(a) - load.get(b) || a - b);
      const pick = pool[0];
      const r = db.prepare("UPDATE task_occurrences SET assigned_to = ?, assignment_mode = 'auto' WHERE id = ? AND assigned_to IS NULL").run(pick, o.id);
      if (r.changes) { load.set(pick, load.get(pick) + 1); res.assigned++; }
    }
  });
  void notify;
  return res;
}

function weekDates(week) {
  const [y, w] = week.split('-W').map(Number);
  const jan4 = `${y}-01-04`;
  const monday1 = addDays(jan4, 1 - isoWeekday(jan4));
  const monday = addDays(monday1, (w - 1) * 7);
  return [0, 1, 2, 3, 4, 5, 6].map((k) => addDays(monday, k));
}

export function registerAssign({ route, db, needUser, needBranch, HttpError, bad, notFound, notify }) {
  // --- Anwesenheit je Schicht (keine Zeiten, nur "eingeteilt/abwesend") ---
  route('GET', '/api/presence', (ctx) => {
    needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    const shift = ctx.query.get('shift');
    if (!SHIFTS.includes(shift)) throw bad('shift');
    const date = berlinDate();
    const cands = shiftCandidates(db, branchId, date, shift);
    const people = db.prepare(`SELECT DISTINCT u.id, u.display_name FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.branch_id = ? AND m.role IN ('employee','shift_lead','trainer') AND u.active = 1 ORDER BY u.display_name`).all(branchId);
    const pres = new Map(db.prepare('SELECT * FROM shift_presence WHERE branch_id = ? AND work_date = ? AND shift = ?').all(branchId, date, shift).map((p) => [p.user_id, p]));
    return { date, shift, people: people.map((p) => ({ ...p, present: cands.includes(p.id), status: pres.get(p.id)?.status ?? null, source: pres.get(p.id)?.source ?? null,
      open_tasks: db.prepare("SELECT COUNT(*) n FROM task_occurrences WHERE assigned_to = ? AND branch_id = ? AND shift = ? AND status IN ('open','rework') AND work_date <= ?").get(p.id, branchId, shift, date).n,
      done_tasks: db.prepare("SELECT COUNT(*) n FROM task_occurrences WHERE completed_by = ? AND branch_id = ? AND shift = ? AND work_date = ?").get(p.id, branchId, shift, date).n })) };
  });
  route('POST', '/api/presence', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch);
    const shift = ctx.body.shift;
    if (!SHIFTS.includes(shift)) throw bad('shift');
    const self = ctx.body.user_id == null || Number(ctx.body.user_id) === u.id;
    const target = self ? u.id : Number(ctx.body.user_id);
    if (!self) needBranch(ctx, branchId, 'manager', 'shift_lead', 'admin');
    if (!db.prepare('SELECT 1 FROM memberships WHERE user_id = ? AND branch_id = ?').get(target, branchId)) throw bad('user');
    const status = ctx.body.status === 'absent' ? 'absent' : 'present';
    if (self && status === 'absent') throw new HttpError(403, 'self_absent', 'Abwesenheit trägt die Leitung ein');
    const date = berlinDate();
    db.prepare(`INSERT INTO shift_presence (branch_id, work_date, shift, user_id, status, source, updated_by) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT (branch_id, work_date, shift, user_id) DO UPDATE SET status = excluded.status, source = excluded.source, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .run(branchId, date, shift, target, status, self ? 'self' : 'manager', u.id);
    audit(db, { actor: u.id, branch: branchId, action: 'presence', entity: 'user', id: target, payload: { shift, status } });
    generateTasks(db, branchId, date);
    const r = autoAssign(db, branchId, date, shift, notify, { rebalance: true });
    return { ok: true, ...r };
  });

  // --- Manuelle Zuweisung (Leitung/Schichtführer) ---
  route('POST', '/api/tasks/:id/assign', (ctx) => {
    const u = needUser(ctx);
    const o = db.prepare('SELECT o.*, t.role, t.required_course_id, t.station_id, t.title FROM task_occurrences o JOIN task_templates t ON t.id = o.template_id WHERE o.id = ?').get(Number(ctx.params.id));
    if (!o) throw notFound();
    const branchId = needBranch(ctx, o.branch_id, 'manager', 'shift_lead', 'admin');
    if (!['open', 'rework'].includes(o.status)) throw new HttpError(409, 'not_open', 'Aufgabe ist nicht offen');
    const target = ctx.body.user_id == null ? null : Number(ctx.body.user_id);
    if (target != null && !eligible(db, target, o)) throw new HttpError(409, 'not_eligible', 'Person hat nicht die nötige Rolle, Schulung oder Stationsfreigabe');
    db.prepare('UPDATE task_occurrences SET assigned_to = ?, assignment_mode = ? WHERE id = ?').run(target, target ? 'manual' : null, o.id);
    audit(db, { actor: u.id, branch: branchId, action: 'assign', entity: 'task', id: o.id, payload: { to: target } });
    return { ok: true };
  });

  // --- Status "in Arbeit" ---
  route('POST', '/api/tasks/:id/start', (ctx) => {
    const u = needUser(ctx);
    const o = db.prepare('SELECT * FROM task_occurrences WHERE id = ?').get(Number(ctx.params.id));
    if (!o) throw notFound();
    const branchId = needBranch(ctx, o.branch_id);
    if (!['open', 'rework'].includes(o.status)) throw new HttpError(409, 'not_open', 'Aufgabe ist nicht offen');
    { const g = workGate(db, u.id, branchId, o.shift); if (!g.ok) throw new HttpError(403, g.reason, g.message); }
    if (o.assigned_to && o.assigned_to !== u.id && !can(u, branchId, 'manager', 'shift_lead', 'admin')) throw new HttpError(403, 'assigned_other', 'Aufgabe ist einer anderen Person zugewiesen');
    const full = db.prepare('SELECT o.*, t.role, t.required_course_id, t.station_id FROM task_occurrences o JOIN task_templates t ON t.id = o.template_id WHERE o.id = ?').get(o.id);
    if (!can(u, branchId, 'manager', 'shift_lead', 'admin') && !eligible(db, u.id, full)) throw new HttpError(403, 'not_eligible', 'Dafür fehlt dir Schulung, Rolle oder Stationsfreigabe');
    db.prepare('UPDATE task_occurrences SET started_by = ?, started_at = ? WHERE id = ?').run(u.id, new Date().toISOString(), o.id);
    return { ok: true };
  });

  // --- Rückgabe zur Nacharbeit / Nachreinigung durch die Leitung ---
  route('POST', '/api/tasks/:id/return', (ctx) => {
    const u = needUser(ctx);
    const o = db.prepare('SELECT o.*, t.title FROM task_occurrences o JOIN task_templates t ON t.id = o.template_id WHERE o.id = ?').get(Number(ctx.params.id));
    if (!o) throw notFound();
    const branchId = needBranch(ctx, o.branch_id, 'manager', 'shift_lead', 'admin');
    if (!['done', 'approved'].includes(o.status)) throw new HttpError(409, 'not_done', 'Nur erledigte Aufgaben können zurückgegeben werden');
    const note = String(ctx.body.note || '').trim();
    if (note.length < 2) throw bad('note', 'Bitte kurz begründen, was nachzuarbeiten ist');
    tx(db, () => {
      db.prepare("UPDATE task_occurrences SET status = 'rework', assigned_to = COALESCE(completed_by, assigned_to), assignment_mode = 'manual', started_at = NULL, started_by = NULL, note = ? WHERE id = ?")
        .run(`Zurückgegeben: ${note.slice(0, 300)}`, o.id);
      notify(db, branchId, 'return', `Zurück zur Nacharbeit: ${JSON.parse(o.title).de} – ${note.slice(0, 120)}`, `task:${o.id}`);
      audit(db, { actor: u.id, branch: branchId, action: 'return', entity: 'task', id: o.id, payload: { note, previous_by: o.completed_by, previous_at: o.completed_at } });
    });
    return { ok: true };
  });

  // --- Reinigungsplan ---
  const EVENT_AREAS = ['Panierstation nach Benutzung', 'Marinierstation nach Benutzung', 'Messer/Bretter nach Rohfleisch', 'Arbeitsfläche nach Rohfleisch', 'Verschüttetes beseitigt'];
  route('GET', '/api/cleaning', (ctx) => {
    needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    const date = berlinDate();
    const rows = db.prepare(`SELECT o.*, t.title, t.hint, t.icon, t.frequency, t.requires_photo, t.cleaning_agent, t.sop_id, t.carry_over,
        a.display_name AS assigned_name, c.display_name AS completed_name, s.display_name AS started_name
      FROM task_occurrences o JOIN task_templates t ON t.id = o.template_id
      LEFT JOIN users a ON a.id = o.assigned_to LEFT JOIN users c ON c.id = o.completed_by LEFT JOIN users s ON s.id = o.started_by
      WHERE o.branch_id = ? AND t.category = 'cleaning' AND (o.work_date = ? OR (o.work_date < ? AND t.carry_over = 1 AND o.status IN ('open','rework')))
      ORDER BY o.shift, o.position`).all(branchId, date, date);
    const L = ['de', 'ar', 'en', 'tr'].includes(ctx.query.get('lang')) ? ctx.query.get('lang') : 'de';
    const status = (o) => (['done', 'approved'].includes(o.status) ? 'done' : o.status === 'problem' ? 'problem' : o.work_date < date ? 'overdue' : o.started_at ? 'in_progress' : o.status === 'rework' ? 'rework' : 'open');
    return {
      date,
      tasks: rows.map((o) => { const t = JSON.parse(o.title), h = JSON.parse(o.hint);
        return { id: o.id, shift: o.shift, work_date: o.work_date, frequency: o.frequency, icon: o.icon, title: t[L] || t.de, hint: h[L] || h.de, requires_photo: !!o.requires_photo,
          cleaning_agent: o.cleaning_agent, sop_id: o.sop_id, status: status(o), assigned: o.assigned_name, completed_by: o.completed_name, completed_at: o.completed_at,
          started_by: o.started_name, started_at: o.started_at, note: o.note }; }),
      event_areas: EVENT_AREAS.map((a) => ({ area: a, last: db.prepare('SELECT l.created_at, u.display_name AS by FROM cleaning_logs l JOIN users u ON u.id = l.created_by WHERE branch_id = ? AND area = ? ORDER BY l.id DESC LIMIT 1').get(branchId, a) || null })),
    };
  });
  route('POST', '/api/cleaning/log', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch);
    if (!EVENT_AREAS.includes(ctx.body.area)) throw bad('area');
    let media = null;
    if (ctx.body.media_id != null) {
      const m = db.prepare('SELECT * FROM media WHERE id = ?').get(Number(ctx.body.media_id));
      if (!m || m.branch_id !== branchId) throw bad('media', 'Foto ungültig');
      media = m.id;
    }
    const id = Number(db.prepare('INSERT INTO cleaning_logs (branch_id, area, media_id, note, created_by) VALUES (?,?,?,?,?)').run(branchId, ctx.body.area, media, String(ctx.body.note || '').slice(0, 200) || null, u.id).lastInsertRowid);
    audit(db, { actor: u.id, branch: branchId, action: 'cleaning_log', entity: 'cleaning_log', id, payload: { area: ctx.body.area } });
    return { ok: true, id };
  });

  // --- Wochenbericht je Filiale ---
  route('GET', '/api/reports/week', (ctx) => {
    const branchId = needBranch(ctx, ctx.query.get('branch'), 'manager', 'shift_lead', 'admin');
    const week = /^\d{4}-W\d{2}$/.test(ctx.query.get('week') || '') ? ctx.query.get('week') : isoWeek(berlinDate());
    const dates = weekDates(week);
    const from = dates[0], to = dates[6];
    const days = dates.map((d) => {
      const c = db.prepare(`SELECT SUM(CASE WHEN status IN ('done','approved') THEN 1 ELSE 0 END) done, SUM(CASE WHEN status IN ('open','rework') THEN 1 ELSE 0 END) open,
        SUM(CASE WHEN status = 'problem' THEN 1 ELSE 0 END) problem, COUNT(*) total FROM task_occurrences WHERE branch_id = ? AND work_date = ?`).get(branchId, d);
      const daily = dailyStatus(db, branchId, d);
      return { date: d, done: c.done || 0, open: c.open || 0, problem: c.problem || 0, total: c.total, daily_early: daily.early.state, daily_late: daily.late.state };
    });
    const people = db.prepare(`SELECT u.display_name AS name, COUNT(*) n FROM task_occurrences o JOIN users u ON u.id = o.completed_by
      WHERE o.branch_id = ? AND o.work_date BETWEEN ? AND ? AND o.status IN ('done','approved') GROUP BY u.id ORDER BY n DESC`).all(branchId, from, to);
    const openAssigned = db.prepare(`SELECT u.display_name AS name, COUNT(*) n FROM task_occurrences o JOIN users u ON u.id = o.assigned_to
      WHERE o.branch_id = ? AND o.work_date BETWEEN ? AND ? AND o.status IN ('open','rework') GROUP BY u.id`).all(branchId, from, to);
    const overdue = db.prepare(`SELECT o.id, o.work_date, t.title, u.display_name AS assigned FROM task_occurrences o JOIN task_templates t ON t.id = o.template_id
      LEFT JOIN users u ON u.id = o.assigned_to WHERE o.branch_id = ? AND o.work_date <= ? AND o.status IN ('open','rework') AND (o.work_date < ? OR t.carry_over = 1)
      ORDER BY o.work_date`).all(branchId, to, berlinDate()).map((o) => ({ ...o, title: JSON.parse(o.title).de }));
    const cleaning = db.prepare(`SELECT SUM(CASE WHEN o.status IN ('done','approved') THEN 1 ELSE 0 END) done, COUNT(*) total FROM task_occurrences o JOIN task_templates t ON t.id = o.template_id
      WHERE o.branch_id = ? AND t.category = 'cleaning' AND o.work_date BETWEEN ? AND ?`).get(branchId, from, to);
    const oil = db.prepare(`SELECT f.name, e.type, e.reason, e.tpm, e.quality_ok, COALESCE(e.measured_at, e.created_at) AS at, u.display_name AS by FROM oil_events e
      JOIN fryers f ON f.id = e.fryer_id JOIN users u ON u.id = e.created_by WHERE e.branch_id = ? AND e.type IN ('change','filter') AND date(COALESCE(e.measured_at, e.created_at)) BETWEEN ? AND ? ORDER BY at`).all(branchId, from, to);
    const problems = db.prepare("SELECT SUM(CASE WHEN date(reported_at) BETWEEN ? AND ? THEN 1 ELSE 0 END) opened, SUM(CASE WHEN date(resolved_at) BETWEEN ? AND ? THEN 1 ELSE 0 END) resolved FROM problems WHERE branch_id = ?").get(from, to, from, to, branchId);
    const inv = db.prepare('SELECT status, submitted_at FROM inventory_counts WHERE branch_id = ? AND week = ?').get(branchId, week);
    const pest = db.prepare('SELECT COUNT(*) n, SUM(infestation) infest FROM pest_checks WHERE branch_id = ? AND date(created_at) BETWEEN ? AND ?').get(branchId, from, to);
    return { branch: db.prepare('SELECT name FROM branches WHERE id = ?').get(branchId).name, week, from, to, days, people, open_assigned: openAssigned, overdue,
      cleaning: { done: cleaning.done || 0, total: cleaning.total }, oil, problems: { opened: problems.opened || 0, resolved: problems.resolved || 0 },
      weekly_inventory: inv ? inv.status : 'missing', pest: { checks: pest.n, infestations: pest.infest || 0 } };
  });
}
