// Fahrer & Fahrzeuge (Issue #20).
// Persönliche Aufgaben je Fahrzeug und Schicht: Start- und Endkontrolle mit Tank- und Innenraumfoto.
// Nur der Fahrer selbst kann seine Kontrolle abgeben – keine Bestätigung durch andere.
// Ein „Nein“ bei einem sicherheitsrelevanten Punkt sperrt das Fahrzeug, bis die Leitung die Behebung dokumentiert.
// Führerscheinkontrolle: nur Klasse, Datum und prüfende Person – keine Kopie, keine Führerscheinnummer.
// Prüfintervall ist eine Betreiber-Einstellung (keine erfundene Vorgabe); ohne Einstellung reicht eine dokumentierte Prüfung.
import { audit } from './db.js';
import { berlinDate } from './app.js';
import { workGate } from './readiness.js';

// Startkontrolle: Ja = in Ordnung. Sicherheitspunkte sperren bei „Nein“.
export const START_ITEMS = ['lights', 'tyres', 'brakes', 'warning_lights', 'mirrors_seat', 'body_damage', 'bags_clean', 'docs_on_board'];
export const SAFETY_ITEMS = ['lights', 'tyres', 'brakes', 'warning_lights'];
// Endkontrolle / Übergabe
export const END_ITEMS = ['interior_clean', 'rubbish_out', 'bags_cleaned', 'no_food_left', 'keys_back', 'new_damage_none'];
export const FUEL_LEVELS = ['full', '3_4', '1_2', '1_4', 'reserve'];

const setting = (db, b, k, d) => db.prepare('SELECT value FROM branch_settings WHERE branch_id = ? AND key = ?').get(b, k)?.value ?? d;
const monthsBefore = (date, m) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - m); return d.toISOString().slice(0, 10); };

export function licenceState(db, profile, branchId, today = berlinDate()) {
  if (!profile || !profile.licence_checked_on) return { ok: false, reason: 'licence_unchecked' };
  const months = Number(setting(db, branchId, 'licence_check_months', '')) || null;
  if (months && profile.licence_checked_on < monthsBefore(today, months)) return { ok: false, reason: 'licence_due', months };
  return { ok: true, months };
}

export function registerDrivers({ route, db, needUser, needBranch, HttpError, bad, notFound, notify, mediaInBranch, can }) {
  const profileOf = (uid, b) => db.prepare('SELECT * FROM driver_profiles WHERE user_id = ? AND branch_id = ? AND active = 1').get(uid, b);
  const vehiclesOf = (b, all = false) => db.prepare(`SELECT * FROM vehicles WHERE branch_id = ? ${all ? '' : 'AND active = 1'} ORDER BY label`).all(b);
  const checksOn = (b, date) => db.prepare(`SELECT c.id, c.vehicle_id, c.user_id, c.shift, c.kind, c.safety_defect, c.fuel_level, c.created_at, c.note, c.answers,
      c.fuel_media_id, c.interior_media_id, u.display_name FROM vehicle_checks c JOIN users u ON u.id = c.user_id WHERE c.branch_id = ? AND c.work_date = ? ORDER BY c.created_at`).all(b, date);

  route('GET', '/api/drivers/me', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    const p = profileOf(u.id, branchId);
    if (!p) return { driver: false };
    const date = berlinDate();
    const checks = checksOn(branchId, date);
    return {
      driver: true, licence: licenceState(db, p, branchId), licence_class: p.licence_class, licence_checked_on: p.licence_checked_on,
      items: { start: START_ITEMS, end: END_ITEMS, safety: SAFETY_ITEMS, fuel: FUEL_LEVELS }, date,
      vehicles: vehiclesOf(branchId).map((v) => ({ id: v.id, label: v.label, plate: v.plate, blocked: !!v.blocked, blocked_reason: v.blocked_reason,
        shifts: Object.fromEntries(['early', 'late'].map((s) => {
          const st = checks.find((c) => c.vehicle_id === v.id && c.shift === s && c.kind === 'start');
          const en = checks.find((c) => c.vehicle_id === v.id && c.shift === s && c.kind === 'end');
          return [s, { driver: st ? st.display_name : null, mine: st ? st.user_id === u.id : false, started: !!st, ended: !!en }];
        })) })),
    };
  });

  route('POST', '/api/drivers/checks', (ctx) => {
    const u = needUser(ctx);
    const b = ctx.body;
    const branchId = needBranch(ctx, b.branch);
    const p = profileOf(u.id, branchId);
    if (!p) throw new HttpError(403, 'not_driver', 'Nur eingetragene Fahrer');
    const lic = licenceState(db, p, branchId);
    if (!lic.ok) throw new HttpError(403, lic.reason, lic.reason === 'licence_due' ? 'Führerscheinkontrolle ist fällig – bitte bei der Leitung vorzeigen.' : 'Führerscheinkontrolle fehlt – bitte bei der Leitung vorzeigen.');
    const g = workGate(db, u.id, branchId);
    if (!g.ok) throw new HttpError(403, g.reason, g.message);
    if (!['early', 'late'].includes(b.shift)) throw bad('shift');
    if (!['start', 'end'].includes(b.kind)) throw bad('kind');
    const v = db.prepare('SELECT * FROM vehicles WHERE id = ? AND branch_id = ? AND active = 1').get(Number(b.vehicle_id), branchId);
    if (!v) throw notFound();
    const date = berlinDate();
    const start = db.prepare("SELECT * FROM vehicle_checks WHERE vehicle_id = ? AND work_date = ? AND shift = ? AND kind = 'start'").get(v.id, date, b.shift);
    if (b.kind === 'start') {
      if (v.blocked) throw new HttpError(409, 'vehicle_blocked', `Fahrzeug gesperrt: ${v.blocked_reason || 'Sicherheitsmangel'} – nicht fahren, Leitung informieren.`);
      if (start) throw new HttpError(409, 'taken', `Fahrzeug ist in dieser Schicht schon von ${start.user_id === u.id ? 'dir' : 'jemand anderem'} übernommen`);
    } else {
      if (!start) throw new HttpError(409, 'no_start', 'Erst die Startkontrolle machen');
      if (start.user_id !== u.id) throw new HttpError(403, 'not_yours', 'Nur der Fahrer dieser Schicht kann die Endkontrolle abgeben');
      if (db.prepare("SELECT 1 FROM vehicle_checks WHERE vehicle_id = ? AND work_date = ? AND shift = ? AND kind = 'end'").get(v.id, date, b.shift)) throw new HttpError(409, 'done', 'Endkontrolle schon abgegeben');
    }
    const keys = b.kind === 'start' ? START_ITEMS : END_ITEMS;
    const a = b.answers || {};
    if (keys.some((k) => !['yes', 'no'].includes(a[k]))) throw bad('incomplete', 'Bitte jeden Punkt mit Ja oder Nein beantworten');
    const clean = Object.fromEntries(keys.map((k) => [k, a[k]]));
    const fuel = mediaInBranch(b.fuel_media_id, branchId);
    const interior = mediaInBranch(b.interior_media_id, branchId);
    if (!fuel) throw bad('fuel_photo', 'Foto der Tankanzeige ist Pflicht');
    if (!interior) throw bad('interior_photo', 'Foto vom Innenraum ist Pflicht');
    if (b.fuel_level != null && b.fuel_level !== '' && !FUEL_LEVELS.includes(b.fuel_level)) throw bad('fuel_level');
    const note = String(b.note || '').trim().slice(0, 400) || null;
    const noKeys = keys.filter((k) => clean[k] === 'no');
    if (noKeys.length && !note) throw bad('note', 'Bei „Nein“ kurz beschreiben, was nicht in Ordnung ist');
    const safety = b.kind === 'start' && SAFETY_ITEMS.some((k) => clean[k] === 'no');
    const id = Number(db.prepare(`INSERT INTO vehicle_checks (branch_id, vehicle_id, user_id, work_date, shift, kind, answers, fuel_level, fuel_media_id, interior_media_id, safety_defect, note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(branchId, v.id, u.id, date, b.shift, b.kind, JSON.stringify(clean), b.fuel_level || null, fuel, interior, safety ? 1 : 0, note).lastInsertRowid);
    if (safety) {
      db.prepare('UPDATE vehicles SET blocked = 1, blocked_reason = ?, blocked_at = ?, blocked_check_id = ?, unblocked_by = NULL, unblocked_at = NULL, unblock_note = NULL WHERE id = ?')
        .run(note, new Date().toISOString(), id, v.id);
      notify(db, branchId, 'critical', `Fahrzeug ${v.label} gesperrt (Sicherheitsmangel): ${note}`, `remind:veh:${v.id}:${id}`, null, 'manager');
    } else if (noKeys.length) {
      notify(db, branchId, 'vehicle', `Fahrzeug ${v.label}: Mangel gemeldet von ${u.display_name} – ${note}`, `remind:vehnote:${id}`, null, 'manager');
    }
    audit(db, { actor: u.id, branch: branchId, action: 'vehicle_check', entity: 'vehicle', id: v.id, payload: { kind: b.kind, shift: b.shift, safety } });
    return { ok: true, id, blocked: safety, defects: noKeys };
  });

  // --- Leitung ---------------------------------------------------------------
  route('GET', '/api/drivers', (ctx) => {
    needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'), 'manager', 'admin');
    const date = ctx.query.get('date') || berlinDate();
    const drivers = db.prepare(`SELECT p.*, u.display_name, c.display_name checked_by_name FROM driver_profiles p JOIN users u ON u.id = p.user_id
      LEFT JOIN users c ON c.id = p.licence_checked_by WHERE p.branch_id = ? ORDER BY p.active DESC, u.display_name`).all(branchId)
      .map((p) => ({ user_id: p.user_id, name: p.display_name, active: !!p.active, licence_class: p.licence_class, licence_checked_on: p.licence_checked_on,
        checked_by: p.checked_by_name, licence: licenceState(db, p, branchId) }));
    const staff = db.prepare(`SELECT DISTINCT u.id, u.display_name FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.branch_id = ? AND u.active = 1 ORDER BY u.display_name`).all(branchId);
    return { date, drivers, staff, vehicles: vehiclesOf(branchId, true).map((v) => ({ ...v, active: !!v.active, blocked: !!v.blocked })),
      checks: checksOn(branchId, date).map((c) => ({ ...c, answers: JSON.parse(c.answers), safety_defect: !!c.safety_defect })),
      licence_check_months: Number(setting(db, branchId, 'licence_check_months', '')) || null };
  });

  route('POST', '/api/drivers', (ctx) => {
    const u = needUser(ctx);
    const b = ctx.body;
    const branchId = needBranch(ctx, b.branch, 'manager', 'admin');
    const uid = Number(b.user_id);
    if (!db.prepare('SELECT 1 FROM memberships WHERE user_id = ? AND branch_id = ?').get(uid, branchId)) throw notFound();
    const checked = b.licence_checked_on ? String(b.licence_checked_on) : null;
    if (checked) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(checked) || checked > berlinDate()) throw bad('licence_checked_on', 'Gültiges Datum, nicht in der Zukunft');
      if (uid === u.id) throw new HttpError(403, 'self', 'Eigenen Führerschein nicht selbst prüfen');
      if (!String(b.licence_class || '').trim()) throw bad('licence_class', 'Führerscheinklasse angeben');
    }
    const ex = db.prepare('SELECT * FROM driver_profiles WHERE user_id = ? AND branch_id = ?').get(uid, branchId);
    const cls = String(b.licence_class || '').trim().slice(0, 20) || ex?.licence_class || null;
    const note = String(b.licence_note || '').trim().slice(0, 200) || null;
    if (ex) db.prepare('UPDATE driver_profiles SET active = 1, licence_class = ?, licence_checked_on = COALESCE(?, licence_checked_on), licence_checked_by = CASE WHEN ? IS NULL THEN licence_checked_by ELSE ? END, licence_note = COALESCE(?, licence_note) WHERE user_id = ? AND branch_id = ?')
      .run(cls, checked, checked, u.id, note, uid, branchId);
    else db.prepare('INSERT INTO driver_profiles (user_id, branch_id, licence_class, licence_checked_on, licence_checked_by, licence_note) VALUES (?,?,?,?,?,?)')
      .run(uid, branchId, cls, checked, checked ? u.id : null, note);
    audit(db, { actor: u.id, branch: branchId, action: checked ? 'licence_check' : 'driver_add', entity: 'user', id: uid, payload: { licence_class: cls, checked_on: checked } });
    return { ok: true };
  });

  route('POST', '/api/drivers/:id/deactivate', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'manager', 'admin');
    const r = db.prepare('UPDATE driver_profiles SET active = 0 WHERE user_id = ? AND branch_id = ?').run(Number(ctx.params.id), branchId);
    if (!r.changes) throw notFound();
    audit(db, { actor: u.id, branch: branchId, action: 'driver_deactivate', entity: 'user', id: Number(ctx.params.id) });
    return { ok: true };
  });

  route('POST', '/api/vehicles', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'manager', 'admin');
    const label = String(ctx.body.label || '').trim().slice(0, 60);
    if (!label) throw bad('label', 'Bezeichnung angeben');
    const id = Number(db.prepare('INSERT INTO vehicles (branch_id, label, plate) VALUES (?,?,?)').run(branchId, label, String(ctx.body.plate || '').trim().slice(0, 20) || null).lastInsertRowid);
    audit(db, { actor: u.id, branch: branchId, action: 'vehicle_add', entity: 'vehicle', id });
    return { id };
  });

  route('PUT', '/api/vehicles/:id', (ctx) => {
    const u = needUser(ctx);
    const v = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(Number(ctx.params.id)); if (!v) throw notFound();
    const branchId = needBranch(ctx, v.branch_id, 'manager', 'admin');
    const b = ctx.body;
    const label = b.label != null ? String(b.label).trim().slice(0, 60) : v.label;
    if (!label) throw bad('label');
    db.prepare('UPDATE vehicles SET label = ?, plate = ?, active = ? WHERE id = ?')
      .run(label, b.plate != null ? (String(b.plate).trim().slice(0, 20) || null) : v.plate, b.active != null ? (b.active ? 1 : 0) : v.active, v.id);
    audit(db, { actor: u.id, branch: branchId, action: 'vehicle_edit', entity: 'vehicle', id: v.id });
    return { ok: true };
  });

  // Freigabe nach Sperre: nur Leitung, mit Notiz zur Behebung. Der meldende Fahrer kann nicht selbst entsperren.
  route('POST', '/api/vehicles/:id/unblock', (ctx) => {
    const u = needUser(ctx);
    const v = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(Number(ctx.params.id)); if (!v) throw notFound();
    const branchId = needBranch(ctx, v.branch_id, 'manager', 'admin');
    if (!v.blocked) throw new HttpError(409, 'not_blocked');
    const note = String(ctx.body.note || '').trim();
    if (!note) throw bad('note', 'Beschreiben, wie der Mangel behoben wurde');
    const rep = v.blocked_check_id ? db.prepare('SELECT user_id FROM vehicle_checks WHERE id = ?').get(v.blocked_check_id) : null;
    if (rep && rep.user_id === u.id && !can(u, branchId, 'admin')) throw new HttpError(403, 'self', 'Eigene Mängelmeldung nicht selbst freigeben');
    db.prepare('UPDATE vehicles SET blocked = 0, unblocked_by = ?, unblocked_at = ?, unblock_note = ? WHERE id = ?').run(u.id, new Date().toISOString(), note.slice(0, 300), v.id);
    audit(db, { actor: u.id, branch: branchId, action: 'vehicle_unblock', entity: 'vehicle', id: v.id, payload: { note } });
    return { ok: true };
  });

  route('PUT', '/api/drivers/settings', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'manager', 'admin');
    const m = ctx.body.licence_check_months;
    const val = m === '' || m == null ? '' : Number(m);
    if (val !== '' && !(Number.isInteger(val) && val >= 1 && val <= 36)) throw bad('licence_check_months', '1–36 Monate oder leer');
    db.prepare('INSERT INTO branch_settings (branch_id, key, value) VALUES (?,?,?) ON CONFLICT (branch_id, key) DO UPDATE SET value = excluded.value').run(branchId, 'licence_check_months', String(val));
    audit(db, { actor: u.id, branch: branchId, action: 'driver_settings', entity: 'branch', id: branchId, payload: { licence_check_months: val } });
    return { ok: true };
  });
}
