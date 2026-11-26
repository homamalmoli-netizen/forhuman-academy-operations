// Schulungsbereiche: 10 Bereiche × 3 Stufen, Fragenpool je Stufe (Ziel 20), Zufallsreihenfolge von Fragen und Antworten,
// Bestehen ab 80 % UND alle Sicherheitsfragen richtig, Erklärungen bei Fehlern, Wiederholen, praktische Freigabe durch
// Trainer/Leitung, Zertifikat, Stationsbezug und Hilfesuche „Wie mache ich das?“.
// Fragen-Daten: options[0] ist immer die richtige Antwort; ausgeliefert wird nur eine gemischte Reihenfolge ohne Lösung.
import { randomBytes, randomInt } from 'node:crypto';
import { tx, audit } from './db.js';
import { can } from './auth.js';
import { AREAS, LEVELS } from './training-content.js';
import { MORE_QUESTIONS } from './training-content-2.js';
import { LEVEL1_MORE } from './training-content-3.js';
import { HANDBOOK } from './handbook.js';

export const POOL_TARGET = 20;     // Ziel je Stufe
export const EXAM_MIN = 5;         // darunter ist die Prüfung „in Vorbereitung“
export const PASS_PERCENT = 80;
const ATTEMPT_HOURS = 3;
const LANGS = ['de', 'en', 'ar'];

const j = (s, d = {}) => { try { return JSON.parse(s); } catch { return d; } };
const pick = (obj, L) => obj?.[L] ?? obj?.de;

function shuffle(a) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const k = randomInt(i + 1); [r[i], r[k]] = [r[k], r[i]]; }
  return r;
}

const toContent = (langs) => Object.fromEntries(Object.entries(langs).map(([L, [q, ...rest]]) => [L, { q, options: rest.slice(0, -1), explain: rest[rest.length - 1] }]));

export function seedTraining(db) {
  tx(db, () => {
    const insA = db.prepare('INSERT OR IGNORE INTO train_areas (code, icon, position, title, stations) VALUES (?,?,?,?,?)');
    AREAS.forEach((a, i) => insA.run(a.code, a.icon, i + 1, JSON.stringify(a.title), a.stations.join(',')));
    const insQ = db.prepare('INSERT OR IGNORE INTO train_questions (module_id, position, safety, content, seed_key) VALUES (?,?,?,?,?)');
    for (const a of AREAS) {
      const areaId = db.prepare('SELECT id FROM train_areas WHERE code = ?').get(a.code).id;
      a.levels.forEach((lv, i) => {
        const level = i + 1;
        let mod = db.prepare('SELECT id FROM train_modules WHERE area_id = ? AND level = ?').get(areaId, level);
        if (!mod) {
          const content = Object.fromEntries(LANGS.map((L) => [L, { steps: lv.steps[L] || [] }]));
          mod = { id: Number(db.prepare('INSERT INTO train_modules (area_id, level, content, open_points, practical_required) VALUES (?,?,?,?,?)')
            .run(areaId, level, JSON.stringify(content), JSON.stringify(lv.open || []), 1).lastInsertRowid) };
        }
        // Jede mitgelieferte Frage hat einen festen Schlüssel (Bereich:Stufe:Nr.). Vorhandene Schlüssel werden nie
        // überschrieben – auch nicht, wenn der Betreiber die Frage geändert oder archiviert hat. Neue Fragen nur anhängen.
        const list = [...lv.questions, ...(level === 1 ? LEVEL1_MORE[a.code] || [] : MORE_QUESTIONS[a.code]?.[level] || [])];
        list.forEach(([safety, langs], k) => insQ.run(mod.id, k + 1, safety, JSON.stringify(toContent(langs)), `${a.code}:${level}:${k}`));
      });
    }
  });
}

/** Status eines Moduls für eine Person. */
export function moduleState(db, userId, mod, branchId) {
  const cert = db.prepare('SELECT code, issued_at FROM train_certificates WHERE user_id = ? AND module_id = ? AND branch_id = ?').get(userId, mod.id, branchId);
  const passed = db.prepare('SELECT id, score, total, submitted_at FROM train_attempts WHERE user_id = ? AND module_id = ? AND branch_id = ? AND passed = 1 ORDER BY id DESC LIMIT 1').get(userId, mod.id, branchId);
  const last = db.prepare('SELECT score, total, passed, safety_ok, submitted_at FROM train_attempts WHERE user_id = ? AND module_id = ? AND submitted_at IS NOT NULL ORDER BY id DESC LIMIT 1').get(userId, mod.id);
  const pool = db.prepare("SELECT COUNT(*) n FROM train_questions WHERE module_id = ? AND status = 'active'").get(mod.id).n;
  let unlocked = true;
  if (mod.level > 1) {
    const prev = db.prepare('SELECT id FROM train_modules WHERE area_id = ? AND level = ?').get(mod.area_id, mod.level - 1);
    unlocked = !!db.prepare('SELECT 1 FROM train_attempts WHERE user_id = ? AND module_id = ? AND branch_id = ? AND passed = 1').get(userId, prev.id, branchId);
  }
  const state = cert ? 'certified' : passed ? 'needs_practical' : !unlocked ? 'locked' : pool < EXAM_MIN ? 'preparing' : 'open';
  return { state, unlocked, pool, pool_target: POOL_TARGET, exam_ready: pool >= EXAM_MIN, certificate: cert || null, last_attempt: last || null };
}

function issueCertificate(db, userId, mod, branchId, attemptId) {
  if (db.prepare('SELECT 1 FROM train_certificates WHERE user_id = ? AND module_id = ? AND branch_id = ?').get(userId, mod.id, branchId)) return null;
  const code = 'FH-' + randomBytes(5).toString('hex').toUpperCase();
  db.prepare('INSERT INTO train_certificates (user_id, module_id, module_version, branch_id, attempt_id, code) VALUES (?,?,?,?,?,?)').run(userId, mod.id, mod.version, branchId, attemptId, code);
  return code;
}

/** Höchste zertifizierte Stufe je Bereich. */
export function areaLevels(db, userId, branchId) {
  const rows = db.prepare(`SELECT m.area_id, MAX(m.level) lvl FROM train_certificates c JOIN train_modules m ON m.id = c.module_id
    WHERE c.user_id = ? AND c.branch_id = ? GROUP BY m.area_id`).all(userId, branchId);
  return Object.fromEntries(rows.map((r) => [r.area_id, r.lvl]));
}

function validQuestion(c) {
  if (!c?.de?.q?.trim() || !Array.isArray(c.de.options)) return 'Deutsche Frage und Antworten sind Pflicht';
  const n = c.de.options.length;
  if (n < 2 || n > 4 || c.de.options.some((o) => !String(o || '').trim())) return '2–4 Antworten, keine leer; die erste ist die richtige';
  for (const L of ['en', 'ar']) {
    if (!c[L]) continue;
    if (!c[L].q?.trim()) { delete c[L]; continue; }
    if (!Array.isArray(c[L].options) || c[L].options.length !== n || c[L].options.some((o) => !String(o || '').trim())) return `Übersetzung ${L.toUpperCase()}: gleiche Anzahl Antworten wie Deutsch`;
  }
  return null;
}
const cleanQuestion = (c) => Object.fromEntries(LANGS.filter((L) => c[L]).map((L) => [L, { q: String(c[L].q).trim().slice(0, 500), options: c[L].options.map((o) => String(o).trim().slice(0, 300)), explain: String(c[L].explain || '').trim().slice(0, 800) }]));

export function registerTraining({ route, db, needUser, needBranch, needAdmin, HttpError, bad, notFound }) {
  const langOf = (ctx, v) => (LANGS.includes(v) ? v : LANGS.includes(ctx.query?.get?.('lang')) ? ctx.query.get('lang') : 'de');
  const modFor = (id) => { const m = db.prepare('SELECT * FROM train_modules WHERE id = ?').get(Number(id)); if (!m) throw notFound(); return m; };
  const areaOf = (m) => db.prepare('SELECT * FROM train_areas WHERE id = ?').get(m.area_id);
  const modTitle = (a, m, L) => `${pick(j(a.title), L)} · ${pick(LEVELS[m.level], L)}`;

  route('GET', '/api/train', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    const L = langOf(ctx);
    const stations = db.prepare('SELECT code, name FROM stations WHERE branch_id = ?').all(branchId);
    const stName = (code) => { const s = stations.find((x) => x.code === code); return s ? pick(j(s.name), L) : code; };
    return db.prepare('SELECT * FROM train_areas WHERE active = 1 ORDER BY position').all().map((a) => ({
      id: a.id, code: a.code, icon: a.icon, title: pick(j(a.title), L),
      stations: a.stations ? a.stations.split(',').filter(Boolean).map(stName) : [],
      levels: db.prepare('SELECT * FROM train_modules WHERE area_id = ? ORDER BY level').all(a.id).map((m) => ({ id: m.id, level: m.level, label: pick(LEVELS[m.level], L), ...moduleState(db, u.id, m, branchId) })),
    }));
  });

  route('GET', '/api/train/modules/:id', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    const m = modFor(ctx.params.id); const a = areaOf(m);
    const L = langOf(ctx);
    const content = j(m.content);
    const steps = content[L]?.steps?.length ? content[L].steps : content.de?.steps || [];
    return { id: m.id, area: pick(j(a.title), L), area_code: a.code, level: m.level, level_label: pick(LEVELS[m.level], L), title: modTitle(a, m, L),
      lang: L, translation_reviewed: m.reviewed_langs.split(',').includes(L), steps, video_url: m.video_url, open_points: j(m.open_points, []),
      practical_required: !!m.practical_required, pass_percent: PASS_PERCENT, ...moduleState(db, u.id, m, branchId) };
  });

  // Prüfung starten: Fragen (max. 20) und Antworten werden serverseitig zufällig gemischt.
  route('POST', '/api/train/modules/:id/start', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch);
    const m = modFor(ctx.params.id);
    const st = moduleState(db, u.id, m, branchId);
    if (!st.unlocked) throw new HttpError(403, 'locked', 'Erst die vorherige Stufe bestehen');
    if (!st.exam_ready) throw new HttpError(409, 'not_ready', 'Für diese Stufe sind noch nicht genug Fragen freigegeben');
    const L = langOf(ctx, ctx.body.lang);
    const qs = shuffle(db.prepare("SELECT * FROM train_questions WHERE module_id = ? AND status = 'active'").all(m.id)).slice(0, POOL_TARGET);
    const plan = qs.map((q) => ({ q: q.id, order: shuffle(j(q.content).de.options.map((_, i) => i)) }));
    const id = Number(db.prepare('INSERT INTO train_attempts (user_id, module_id, module_version, branch_id, lang, plan) VALUES (?,?,?,?,?,?)')
      .run(u.id, m.id, m.version, branchId, L, JSON.stringify(plan)).lastInsertRowid);
    return { attempt_id: id };
  });

  const attemptFor = (ctx, id) => {
    const u = needUser(ctx);
    const t = db.prepare('SELECT * FROM train_attempts WHERE id = ?').get(Number(id));
    if (!t || t.user_id !== u.id) throw notFound();
    return { u, t };
  };
  const qMap = (plan) => new Map(db.prepare(`SELECT * FROM train_questions WHERE id IN (${plan.map(() => '?').join(',')})`).all(...plan.map((p) => p.q)).map((q) => [q.id, q]));

  route('GET', '/api/train/attempts/:id', (ctx) => {
    const { t } = attemptFor(ctx, ctx.params.id);
    if (t.submitted_at) throw new HttpError(409, 'submitted', 'Diese Prüfung ist schon abgegeben');
    const m = modFor(t.module_id); const a = areaOf(m);
    const L = langOf(ctx);
    const plan = j(t.plan, []); const map = qMap(plan);
    return { id: t.id, module_id: m.id, title: modTitle(a, m, L), lang: L, pass_percent: PASS_PERCENT, translation_reviewed: m.reviewed_langs.split(',').includes(L),
      questions: plan.map((p, i) => { const c = j(map.get(p.q).content); const lc = c[L] || c.de; return { index: i, safety: !!map.get(p.q).safety, q: lc.q, options: p.order.map((k) => lc.options[k]) }; }) };
  });

  route('POST', '/api/train/attempts/:id/submit', (ctx) => {
    const { u, t } = attemptFor(ctx, ctx.params.id);
    if (t.submitted_at) throw new HttpError(409, 'submitted', 'Diese Prüfung ist schon abgegeben');
    if (Date.now() - Date.parse(t.started_at) > ATTEMPT_HOURS * 3600e3) throw new HttpError(409, 'expired', 'Zeit abgelaufen – bitte neu starten');
    const m = modFor(t.module_id);
    const plan = j(t.plan, []); const map = qMap(plan);
    const answers = Array.isArray(ctx.body.answers) ? ctx.body.answers.map((x) => (x === null || x === '' ? null : Number(x))) : [];
    if (answers.length !== plan.length || answers.some((x) => x === null || !Number.isInteger(x))) throw bad('answers', 'Bitte alle Fragen beantworten');
    const L = LANGS.includes(ctx.body.lang) ? ctx.body.lang : t.lang;
    const results = plan.map((p, i) => {
      const q = map.get(p.q); const c = j(q.content); const lc = c[L] || c.de;
      const given = answers[i];
      if (given < 0 || given >= p.order.length) throw bad('answers');
      const correct = p.order[given] === 0;
      return { index: i, correct, safety: !!q.safety, q: lc.q, given: lc.options[p.order[given]], right: lc.options[0], explain: correct ? null : (lc.explain || null) };
    });
    const score = results.filter((r) => r.correct).length;
    const safetyOk = results.every((r) => !r.safety || r.correct);
    const passed = safetyOk && score * 100 >= PASS_PERCENT * plan.length;
    let certificate = null;
    tx(db, () => {
      db.prepare('UPDATE train_attempts SET submitted_at = ?, answers = ?, score = ?, total = ?, safety_ok = ?, passed = ?, lang = ? WHERE id = ?')
        .run(new Date().toISOString(), JSON.stringify(answers), score, plan.length, safetyOk ? 1 : 0, passed ? 1 : 0, L, t.id);
      if (passed && !m.practical_required) certificate = issueCertificate(db, u.id, m, t.branch_id, t.id);
      audit(db, { actor: u.id, branch: t.branch_id, action: 'train_exam', entity: 'train_module', id: m.id, payload: { attempt: t.id, score, total: plan.length, safety_ok: safetyOk, passed } });
    });
    return { score, total: plan.length, percent: Math.round((score * 100) / plan.length), pass_percent: PASS_PERCENT, safety_ok: safetyOk, passed,
      needs_practical: passed && !!m.practical_required && !certificate, certificate, results };
  });

  // Praktische Freigabe durch Trainer/Leitung (nie durch sich selbst), danach Zertifikat
  route('POST', '/api/train/modules/:id/signoff', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'trainer', 'manager', 'admin');
    const m = modFor(ctx.params.id);
    const userId = Number(ctx.body.user_id);
    if (userId === u.id) throw new HttpError(403, 'self', 'Eigene Freigabe ist nicht erlaubt');
    if (!db.prepare('SELECT 1 FROM memberships WHERE user_id = ? AND branch_id = ?').get(userId, branchId)) throw notFound();
    const att = db.prepare('SELECT id FROM train_attempts WHERE user_id = ? AND module_id = ? AND branch_id = ? AND passed = 1 ORDER BY id DESC LIMIT 1').get(userId, m.id, branchId);
    if (!att) throw new HttpError(409, 'no_theory', 'Erst muss die Prüfung bestanden sein');
    let code;
    tx(db, () => {
      db.prepare('INSERT OR IGNORE INTO train_signoffs (user_id, module_id, branch_id, signed_by, note) VALUES (?,?,?,?,?)').run(userId, m.id, branchId, u.id, String(ctx.body.note || '').slice(0, 500) || null);
      code = issueCertificate(db, userId, m, branchId, att.id);
      audit(db, { actor: u.id, branch: branchId, action: 'train_signoff', entity: 'train_module', id: m.id, payload: { user: userId } });
    });
    return { ok: true, certificate: code };
  });

  route('GET', '/api/train/certificates', (ctx) => {
    const u = needUser(ctx);
    const L = langOf(ctx);
    return db.prepare(`SELECT c.code, c.issued_at, c.branch_id, m.level, a.title, b.name branch, s.signed_at, su.display_name signed_by
      FROM train_certificates c JOIN train_modules m ON m.id = c.module_id JOIN train_areas a ON a.id = m.area_id JOIN branches b ON b.id = c.branch_id
      LEFT JOIN train_signoffs s ON s.user_id = c.user_id AND s.module_id = c.module_id AND s.branch_id = c.branch_id LEFT JOIN users su ON su.id = s.signed_by
      WHERE c.user_id = ? ORDER BY c.issued_at DESC`).all(u.id)
      .map((r) => ({ code: r.code, issued_at: r.issued_at, branch: r.branch, title: `${pick(j(r.title), L)} · ${pick(LEVELS[r.level], L)}`, signed_by: r.signed_by, signed_at: r.signed_at }));
  });

  // Leitung/Trainer: Matrix Personen × Bereiche, offene praktische Freigaben
  route('GET', '/api/train/overview', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'), 'trainer', 'manager', 'shift_lead', 'admin');
    const areas = db.prepare('SELECT * FROM train_areas WHERE active = 1 ORDER BY position').all();
    const people = db.prepare(`SELECT DISTINCT us.id, us.display_name FROM memberships ms JOIN users us ON us.id = ms.user_id
      WHERE ms.branch_id = ? AND ms.role IN ('employee','shift_lead','trainer') AND us.active = 1 ORDER BY us.display_name`).all(branchId);
    const pending = db.prepare(`SELECT DISTINCT t.user_id, t.module_id, us.display_name, m.level, a.title, MAX(t.submitted_at) passed_at
      FROM train_attempts t JOIN users us ON us.id = t.user_id JOIN train_modules m ON m.id = t.module_id JOIN train_areas a ON a.id = m.area_id
      WHERE t.branch_id = ? AND t.passed = 1 AND m.practical_required = 1
        AND NOT EXISTS (SELECT 1 FROM train_certificates c WHERE c.user_id = t.user_id AND c.module_id = t.module_id AND c.branch_id = t.branch_id)
      GROUP BY t.user_id, t.module_id ORDER BY passed_at`).all(branchId);
    const pools = db.prepare(`SELECT m.id, m.area_id, m.level, (SELECT COUNT(*) FROM train_questions q WHERE q.module_id = m.id AND q.status = 'active') active,
      (SELECT COUNT(*) FROM train_questions q WHERE q.module_id = m.id AND q.status = 'open') open_q, m.open_points FROM train_modules m`).all();
    return {
      can_sign: can(u, branchId, 'trainer', 'manager', 'admin'),
      areas: areas.map((a) => ({ id: a.id, code: a.code, title: j(a.title).de, stations: a.stations ? a.stations.split(',').filter(Boolean) : [],
        modules: pools.filter((p) => p.area_id === a.id).sort((x, y) => x.level - y.level).map((p) => ({ id: p.id, level: p.level, active: p.active, open_questions: p.open_q, open_points: j(p.open_points, []).length })) })),
      people: people.map((p) => ({ ...p, levels: areaLevels(db, p.id, branchId) })),
      pending: pending.map((r) => ({ user_id: r.user_id, name: r.display_name, module_id: r.module_id, title: `${j(r.title).de} · ${LEVELS[r.level].de}`, passed_at: r.passed_at })),
      pool_target: POOL_TARGET, exam_min: EXAM_MIN,
    };
  });

  // --- Betreiber: Inhalte, Video, Fragen bearbeiten ------------------------------------
  route('GET', '/api/train/modules/:id/edit', (ctx) => {
    needAdmin(ctx);
    const m = modFor(ctx.params.id); const a = areaOf(m);
    return { id: m.id, title: modTitle(a, m, 'de'), level: m.level, content: j(m.content), video_url: m.video_url || '', open_points: j(m.open_points, []),
      practical_required: !!m.practical_required, reviewed_langs: m.reviewed_langs.split(','), version: m.version,
      questions: db.prepare("SELECT * FROM train_questions WHERE module_id = ? AND status <> 'archived' ORDER BY position, id").all(m.id).map((q) => ({ id: q.id, safety: !!q.safety, status: q.status, content: j(q.content) })) };
  });
  route('PUT', '/api/train/modules/:id', (ctx) => {
    const admin = needAdmin(ctx);
    const m = modFor(ctx.params.id);
    const b = ctx.body || {};
    const content = j(m.content);
    for (const L of LANGS) if (Array.isArray(b.steps?.[L])) content[L] = { steps: b.steps[L].map((s) => String(s).trim()).filter(Boolean).slice(0, 30).map((s) => s.slice(0, 600)) };
    if (!content.de?.steps?.length) throw bad('steps', 'Mindestens ein deutscher Lernschritt');
    const video = b.video_url === undefined ? m.video_url : (String(b.video_url || '').trim() || null);
    if (video && !/^https:\/\/[^\s]+$/.test(video)) throw bad('video_url', 'Nur https-Links');
    const open = Array.isArray(b.open_points) ? b.open_points.map((s) => String(s).trim()).filter(Boolean).slice(0, 20) : j(m.open_points, []);
    const reviewed = Array.isArray(b.reviewed_langs) ? ['de', ...b.reviewed_langs.filter((l) => l === 'en' || l === 'ar')] : m.reviewed_langs.split(',');
    const pr = b.practical_required === undefined ? m.practical_required : (b.practical_required ? 1 : 0);
    db.prepare('UPDATE train_modules SET content = ?, video_url = ?, open_points = ?, practical_required = ?, reviewed_langs = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(content), video, JSON.stringify(open), pr, [...new Set(reviewed)].join(','), admin.id, new Date().toISOString(), m.id);
    audit(db, { actor: admin.id, action: 'train_module_edit', entity: 'train_module', id: m.id, payload: { video: !!video, open_points: open.length } });
    return { ok: true };
  });
  route('POST', '/api/train/modules/:id/questions', (ctx) => {
    const admin = needAdmin(ctx);
    const m = modFor(ctx.params.id);
    const c = ctx.body.content || {};
    const err = validQuestion(c); if (err) throw bad('content', err);
    const status = ['active', 'open'].includes(ctx.body.status) ? ctx.body.status : 'active';
    const pos = (db.prepare('SELECT MAX(position) p FROM train_questions WHERE module_id = ?').get(m.id).p || 0) + 1;
    const id = Number(db.prepare('INSERT INTO train_questions (module_id, position, safety, content, status, updated_by, updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(m.id, pos, ctx.body.safety ? 1 : 0, JSON.stringify(cleanQuestion(c)), status, admin.id, new Date().toISOString()).lastInsertRowid);
    audit(db, { actor: admin.id, action: 'train_question_new', entity: 'train_question', id, payload: { module: m.id } });
    return { id };
  });
  route('PUT', '/api/train/questions/:id', (ctx) => {
    const admin = needAdmin(ctx);
    const q = db.prepare('SELECT * FROM train_questions WHERE id = ?').get(Number(ctx.params.id));
    if (!q) throw notFound();
    const c = ctx.body.content || j(q.content);
    const err = validQuestion(c); if (err) throw bad('content', err);
    const status = ['active', 'open', 'archived'].includes(ctx.body.status) ? ctx.body.status : q.status;
    const safety = ctx.body.safety === undefined ? q.safety : (ctx.body.safety ? 1 : 0);
    db.prepare('UPDATE train_questions SET content = ?, status = ?, safety = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(cleanQuestion(c)), status, safety, admin.id, new Date().toISOString(), q.id);
    audit(db, { actor: admin.id, action: 'train_question_edit', entity: 'train_question', id: q.id, payload: { status } });
    return { ok: true };
  });

  // --- Hilfe: „Wie mache ich das?“ ------------------------------------------------------
  route('GET', '/api/help', (ctx) => {
    needUser(ctx);
    const L = langOf(ctx);
    const raw = String(ctx.query.get('q') || '').toLowerCase().trim().slice(0, 100);
    const words = raw.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
    if (!words.length) return { q: raw, results: [] };
    const hits = [];
    const score = (text) => { const t = text.toLowerCase(); return words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0); };
    const add = (kind, title, link, lines) => {
      let best = 0, snippet = '';
      for (const line of lines) { const s = score(line); if (s > best) { best = s; snippet = line; } }
      const ts = score(title);
      const total = best + ts * 2;
      if (total > 0) hits.push({ kind, title, link, snippet: snippet || lines[0] || '', score: total });
    };
    for (const m of db.prepare('SELECT m.*, a.title atitle FROM train_modules m JOIN train_areas a ON a.id = m.area_id WHERE a.active = 1').all()) {
      const c = j(m.content); const steps = c[L]?.steps?.length ? c[L].steps : c.de?.steps || [];
      add('training', `${pick(j(m.atitle), L)} · ${pick(LEVELS[m.level], L)}`, `#/train/${m.id}`, steps);
    }
    for (const h of HANDBOOK) add('handbook', h.title, '#/handbook', [h.intro, ...(h.items || []), ...(h.groups || []).flatMap((g) => g.items || []), h.rule].filter(Boolean));
    for (const s of db.prepare(`SELECT s.id, v.content FROM sops s JOIN sop_versions v ON v.sop_id = s.id AND v.status = 'approved'
      WHERE v.version_no = (SELECT MAX(version_no) FROM sop_versions v2 WHERE v2.sop_id = s.id AND v2.status = 'approved')`).all()) {
      const c = j(s.content); const lc = c[L] || c.de; if (!lc) continue;
      add('guide', lc.title || 'Anleitung', `#/sop/${s.id}`, (lc.steps || []).map((x) => x.text || String(x)));
    }
    hits.sort((a, b) => b.score - a.score);
    return { q: raw, results: hits.slice(0, 12).map(({ score: _s, ...h }) => h) };
  });
}
