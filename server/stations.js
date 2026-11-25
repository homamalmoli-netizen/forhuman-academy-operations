// Stationen & Positionen, Stationscheck (Beobachtung durch Trainer), Stufen, Positionsplan der Schicht, Haltezeit-Timer.
// Prinzip wie in großen Systemgastronomie-Ketten, aber eigene ForHuman-Inhalte. Zeiten/Werte nur mit Quellenangabe.
import { tx, audit } from './db.js';
import { can } from './auth.js';
import { berlinDate, qualification } from './app.js';

const SHIFTS = ['open', 'run', 'close'];
export const LEVELS = ['new', 'crew', 'allrounder', 'trainer', 'shift_lead'];

export function isCertified(db, userId, stationId) {
  return !!db.prepare('SELECT 1 FROM station_certifications WHERE user_id = ? AND station_id = ?').get(userId, stationId);
}

export function levelOf(db, userId, branchId) {
  const roles = db.prepare('SELECT role FROM memberships WHERE user_id = ? AND branch_id = ?').all(userId, branchId).map((r) => r.role);
  const total = db.prepare('SELECT COUNT(*) n FROM stations WHERE branch_id = ? AND active = 1').get(branchId).n;
  const certified = db.prepare(`SELECT COUNT(*) n FROM station_certifications c JOIN stations s ON s.id = c.station_id
    WHERE c.user_id = ? AND s.branch_id = ? AND s.active = 1`).get(userId, branchId).n;
  let level = certified === 0 ? 'new' : total > 0 && certified >= total ? 'allrounder' : 'crew';
  if (roles.includes('trainer')) level = 'trainer';
  if (roles.includes('shift_lead')) level = 'shift_lead';
  return { level, rank: LEVELS.indexOf(level) + 1, certified, total };
}

function timerState(t, now = Date.now()) {
  if (t.status !== 'running') return t.status;
  return Date.parse(t.ends_at) <= now ? 'expired' : 'running';
}

/** Darf die Person an dieser Station arbeiten? Freigegeben, laut heutigem Plan eingeteilt (auch Einarbeitung) oder Leitung. */
export function stationAccess(db, user, stationId, branchId) {
  if (!stationId || can(user, branchId, 'manager', 'shift_lead', 'admin')) return true;
  if (isCertified(db, user.id, stationId)) return true;
  return !!db.prepare(`SELECT 1 FROM position_plans p JOIN position_assignments a ON a.plan_id = p.id
    WHERE p.branch_id = ? AND p.work_date = ? AND a.user_id = ? AND a.station_id = ?`).get(branchId, berlinDate(), user.id, stationId);
}

export function myStationIds(db, userId, branchId, shift) {
  return db.prepare(`SELECT a.station_id FROM position_plans p JOIN position_assignments a ON a.plan_id = p.id
    WHERE p.branch_id = ? AND p.work_date = ? AND p.shift = ? AND a.user_id = ?`).all(branchId, berlinDate(), shift, userId).map((r) => r.station_id);
}

export function stationDashboard(db, branchId) {
  const now = Date.now();
  const running = db.prepare("SELECT * FROM timers WHERE branch_id = ? AND status = 'running'").all(branchId);
  const date = berlinDate();
  const plans = db.prepare('SELECT shift FROM position_plans WHERE branch_id = ? AND work_date = ?').all(branchId, date).map((p) => p.shift);
  return {
    timers_running: running.filter((t) => timerState(t, now) === 'running').length,
    timers_expired: running.filter((t) => t.kind === 'hold' && timerState(t, now) === 'expired').length,
    position_plans_today: plans,
  };
}

export function registerStations({ route, db, needUser, needBranch, lang, HttpError, bad, forbidden, notFound, j, pickLang }) {
  const stationIn = (id, branchId) => {
    const s = db.prepare('SELECT * FROM stations WHERE id = ? AND active = 1').get(Number(id));
    if (!s || (branchId != null && s.branch_id !== branchId)) throw notFound();
    return s;
  };
  const people = (branchId) => db.prepare(`SELECT DISTINCT u.id, u.display_name FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.branch_id = ? AND m.role IN ('employee','shift_lead','trainer') AND u.active = 1 ORDER BY u.display_name`).all(branchId);

  // Stationen mit eigenem Status
  route('GET', '/api/stations', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    const L = lang(ctx);
    return {
      level: levelOf(db, u.id, branchId),
      stations: db.prepare('SELECT * FROM stations WHERE branch_id = ? AND active = 1 ORDER BY position').all(branchId).map((s) => {
        const last = db.prepare('SELECT score, total, passed, critical_failed, created_at FROM observations WHERE user_id = ? AND station_id = ? ORDER BY id DESC LIMIT 1').get(u.id, s.id);
        return { id: s.id, code: s.code, icon: s.icon, name: pickLang(j(s.name), L), sop_id: s.sop_id, course_id: s.course_id,
          course_ok: s.course_id ? qualification(db, u.id, s.course_id, branchId).exam : true,
          certified: isCertified(db, u.id, s.id), last_observation: last || null };
      }),
    };
  });

  // Checkliste für den Stationscheck (nur Trainer)
  route('GET', '/api/stations/:id/checklist', (ctx) => {
    needUser(ctx);
    const s = stationIn(ctx.params.id);
    needBranch(ctx, s.branch_id, 'trainer', 'admin');
    const L = lang(ctx);
    return { id: s.id, name: pickLang(j(s.name), L), pass_percent: s.pass_percent,
      items: db.prepare('SELECT id, text, critical FROM observation_items WHERE station_id = ? AND active = 1 ORDER BY position').all(s.id)
        .map((i) => ({ id: i.id, text: pickLang(j(i.text), L), critical: !!i.critical })),
      people: people(s.branch_id).map((p) => ({ ...p, certified: isCertified(db, p.id, s.id),
        course_ok: s.course_id ? qualification(db, p.id, s.course_id, s.branch_id).exam : true })) };
  });

  route('POST', '/api/observations', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'trainer', 'admin');
    const s = stationIn(ctx.body.station_id, branchId);
    const userId = Number(ctx.body.user_id);
    if (userId === u.id) throw new HttpError(403, 'self_observation', 'Eigene Beobachtung ist nicht erlaubt');
    if (!people(branchId).some((p) => p.id === userId)) throw forbidden();
    // Beobachter muss die Station selbst beherrschen (Ausnahme: Betreiber/Admin für den Start)
    if (!u.is_admin && !isCertified(db, u.id, s.id)) throw new HttpError(403, 'observer_not_certified', 'Du bist für diese Station selbst noch nicht freigegeben');
    if (s.course_id && !qualification(db, userId, s.course_id, branchId).exam) throw new HttpError(409, 'course_missing', 'Erst die Schulung zur Station bestehen');
    const items = db.prepare('SELECT id, critical FROM observation_items WHERE station_id = ? AND active = 1').all(s.id);
    const given = new Map((Array.isArray(ctx.body.results) ? ctx.body.results : []).map((r) => [Number(r.item_id), !!r.ok]));
    if (items.some((i) => !given.has(i.id))) throw bad('results', 'Bitte alle Punkte bewerten');
    const results = items.map((i) => ({ item_id: i.id, ok: given.get(i.id), critical: !!i.critical }));
    const score = results.filter((r) => r.ok).length;
    const criticalFailed = results.filter((r) => r.critical && !r.ok).length;
    const passed = criticalFailed === 0 && score * 100 >= s.pass_percent * items.length;
    return tx(db, () => {
      const oid = Number(db.prepare(`INSERT INTO observations (station_id, branch_id, user_id, observer_id, results, score, total, critical_failed, passed, note)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(s.id, branchId, userId, u.id, JSON.stringify(results), score, items.length, criticalFailed, passed ? 1 : 0,
        String(ctx.body.note || '').slice(0, 500) || null).lastInsertRowid);
      if (passed) {
        db.prepare(`INSERT INTO station_certifications (user_id, station_id, observation_id, certified_by) VALUES (?,?,?,?)
          ON CONFLICT (user_id, station_id) DO UPDATE SET observation_id = excluded.observation_id, certified_by = excluded.certified_by, certified_at = excluded.certified_at`)
          .run(userId, s.id, oid, u.id);
      }
      audit(db, { actor: u.id, branch: branchId, action: 'station_observation', entity: 'station', id: s.id, payload: { user: userId, score, total: items.length, criticalFailed, passed } });
      return { id: oid, score, total: items.length, critical_failed: criticalFailed, passed, level: levelOf(db, userId, branchId) };
    });
  });

  // Übersicht: wer ist für welche Station freigegeben, welche Stufe
  route('GET', '/api/stations/matrix', (ctx) => {
    const branchId = needBranch(ctx, ctx.query.get('branch'), 'manager', 'shift_lead', 'trainer', 'admin');
    const L = lang(ctx);
    const stations = db.prepare('SELECT id, name, icon FROM stations WHERE branch_id = ? AND active = 1 ORDER BY position').all(branchId)
      .map((s) => ({ id: s.id, icon: s.icon, name: pickLang(j(s.name), L) }));
    return { stations, people: people(branchId).map((p) => ({ ...p, ...levelOf(db, p.id, branchId),
      stations: Object.fromEntries(stations.map((s) => [s.id, isCertified(db, p.id, s.id)])) })) };
  });

  // Positionsplan
  const planFor = (branchId, date, shift) => db.prepare('SELECT * FROM position_plans WHERE branch_id = ? AND work_date = ? AND shift = ?').get(branchId, date, shift);
  route('GET', '/api/positions', (ctx) => {
    const branchId = needBranch(ctx, ctx.query.get('branch'), 'manager', 'shift_lead', 'admin');
    const date = ctx.query.get('date') || berlinDate();
    const shift = ctx.query.get('shift');
    if (!SHIFTS.includes(shift) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('shift');
    const L = lang(ctx);
    const plan = planFor(branchId, date, shift);
    const assignments = plan ? db.prepare('SELECT a.*, u.display_name FROM position_assignments a JOIN users u ON u.id = a.user_id WHERE plan_id = ?').all(plan.id) : [];
    const staff = people(branchId);
    return {
      date, shift, plan_id: plan?.id ?? null, updated_at: plan?.updated_at ?? null,
      stations: db.prepare('SELECT * FROM stations WHERE branch_id = ? AND active = 1 ORDER BY position').all(branchId).map((s) => ({
        id: s.id, icon: s.icon, name: pickLang(j(s.name), L),
        assigned: assignments.filter((a) => a.station_id === s.id).map((a) => ({ user_id: a.user_id, display_name: a.display_name, training: !!a.training })),
        certified_people: staff.filter((p) => isCertified(db, p.id, s.id)).map((p) => p.id),
      })),
      staff,
    };
  });
  route('PUT', '/api/positions', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'manager', 'shift_lead', 'admin');
    const { date, shift } = ctx.body;
    if (!SHIFTS.includes(shift) || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw bad('shift');
    const list = Array.isArray(ctx.body.assignments) ? ctx.body.assignments : [];
    const staffIds = new Set(people(branchId).map((p) => p.id));
    const clean = [];
    for (const a of list) {
      const s = stationIn(a.station_id, branchId);
      const userId = Number(a.user_id);
      if (!staffIds.has(userId)) throw bad('user', 'Person gehört nicht zu dieser Filiale');
      const training = !!a.training;
      if (!training && !isCertified(db, userId, s.id)) {
        throw new HttpError(409, 'not_certified', `${db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId).display_name} ist für ${j(s.name).de} nicht freigegeben – nur als Einarbeitung mit freigegebener Person möglich`);
      }
      clean.push({ station_id: s.id, user_id: userId, training: training ? 1 : 0 });
    }
    // Einarbeitung nur, wenn an derselben Station eine freigegebene Person eingeteilt ist
    for (const a of clean.filter((x) => x.training)) {
      const coach = clean.some((b) => b.station_id === a.station_id && !b.training && b.user_id !== a.user_id);
      if (!coach) throw new HttpError(409, 'training_without_coach', 'Einarbeitung nur zusammen mit einer freigegebenen Person an derselben Station');
    }
    return tx(db, () => {
      let plan = planFor(branchId, date, shift);
      if (!plan) {
        const id = db.prepare('INSERT INTO position_plans (branch_id, work_date, shift, created_by) VALUES (?,?,?,?)').run(branchId, date, shift, u.id).lastInsertRowid;
        plan = { id: Number(id) };
      } else {
        db.prepare('UPDATE position_plans SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), plan.id);
      }
      db.prepare('DELETE FROM position_assignments WHERE plan_id = ?').run(plan.id);
      const ins = db.prepare('INSERT OR IGNORE INTO position_assignments (plan_id, station_id, user_id, training) VALUES (?,?,?,?)');
      for (const a of clean) ins.run(plan.id, a.station_id, a.user_id, a.training);
      audit(db, { actor: u.id, branch: branchId, action: 'position_plan', entity: 'position_plan', id: plan.id, payload: { date, shift, count: clean.length } });
      return { ok: true, plan_id: plan.id };
    });
  });

  // Meine Station(en) heute
  route('GET', '/api/my-stations', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    const shift = ctx.query.get('shift');
    if (!SHIFTS.includes(shift)) throw bad('shift');
    const L = lang(ctx);
    return db.prepare(`SELECT s.id, s.name, s.icon, s.sop_id, a.training FROM position_plans p JOIN position_assignments a ON a.plan_id = p.id
      JOIN stations s ON s.id = a.station_id WHERE p.branch_id = ? AND p.work_date = ? AND p.shift = ? AND a.user_id = ? ORDER BY s.position`)
      .all(branchId, berlinDate(), shift, u.id).map((s) => ({ id: s.id, icon: s.icon, sop_id: s.sop_id, training: !!s.training, name: pickLang(j(s.name), L) }));
  });

  // Produkte & Haltezeiten
  const productView = (p, L) => ({ id: p.id, icon: p.icon, name: pickLang(j(p.name), L), name_de: j(p.name).de, station_id: p.station_id,
    hold_minutes: p.hold_minutes, cook_seconds: p.cook_seconds, value_source: p.value_source, active: !!p.active });
  route('GET', '/api/products', (ctx) => {
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    return db.prepare('SELECT * FROM products WHERE branch_id = ? ORDER BY id').all(branchId).map((p) => productView(p, lang(ctx)));
  });
  route('POST', '/api/products', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'manager', 'admin');
    const name = String(ctx.body.name_de || '').trim();
    if (!name) throw bad('name', 'Name fehlt');
    const station = ctx.body.station_id ? stationIn(ctx.body.station_id, branchId).id : null;
    const id = Number(db.prepare('INSERT INTO products (branch_id, name, icon, station_id) VALUES (?,?,?,?)').run(branchId, JSON.stringify({ de: name.slice(0, 80) }), ctx.body.icon || 'prep', station).lastInsertRowid);
    audit(db, { actor: u.id, branch: branchId, action: 'create', entity: 'product', id });
    return { id };
  });
  route('PATCH', '/api/products/:id', (ctx) => {
    const u = needUser(ctx);
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(ctx.params.id));
    if (!p) throw notFound();
    const branchId = needBranch(ctx, p.branch_id, 'manager', 'admin');
    const b = ctx.body;
    const int = (v) => (v === '' || v == null ? null : Number(v));
    const hold = b.hold_minutes !== undefined ? int(b.hold_minutes) : p.hold_minutes;
    const cook = b.cook_seconds !== undefined ? int(b.cook_seconds) : p.cook_seconds;
    const source = b.value_source !== undefined ? String(b.value_source || '').trim() || null : p.value_source;
    if ((hold != null || cook != null) && !source) throw bad('value_source', 'Quelle angeben (Herstellerangabe / freigegebene Rezeptur / HACCP-Plan)');
    if (hold != null && !(Number.isInteger(hold) && hold >= 1 && hold <= 720)) throw bad('hold_minutes', 'Haltezeit 1–720 Minuten');
    if (cook != null && !(Number.isInteger(cook) && cook >= 10 && cook <= 7200)) throw bad('cook_seconds', 'Zeit 10–7200 Sekunden');
    db.prepare('UPDATE products SET hold_minutes = ?, cook_seconds = ?, value_source = ?, active = ? WHERE id = ?')
      .run(hold, cook, hold == null && cook == null ? null : source, b.active != null ? (b.active ? 1 : 0) : p.active, p.id);
    audit(db, { actor: u.id, branch: branchId, action: 'set_times', entity: 'product', id: p.id, payload: { hold, cook, source } });
    return { ok: true };
  });

  // Timer
  const timerView = (t, L, now) => {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(t.product_id);
    return { id: t.id, kind: t.kind, product: productView(p, L), started_at: t.started_at, ends_at: t.ends_at,
      state: timerState(t, now), remaining_s: Math.round((Date.parse(t.ends_at) - now) / 1000),
      started_by: db.prepare('SELECT display_name FROM users WHERE id = ?').get(t.started_by).display_name };
  };
  const mayUseStation = (u, stationId, branchId) => stationAccess(db, u, stationId, branchId);
  route('GET', '/api/timers', (ctx) => {
    needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    const now = Date.now();
    return { now: new Date(now).toISOString(),
      timers: db.prepare("SELECT * FROM timers WHERE branch_id = ? AND status = 'running' ORDER BY ends_at").all(branchId).map((t) => timerView(t, lang(ctx), now)) };
  });
  route('POST', '/api/timers', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch);
    const p = db.prepare('SELECT * FROM products WHERE id = ? AND branch_id = ? AND active = 1').get(Number(ctx.body.product_id), branchId);
    if (!p) throw bad('product');
    const kind = ctx.body.kind === 'cook' ? 'cook' : 'hold';
    const secs = kind === 'hold' ? (p.hold_minutes != null ? p.hold_minutes * 60 : null) : p.cook_seconds;
    if (secs == null) throw new HttpError(409, 'no_value', 'Für dieses Produkt ist noch keine freigegebene Zeit hinterlegt. Leitung fragen.');
    if (!mayUseStation(u, p.station_id, branchId)) throw new HttpError(403, 'not_certified', 'Du bist für diese Station nicht freigegeben');
    const start = new Date();
    const id = Number(db.prepare('INSERT INTO timers (branch_id, product_id, kind, started_by, started_at, ends_at) VALUES (?,?,?,?,?,?)')
      .run(branchId, p.id, kind, u.id, start.toISOString(), new Date(start.getTime() + secs * 1000).toISOString()).lastInsertRowid);
    audit(db, { actor: u.id, branch: branchId, action: 'timer_start', entity: 'timer', id, payload: { product: p.id, kind, secs } });
    return timerView(db.prepare('SELECT * FROM timers WHERE id = ?').get(id), lang(ctx), Date.now());
  });
  route('POST', '/api/timers/:id/end', (ctx) => {
    const u = needUser(ctx);
    const t = db.prepare('SELECT * FROM timers WHERE id = ?').get(Number(ctx.params.id));
    if (!t) throw notFound();
    const branchId = needBranch(ctx, t.branch_id);
    if (t.status !== 'running') throw new HttpError(409, 'not_running', 'Timer ist schon beendet');
    const action = ctx.body.action === 'discarded' ? 'discarded' : 'done';
    // Abgelaufene Haltezeit: Ware darf nicht mehr verwendet werden -> nur "entsorgt" möglich
    if (t.kind === 'hold' && action === 'done' && timerState(t) === 'expired') throw new HttpError(409, 'expired', 'Haltezeit abgelaufen – bitte entsorgen');
    db.prepare('UPDATE timers SET status = ?, ended_by = ?, ended_at = ? WHERE id = ?').run(action, u.id, new Date().toISOString(), t.id);
    audit(db, { actor: u.id, branch: branchId, action: 'timer_' + action, entity: 'timer', id: t.id, payload: { expired: timerState(t) === 'expired' } });
    return { ok: true };
  });

}
