// Einarbeitungs-Freigabe und täglicher Hygiene-Check (Issue #20).
// Serverseitige Sperre regulärer Arbeitsaufgaben, bis die Voraussetzungen erfüllt sind und die Leitung freigegeben hat.
// Lernbereiche, Handbuch und Nachweis-Upload bleiben immer erreichbar.
// Rechtlicher Rahmen (kein Rechtsrat): Belehrung nach §43 Abs. 1 IfSG vor erstmaliger Tätigkeit, nicht älter als 3 Monate;
// Arbeitgeberbelehrung nach §43 Abs. 4 IfSG bei Aufnahme und danach alle 2 Jahre. Jährliche Hygieneschulung = ForHuman-Standard (Warnung).
import { audit } from './db.js';
import { berlinDate } from './app.js';
import { certStatus } from './accounts.js';
import { openTrainings } from './inventory.js';
import { HANDBOOK_VERSION } from './handbook.js';

// Hygiene-Check vor Schichtbeginn: betriebliche Standards (keine medizinischen Fragen, keine Diagnosen, kein Freitext).
export const HYGIENE_ITEMS = ['clothes', 'shoes', 'hair', 'beard', 'nails', 'no_polish', 'jewelry', 'hands', 'wounds', 'no_ban', 'private_items', 'rules'];
// „no_ban“ = keine bekannten Gründe für ein Tätigkeitsverbot. Ein „Nein“ darf die Leitung NICHT für Lebensmitteltätigkeit freigeben.
export const NON_OVERRIDABLE = ['no_ban'];

const setting = (db, b, k, d) => db.prepare('SELECT value FROM branch_settings WHERE branch_id = ? AND key = ?').get(b, k)?.value ?? d;
const monthsBefore = (date, m) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - m); return d.toISOString().slice(0, 10); };
const isLeadRole = (db, userId, branchId) => !!db.prepare("SELECT 1 FROM memberships WHERE user_id = ? AND branch_id = ? AND role IN ('manager','trainer')").get(userId, branchId)
  || !!db.prepare('SELECT 1 FROM users WHERE id = ? AND is_admin = 1').get(userId);

export function readiness(db, userId, branchId, today = berlinDate()) {
  const ifsg = certStatus(db, userId, branchId, 'ifsg43', today);
  const employer = db.prepare("SELECT issued_on FROM certificates WHERE user_id = ? AND type = 'ifsg_followup' AND status = 'approved' ORDER BY issued_on DESC LIMIT 1").get(userId);
  const employerOk = !!employer && employer.issued_on >= monthsBefore(today, 24);
  const onb = db.prepare('SELECT employee_confirmed_at FROM onboarding_confirmations WHERE user_id = ? AND branch_id = ? AND handbook_version = ?').get(userId, branchId, HANDBOOK_VERSION);
  const trainings = openTrainings(db, branchId).filter((o) => o.user_id === userId);
  const metro = certStatus(db, userId, branchId, 'metro_hygiene', today);
  const metroRecent = db.prepare("SELECT 1 FROM certificates WHERE user_id = ? AND type = 'metro_hygiene' AND status = 'approved' AND issued_on >= ?").get(userId, monthsBefore(today, 12));
  const rel = db.prepare('SELECT r.*, u.display_name released_name FROM work_releases r JOIN users u ON u.id = r.released_by WHERE r.user_id = ? AND r.branch_id = ? AND r.revoked_at IS NULL').get(userId, branchId);
  const items = [
    { key: 'ifsg43', label: 'Belehrung nach §43 IfSG (Gesundheitsamt) – Nachweis bestätigt', ok: ifsg.state === 'approved', blocking: true, issued_on: ifsg.issued_on || null },
    { key: 'employer_instruction', label: 'Arbeitgeberbelehrung nach §43 Abs. 4 IfSG – bei Aufnahme, dann alle 2 Jahre', ok: employerOk, blocking: true, issued_on: employer?.issued_on || null },
    { key: 'onboarding', label: 'Einweisung und Mitarbeiter-Handbuch bestätigt', ok: !!onb?.employee_confirmed_at, blocking: true },
    { key: 'trainings', label: 'Pflichtschulungen bestanden', ok: trainings.length === 0, blocking: true, open: trainings.map((t) => t.title) },
    { key: 'annual_hygiene', label: 'Hygieneschulung der letzten 12 Monate (ForHuman-Standard)', ok: !!metroRecent, blocking: false, state: metro.state },
  ];
  const ready = items.filter((i) => i.blocking).every((i) => i.ok);
  return { ready, released: !!rel, release: rel || null, items };
}

/** Prüft, ob reguläre Arbeitsaufgaben erlaubt sind. Leitung, Trainer und Betreiber sind ausgenommen. */
export function workGate(db, userId, branchId, shift = null, date = berlinDate()) {
  if (isLeadRole(db, userId, branchId)) return { ok: true };
  if (setting(db, branchId, 'gate_release', '1') === '1') {
    const r = readiness(db, userId, branchId, date);
    if (!r.released) return { ok: false, reason: 'not_released', message: 'Noch nicht für Arbeitsaufgaben freigegeben – erst Einarbeitung abschließen.', readiness: r };
  }
  if (setting(db, branchId, 'gate_hygiene', '1') === '1') {
    const q = shift
      ? db.prepare('SELECT * FROM hygiene_checks WHERE branch_id = ? AND user_id = ? AND work_date = ? AND shift = ?').get(branchId, userId, date, shift)
      : db.prepare('SELECT * FROM hygiene_checks WHERE branch_id = ? AND user_id = ? AND work_date = ? ORDER BY id DESC LIMIT 1').get(branchId, userId, date);
    if (!q) return { ok: false, reason: 'hygiene_check_required', message: 'Vor Schichtbeginn den Hygiene-Check ausfüllen.' };
    if (q.review_status === 'pending') return { ok: false, reason: 'hygiene_pending', message: 'Hygiene-Check: Die Leitung prüft. Bitte kurz melden.' };
    if (q.review_status === 'blocked') return { ok: false, reason: 'hygiene_blocked', message: 'Heute keine Arbeit mit Lebensmitteln – bitte mit der Leitung sprechen.' };
  }
  return { ok: true };
}

export function purgeHygiene(db, now = new Date()) {
  for (const b of db.prepare('SELECT id FROM branches').all()) {
    const days = Number(setting(db, b.id, 'hygiene_retention_days', '30')) || 30;
    const cut = new Date(now.getTime() - days * 86400e3).toISOString().slice(0, 10);
    db.prepare('UPDATE hygiene_checks SET answers = NULL WHERE branch_id = ? AND work_date < ? AND answers IS NOT NULL').run(b.id, cut);
  }
}

export function registerReadiness({ route, db, needUser, needBranch, HttpError, bad, notFound, notify }) {
  route('GET', '/api/readiness/me', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    const shift = ctx.query.get('shift') || null;
    return { ...readiness(db, u.id, branchId), gate: workGate(db, u.id, branchId, shift), items_hygiene: HYGIENE_ITEMS,
      hygiene_today: db.prepare('SELECT shift, all_ok, review_status, created_at FROM hygiene_checks WHERE branch_id = ? AND user_id = ? AND work_date = ?').all(branchId, u.id, berlinDate()) };
  });

  route('GET', '/api/readiness', (ctx) => {
    needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'), 'manager', 'admin');
    const people = db.prepare(`SELECT DISTINCT u.id, u.display_name FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.branch_id = ? AND m.role IN ('employee','shift_lead') AND u.active = 1 ORDER BY u.display_name`).all(branchId);
    const pending = db.prepare(`SELECT h.id, h.user_id, h.shift, h.work_date, h.answers, h.created_at, u.display_name FROM hygiene_checks h JOIN users u ON u.id = h.user_id
      WHERE h.branch_id = ? AND h.review_status = 'pending' ORDER BY h.created_at`).all(branchId)
      .map((h) => { const a = h.answers ? JSON.parse(h.answers) : {}; const no = Object.keys(a).filter((k) => a[k] === 'no');
        return { id: h.id, user_id: h.user_id, name: h.display_name, shift: h.shift, work_date: h.work_date, created_at: h.created_at, no, can_clear: !no.some((k) => NON_OVERRIDABLE.includes(k)) }; });
    return { people: people.map((p) => ({ ...p, ...readiness(db, p.id, branchId) })), pending,
      gate_release: setting(db, branchId, 'gate_release', '1') === '1', gate_hygiene: setting(db, branchId, 'gate_hygiene', '1') === '1',
      retention_days: Number(setting(db, branchId, 'hygiene_retention_days', '30')) };
  });

  route('POST', '/api/readiness/:id/release', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'manager', 'admin');
    const uid = Number(ctx.params.id);
    if (uid === u.id) throw new HttpError(403, 'self', 'Eigene Freigabe ist nicht erlaubt');
    if (!db.prepare("SELECT 1 FROM memberships WHERE user_id = ? AND branch_id = ? AND role IN ('employee','shift_lead')").get(uid, branchId)) throw notFound();
    const r = readiness(db, uid, branchId);
    const missing = r.items.filter((i) => i.blocking && !i.ok).map((i) => i.label);
    if (missing.length) throw new HttpError(409, 'not_ready', `Noch nicht erfüllt: ${missing.join('; ')}`);
    // Erstbelehrung darf bei Aufnahme der Tätigkeit höchstens 3 Monate alt sein – außer die Tätigkeit wurde nachweislich früher rechtzeitig aufgenommen
    const ifsg = r.items.find((i) => i.key === 'ifsg43');
    const prior = !!ctx.body.prior_activity;
    const note = String(ctx.body.note || '').trim().slice(0, 300);
    if (ifsg.issued_on && ifsg.issued_on < monthsBefore(berlinDate(), 3) && !prior)
      throw new HttpError(409, 'ifsg_too_old', 'Belehrung nach §43 IfSG ist älter als 3 Monate. Nur freigeben, wenn die Tätigkeit früher rechtzeitig aufgenommen wurde (mit Notiz).');
    if (prior && !note) throw bad('note', 'Notiz zur früheren Aufnahme der Tätigkeit angeben');
    db.prepare(`INSERT INTO work_releases (user_id, branch_id, released_by, prior_activity, note) VALUES (?,?,?,?,?)
      ON CONFLICT (user_id, branch_id) DO UPDATE SET released_by = excluded.released_by, released_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), prior_activity = excluded.prior_activity, note = excluded.note, revoked_at = NULL`)
      .run(uid, branchId, u.id, prior ? 1 : 0, note || null);
    audit(db, { actor: u.id, branch: branchId, action: 'work_release', entity: 'user', id: uid, payload: { prior } });
    return { ok: true };
  });

  route('POST', '/api/readiness/:id/revoke', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'manager', 'admin');
    const note = String(ctx.body.note || '').trim();
    if (!note) throw bad('note', 'Grund angeben');
    const res = db.prepare('UPDATE work_releases SET revoked_at = ?, note = ? WHERE user_id = ? AND branch_id = ? AND revoked_at IS NULL').run(new Date().toISOString(), note.slice(0, 300), Number(ctx.params.id), branchId);
    if (!res.changes) throw notFound();
    audit(db, { actor: u.id, branch: branchId, action: 'work_revoke', entity: 'user', id: Number(ctx.params.id) });
    return { ok: true };
  });

  route('PUT', '/api/readiness/settings', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'manager', 'admin');
    const put = (k, v) => db.prepare('INSERT INTO branch_settings (branch_id, key, value) VALUES (?,?,?) ON CONFLICT (branch_id, key) DO UPDATE SET value = excluded.value').run(branchId, k, v);
    if (ctx.body.gate_release !== undefined) put('gate_release', ctx.body.gate_release ? '1' : '0');
    if (ctx.body.gate_hygiene !== undefined) put('gate_hygiene', ctx.body.gate_hygiene ? '1' : '0');
    if (ctx.body.retention_days !== undefined) {
      const d = Number(ctx.body.retention_days);
      if (!(d >= 1 && d <= 365)) throw bad('retention_days', '1–365 Tage');
      put('hygiene_retention_days', String(d));
    }
    audit(db, { actor: u.id, branch: branchId, action: 'readiness_settings', entity: 'branch', id: branchId, payload: ctx.body });
    return { ok: true };
  });

  // Hygiene-Check: alle Punkte Ja/Nein, keine Vorauswahl. Bei „Nein“ vertrauliche Leitungsprüfung (Meldung ohne Details).
  route('POST', '/api/hygiene', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch);
    const shift = ctx.body.shift;
    if (!['open', 'run', 'close'].includes(shift)) throw bad('shift');
    const a = ctx.body.answers || {};
    const missing = HYGIENE_ITEMS.filter((k) => !['yes', 'no'].includes(a[k]));
    if (missing.length) throw bad('hygiene_incomplete', 'Bitte jeden Punkt mit Ja oder Nein beantworten');
    const clean = Object.fromEntries(HYGIENE_ITEMS.map((k) => [k, a[k]]));
    const allOk = HYGIENE_ITEMS.every((k) => clean[k] === 'yes');
    const date = berlinDate();
    const ex = db.prepare('SELECT * FROM hygiene_checks WHERE branch_id = ? AND user_id = ? AND work_date = ? AND shift = ?').get(branchId, u.id, date, shift);
    if (ex && ex.review_status === 'blocked') throw new HttpError(409, 'hygiene_blocked', 'Heute gesperrt – bitte mit der Leitung sprechen');
    if (ex) db.prepare("UPDATE hygiene_checks SET answers = ?, all_ok = ?, review_status = ?, created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), reviewed_by = NULL, reviewed_at = NULL WHERE id = ?")
      .run(JSON.stringify(clean), allOk ? 1 : 0, allOk ? 'none' : 'pending', ex.id);
    else db.prepare('INSERT INTO hygiene_checks (branch_id, user_id, work_date, shift, answers, all_ok, review_status) VALUES (?,?,?,?,?,?,?)')
      .run(branchId, u.id, date, shift, JSON.stringify(clean), allOk ? 1 : 0, allOk ? 'none' : 'pending');
    if (!allOk) notify(db, branchId, 'hygiene', `Hygiene-Check: bitte kurz mit ${u.display_name} sprechen (${shift === 'open' ? 'Öffnung' : shift === 'run' ? 'laufender Betrieb' : 'Schließung'}).`, `remind:hyg:${u.id}:${date}:${shift}:${Date.now()}`, null, 'manager');
    return { ok: true, all_ok: allOk, review: allOk ? null : 'pending' };
  });

  route('POST', '/api/hygiene/:id/review', (ctx) => {
    const u = needUser(ctx);
    const h = db.prepare('SELECT * FROM hygiene_checks WHERE id = ?').get(Number(ctx.params.id)); if (!h) throw notFound();
    const branchId = needBranch(ctx, h.branch_id, 'manager', 'admin');
    if (h.user_id === u.id) throw new HttpError(403, 'self', 'Eigenen Check nicht selbst prüfen');
    if (h.review_status !== 'pending') throw new HttpError(409, 'not_pending');
    const decision = ctx.body.decision;
    if (!['cleared', 'blocked'].includes(decision)) throw bad('decision');
    const a = h.answers ? JSON.parse(h.answers) : {};
    if (decision === 'cleared' && NON_OVERRIDABLE.some((k) => a[k] === 'no'))
      throw new HttpError(409, 'legal_ban', 'Ein mögliches Tätigkeitsverbot kann nicht übersteuert werden – keine Arbeit mit Lebensmitteln, Klärung nach Vorgabe (IfSG).');
    db.prepare('UPDATE hygiene_checks SET review_status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?').run(decision, u.id, new Date().toISOString(), h.id);
    audit(db, { actor: u.id, branch: branchId, action: 'hygiene_review', entity: 'hygiene_check', id: h.id, payload: { decision } });
    return { ok: true };
  });
}
