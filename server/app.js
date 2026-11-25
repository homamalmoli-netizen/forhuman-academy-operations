// HTTP-API und Auslieferung der App. Nur Node-Bordmittel.
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync, unlinkSync } from 'node:fs';
import { join, normalize, extname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { tx, audit } from './db.js';
import {
  verifyPassword, hashPassword, createSession, destroySession, userFromToken, rolesIn, can, branchIdsFor,
  loginAllowed, loginFailed, loginSucceeded,
} from './auth.js';
import { classifyCode } from '../shared/codes.js';
import { seedTemplates } from './seed.js';

export const LANGS = ['de', 'ar', 'en', 'tr'];
const SHIFTS = ['open', 'run', 'close'];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

export class HttpError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}
const bad = (code, msg) => new HttpError(400, code, msg);
const forbidden = () => new HttpError(403, 'forbidden', 'Keine Berechtigung');
const notFound = () => new HttpError(404, 'not_found', 'Nicht gefunden');

export function berlinDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function isoWeekday(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return ((d.getUTCDay() + 6) % 7) + 1;
}
const j = (s, fb = {}) => { try { return JSON.parse(s); } catch { return fb; } };
const pickLang = (obj, lang) => (obj && (obj[lang] || obj.de)) || null;

// --- Fachlogik -------------------------------------------------------------

export function generateTasks(db, branchId, date) {
  const dow = String(isoWeekday(date));
  const day = Number(date.slice(8, 10));
  const tpls = db.prepare('SELECT * FROM task_templates WHERE branch_id = ? AND active = 1').all(branchId);
  const ins = db.prepare('INSERT OR IGNORE INTO task_occurrences (template_id, branch_id, shift, work_date, position) VALUES (?,?,?,?,?)');
  let created = 0;
  for (const t of tpls) {
    const due = t.frequency === 'monthly' ? t.month_day === day : t.weekdays.includes(dow);
    if (due) created += ins.run(t.id, branchId, t.shift, date, t.position).changes;
  }
  return created;
}

export function qualification(db, userId, courseId, branchId) {
  const c = db.prepare('SELECT id, version, safety_critical FROM courses WHERE id = ?').get(courseId);
  if (!c) return { ok: false, exam: false, practical: false, needsPractical: false };
  const exam = !!db.prepare('SELECT 1 FROM exam_attempts WHERE user_id = ? AND course_id = ? AND course_version = ? AND passed = 1').get(userId, courseId, c.version);
  const practical = !!db.prepare('SELECT 1 FROM practical_signoffs WHERE user_id = ? AND course_id = ? AND branch_id = ?').get(userId, courseId, branchId);
  const needsPractical = !!c.safety_critical;
  return { ok: exam && (!needsPractical || practical), exam, practical, needsPractical };
}

function notify(db, branchId, kind, message, ref) {
  db.prepare('INSERT INTO notifications (branch_id, kind, message, ref) VALUES (?,?,?,?)').run(branchId, kind, message, ref ?? null);
}

function taskView(db, row, lang, user) {
  const title = j(row.title), hint = j(row.hint);
  const q = row.required_course_id ? qualification(db, user.id, row.required_course_id, row.branch_id) : { ok: true };
  return {
    id: row.id, status: row.status, shift: row.shift, work_date: row.work_date, position: row.position, icon: row.icon,
    category: row.category, frequency: row.frequency,
    title: pickLang(title, lang), hint: pickLang(hint, lang), title_de: title.de,
    requires_photo: !!row.requires_photo, measure_unit: row.measure_unit, limit_min: row.limit_min, limit_max: row.limit_max,
    sop_id: row.sop_id, required_course_id: row.required_course_id, qualified: q.ok,
    completed_by: row.completed_by_name ?? null, completed_at: row.completed_at, measured_value: row.measured_value, note: row.note,
    photos: row.photos ? String(row.photos).split(',').map(Number) : [],
  };
}

const OCC_SELECT = `SELECT o.*, t.title, t.hint, t.icon, t.category, t.frequency, t.requires_photo, t.measure_unit, t.limit_min, t.limit_max,
  t.sop_id, t.required_course_id, u.display_name AS completed_by_name,
  (SELECT group_concat(e.media_id) FROM task_evidence e WHERE e.occurrence_id = o.id) AS photos
  FROM task_occurrences o JOIN task_templates t ON t.id = o.template_id LEFT JOIN users u ON u.id = o.completed_by`;

function stockOf(db, branchId) {
  return db.prepare(`SELECT i.id, i.name, i.unit, i.category, i.metro_article_no, i.needs_temperature,
      COALESCE((SELECT SUM(qty_delta) FROM stock_movements m WHERE m.item_id = i.id AND m.branch_id = ?), 0) AS qty,
      COALESCE(s.min_qty, 0) AS min_qty
    FROM items i LEFT JOIN stock_settings s ON s.item_id = i.id AND s.branch_id = ? WHERE i.active = 1 ORDER BY i.name`).all(branchId, branchId)
    .map((r) => ({ ...r, below_min: r.qty < r.min_qty }));
}

function oilStatus(db, fryer) {
  const last = db.prepare("SELECT * FROM oil_events WHERE fryer_id = ? AND type = 'tpm' ORDER BY id DESC LIMIT 1").get(fryer.id);
  const lastChange = db.prepare("SELECT created_at FROM oil_events WHERE fryer_id = ? AND type = 'change' ORDER BY id DESC LIMIT 1").get(fryer.id);
  const today = berlinDate();
  const measuredToday = last && berlinDate(new Date(last.created_at)) === today;
  let state = 'ok', reason = 'ok';
  if (!last) { state = 'unknown'; reason = 'no_measurement'; }
  else if (fryer.tpm_limit == null) { state = 'unknown'; reason = 'no_limit'; }
  else if (last.tpm >= fryer.tpm_limit) { state = 'change'; reason = 'limit_reached'; }
  else if (fryer.tpm_warn != null && last.tpm >= fryer.tpm_warn) { state = 'warn'; reason = 'warn_reached'; }
  if (last && !measuredToday && state === 'ok') { state = 'warn'; reason = 'not_measured_today'; }
  return { state, reason, last_tpm: last?.tpm ?? null, last_measured_at: last?.created_at ?? null, last_change_at: lastChange?.created_at ?? null };
}

// --- HTTP-Grundlagen ------------------------------------------------------

function parseCookies(h = '') {
  const out = {};
  for (const p of h.split(';')) { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }
  return out;
}

function readBody(req, limit) {
  return new Promise((res, rej) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { rej(new HttpError(413, 'too_large', 'Datei zu groß')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => res(Buffer.concat(chunks)));
    req.on('error', rej);
  });
}

function sniffMime(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.length > 5 && buf.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  return null;
}

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

export function createApp({ db, demo = false, uploadDir, publicDir, sharedDir, trustedHosts = ['metro.de'], cookieSecure = false, log = () => {} }) {
  mkdirSync(uploadDir, { recursive: true });
  const routes = [];
  const route = (method, path, handler, opts = {}) => {
    handler.raw = !!opts.raw;
    const keys = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '(\\d+)'; }) + '$');
    routes.push({ method, re, keys, handler });
  };

  // Hilfsfunktionen innerhalb der App
  const needUser = (ctx) => { if (!ctx.user) throw new HttpError(401, 'unauthorized', 'Bitte anmelden'); return ctx.user; };
  const needBranch = (ctx, branchId, ...roles) => {
    const user = needUser(ctx);
    const b = Number(branchId);
    if (!Number.isInteger(b) || !db.prepare('SELECT 1 FROM branches WHERE id = ? AND active = 1').get(b)) throw bad('branch', 'Filiale fehlt');
    if (!can(user, b, ...(roles.length ? roles : ['employee', 'trainer', 'manager', 'admin']))) throw forbidden();
    return b;
  };
  const needAdmin = (ctx) => { const u = needUser(ctx); if (!u.is_admin) throw forbidden(); return u; };
  const lang = (ctx) => (LANGS.includes(ctx.query.get('lang')) ? ctx.query.get('lang') : ctx.user?.lang || 'de');
  const mediaInBranch = (mediaId, branchId) => {
    if (mediaId == null) return null;
    const m = db.prepare('SELECT * FROM media WHERE id = ?').get(Number(mediaId));
    if (!m || m.branch_id !== branchId || m.purged_at) throw bad('media', 'Foto ungültig');
    return m.id;
  };

  // --- Konfiguration, Anmeldung -------------------------------------------
  route('GET', '/api/config', (ctx) => ({
    demo, langs: LANGS, trusted_hosts: trustedHosts,
    notification_channels: j(db.prepare("SELECT value FROM settings WHERE key = 'notification_channels'").get()?.value, []),
    has_admin: !!db.prepare('SELECT 1 FROM users WHERE is_admin = 1 AND active = 1').get(),
  }));

  if (demo) {
    const personas = {
      admin: 'demo.admin', manager_halle: 'demo.leitung.halle', manager_leuna: 'demo.leitung.leuna', trainer: 'demo.trainer',
      employee_halle: 'demo.mitarbeiter.halle', employee_leuna: 'demo.mitarbeiter.leuna',
    };
    route('POST', '/api/demo/session', (ctx) => {
      const username = personas[ctx.body.persona];
      if (!username) throw bad('persona');
      const u = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      ctx.setCookie(createSession(db, u.id));
      return { ok: true };
    });
  }

  route('POST', '/api/login', (ctx) => {
    const { username = '', password = '' } = ctx.body;
    const key = `${String(username).toLowerCase()}|${ctx.ip}`;
    if (!loginAllowed(key)) throw new HttpError(429, 'rate_limited', 'Zu viele Versuche. Bitte 15 Minuten warten.');
    const u = db.prepare('SELECT id, password_hash FROM users WHERE username = ? AND active = 1').get(String(username));
    if (!u || !verifyPassword(password, u.password_hash)) { loginFailed(key); throw new HttpError(401, 'bad_login', 'Anmeldung fehlgeschlagen'); }
    loginSucceeded(key);
    ctx.setCookie(createSession(db, u.id));
    audit(db, { actor: u.id, action: 'login', entity: 'user', id: u.id });
    return { ok: true };
  });
  route('POST', '/api/logout', (ctx) => { destroySession(db, ctx.token); ctx.setCookie('', true); return { ok: true }; });
  route('GET', '/api/me', (ctx) => {
    const u = needUser(ctx);
    const branches = branchIdsFor(db, u).map((id) => {
      const b = db.prepare('SELECT id, code, name FROM branches WHERE id = ?').get(id);
      return { ...b, roles: rolesIn(u, id) };
    });
    return { id: u.id, username: u.username, display_name: u.display_name, is_admin: u.is_admin, lang: u.lang, branches };
  });
  route('PUT', '/api/me/lang', (ctx) => {
    const u = needUser(ctx);
    if (!LANGS.includes(ctx.body.lang)) throw bad('lang');
    db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(ctx.body.lang, u.id);
    return { ok: true };
  });

  // --- Medien (Fotos, Belege) ------------------------------------------------
  route('POST', '/api/media', async (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    const purpose = ctx.query.get('purpose') || 'evidence';
    if (!['evidence', 'problem', 'goods', 'oil', 'receipt'].includes(purpose)) throw bad('purpose');
    const buf = await readBody(ctx.req, 8 * 1024 * 1024);
    const mime = sniffMime(buf);
    if (!mime || (mime === 'application/pdf' && purpose !== 'receipt')) throw bad('file_type', 'Nur JPG, PNG oder WEBP (Beleg auch PDF)');
    const key = randomBytes(18).toString('hex');
    writeFileSync(join(uploadDir, key), buf, { mode: 0o600 });
    const id = db.prepare('INSERT INTO media (branch_id, storage_key, mime, size, purpose, uploaded_by) VALUES (?,?,?,?,?,?)')
      .run(branchId, key, mime, buf.length, purpose, u.id).lastInsertRowid;
    audit(db, { actor: u.id, branch: branchId, action: 'upload', entity: 'media', id: Number(id), payload: { purpose, mime, size: buf.length } });
    return { id: Number(id) };
  }, { raw: true });
  route('GET', '/api/media/:id', (ctx) => {
    needUser(ctx);
    const m = db.prepare('SELECT * FROM media WHERE id = ?').get(Number(ctx.params.id));
    if (!m || m.purged_at) throw notFound();
    needBranch(ctx, m.branch_id);
    const file = join(uploadDir, m.storage_key);
    if (!existsSync(file)) throw notFound();
    ctx.res.writeHead(200, { ...SEC_HEADERS, 'Content-Type': m.mime, 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': 'inline' });
    ctx.res.end(readFileSync(file));
    return undefined;
  });

  route('GET', '/api/branches', (ctx) => {
    const u = needUser(ctx);
    return branchIdsFor(db, u).map((id) => db.prepare('SELECT id, code, name FROM branches WHERE id = ?').get(id));
  });

  // --- Mitarbeiter: Schicht ---------------------------------------------------
  route('GET', '/api/shift/next', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    const shift = ctx.query.get('shift');
    if (!SHIFTS.includes(shift)) throw bad('shift');
    const date = berlinDate();
    generateTasks(db, branchId, date);
    const rows = db.prepare(`${OCC_SELECT} WHERE o.branch_id = ? AND o.work_date = ? AND o.shift = ?
      ORDER BY CASE o.status WHEN 'rework' THEN 0 ELSE 1 END, o.position`).all(branchId, date, shift);
    const L = lang(ctx);
    const tasks = rows.map((r) => taskView(db, r, L, u));
    const actionable = tasks.filter((t) => ['open', 'rework'].includes(t.status));
    const next = actionable.find((t) => t.qualified) || null;
    return {
      date, shift,
      total: tasks.length,
      done: tasks.filter((t) => ['done', 'approved'].includes(t.status)).length,
      problems: tasks.filter((t) => t.status === 'problem').length,
      blocked: actionable.filter((t) => !t.qualified).map((t) => ({ id: t.id, title: t.title, icon: t.icon, required_course_id: t.required_course_id })),
      next,
    };
  });

  route('POST', '/api/tasks/:id/complete', (ctx) => {
    const u = needUser(ctx);
    const row = db.prepare(`${OCC_SELECT} WHERE o.id = ?`).get(Number(ctx.params.id));
    if (!row) throw notFound();
    const branchId = needBranch(ctx, row.branch_id);
    if (!['open', 'rework'].includes(row.status)) throw new HttpError(409, 'not_open', 'Aufgabe ist nicht offen');
    if (row.required_course_id && !qualification(db, u.id, row.required_course_id, branchId).ok) throw new HttpError(403, 'not_qualified', 'Schulung oder praktische Freigabe fehlt');
    const photo = mediaInBranch(ctx.body.media_id, branchId);
    if (row.requires_photo && !photo) throw bad('photo_required', 'Foto ist Pflicht');
    let value = null;
    if (row.measure_unit) {
      value = Number(ctx.body.value);
      if (ctx.body.value === '' || ctx.body.value == null || !Number.isFinite(value)) throw bad('value_required', 'Messwert fehlt');
    }
    const note = ctx.body.note ? String(ctx.body.note).slice(0, 500) : null;
    return tx(db, () => {
      db.prepare("UPDATE task_occurrences SET status = 'done', completed_by = ?, completed_at = ?, measured_value = ?, note = ? WHERE id = ?")
        .run(u.id, new Date().toISOString(), value, note, row.id);
      if (photo) db.prepare('INSERT INTO task_evidence (occurrence_id, media_id, created_by) VALUES (?,?,?)').run(row.id, photo, u.id);
      let deviation = null;
      const out = value != null && ((row.limit_min != null && value < row.limit_min) || (row.limit_max != null && value > row.limit_max));
      if (out) {
        const title = j(row.title).de;
        const pid = db.prepare("INSERT INTO problems (branch_id, occurrence_id, source, description, media_id, reported_by) VALUES (?,?,?,?,?,?)")
          .run(branchId, row.id, 'limit', `Grenzwert verletzt: ${title} = ${value} ${row.measure_unit} (freigegeben ${row.limit_min ?? '–'} bis ${row.limit_max ?? '–'})`, photo, u.id).lastInsertRowid;
        db.prepare("UPDATE task_occurrences SET status = 'problem' WHERE id = ?").run(row.id);
        notify(db, branchId, 'deviation', `Grenzwert verletzt: ${title}`, `problem:${pid}`);
        deviation = Number(pid);
      }
      audit(db, { actor: u.id, branch: branchId, action: 'complete', entity: 'task', id: row.id, payload: { value, photo, deviation } });
      return { ok: true, deviation };
    });
  });

  route('POST', '/api/tasks/:id/problem', (ctx) => {
    const u = needUser(ctx);
    const row = db.prepare('SELECT o.*, t.title FROM task_occurrences o JOIN task_templates t ON t.id = o.template_id WHERE o.id = ?').get(Number(ctx.params.id));
    if (!row) throw notFound();
    const branchId = needBranch(ctx, row.branch_id);
    const desc = String(ctx.body.description || '').trim();
    if (desc.length < 2) throw bad('description', 'Bitte kurz beschreiben');
    const photo = mediaInBranch(ctx.body.media_id, branchId);
    return tx(db, () => {
      const pid = db.prepare('INSERT INTO problems (branch_id, occurrence_id, description, media_id, reported_by) VALUES (?,?,?,?,?)')
        .run(branchId, row.id, desc.slice(0, 1000), photo, u.id).lastInsertRowid;
      db.prepare("UPDATE task_occurrences SET status = 'problem' WHERE id = ?").run(row.id);
      notify(db, branchId, 'problem', `Problem gemeldet: ${j(row.title).de}`, `problem:${pid}`);
      audit(db, { actor: u.id, branch: branchId, action: 'report_problem', entity: 'problem', id: Number(pid), payload: { task: row.id } });
      return { ok: true, problem_id: Number(pid) };
    });
  });

  route('POST', '/api/problems', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch);
    const desc = String(ctx.body.description || '').trim();
    if (desc.length < 2) throw bad('description', 'Bitte kurz beschreiben');
    const photo = mediaInBranch(ctx.body.media_id, branchId);
    const pid = db.prepare('INSERT INTO problems (branch_id, description, media_id, reported_by) VALUES (?,?,?,?)').run(branchId, desc.slice(0, 1000), photo, u.id).lastInsertRowid;
    notify(db, branchId, 'problem', 'Problem gemeldet', `problem:${pid}`);
    audit(db, { actor: u.id, branch: branchId, action: 'report_problem', entity: 'problem', id: Number(pid) });
    return { ok: true, problem_id: Number(pid) };
  });

  // --- Anleitungen -----------------------------------------------------------
  route('GET', '/api/sops/:id', (ctx) => {
    needUser(ctx);
    const sop = db.prepare('SELECT * FROM sops WHERE id = ?').get(Number(ctx.params.id));
    if (!sop) throw notFound();
    const v = db.prepare("SELECT * FROM sop_versions WHERE sop_id = ? AND status = 'approved' ORDER BY version_no DESC LIMIT 1").get(sop.id);
    if (!v) return { id: sop.id, code: sop.code, published: false };
    const L = lang(ctx);
    const content = j(v.content);
    const reviewed = v.reviewed_langs.split(',');
    const shownLang = content[L] ? L : 'de';
    return { id: sop.id, code: sop.code, icon: sop.icon, published: true, version: v.version_no, safety_review: sop.safety_review,
      lang: shownLang, translation_reviewed: reviewed.includes(shownLang), ...content[shownLang] };
  });

  // --- Manager: Probleme, Nacharbeit, Freigaben -------------------------------
  route('GET', '/api/problems', (ctx) => {
    const branchId = needBranch(ctx, ctx.query.get('branch'), 'manager', 'admin');
    const status = ctx.query.get('status');
    return db.prepare(`SELECT p.*, u.display_name AS reported_by_name, t.title AS task_title, o.status AS task_status
      FROM problems p JOIN users u ON u.id = p.reported_by LEFT JOIN task_occurrences o ON o.id = p.occurrence_id
      LEFT JOIN task_templates t ON t.id = o.template_id
      WHERE p.branch_id = ? AND (? IS NULL OR p.status = ?) ORDER BY p.id DESC LIMIT 200`).all(branchId, status, status)
      .map((p) => ({ ...p, task_title: p.task_title ? j(p.task_title).de : null }));
  });
  route('POST', '/api/problems/:id/rework', (ctx) => {
    const u = needUser(ctx);
    const p = db.prepare('SELECT * FROM problems WHERE id = ?').get(Number(ctx.params.id));
    if (!p) throw notFound();
    const branchId = needBranch(ctx, p.branch_id, 'manager', 'admin');
    if (p.status === 'resolved') throw new HttpError(409, 'resolved');
    return tx(db, () => {
      db.prepare("UPDATE problems SET status = 'rework', manager_note = ? WHERE id = ?").run(String(ctx.body.note || '').slice(0, 500), p.id);
      if (p.occurrence_id) db.prepare("UPDATE task_occurrences SET status = 'rework', completed_by = NULL, completed_at = NULL WHERE id = ?").run(p.occurrence_id);
      audit(db, { actor: u.id, branch: branchId, action: 'rework', entity: 'problem', id: p.id, payload: { note: ctx.body.note } });
      return { ok: true };
    });
  });
  route('POST', '/api/problems/:id/resolve', (ctx) => {
    const u = needUser(ctx);
    const p = db.prepare('SELECT * FROM problems WHERE id = ?').get(Number(ctx.params.id));
    if (!p) throw notFound();
    const branchId = needBranch(ctx, p.branch_id, 'manager', 'admin');
    const note = String(ctx.body.note || '').trim();
    if (note.length < 2) throw bad('note', 'Maßnahme beschreiben');
    return tx(db, () => {
      db.prepare("UPDATE problems SET status = 'resolved', manager_note = ?, resolved_by = ?, resolved_at = ? WHERE id = ?").run(note.slice(0, 500), u.id, new Date().toISOString(), p.id);
      if (p.occurrence_id) {
        const o = db.prepare('SELECT status FROM task_occurrences WHERE id = ?').get(p.occurrence_id);
        if (o.status === 'problem') db.prepare("UPDATE task_occurrences SET status = 'approved' WHERE id = ?").run(p.occurrence_id);
      }
      audit(db, { actor: u.id, branch: branchId, action: 'resolve', entity: 'problem', id: p.id, payload: { note } });
      return { ok: true };
    });
  });

  route('GET', '/api/shift/tasks', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'), 'manager', 'trainer', 'admin');
    const date = ctx.query.get('date') || berlinDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('date');
    if (date === berlinDate()) generateTasks(db, branchId, date);
    const shift = ctx.query.get('shift');
    return db.prepare(`${OCC_SELECT} WHERE o.branch_id = ? AND o.work_date = ? AND (? IS NULL OR o.shift = ?) ORDER BY o.shift, o.position`)
      .all(branchId, date, shift, shift).map((r) => taskView(db, r, lang(ctx), u));
  });

  route('POST', '/api/shifts/approve', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'manager', 'admin');
    const { date, shift } = ctx.body;
    if (!SHIFTS.includes(shift) || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw bad('shift');
    if (db.prepare('SELECT 1 FROM shift_approvals WHERE branch_id = ? AND work_date = ? AND shift = ?').get(branchId, date, shift)) throw new HttpError(409, 'already_approved', 'Schicht ist bereits freigegeben');
    const open = db.prepare("SELECT COUNT(*) n FROM task_occurrences WHERE branch_id = ? AND work_date = ? AND shift = ? AND status IN ('open','rework','problem')").get(branchId, date, shift).n;
    const note = String(ctx.body.note || '').trim();
    if (open && note.length < 2) throw bad('open_tasks', `Noch ${open} offene Aufgaben. Bitte Begründung angeben.`);
    return tx(db, () => {
      db.prepare('INSERT INTO shift_approvals (branch_id, work_date, shift, approved_by, note) VALUES (?,?,?,?,?)').run(branchId, date, shift, u.id, note || null);
      db.prepare("UPDATE task_occurrences SET status = 'approved' WHERE branch_id = ? AND work_date = ? AND shift = ? AND status = 'done'").run(branchId, date, shift);
      audit(db, { actor: u.id, branch: branchId, action: 'approve_shift', entity: 'shift', payload: { date, shift, open, note } });
      return { ok: true, open };
    });
  });

  route('GET', '/api/reports/shift', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'), 'manager', 'admin');
    const date = ctx.query.get('date') || berlinDate();
    const shift = ctx.query.get('shift');
    if (!SHIFTS.includes(shift)) throw bad('shift');
    if (date === berlinDate()) generateTasks(db, branchId, date);
    const tasks = db.prepare(`${OCC_SELECT} WHERE o.branch_id = ? AND o.work_date = ? AND o.shift = ? ORDER BY o.position`).all(branchId, date, shift).map((r) => taskView(db, r, 'de', u));
    const problems = db.prepare(`SELECT p.id, p.description, p.status, p.manager_note, p.source FROM problems p JOIN task_occurrences o ON o.id = p.occurrence_id
      WHERE p.branch_id = ? AND o.work_date = ? AND o.shift = ?`).all(branchId, date, shift);
    const approval = db.prepare('SELECT a.*, u.display_name FROM shift_approvals a JOIN users u ON u.id = a.approved_by WHERE branch_id = ? AND work_date = ? AND shift = ?').get(branchId, date, shift);
    const branch = db.prepare('SELECT name FROM branches WHERE id = ?').get(branchId).name;
    return {
      branch, date, shift, generated_at: new Date().toISOString(),
      counts: {
        total: tasks.length, done: tasks.filter((t) => ['done', 'approved'].includes(t.status)).length,
        open: tasks.filter((t) => ['open', 'rework'].includes(t.status)).length, problems: tasks.filter((t) => t.status === 'problem').length,
        photos: tasks.reduce((n, t) => n + t.photos.length, 0),
      },
      measurements: tasks.filter((t) => t.measure_unit && t.measured_value != null).map((t) => ({ title: t.title, value: t.measured_value, unit: t.measure_unit, by: t.completed_by, at: t.completed_at })),
      tasks, problems, approval: approval || null,
      oil: db.prepare('SELECT * FROM fryers WHERE branch_id = ?').all(branchId).map((f) => ({ name: f.name, ...oilStatus(db, f) })),
    };
  });

  route('GET', '/api/dashboard', (ctx) => {
    const u = needUser(ctx);
    const ids = ctx.query.get('branch') ? [needBranch(ctx, ctx.query.get('branch'), 'manager', 'trainer', 'admin')]
      : branchIdsFor(db, u).filter((b) => can(u, b, 'manager', 'trainer', 'admin'));
    if (!ids.length) throw forbidden();
    const date = berlinDate();
    return ids.map((branchId) => {
      generateTasks(db, branchId, date);
      const c = db.prepare(`SELECT shift, status, COUNT(*) n FROM task_occurrences WHERE branch_id = ? AND work_date = ? GROUP BY shift, status`).all(branchId, date);
      const by = {};
      for (const r of c) { by[r.shift] ??= { open: 0, done: 0, problem: 0 }; const k = ['done', 'approved'].includes(r.status) ? 'done' : r.status === 'problem' ? 'problem' : 'open'; by[r.shift][k] += r.n; }
      const overdue = db.prepare("SELECT COUNT(*) n FROM task_occurrences WHERE branch_id = ? AND work_date < ? AND status IN ('open','rework')").get(branchId, date).n;
      const learners = db.prepare("SELECT DISTINCT user_id FROM memberships WHERE branch_id = ? AND role = 'employee'").all(branchId).map((r) => r.user_id);
      const courses = db.prepare('SELECT id FROM courses WHERE active = 1').all();
      let qualifiedCount = 0;
      for (const l of learners) for (const cr of courses) if (qualification(db, l, cr.id, branchId).ok) qualifiedCount++;
      return {
        branch: db.prepare('SELECT id, name FROM branches WHERE id = ?').get(branchId),
        date, shifts: by, overdue,
        open_problems: db.prepare("SELECT COUNT(*) n FROM problems WHERE branch_id = ? AND status <> 'resolved'").get(branchId).n,
        photos_today: db.prepare("SELECT COUNT(*) n FROM media WHERE branch_id = ? AND created_at >= ?").get(branchId, date).n,
        training: { learners: learners.length, courses: courses.length, qualified: qualifiedCount },
        stock_below_min: stockOf(db, branchId).filter((s) => s.below_min).length,
        unknown_codes: db.prepare("SELECT COUNT(*) n FROM unknown_codes WHERE branch_id = ? AND status = 'open'").get(branchId).n,
        oil: db.prepare('SELECT * FROM fryers WHERE branch_id = ?').all(branchId).map((f) => ({ id: f.id, name: f.name, ...oilStatus(db, f) })),
        notifications: db.prepare('SELECT * FROM notifications WHERE branch_id = ? ORDER BY id DESC LIMIT 10').all(branchId),
      };
    });
  });

  // --- Vorlagen (Manager) ------------------------------------------------------
  route('GET', '/api/templates', (ctx) => {
    const branchId = needBranch(ctx, ctx.query.get('branch'), 'manager', 'admin');
    return db.prepare('SELECT * FROM task_templates WHERE branch_id = ? ORDER BY shift, position').all(branchId)
      .map((t) => ({ ...t, title: j(t.title), hint: j(t.hint) }));
  });
  route('POST', '/api/templates', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'manager', 'admin');
    const { shift, title_de } = ctx.body;
    if (!SHIFTS.includes(shift) || !String(title_de || '').trim()) throw bad('template', 'Schicht und Titel nötig');
    const pos = (db.prepare('SELECT MAX(position) m FROM task_templates WHERE branch_id = ? AND shift = ?').get(branchId, shift).m || 0) + 10;
    const id = db.prepare('INSERT INTO task_templates (branch_id, shift, position, category, icon, title, hint, requires_photo) VALUES (?,?,?,?,?,?,?,?)')
      .run(branchId, shift, pos, ctx.body.category || 'routine', ctx.body.icon || 'check', JSON.stringify({ de: String(title_de).trim().slice(0, 120) }),
        JSON.stringify({ de: String(ctx.body.hint_de || '').trim().slice(0, 200) }), ctx.body.requires_photo ? 1 : 0).lastInsertRowid;
    audit(db, { actor: u.id, branch: branchId, action: 'create', entity: 'template', id: Number(id), payload: ctx.body });
    return { id: Number(id) };
  });
  route('PATCH', '/api/templates/:id', (ctx) => {
    const u = needUser(ctx);
    const t = db.prepare('SELECT * FROM task_templates WHERE id = ?').get(Number(ctx.params.id));
    if (!t) throw notFound();
    const branchId = needBranch(ctx, t.branch_id, 'manager', 'admin');
    const b = ctx.body;
    if ((b.limit_min != null || b.limit_max != null) && !String(b.limit_source || t.limit_source || '').trim()) {
      throw bad('limit_source', 'Grenzwerte nur mit Quelle (HACCP-Plan / Herstellerangabe)');
    }
    const fields = { active: b.active != null ? (b.active ? 1 : 0) : t.active, requires_photo: b.requires_photo != null ? (b.requires_photo ? 1 : 0) : t.requires_photo,
      weekdays: b.weekdays != null ? String(b.weekdays).replace(/[^1-7]/g, '') || t.weekdays : t.weekdays,
      limit_min: b.limit_min !== undefined ? (b.limit_min === null || b.limit_min === '' ? null : Number(b.limit_min)) : t.limit_min,
      limit_max: b.limit_max !== undefined ? (b.limit_max === null || b.limit_max === '' ? null : Number(b.limit_max)) : t.limit_max,
      limit_source: b.limit_source !== undefined ? String(b.limit_source || '').slice(0, 200) || null : t.limit_source };
    db.prepare('UPDATE task_templates SET active=?, requires_photo=?, weekdays=?, limit_min=?, limit_max=?, limit_source=? WHERE id = ?')
      .run(fields.active, fields.requires_photo, fields.weekdays, fields.limit_min, fields.limit_max, fields.limit_source, t.id);
    audit(db, { actor: u.id, branch: branchId, action: 'update', entity: 'template', id: t.id, payload: fields });
    return { ok: true };
  });
  route('POST', '/api/templates/:id/move', (ctx) => {
    const u = needUser(ctx);
    const t = db.prepare('SELECT * FROM task_templates WHERE id = ?').get(Number(ctx.params.id));
    if (!t) throw notFound();
    const branchId = needBranch(ctx, t.branch_id, 'manager', 'admin');
    const up = ctx.body.dir === 'up';
    const other = db.prepare(`SELECT * FROM task_templates WHERE branch_id = ? AND shift = ? AND position ${up ? '<' : '>'} ? ORDER BY position ${up ? 'DESC' : 'ASC'} LIMIT 1`).get(branchId, t.shift, t.position);
    if (!other) return { ok: true, moved: false };
    tx(db, () => {
      db.prepare('UPDATE task_templates SET position = ? WHERE id = ?').run(other.position, t.id);
      db.prepare('UPDATE task_templates SET position = ? WHERE id = ?').run(t.position, other.id);
      // heutige, noch offene Aufgaben übernehmen die neue Reihenfolge
      const today = berlinDate();
      db.prepare('UPDATE task_occurrences SET position = ? WHERE template_id = ? AND work_date >= ?').run(other.position, t.id, today);
      db.prepare('UPDATE task_occurrences SET position = ? WHERE template_id = ? AND work_date >= ?').run(t.position, other.id, today);
      audit(db, { actor: u.id, branch: branchId, action: 'reorder', entity: 'template', id: t.id, payload: { dir: ctx.body.dir } });
    });
    return { ok: true, moved: true };
  });

  // --- Academy -----------------------------------------------------------------
  const courseFor = (id) => { const c = db.prepare('SELECT * FROM courses WHERE id = ? AND active = 1').get(Number(id)); if (!c) throw notFound(); return c; };
  route('GET', '/api/courses', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    const L = lang(ctx);
    return db.prepare('SELECT * FROM courses WHERE active = 1 ORDER BY id').all().map((c) => {
      const content = j(c.content);
      const prog = db.prepare('SELECT * FROM course_progress WHERE user_id = ? AND course_id = ?').get(u.id, c.id);
      const last = db.prepare('SELECT score, total, passed, created_at FROM exam_attempts WHERE user_id = ? AND course_id = ? ORDER BY id DESC LIMIT 1').get(u.id, c.id);
      return { id: c.id, code: c.code, icon: c.icon, safety_critical: !!c.safety_critical, title: pickLang(content, L)?.title,
        langs: Object.keys(content), steps: (content.de?.steps || []).length,
        steps_done: prog && prog.course_version === c.version ? prog.steps_done : 0,
        last_attempt: last || null, ...qualification(db, u.id, c.id, branchId) };
    });
  });
  route('GET', '/api/courses/:id', (ctx) => {
    const u = needUser(ctx);
    needBranch(ctx, ctx.query.get('branch'));
    const c = courseFor(ctx.params.id);
    const content = j(c.content);
    const L = content[ctx.query.get('lang')] ? ctx.query.get('lang') : 'de';
    const prog = db.prepare('SELECT * FROM course_progress WHERE user_id = ? AND course_id = ?').get(u.id, c.id);
    const done = prog && prog.course_version === c.version ? prog.steps_done : 0;
    const { title, intro, steps } = content[L];
    return { id: c.id, code: c.code, icon: c.icon, safety_critical: !!c.safety_critical, pass_percent: c.pass_percent, version: c.version,
      lang: L, langs: Object.keys(content), translation_reviewed: c.reviewed_langs.split(',').includes(L),
      title, intro, steps, steps_done: done, exam_unlocked: done >= steps.length };
  });
  route('POST', '/api/courses/:id/progress', (ctx) => {
    const u = needUser(ctx);
    const c = courseFor(ctx.params.id);
    const content = j(c.content);
    const L = ctx.body.lang;
    if (!content[L]) throw bad('lang');
    const step = Number(ctx.body.step);
    const prog = db.prepare('SELECT * FROM course_progress WHERE user_id = ? AND course_id = ?').get(u.id, c.id);
    const done = prog && prog.course_version === c.version ? prog.steps_done : 0;
    // Schritte nur der Reihe nach bestätigen (serverseitig erzwungen)
    if (step !== done || step >= content[L].steps.length) throw new HttpError(409, 'step_order', 'Bitte Schritte der Reihe nach bestätigen');
    db.prepare(`INSERT INTO course_progress (user_id, course_id, course_version, lang, steps_done, updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT (user_id, course_id) DO UPDATE SET course_version = excluded.course_version, lang = excluded.lang, steps_done = excluded.steps_done, updated_at = excluded.updated_at`)
      .run(u.id, c.id, c.version, L, step + 1, new Date().toISOString());
    return { steps_done: step + 1, exam_unlocked: step + 1 >= content[L].steps.length };
  });
  route('GET', '/api/courses/:id/exam', (ctx) => {
    const u = needUser(ctx);
    const c = courseFor(ctx.params.id);
    const content = j(c.content);
    const L = content[ctx.query.get('lang')] ? ctx.query.get('lang') : 'de';
    const prog = db.prepare('SELECT * FROM course_progress WHERE user_id = ? AND course_id = ?').get(u.id, c.id);
    if (!prog || prog.course_version !== c.version || prog.steps_done < content[L].steps.length) throw new HttpError(403, 'exam_locked', 'Erst alle Lernschritte abschließen');
    return { id: c.id, lang: L, pass_percent: c.pass_percent, translation_reviewed: c.reviewed_langs.split(',').includes(L),
      questions: content[L].questions.map((q, i) => ({ index: i, q: q.q, image: q.image || null, options: q.options })) };
  });
  route('POST', '/api/courses/:id/exam', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch);
    const c = courseFor(ctx.params.id);
    const content = j(c.content);
    const L = content[ctx.body.lang] ? ctx.body.lang : 'de';
    const prog = db.prepare('SELECT * FROM course_progress WHERE user_id = ? AND course_id = ?').get(u.id, c.id);
    if (!prog || prog.course_version !== c.version || prog.steps_done < content[L].steps.length) throw new HttpError(403, 'exam_locked', 'Erst alle Lernschritte abschließen');
    const qs = content[L].questions;
    const answers = Array.isArray(ctx.body.answers) ? ctx.body.answers.map(Number) : [];
    if (answers.length !== qs.length) throw bad('answers', 'Bitte alle Fragen beantworten');
    const results = qs.map((q, i) => ({ index: i, correct: answers[i] === q.correct, correct_option: q.correct, given: answers[i] }));
    const score = results.filter((r) => r.correct).length;
    const passed = score * 100 >= c.pass_percent * qs.length;
    const id = db.prepare('INSERT INTO exam_attempts (user_id, course_id, course_version, branch_id, lang, score, total, passed, answers) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(u.id, c.id, c.version, branchId, L, score, qs.length, passed ? 1 : 0, JSON.stringify(answers)).lastInsertRowid;
    audit(db, { actor: u.id, branch: branchId, action: 'exam', entity: 'course', id: c.id, payload: { attempt: Number(id), score, total: qs.length, passed } });
    return { score, total: qs.length, passed, results, needs_practical: !!c.safety_critical, ...qualification(db, u.id, c.id, branchId) };
  });
  route('GET', '/api/training', (ctx) => {
    const branchId = needBranch(ctx, ctx.query.get('branch'), 'trainer', 'manager', 'admin');
    const people = db.prepare(`SELECT DISTINCT u.id, u.display_name FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.branch_id = ? AND m.role = 'employee' AND u.active = 1 ORDER BY u.display_name`).all(branchId);
    const courses = db.prepare('SELECT id, code, content, safety_critical FROM courses WHERE active = 1').all();
    return { courses: courses.map((c) => ({ id: c.id, code: c.code, title: j(c.content).de.title, safety_critical: !!c.safety_critical })),
      people: people.map((p) => ({ ...p, status: Object.fromEntries(courses.map((c) => [c.id, qualification(db, p.id, c.id, branchId)])) })) };
  });
  route('POST', '/api/signoffs', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'trainer', 'admin');
    const userId = Number(ctx.body.user_id), courseId = Number(ctx.body.course_id);
    if (userId === u.id) throw new HttpError(403, 'self_signoff', 'Eigene Freigabe ist nicht erlaubt');
    if (!db.prepare("SELECT 1 FROM memberships WHERE user_id = ? AND branch_id = ?").get(userId, branchId)) throw forbidden();
    const q = qualification(db, userId, courseId, branchId);
    if (!q.exam) throw new HttpError(409, 'exam_missing', 'Erst Prüfung bestehen');
    db.prepare('INSERT OR IGNORE INTO practical_signoffs (user_id, course_id, branch_id, signed_by, note) VALUES (?,?,?,?,?)').run(userId, courseId, branchId, u.id, String(ctx.body.note || '').slice(0, 300) || null);
    audit(db, { actor: u.id, branch: branchId, action: 'practical_signoff', entity: 'course', id: courseId, payload: { user: userId } });
    return { ok: true };
  });

  // --- Wareneingang, METRO, Bestand -------------------------------------------
  route('GET', '/api/items', (ctx) => { needUser(ctx); return db.prepare('SELECT id, name, unit, category, metro_article_no, needs_temperature FROM items WHERE active = 1 ORDER BY name').all(); });
  route('POST', '/api/goods/scan', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch);
    const raw = String(ctx.body.code || '').slice(0, 500);
    const c = classifyCode(raw, trustedHosts);
    let item = null;
    if (c.gtin) item = db.prepare("SELECT i.* FROM item_codes k JOIN items i ON i.id = k.item_id WHERE k.code = ?").get(c.gtin);
    if (!item && c.kind === 'unknown') {
      // Exakter Abgleich mit hinterlegter METRO-Artikelnummer (keine Schätzung des Formats)
      item = db.prepare("SELECT i.* FROM item_codes k JOIN items i ON i.id = k.item_id WHERE k.code = ? AND k.kind = 'metro_article'").get(raw.trim());
      if (item) c.kind = 'metro_article';
    }
    const result = { ...c, item: item ? { id: item.id, name: item.name, unit: item.unit, needs_temperature: !!item.needs_temperature } : null };
    if (!item && (c.kind !== 'url' || c.gtin)) {
      const code = c.gtin || raw.trim();
      db.prepare('INSERT OR IGNORE INTO unknown_codes (branch_id, code, kind, seen_by) VALUES (?,?,?,?)').run(branchId, code, c.gtin ? 'gtin' : 'unknown', u.id);
      result.unknown_id = db.prepare('SELECT id FROM unknown_codes WHERE branch_id = ? AND code = ?').get(branchId, code).id;
    }
    // URLs werden nie automatisch geöffnet. Nur vertrauenswürdige https-Hosts dürfen nach Bestätigung geöffnet werden.
    if (c.kind === 'url') result.open_allowed = !!c.trusted;
    audit(db, { actor: u.id, branch: branchId, action: 'scan', entity: 'code', payload: { kind: result.kind, matched: !!item } });
    return result;
  });
  route('GET', '/api/goods/unknown', (ctx) => {
    const branchId = needBranch(ctx, ctx.query.get('branch'), 'manager', 'admin');
    return db.prepare("SELECT * FROM unknown_codes WHERE branch_id = ? AND status = 'open' ORDER BY id DESC").all(branchId);
  });
  route('POST', '/api/goods/unknown/:id/assign', (ctx) => {
    const u = needUser(ctx);
    const row = db.prepare('SELECT * FROM unknown_codes WHERE id = ?').get(Number(ctx.params.id));
    if (!row) throw notFound();
    const branchId = needBranch(ctx, row.branch_id, 'manager', 'admin');
    const itemId = Number(ctx.body.item_id);
    if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(itemId)) throw bad('item');
    const existing = db.prepare('SELECT item_id FROM item_codes WHERE code = ?').get(row.code);
    if (existing && existing.item_id !== itemId) throw new HttpError(409, 'code_taken', 'Code ist bereits einem anderen Artikel zugeordnet');
    tx(db, () => {
      db.prepare('INSERT OR IGNORE INTO item_codes (code, item_id, kind) VALUES (?,?,?)').run(row.code, itemId, row.kind === 'gtin' ? 'gtin' : 'other');
      db.prepare("UPDATE unknown_codes SET status = 'assigned', assigned_item_id = ? WHERE id = ?").run(itemId, row.id);
      audit(db, { actor: u.id, branch: branchId, action: 'assign_code', entity: 'item', id: itemId, payload: { code: row.code } });
    });
    return { ok: true };
  });
  route('POST', '/api/items', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'manager', 'admin');
    const name = String(ctx.body.name || '').trim(), unit = String(ctx.body.unit || '').trim();
    if (!name || !unit) throw bad('item', 'Name und Einheit nötig');
    const metro = String(ctx.body.metro_article_no || '').trim() || null;
    if (metro && db.prepare('SELECT 1 FROM items WHERE metro_article_no = ?').get(metro)) throw new HttpError(409, 'duplicate', 'METRO-Artikelnummer existiert bereits');
    return tx(db, () => {
      const id = Number(db.prepare('INSERT INTO items (name, unit, category, metro_article_no, needs_temperature) VALUES (?,?,?,?,?)')
        .run(name.slice(0, 120), unit.slice(0, 20), String(ctx.body.category || 'Ware').slice(0, 40), metro, ctx.body.needs_temperature ? 1 : 0).lastInsertRowid);
      if (metro) db.prepare("INSERT INTO item_codes (code, item_id, kind) VALUES (?,?,'metro_article')").run(metro, id);
      db.prepare('INSERT INTO stock_settings (branch_id, item_id, min_qty) VALUES (?,?,?)').run(branchId, id, Math.max(0, Number(ctx.body.min_qty) || 0));
      audit(db, { actor: u.id, branch: branchId, action: 'create', entity: 'item', id });
      return { id };
    });
  });
  route('POST', '/api/goods/documents', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch);
    const no = String(ctx.body.receipt_no || '').trim();
    if (!no) throw bad('receipt_no', 'Belegnummer fehlt');
    const media = mediaInBranch(ctx.body.media_id, branchId);
    const dup = db.prepare('SELECT id FROM receipt_documents WHERE branch_id = ? AND supplier = ? AND receipt_no = ?').get(branchId, ctx.body.supplier || 'METRO', no);
    if (dup) throw new HttpError(409, 'duplicate', 'Dieser Beleg wurde schon erfasst');
    const id = db.prepare('INSERT INTO receipt_documents (branch_id, supplier, receipt_no, media_id, created_by) VALUES (?,?,?,?,?)').run(branchId, ctx.body.supplier || 'METRO', no.slice(0, 60), media, u.id).lastInsertRowid;
    audit(db, { actor: u.id, branch: branchId, action: 'create', entity: 'receipt_document', id: Number(id) });
    return { id: Number(id) };
  });
  route('POST', '/api/goods/receipts', (ctx) => {
    const u = needUser(ctx);
    const b = ctx.body;
    const branchId = needBranch(ctx, b.branch);
    const item = db.prepare('SELECT * FROM items WHERE id = ? AND active = 1').get(Number(b.item_id));
    if (!item) throw bad('item', 'Artikel wählen');
    const qty = Number(b.quantity);
    if (!(qty > 0)) throw bad('quantity', 'Menge fehlt');
    if (!['accepted', 'rejected'].includes(b.decision)) throw bad('decision');
    if (b.best_before && !/^\d{4}-\d{2}-\d{2}$/.test(b.best_before)) throw bad('best_before');
    let temperature = null;
    if (item.needs_temperature) {
      temperature = Number(b.temperature);
      if (b.temperature === '' || b.temperature == null || !Number.isFinite(temperature)) throw bad('temperature', 'Temperatur ist für diesen Artikel Pflicht');
    }
    if (b.decision === 'rejected' && !String(b.reject_reason || '').trim()) throw bad('reject_reason', 'Grund für Ablehnung angeben');
    const photo = mediaInBranch(b.media_id, branchId);
    if (!photo) throw bad('photo_required', 'Foto der Lieferung ist Pflicht');
    const docId = b.document_id ? db.prepare('SELECT id FROM receipt_documents WHERE id = ? AND branch_id = ?').get(Number(b.document_id), branchId)?.id ?? null : null;
    return tx(db, () => {
      const rid = Number(db.prepare(`INSERT INTO goods_receipts (branch_id, item_id, document_id, scanned_code, quantity, unit, batch, best_before, temperature, condition_ok, decision, reject_reason, media_id, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(branchId, item.id, docId, b.code ? String(b.code).slice(0, 200) : null, qty, item.unit,
        b.batch ? String(b.batch).slice(0, 60) : null, b.best_before || null, temperature, b.condition_ok ? 1 : 0, b.decision,
        b.reject_reason ? String(b.reject_reason).slice(0, 300) : null, photo, u.id).lastInsertRowid);
      if (b.decision === 'accepted') db.prepare("INSERT INTO stock_movements (branch_id, item_id, qty_delta, type, receipt_id, created_by) VALUES (?,?,?,'receipt',?,?)").run(branchId, item.id, qty, rid, u.id);
      else notify(db, branchId, 'goods', `Lieferung abgelehnt: ${item.name}`, `receipt:${rid}`);
      audit(db, { actor: u.id, branch: branchId, action: 'goods_receipt', entity: 'goods_receipt', id: rid, payload: { item: item.id, qty, decision: b.decision } });
      return { id: rid, stock: stockOf(db, branchId).find((s) => s.id === item.id) };
    });
  });
  route('GET', '/api/stock', (ctx) => stockOf(db, needBranch(ctx, ctx.query.get('branch'))));
  route('POST', '/api/stock/movement', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch);
    const type = ctx.body.type;
    if (!['waste', 'consumption'].includes(type)) throw bad('type');
    const qty = Number(ctx.body.quantity);
    if (!(qty > 0)) throw bad('quantity');
    if (type === 'waste' && !String(ctx.body.note || '').trim()) throw bad('note', 'Grund für Verderb angeben');
    if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(Number(ctx.body.item_id))) throw bad('item');
    db.prepare('INSERT INTO stock_movements (branch_id, item_id, qty_delta, type, note, created_by) VALUES (?,?,?,?,?,?)').run(branchId, Number(ctx.body.item_id), -qty, type, String(ctx.body.note || '').slice(0, 200) || null, u.id);
    audit(db, { actor: u.id, branch: branchId, action: type, entity: 'item', id: Number(ctx.body.item_id), payload: { qty } });
    return stockOf(db, branchId).find((s) => s.id === Number(ctx.body.item_id));
  });
  route('POST', '/api/stock/count', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'manager', 'admin');
    const counted = Number(ctx.body.counted);
    if (!Number.isFinite(counted) || counted < 0) throw bad('counted');
    const cur = stockOf(db, branchId).find((s) => s.id === Number(ctx.body.item_id));
    if (!cur) throw bad('item');
    const diff = Math.round((counted - cur.qty) * 1000) / 1000;
    if (diff !== 0) db.prepare("INSERT INTO stock_movements (branch_id, item_id, qty_delta, type, note, created_by) VALUES (?,?,?,'count',?,?)").run(branchId, cur.id, diff, `Inventur: gezählt ${counted}, Soll ${cur.qty}`, u.id);
    audit(db, { actor: u.id, branch: branchId, action: 'stock_count', entity: 'item', id: cur.id, payload: { counted, before: cur.qty, diff } });
    return { diff, stock: stockOf(db, branchId).find((s) => s.id === cur.id) };
  });
  route('PATCH', '/api/stock/:id', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'manager', 'admin');
    const min = Number(ctx.body.min_qty);
    if (!Number.isFinite(min) || min < 0) throw bad('min_qty');
    db.prepare('INSERT INTO stock_settings (branch_id, item_id, min_qty) VALUES (?,?,?) ON CONFLICT (branch_id, item_id) DO UPDATE SET min_qty = excluded.min_qty').run(branchId, Number(ctx.params.id), min);
    audit(db, { actor: u.id, branch: branchId, action: 'set_min', entity: 'item', id: Number(ctx.params.id), payload: { min } });
    return { ok: true };
  });

  // --- Ölmanager -----------------------------------------------------------------
  route('GET', '/api/oil', (ctx) => {
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    return db.prepare('SELECT * FROM fryers WHERE branch_id = ? ORDER BY name').all(branchId).map((f) => ({
      ...f, model_verified: !!f.model_verified, ...oilStatus(db, f),
      history: db.prepare('SELECT e.id, e.type, e.tpm, e.note, e.created_at, e.media_id, u.display_name AS by FROM oil_events e JOIN users u ON u.id = e.created_by WHERE fryer_id = ? ORDER BY e.id DESC LIMIT 15').all(f.id),
    }));
  });
  route('POST', '/api/oil/:id/event', (ctx) => {
    const u = needUser(ctx);
    const f = db.prepare('SELECT * FROM fryers WHERE id = ?').get(Number(ctx.params.id));
    if (!f) throw notFound();
    const branchId = needBranch(ctx, f.branch_id);
    if (f.course_id && !qualification(db, u.id, f.course_id, branchId).ok) throw new HttpError(403, 'not_qualified', 'Schulung oder praktische Freigabe für diese Fritteuse fehlt');
    const type = ctx.body.type;
    if (!['tpm', 'filter', 'change'].includes(type)) throw bad('type');
    let tpm = null;
    if (type === 'tpm') {
      tpm = Number(ctx.body.tpm);
      if (ctx.body.tpm === '' || ctx.body.tpm == null || !Number.isFinite(tpm) || tpm < 0 || tpm > 100) throw bad('tpm', 'TPM-Wert 0–100 % eingeben');
    }
    const photo = mediaInBranch(ctx.body.media_id, branchId);
    if (!photo) throw bad('photo_required', 'Foto ist Pflicht');
    return tx(db, () => {
      const id = Number(db.prepare('INSERT INTO oil_events (fryer_id, branch_id, type, tpm, media_id, note, created_by) VALUES (?,?,?,?,?,?,?)').run(f.id, branchId, type, tpm, photo, String(ctx.body.note || '').slice(0, 300) || null, u.id).lastInsertRowid);
      const st = oilStatus(db, f);
      if (type === 'tpm' && st.state === 'change') {
        db.prepare("INSERT INTO problems (branch_id, source, description, media_id, reported_by) VALUES (?, 'oil', ?, ?, ?)").run(branchId, `Öl ${f.name}: TPM ${tpm} % ≥ freigegebener Grenzwert ${f.tpm_limit} %`, photo, u.id);
        notify(db, branchId, 'oil', `Ölwechsel nötig: ${f.name}`, `fryer:${f.id}`);
      }
      audit(db, { actor: u.id, branch: branchId, action: 'oil_' + type, entity: 'fryer', id: f.id, payload: { tpm, event: id } });
      return { id, status: st };
    });
  });
  route('PATCH', '/api/oil/:id', (ctx) => {
    const u = needUser(ctx);
    const f = db.prepare('SELECT * FROM fryers WHERE id = ?').get(Number(ctx.params.id));
    if (!f) throw notFound();
    const branchId = needBranch(ctx, f.branch_id, 'manager', 'admin');
    const b = ctx.body;
    const num = (v) => (v === '' || v == null ? null : Number(v));
    const limit = b.tpm_limit !== undefined ? num(b.tpm_limit) : f.tpm_limit;
    const warn = b.tpm_warn !== undefined ? num(b.tpm_warn) : f.tpm_warn;
    const source = b.limit_source !== undefined ? String(b.limit_source || '').trim() : f.limit_source;
    if ((limit != null || warn != null) && !source) throw bad('limit_source', 'Quelle angeben (Herstellerangabe / HACCP-Plan)');
    if ([limit, warn].some((v) => v != null && (!Number.isFinite(v) || v <= 0 || v > 100))) throw bad('tpm', 'Wert 0–100 %');
    if (limit != null && warn != null && warn >= limit) throw bad('tpm_warn', 'Warnwert muss unter dem Grenzwert liegen');
    db.prepare('UPDATE fryers SET tpm_limit = ?, tpm_warn = ?, limit_source = ?, oil_product = COALESCE(?, oil_product) WHERE id = ?').run(limit, warn, source || null, b.oil_product ? String(b.oil_product).slice(0, 80) : null, f.id);
    audit(db, { actor: u.id, branch: branchId, action: 'set_oil_limits', entity: 'fryer', id: f.id, payload: { limit, warn, source } });
    return { ok: true };
  });

  // --- Admin --------------------------------------------------------------------
  route('GET', '/api/admin/users', (ctx) => {
    needAdmin(ctx);
    return db.prepare('SELECT id, username, display_name, is_admin, active FROM users ORDER BY display_name').all().map((u) => ({
      ...u, memberships: db.prepare('SELECT branch_id, role FROM memberships WHERE user_id = ?').all(u.id) }));
  });
  route('POST', '/api/admin/users', (ctx) => {
    const a = needAdmin(ctx);
    const { username, display_name, password, memberships = [] } = ctx.body;
    if (!/^[a-z0-9._-]{3,40}$/i.test(username || '')) throw bad('username', 'Benutzername: 3–40 Zeichen a-z 0-9 . _ -');
    if (String(password || '').length < 10) throw bad('password', 'Passwort mindestens 10 Zeichen');
    if (!String(display_name || '').trim()) throw bad('display_name');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'duplicate', 'Benutzer existiert');
    return tx(db, () => {
      const id = Number(db.prepare('INSERT INTO users (username, display_name, password_hash) VALUES (?,?,?)').run(username, String(display_name).slice(0, 80), hashPassword(password)).lastInsertRowid);
      for (const m of memberships) {
        if (!['manager', 'trainer', 'employee'].includes(m.role) || !db.prepare('SELECT 1 FROM branches WHERE id = ?').get(Number(m.branch_id))) throw bad('membership');
        db.prepare('INSERT OR IGNORE INTO memberships (user_id, branch_id, role) VALUES (?,?,?)').run(id, Number(m.branch_id), m.role);
      }
      audit(db, { actor: a.id, action: 'create', entity: 'user', id, payload: { username, memberships } });
      return { id };
    });
  });
  route('POST', '/api/admin/branches', (ctx) => {
    const a = needAdmin(ctx);
    const code = String(ctx.body.code || '').toLowerCase().trim(), name = String(ctx.body.name || '').trim();
    if (!/^[a-z0-9-]{2,30}$/.test(code) || !name) throw bad('branch', 'Kürzel und Name nötig');
    if (db.prepare('SELECT 1 FROM branches WHERE code = ?').get(code)) throw new HttpError(409, 'duplicate');
    const id = Number(db.prepare('INSERT INTO branches (code, name) VALUES (?,?)').run(code, name.slice(0, 60)).lastInsertRowid);
    seedTemplates(db, id);
    audit(db, { actor: a.id, branch: id, action: 'create', entity: 'branch', id });
    return { id };
  });
  route('GET', '/api/admin/sops', (ctx) => {
    needAdmin(ctx);
    return db.prepare('SELECT * FROM sops ORDER BY code').all().map((s) => ({
      ...s, versions: db.prepare('SELECT id, version_no, status, content, reviewed_langs, approved_at FROM sop_versions WHERE sop_id = ? ORDER BY version_no DESC').all(s.id)
        .map((v) => ({ ...v, content: j(v.content) })) }));
  });
  route('POST', '/api/admin/sops/:id/versions', (ctx) => {
    const a = needAdmin(ctx);
    const sop = db.prepare('SELECT * FROM sops WHERE id = ?').get(Number(ctx.params.id));
    if (!sop) throw notFound();
    const content = ctx.body.content;
    if (!content || !content.de || !String(content.de.title || '').trim() || !Array.isArray(content.de.steps) || !content.de.steps.length) throw bad('content', 'Deutscher Titel und mindestens ein Schritt nötig');
    const clean = {};
    for (const l of LANGS) {
      if (!content[l]?.title) continue;
      clean[l] = { title: String(content[l].title).slice(0, 120), steps: (content[l].steps || []).filter((s) => String(s.text || '').trim()).slice(0, 20)
        .map((s) => ({ icon: String(s.icon || 'check').slice(0, 20), text: String(s.text).slice(0, 400) })) };
    }
    const reviewed = (Array.isArray(ctx.body.reviewed_langs) ? ctx.body.reviewed_langs : ['de']).filter((l) => clean[l]);
    const no = (db.prepare('SELECT MAX(version_no) m FROM sop_versions WHERE sop_id = ?').get(sop.id).m || 0) + 1;
    db.prepare("INSERT INTO sop_versions (sop_id, version_no, status, content, reviewed_langs, created_by) VALUES (?,?,'draft',?,?,?)").run(sop.id, no, JSON.stringify(clean), reviewed.join(',') || 'de', a.id);
    audit(db, { actor: a.id, action: 'create_version', entity: 'sop', id: sop.id, payload: { version: no } });
    return { version_no: no };
  });
  route('POST', '/api/admin/sops/:id/publish', (ctx) => {
    const a = needAdmin(ctx);
    const sop = db.prepare('SELECT * FROM sops WHERE id = ?').get(Number(ctx.params.id));
    if (!sop) throw notFound();
    const v = db.prepare("SELECT * FROM sop_versions WHERE sop_id = ? AND version_no = ? AND status = 'draft'").get(sop.id, Number(ctx.body.version_no));
    if (!v) throw bad('version', 'Entwurf nicht gefunden');
    tx(db, () => {
      db.prepare("UPDATE sop_versions SET status = 'archived' WHERE sop_id = ? AND status = 'approved'").run(sop.id);
      db.prepare("UPDATE sop_versions SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?").run(a.id, new Date().toISOString(), v.id);
      audit(db, { actor: a.id, action: 'publish', entity: 'sop', id: sop.id, payload: { version: v.version_no } });
    });
    return { ok: true };
  });
  route('PATCH', '/api/admin/sops/:id', (ctx) => {
    const a = needAdmin(ctx);
    if (!['pending', 'verified', 'not_required'].includes(ctx.body.safety_review)) throw bad('safety_review');
    db.prepare('UPDATE sops SET safety_review = ? WHERE id = ?').run(ctx.body.safety_review, Number(ctx.params.id));
    audit(db, { actor: a.id, action: 'safety_review', entity: 'sop', id: Number(ctx.params.id), payload: { value: ctx.body.safety_review } });
    return { ok: true };
  });
  route('GET', '/api/audit', (ctx) => {
    const u = needUser(ctx);
    const b = ctx.query.get('branch');
    if (b) needBranch(ctx, b, 'manager', 'admin'); else if (!u.is_admin) throw forbidden();
    return db.prepare(`SELECT a.*, u.display_name AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      WHERE (? IS NULL OR a.branch_id = ?) ORDER BY a.id DESC LIMIT 200`).all(b ? Number(b) : null, b ? Number(b) : null);
  });
  route('GET', '/api/admin/settings', (ctx) => { needAdmin(ctx); return Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value])); });
  route('PUT', '/api/admin/settings', (ctx) => {
    const a = needAdmin(ctx);
    const days = Number(ctx.body.photo_retention_days);
    if (!Number.isInteger(days) || days < 30 || days > 3650) throw bad('photo_retention_days', '30–3650 Tage');
    db.prepare("UPDATE settings SET value = ? WHERE key = 'photo_retention_days'").run(String(days));
    audit(db, { actor: a.id, action: 'settings', entity: 'settings', payload: { photo_retention_days: days } });
    return { ok: true };
  });

  // --- Request-Verarbeitung ----------------------------------------------------
  const pubRoot = resolve(publicDir);
  function serveStatic(req, res, pathname) {
    let rel = pathname === '/' ? '/index.html' : pathname;
    let root = pubRoot;
    if (rel.startsWith('/shared/')) { root = resolve(sharedDir); rel = rel.slice('/shared'.length); }
    const file = normalize(join(root, rel));
    if (!file.startsWith(root)) return false;
    let target = file;
    if (!existsSync(target) || statSync(target).isDirectory()) {
      if (extname(rel)) return false;
      target = join(pubRoot, 'index.html'); // App-Routen
    }
    const headers = { ...SEC_HEADERS, 'Content-Type': MIME[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
    if (target.endsWith('sw.js')) headers['Service-Worker-Allowed'] = '/';
    res.writeHead(200, headers);
    res.end(readFileSync(target));
    return true;
  }

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://local');
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.fh_session;
    const ctx = {
      req, res, query: url.searchParams, params: {}, body: {}, token,
      ip: req.socket?.remoteAddress || '',
      user: null,
      setCookie(value, clear = false) {
        const attrs = ['Path=/', 'HttpOnly', 'SameSite=Strict', clear ? 'Max-Age=0' : 'Max-Age=43200'];
        if (cookieSecure) attrs.push('Secure');
        res.setHeader('Set-Cookie', `fh_session=${value}; ${attrs.join('; ')}`);
      },
    };
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method === 'GET' && serveStatic(req, res, url.pathname)) return;
        throw notFound();
      }
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) throw notFound();
      const m = url.pathname.match(r.re);
      r.keys.forEach((k, i) => { ctx.params[k] = m[i + 1]; });
      if (req.method !== 'GET') {
        // CSRF-Schutz: nur Same-Site-Cookie + eigener Header (von Formularen fremder Seiten nicht setzbar)
        if (req.headers['x-fh-request'] !== '1') throw new HttpError(403, 'csrf', 'Ungültige Anfrage');
        if (!r.handler.raw) {
          const buf = await readBody(req, 256 * 1024);
          if (buf.length) { try { ctx.body = JSON.parse(buf.toString('utf8')); } catch { throw bad('json'); } }
          if (typeof ctx.body !== 'object' || ctx.body === null) ctx.body = {};
        }
      }
      ctx.user = userFromToken(db, token);
      const out = await r.handler(ctx);
      if (out === undefined) return;
      res.writeHead(200, { ...SEC_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(out));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) log('error', e);
      if (!res.headersSent) res.writeHead(status, { ...SEC_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: e instanceof HttpError ? e.code : 'server_error', message: e instanceof HttpError ? e.message : 'Serverfehler' }));
    }
  };
}

/** Fotos nach Aufbewahrungsfrist löschen (Datenschutz). Nachweis-Datensatz bleibt, Datei wird entfernt. */
export function purgeExpiredMedia(db, uploadDir, now = new Date()) {
  const days = Number(db.prepare("SELECT value FROM settings WHERE key = 'photo_retention_days'").get()?.value || 365);
  const cutoff = new Date(now.getTime() - days * 86400e3).toISOString();
  const rows = db.prepare('SELECT id, storage_key FROM media WHERE purged_at IS NULL AND created_at < ?').all(cutoff);
  for (const r of rows) {
    try { unlinkSync(join(uploadDir, r.storage_key)); } catch { /* bereits entfernt */ }
    db.prepare('UPDATE media SET purged_at = ? WHERE id = ?').run(now.toISOString(), r.id);
  }
  if (rows.length) audit(db, { action: 'purge_media', entity: 'media', payload: { count: rows.length, days } });
  return rows.length;
}
