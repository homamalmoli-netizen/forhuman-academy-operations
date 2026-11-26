// Tägliche Inventur (Früh-/Spätschicht mit Frist), Schädlingskontrolle, Mitarbeiter-Handbuch und Einarbeitungsbestätigung.
import { tx, audit } from './db.js';
import { berlinDate } from './app.js';
import { branchSetting } from './inventory.js';
import { HANDBOOK, HANDBOOK_VERSION, ONBOARDING_AREAS, ONBOARDING_STATEMENT, PEST_AREAS, PEST_GUIDE } from './handbook.js';

export const DAILY_SHIFTS = ['early', 'late'];
const DEFAULT_DEADLINE = { early: '17:00', late: '23:00' };

export function berlinTime(d = new Date()) {
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
export const deadlineFor = (db, branchId, shift) => branchSetting(db, branchId, `daily_deadline_${shift}`, DEFAULT_DEADLINE[shift]);

export function dailyStatus(db, branchId, date = berlinDate(), now = new Date()) {
  const out = {};
  const nowLocal = `${berlinDate(now)} ${berlinTime(now)}`;
  // Tage vor Beginn der digitalen Tagesinventur nicht als "verpasst" werten
  const first = db.prepare('SELECT MIN(work_date) d FROM daily_counts WHERE branch_id = ?').get(branchId).d;
  const before = date < berlinDate(now) && (!first || date < first);
  for (const shift of DAILY_SHIFTS) {
    const deadline = deadlineFor(db, branchId, shift);
    const c = db.prepare(`SELECT c.*, u.display_name AS by FROM daily_counts c LEFT JOIN users u ON u.id = c.submitted_by
      WHERE c.branch_id = ? AND c.work_date = ? AND c.shift = ?`).get(branchId, date, shift);
    const done = c?.status === 'submitted';
    const late = !done && nowLocal > `${date} ${deadline}`;
    out[shift] = { deadline, state: done ? (c.on_time ? 'on_time' : 'late_done') : !c && before ? 'none' : late ? 'missed' : 'open',
      by: c?.by ?? null, submitted_at: c?.submitted_at ?? null, count_id: c?.id ?? null };
  }
  return out;
}

const remind = (db, branchId, ref, kind, message) =>
  db.prepare('INSERT OR IGNORE INTO notifications (branch_id, kind, message, ref) VALUES (?,?,?,?)').run(branchId, kind, message, ref).changes;

/** Erinnerung 60 Minuten vor der Frist und Meldung bei verpasster Frist (je Anlass einmal). */
export function runDailyReminders(db, branchId, now = new Date()) {
  const date = berlinDate(now);
  const st = dailyStatus(db, branchId, date, now);
  const label = { early: 'Frühschicht', late: 'Spätschicht' };
  let n = 0;
  for (const shift of DAILY_SHIFTS) {
    const s = st[shift];
    if (s.state === 'missed') n += remind(db, branchId, `remind:daily:${date}:${shift}:missed`, 'daily_inventory', `Tagesinventur ${label[shift]} nicht bis ${s.deadline} Uhr abgeschlossen.`);
    if (s.state === 'open') {
      const [h, m] = s.deadline.split(':').map(Number);
      const [nh, nm] = berlinTime(now).split(':').map(Number);
      const minutesLeft = h * 60 + m - (nh * 60 + nm);
      if (minutesLeft <= 60 && minutesLeft >= 0) n += remind(db, branchId, `remind:daily:${date}:${shift}:soon`, 'daily_inventory', `Tagesinventur ${label[shift]}: noch ${minutesLeft} Minuten bis ${s.deadline} Uhr.`);
    }
  }
  return n;
}

function dailyItems(db) {
  return db.prepare('SELECT id, name, unit, category, meat FROM items WHERE active = 1 AND daily_count = 1 ORDER BY meat DESC, category, name').all();
}

/** Fleisch-Auswertung: Anfangsbestand (letzte Zählung), Zugang (Wareneingang seitdem), Verbrauch, Rest, nicht verwendbar. */
function meatReport(db, branchId, count) {
  const prev = db.prepare(`SELECT * FROM daily_counts WHERE branch_id = ? AND status = 'submitted' AND submitted_at < ? ORDER BY submitted_at DESC LIMIT 1`).get(branchId, count.submitted_at);
  const lines = db.prepare('SELECT l.*, i.name, i.unit, i.meat FROM daily_count_lines l JOIN items i ON i.id = l.item_id WHERE count_id = ?').all(count.id);
  return lines.filter((l) => l.meat).map((l) => {
    const start = prev ? db.prepare('SELECT counted FROM daily_count_lines WHERE count_id = ? AND item_id = ?').get(prev.id, l.item_id)?.counted ?? null : null;
    const incoming = prev ? db.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM goods_receipts WHERE branch_id = ? AND item_id = ? AND decision = 'accepted' AND created_at > ? AND created_at <= ?`)
      .get(branchId, l.item_id, prev.submitted_at, count.submitted_at).q : null;
    const usage = start != null ? Math.round((start + incoming - l.counted - (l.unusable || 0)) * 1000) / 1000 : null;
    return { item: l.name, unit: l.unit, start, incoming, usage, rest: l.counted, marinated: l.marinated, unusable: l.unusable };
  });
}

export function registerDaily({ route, db, needUser, needBranch, HttpError, bad, can, notify }) {
  // --- Tägliche Inventur ---
  route('GET', '/api/daily', (ctx) => {
    needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    const shift = ctx.query.get('shift');
    if (!DAILY_SHIFTS.includes(shift)) throw bad('shift');
    const date = berlinDate();
    const st = dailyStatus(db, branchId, date)[shift];
    const lines = st.count_id ? new Map(db.prepare('SELECT * FROM daily_count_lines WHERE count_id = ?').all(st.count_id).map((l) => [l.item_id, l])) : new Map();
    return { date, shift, ...st,
      items: dailyItems(db).map((i) => ({ item_id: i.id, name: i.name, unit: i.unit, category: i.category, meat: !!i.meat,
        counted: lines.get(i.id)?.counted ?? null, marinated: lines.get(i.id)?.marinated ?? null, unusable: lines.get(i.id)?.unusable ?? null })) };
  });

  route('POST', '/api/daily', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch);
    const shift = ctx.body.shift;
    if (!DAILY_SHIFTS.includes(shift)) throw bad('shift');
    const date = berlinDate();
    const st = dailyStatus(db, branchId, date)[shift];
    if (['on_time', 'late_done'].includes(st.state)) throw new HttpError(409, 'daily_done', 'Diese Tagesinventur ist bereits abgeschlossen');
    const items = dailyItems(db);
    const given = new Map((Array.isArray(ctx.body.lines) ? ctx.body.lines : []).filter((l) => l.counted !== '' && l.counted != null).map((l) => [Number(l.item_id), l]));
    const num = (v) => (v === '' || v == null ? null : Number(v));
    for (const [, l] of given) for (const k of ['counted', 'marinated', 'unusable']) {
      const v = num(l[k]); if (v != null && (!Number.isFinite(v) || v < 0)) throw bad(k, 'Mengen müssen 0 oder größer sein');
    }
    const submit = !!ctx.body.submit;
    if (submit) {
      const missing = items.filter((i) => !given.has(i.id));
      if (missing.length) throw bad('daily_incomplete', `Noch nicht eingetragen: ${missing.map((m) => m.name).join(', ')}`);
    }
    return tx(db, () => {
      let id = st.count_id;
      if (!id) id = Number(db.prepare('INSERT INTO daily_counts (branch_id, work_date, shift, deadline) VALUES (?,?,?,?)').run(branchId, date, shift, st.deadline).lastInsertRowid);
      const up = db.prepare(`INSERT INTO daily_count_lines (count_id, item_id, counted, marinated, unusable, counted_by) VALUES (?,?,?,?,?,?)
        ON CONFLICT (count_id, item_id) DO UPDATE SET counted = excluded.counted, marinated = excluded.marinated, unusable = excluded.unusable, counted_by = excluded.counted_by`);
      for (const i of items) {
        const l = given.get(i.id); if (!l) continue;
        up.run(id, i.id, Number(l.counted), i.meat ? num(l.marinated) : null, num(l.unusable), u.id);
      }
      if (!submit) return { ok: true, saved: given.size };
      const now = new Date();
      const onTime = `${berlinDate(now)} ${berlinTime(now)}` <= `${date} ${st.deadline}`;
      db.prepare("UPDATE daily_counts SET status = 'submitted', submitted_by = ?, submitted_at = ?, on_time = ?, deadline = ?, note = ? WHERE id = ?")
        .run(u.id, now.toISOString(), onTime ? 1 : 0, st.deadline, String(ctx.body.note || '').slice(0, 300) || null, id);
      const unusable = items.filter((i) => num(given.get(i.id)?.unusable) > 0);
      if (unusable.length) notify(db, branchId, 'daily_inventory', `Nicht verwendbare Ware gemeldet: ${unusable.map((i) => i.name).join(', ')}`, `daily:${id}`);
      if (!onTime) notify(db, branchId, 'daily_inventory', `Tagesinventur ${shift === 'early' ? 'Frühschicht' : 'Spätschicht'} verspätet abgeschlossen (Frist ${st.deadline} Uhr)`, `daily:${id}`);
      audit(db, { actor: u.id, branch: branchId, action: 'daily_inventory', entity: 'daily_count', id, payload: { date, shift, on_time: onTime } });
      return { ok: true, on_time: onTime, count_id: id };
    });
  });

  // Auswertung für die Leitung: wer, wann, rechtzeitig; Fleisch-Verbrauch
  route('GET', '/api/daily/report', (ctx) => {
    const branchId = needBranch(ctx, ctx.query.get('branch'), 'manager', 'shift_lead', 'admin');
    const days = [];
    const today = berlinDate();
    for (let k = 0; k < 14; k++) {
      const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - k);
      const date = d.toISOString().slice(0, 10);
      days.push({ date, ...dailyStatus(db, branchId, date) });
    }
    const last = db.prepare("SELECT * FROM daily_counts WHERE branch_id = ? AND status = 'submitted' ORDER BY submitted_at DESC LIMIT 1").get(branchId);
    return { deadlines: { early: deadlineFor(db, branchId, 'early'), late: deadlineFor(db, branchId, 'late') }, days,
      meat: last ? { date: last.work_date, shift: last.shift, lines: meatReport(db, branchId, last) } : null };
  });

  route('PUT', '/api/daily/settings', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'manager', 'admin');
    for (const shift of DAILY_SHIFTS) {
      const v = ctx.body[shift];
      if (v == null) continue;
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw bad('deadline', 'Uhrzeit im Format HH:MM');
      db.prepare('INSERT INTO branch_settings (branch_id, key, value) VALUES (?,?,?) ON CONFLICT (branch_id, key) DO UPDATE SET value = excluded.value').run(branchId, `daily_deadline_${shift}`, v);
    }
    audit(db, { actor: u.id, branch: branchId, action: 'daily_deadlines', entity: 'branch', id: branchId, payload: ctx.body });
    return { ok: true };
  });

  // --- Schädlingskontrolle ---
  route('GET', '/api/pest', (ctx) => {
    needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    const history = db.prepare(`SELECT p.*, u.display_name AS by FROM pest_checks p JOIN users u ON u.id = p.created_by WHERE branch_id = ? ORDER BY p.id DESC LIMIT 10`).all(branchId)
      .map((p) => ({ ...p, areas: db.prepare('SELECT * FROM pest_check_areas WHERE check_id = ?').all(p.id) }));
    return { areas: PEST_AREAS, guide: PEST_GUIDE, history };
  });
  route('POST', '/api/pest', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch);
    const given = new Map((Array.isArray(ctx.body.areas) ? ctx.body.areas : []).map((a) => [a.area, a]));
    const missing = PEST_AREAS.filter((a) => !given.has(a));
    if (missing.length) throw bad('pest_incomplete', `Noch nicht kontrolliert: ${missing.join(', ')}`);
    const findings = PEST_AREAS.filter((a) => given.get(a).finding);
    const infestation = findings.length > 0;
    let media = null;
    if (ctx.body.media_id != null) {
      const m = db.prepare('SELECT * FROM media WHERE id = ?').get(Number(ctx.body.media_id));
      if (!m || m.branch_id !== branchId) throw bad('media', 'Foto ungültig');
      media = m.id;
    }
    if (infestation && !media) throw bad('photo_required', 'Bei Befall/Spuren ist ein Foto Pflicht');
    for (const a of findings) if (!String(given.get(a).note || '').trim()) throw bad('finding_note', `Bitte beschreiben, was im Bereich „${a}“ gefunden wurde`);
    return tx(db, () => {
      const id = Number(db.prepare('INSERT INTO pest_checks (branch_id, infestation, exterminator_needed, remarks, media_id, created_by) VALUES (?,?,?,?,?,?)')
        .run(branchId, infestation ? 1 : 0, ctx.body.exterminator_needed ? 1 : 0, String(ctx.body.remarks || '').slice(0, 500) || null, media, u.id).lastInsertRowid);
      const ins = db.prepare('INSERT INTO pest_check_areas (check_id, area, finding, note, measure, done) VALUES (?,?,?,?,?,?)');
      for (const a of PEST_AREAS) {
        const g = given.get(a);
        ins.run(id, a, g.finding ? 1 : 0, String(g.note || '').slice(0, 200) || null, String(g.measure || '').slice(0, 200) || null, g.done ? 1 : 0);
      }
      if (infestation) {
        db.prepare('INSERT INTO problems (branch_id, description, media_id, reported_by) VALUES (?,?,?,?)')
          .run(branchId, `Schädlingsbefall/Spuren: ${findings.map((a) => `${a} – ${given.get(a).note}`).join('; ')}${ctx.body.exterminator_needed ? ' · Schädlingsbekämpfer erforderlich' : ''}`, media, u.id);
        notify(db, branchId, 'pest', `Schädlingsbefall gemeldet: ${findings.join(', ')}`, `pest:${id}`);
      }
      audit(db, { actor: u.id, branch: branchId, action: 'pest_check', entity: 'pest_check', id, payload: { infestation, findings } });
      return { ok: true, id, infestation };
    });
  });

  // --- Handbuch & Einarbeitungsbestätigung ---
  route('GET', '/api/handbook', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    const mine = db.prepare('SELECT o.*, t.display_name AS trainer FROM onboarding_confirmations o JOIN users t ON t.id = o.trainer_id WHERE user_id = ? AND branch_id = ? AND handbook_version = ?').get(u.id, branchId, HANDBOOK_VERSION);
    return { version: HANDBOOK_VERSION, chapters: HANDBOOK, areas: ONBOARDING_AREAS, statement: ONBOARDING_STATEMENT,
      confirmation: mine ? { ...mine, areas: JSON.parse(mine.areas) } : null };
  });
  route('GET', '/api/onboarding', (ctx) => {
    const branchId = needBranch(ctx, ctx.query.get('branch'), 'trainer', 'manager', 'admin');
    const people = db.prepare(`SELECT DISTINCT u.id, u.display_name FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.branch_id = ? AND m.role IN ('employee','shift_lead') AND u.active = 1 ORDER BY u.display_name`).all(branchId);
    return { areas: ONBOARDING_AREAS, version: HANDBOOK_VERSION, people: people.map((p) => {
      const o = db.prepare('SELECT o.*, t.display_name AS trainer FROM onboarding_confirmations o JOIN users t ON t.id = o.trainer_id WHERE user_id = ? AND branch_id = ? AND handbook_version = ?').get(p.id, branchId, HANDBOOK_VERSION);
      return { ...p, confirmation: o ? { ...o, areas: JSON.parse(o.areas) } : null };
    }) };
  });
  // Schritt 1: Trainer bestätigt die Einweisung (Bereiche); Schritt 2: Mitarbeiter bestätigt selbst
  route('POST', '/api/onboarding', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'trainer', 'admin');
    const userId = Number(ctx.body.user_id);
    if (userId === u.id) throw new HttpError(403, 'self_onboarding', 'Eigene Einweisung kann nicht selbst bestätigt werden');
    if (!db.prepare("SELECT 1 FROM memberships WHERE user_id = ? AND branch_id = ?").get(userId, branchId)) throw bad('user');
    const areas = (Array.isArray(ctx.body.areas) ? ctx.body.areas : []).filter((a) => ONBOARDING_AREAS.includes(a));
    if (!areas.length) throw bad('areas', 'Mindestens einen Bereich auswählen');
    db.prepare(`INSERT INTO onboarding_confirmations (user_id, branch_id, handbook_version, areas, trainer_id, trainer_confirmed_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT (user_id, branch_id, handbook_version) DO UPDATE SET areas = excluded.areas, trainer_id = excluded.trainer_id, trainer_confirmed_at = excluded.trainer_confirmed_at, employee_confirmed_at = NULL`)
      .run(userId, branchId, HANDBOOK_VERSION, JSON.stringify(areas), u.id, new Date().toISOString());
    audit(db, { actor: u.id, branch: branchId, action: 'onboarding_trainer', entity: 'user', id: userId, payload: { areas } });
    return { ok: true };
  });
  route('POST', '/api/onboarding/confirm', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch);
    const o = db.prepare('SELECT * FROM onboarding_confirmations WHERE user_id = ? AND branch_id = ? AND handbook_version = ?').get(u.id, branchId, HANDBOOK_VERSION);
    if (!o) throw new HttpError(409, 'no_onboarding', 'Die Einweisung muss zuerst vom Trainer eingetragen werden');
    if (o.employee_confirmed_at) return { ok: true, already: true };
    db.prepare('UPDATE onboarding_confirmations SET employee_confirmed_at = ? WHERE id = ?').run(new Date().toISOString(), o.id);
    audit(db, { actor: u.id, branch: branchId, action: 'onboarding_employee', entity: 'user', id: u.id, payload: { version: HANDBOOK_VERSION } });
    return { ok: true };
  });
  void can;
}
