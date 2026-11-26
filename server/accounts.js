// Persönliche Zugänge: Leitung legt Konten an (keine Sammelkonten), Einladungscode statt Passwortversand,
// Passwort selbst setzen, Zurücksetzen per neuem Code, Deaktivieren. Nachweise: §43 IfSG-Belehrung, METRO-Hygieneschulung,
// betriebliche Folgebelehrung; privat gespeichert, Prüfung durch die Leitung. METRO ersetzt §43 nicht.
import { randomBytes, createHash } from 'node:crypto';
import { tx, audit } from './db.js';
import { hashPassword, verifyPassword, createSession, rolesIn, can } from './auth.js';
import { berlinDate } from './app.js';
import { openTrainings } from './inventory.js';
import { HANDBOOK_VERSION } from './handbook.js';

const sha = (t) => createHash('sha256').update(t).digest('hex');
const INVITE_DAYS = 7;
// Lesbarer Code ohne verwechselbare Zeichen
function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  let c = '';
  for (let i = 0; i < 12; i++) c += alphabet[bytes[i] % alphabet.length];
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}

export const CERT_TYPES = { ifsg43: 'Belehrung nach §43 Infektionsschutzgesetz', metro_hygiene: 'METRO-Hygieneschulung', ifsg_followup: 'Betriebliche Folgebelehrung (§43)', other: 'Sonstiger Nachweis' };
const DEFAULT_LINKS = {
  ifsg43: { text: 'Die Erstbelehrung nach §43 IfSG erfolgt beim zuständigen Gesundheitsamt bzw. einer beauftragten Stelle. Bescheinigung fotografieren und hier hochladen. Der Betreiber kann hier den offiziellen Link seines Gesundheitsamts hinterlegen.', url: '' },
  metro_hygiene: { text: 'Teilnahmebescheinigung der METRO-Hygieneschulung hochladen. Hinweis: Die METRO-Schulung ersetzt die Belehrung nach §43 IfSG nicht.', url: '' },
};

export function certLinks(db) {
  try { return { ...DEFAULT_LINKS, ...JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'cert_links'").get()?.value || '{}') }; } catch { return DEFAULT_LINKS; }
}

export function certStatus(db, userId, branchId, type, today = berlinDate()) {
  const rows = db.prepare('SELECT * FROM certificates WHERE user_id = ? AND type = ? ORDER BY id DESC').all(userId, type);
  const approved = rows.find((r) => r.status === 'approved' && (!r.valid_until || r.valid_until >= today));
  if (approved) return { state: 'approved', id: approved.id, issued_on: approved.issued_on, valid_until: approved.valid_until };
  const expired = rows.find((r) => r.status === 'approved' && r.valid_until && r.valid_until < today);
  if (rows[0]?.status === 'pending') return { state: 'pending', id: rows[0].id };
  if (rows[0]?.status === 'rejected') return { state: 'rejected', id: rows[0].id, review_note: rows[0].review_note };
  if (expired) return { state: 'expired', id: expired.id, valid_until: expired.valid_until };
  return { state: 'missing' };
}

function issueInvite(db, userId, purpose, by) {
  db.prepare('UPDATE invites SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(new Date().toISOString(), userId); // alte Codes ungültig
  const code = newCode();
  const expires = new Date(Date.now() + INVITE_DAYS * 86400e3).toISOString();
  db.prepare('INSERT INTO invites (user_id, code_hash, purpose, created_by, expires_at) VALUES (?,?,?,?,?)').run(userId, sha(code.replace(/-/g, '')), purpose, by, expires);
  return { invite_code: code, expires_at: expires };
}

export function registerAccounts({ route, db, needUser, needBranch, needAdmin, HttpError, bad, notFound, notify, setCookie }) {
  const manageable = (actor, targetId) => {
    if (actor.is_admin) return true;
    const t = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(targetId);
    if (!t || t.is_admin) return false;
    const tb = db.prepare('SELECT branch_id, role FROM memberships WHERE user_id = ?').all(targetId);
    if (tb.some((m) => m.role === 'manager')) return false; // Filialleitungen verwaltet nur der Betreiber
    return tb.some((m) => can(actor, m.branch_id, 'manager'));
  };

  route('GET', '/api/staff', (ctx) => {
    needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'), 'manager', 'admin');
    const people = db.prepare(`SELECT DISTINCT u.id, u.username, u.display_name, u.active, u.must_change_password, u.password_hash IS NOT NULL AS has_password
      FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.branch_id = ? ORDER BY u.active DESC, u.display_name`).all(branchId);
    return people.map((p) => ({ ...p, active: !!p.active, has_password: !!p.has_password, must_change_password: !!p.must_change_password,
      roles: db.prepare('SELECT role FROM memberships WHERE user_id = ? AND branch_id = ?').all(p.id, branchId).map((r) => r.role),
      invite: db.prepare('SELECT purpose, expires_at, used_at FROM invites WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(p.id) || null,
      ifsg43: certStatus(db, p.id, branchId, 'ifsg43').state, metro_hygiene: certStatus(db, p.id, branchId, 'metro_hygiene').state }));
  });

  route('POST', '/api/staff', (ctx) => {
    const u = needUser(ctx);
    const b = ctx.body;
    const branchId = needBranch(ctx, b.branch, 'manager', 'admin');
    const role = b.role;
    const allowed = u.is_admin ? ['employee', 'shift_lead', 'trainer', 'manager'] : ['employee', 'shift_lead', 'trainer'];
    if (!allowed.includes(role)) throw bad('role', 'Rolle nicht erlaubt');
    const username = String(b.username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw bad('username', 'Benutzername: 3–40 Zeichen a-z 0-9 . _ -');
    if (!String(b.display_name || '').trim()) throw bad('display_name', 'Name fehlt');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'duplicate', 'Benutzername ist vergeben');
    return tx(db, () => {
      const id = Number(db.prepare('INSERT INTO users (username, display_name, password_hash, must_change_password, created_by) VALUES (?,?,NULL,1,?)')
        .run(username, String(b.display_name).trim().slice(0, 80), u.id).lastInsertRowid);
      db.prepare('INSERT INTO memberships (user_id, branch_id, role) VALUES (?,?,?)').run(id, branchId, role);
      if (role === 'shift_lead' || role === 'trainer') db.prepare("INSERT OR IGNORE INTO memberships (user_id, branch_id, role) VALUES (?,?,'employee')").run(id, branchId);
      const inv = issueInvite(db, id, 'invite', u.id);
      audit(db, { actor: u.id, branch: branchId, action: 'create_account', entity: 'user', id, payload: { username, role } });
      return { user_id: id, username, ...inv };
    });
  });

  route('POST', '/api/staff/:id/reset', (ctx) => {
    const u = needUser(ctx);
    const id = Number(ctx.params.id);
    if (!manageable(u, id) || id === u.id) throw new HttpError(403, 'forbidden', 'Keine Berechtigung');
    return tx(db, () => {
      db.prepare('UPDATE users SET password_hash = NULL, must_change_password = 1 WHERE id = ?').run(id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      const inv = issueInvite(db, id, 'reset', u.id);
      audit(db, { actor: u.id, action: 'reset_password', entity: 'user', id });
      return inv;
    });
  });

  route('POST', '/api/staff/:id/active', (ctx) => {
    const u = needUser(ctx);
    const id = Number(ctx.params.id);
    if (!manageable(u, id) || id === u.id) throw new HttpError(403, 'forbidden', 'Keine Berechtigung');
    const active = ctx.body.active ? 1 : 0;
    tx(db, () => {
      db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active, id);
      if (!active) {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
        db.prepare('UPDATE invites SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(new Date().toISOString(), id);
        db.prepare("UPDATE task_occurrences SET assigned_to = NULL, assignment_mode = NULL WHERE assigned_to = ? AND status IN ('open','rework')").run(id);
      }
      audit(db, { actor: u.id, action: active ? 'activate' : 'deactivate', entity: 'user', id });
    });
    return { ok: true };
  });

  route('PUT', '/api/staff/:id/roles', (ctx) => {
    const u = needUser(ctx);
    const id = Number(ctx.params.id);
    const branchId = needBranch(ctx, ctx.body.branch, 'manager', 'admin');
    if (!manageable(u, id) || id === u.id) throw new HttpError(403, 'forbidden', 'Keine Berechtigung');
    const allowed = u.is_admin ? ['employee', 'shift_lead', 'trainer', 'manager'] : ['employee', 'shift_lead', 'trainer'];
    const roles = [...new Set((Array.isArray(ctx.body.roles) ? ctx.body.roles : []).filter((r) => allowed.includes(r)))];
    tx(db, () => {
      db.prepare(`DELETE FROM memberships WHERE user_id = ? AND branch_id = ? ${u.is_admin ? '' : "AND role <> 'manager'"}`).run(id, branchId);
      for (const r of roles) db.prepare('INSERT OR IGNORE INTO memberships (user_id, branch_id, role) VALUES (?,?,?)').run(id, branchId, r);
      audit(db, { actor: u.id, branch: branchId, action: 'set_roles', entity: 'user', id, payload: { roles } });
    });
    return { ok: true };
  });

  // Einladung/Reset einlösen: eigenes Passwort setzen und anmelden (öffentlich)
  route('POST', '/api/invite/redeem', (ctx) => {
    const code = String(ctx.body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const pw = String(ctx.body.password || '');
    if (code.length !== 12) throw bad('code', 'Code prüfen (12 Zeichen)');
    if (pw.length < 10) throw bad('password', 'Passwort mindestens 10 Zeichen');
    const inv = db.prepare('SELECT * FROM invites WHERE code_hash = ?').get(sha(code));
    if (!inv || inv.used_at || inv.expires_at < new Date().toISOString()) throw new HttpError(400, 'invalid_code', 'Code ungültig oder abgelaufen – bitte die Leitung um einen neuen Code bitten');
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(inv.user_id);
    if (!user) throw new HttpError(400, 'invalid_code', 'Konto ist deaktiviert');
    return tx(db, () => {
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashPassword(pw), user.id);
      db.prepare('UPDATE invites SET used_at = ? WHERE id = ?').run(new Date().toISOString(), inv.id);
      ctx.setCookie(createSession(db, user.id));
      audit(db, { actor: user.id, action: 'redeem_' + inv.purpose, entity: 'user', id: user.id });
      return { ok: true, username: user.username };
    });
  });

  route('POST', '/api/password', (ctx) => {
    const u = needUser(ctx, { allowPasswordChange: true });
    const row = db.prepare('SELECT password_hash, must_change_password FROM users WHERE id = ?').get(u.id);
    const next = String(ctx.body.new_password || '');
    if (next.length < 10) throw bad('password', 'Passwort mindestens 10 Zeichen');
    if (!verifyPassword(ctx.body.old_password || '', row.password_hash)) throw new HttpError(400, 'old_password', 'Bisheriges Passwort ist falsch');
    if (verifyPassword(next, row.password_hash)) throw bad('password', 'Bitte ein neues Passwort wählen');
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashPassword(next), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(u.id, ctx.tokenHash());
    audit(db, { actor: u.id, action: 'change_password', entity: 'user', id: u.id });
    return { ok: true };
  });

  // --- Nachweise ---
  const certView = (c) => ({ ...c, type_label: CERT_TYPES[c.type], user: db.prepare('SELECT display_name FROM users WHERE id = ?').get(c.user_id).display_name,
    reviewer: c.reviewed_by ? db.prepare('SELECT display_name FROM users WHERE id = ?').get(c.reviewed_by).display_name : null });

  route('GET', '/api/welcome', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    const handbook = db.prepare('SELECT employee_confirmed_at FROM onboarding_confirmations WHERE user_id = ? AND branch_id = ? AND handbook_version = ?').get(u.id, branchId, HANDBOOK_VERSION);
    return {
      name: u.display_name, ifsg43: certStatus(db, u.id, branchId, 'ifsg43'), metro_hygiene: certStatus(db, u.id, branchId, 'metro_hygiene'),
      handbook_confirmed: !!handbook?.employee_confirmed_at, open_trainings: openTrainings(db, branchId).filter((o) => o.user_id === u.id).length,
      links: certLinks(db), certificates: db.prepare('SELECT * FROM certificates WHERE user_id = ? ORDER BY id DESC').all(u.id).map(certView),
    };
  });

  route('POST', '/api/certificates', (ctx) => {
    const u = needUser(ctx);
    const b = ctx.body;
    const branchId = needBranch(ctx, b.branch);
    if (!['ifsg43', 'metro_hygiene', 'other'].includes(b.type)) throw bad('type', 'Art des Nachweises wählen');
    const date = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    if (!date(b.issued_on)) throw bad('issued_on', 'Ausstellungsdatum angeben');
    if (b.issued_on > berlinDate()) throw bad('issued_on', 'Datum liegt in der Zukunft');
    const m = db.prepare('SELECT * FROM media WHERE id = ?').get(Number(b.media_id));
    if (!m || m.uploaded_by !== u.id || m.purpose !== 'certificate' || m.branch_id !== branchId) throw bad('media', 'Bitte den Nachweis fotografieren oder als PDF hochladen');
    const id = Number(db.prepare('INSERT INTO certificates (user_id, branch_id, type, issued_on, valid_until, media_id, note, uploaded_by) VALUES (?,?,?,?,?,?,?,?)')
      .run(u.id, branchId, b.type, b.issued_on, date(b.valid_until), m.id, String(b.note || '').slice(0, 200) || null, u.id).lastInsertRowid);
    notify(db, branchId, 'certificate', `Neuer Nachweis zur Prüfung: ${CERT_TYPES[b.type]} – ${u.display_name}`, `cert:${id}`);
    audit(db, { actor: u.id, branch: branchId, action: 'upload_certificate', entity: 'certificate', id, payload: { type: b.type } });
    return { id };
  });

  route('GET', '/api/certificates', (ctx) => {
    needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'), 'manager', 'admin');
    const people = db.prepare(`SELECT DISTINCT u.id, u.display_name FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.branch_id = ? AND m.role IN ('employee','shift_lead','trainer') AND u.active = 1 ORDER BY u.display_name`).all(branchId);
    return {
      pending: db.prepare("SELECT * FROM certificates WHERE branch_id = ? AND status = 'pending' ORDER BY id").all(branchId).map(certView),
      people: people.map((p) => ({ ...p, ifsg43: certStatus(db, p.id, branchId, 'ifsg43'), metro_hygiene: certStatus(db, p.id, branchId, 'metro_hygiene'),
        last_followup: db.prepare("SELECT issued_on FROM certificates WHERE user_id = ? AND type = 'ifsg_followup' ORDER BY issued_on DESC LIMIT 1").get(p.id)?.issued_on ?? null })),
      links: certLinks(db),
    };
  });

  route('POST', '/api/certificates/:id/review', (ctx) => {
    const u = needUser(ctx);
    const c = db.prepare('SELECT * FROM certificates WHERE id = ?').get(Number(ctx.params.id));
    if (!c) throw notFound();
    const branchId = needBranch(ctx, c.branch_id, 'manager', 'admin');
    if (c.user_id === u.id) throw new HttpError(403, 'self_review', 'Eigene Nachweise prüft eine andere Person');
    if (c.status !== 'pending') throw new HttpError(409, 'reviewed', 'Bereits geprüft');
    const status = ctx.body.status === 'approved' ? 'approved' : ctx.body.status === 'rejected' ? 'rejected' : null;
    if (!status) throw bad('status');
    const note = String(ctx.body.note || '').trim();
    if (status === 'rejected' && note.length < 2) throw bad('note', 'Grund für die Ablehnung angeben');
    db.prepare('UPDATE certificates SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?').run(status, u.id, new Date().toISOString(), note || null, c.id);
    audit(db, { actor: u.id, branch: branchId, action: 'review_certificate', entity: 'certificate', id: c.id, payload: { status } });
    return { ok: true };
  });

  // Betriebliche Folgebelehrung dokumentieren (durch Leitung, ohne Datei)
  route('POST', '/api/certificates/followup', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'manager', 'admin');
    const userId = Number(ctx.body.user_id);
    if (!db.prepare('SELECT 1 FROM memberships WHERE user_id = ? AND branch_id = ?').get(userId, branchId)) throw bad('user');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ctx.body.issued_on || '') || ctx.body.issued_on > berlinDate()) throw bad('issued_on', 'Datum der Belehrung angeben');
    const id = Number(db.prepare("INSERT INTO certificates (user_id, branch_id, type, issued_on, status, note, uploaded_by, reviewed_by, reviewed_at) VALUES (?,?,'ifsg_followup',?,'approved',?,?,?,?)")
      .run(userId, branchId, ctx.body.issued_on, String(ctx.body.note || '').slice(0, 200) || null, u.id, u.id, new Date().toISOString()).lastInsertRowid);
    audit(db, { actor: u.id, branch: branchId, action: 'followup_instruction', entity: 'user', id: userId, payload: { date: ctx.body.issued_on } });
    return { id };
  });

  route('PUT', '/api/admin/cert-links', (ctx) => {
    const a = needAdmin(ctx);
    const clean = {};
    for (const k of ['ifsg43', 'metro_hygiene']) {
      const v = ctx.body[k] || {};
      const url = String(v.url || '').trim();
      if (url && !/^https:\/\/[^\s]+$/.test(url)) throw bad('url', 'Nur https-Links');
      clean[k] = { text: String(v.text || DEFAULT_LINKS[k].text).slice(0, 500), url };
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('cert_links', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(JSON.stringify(clean));
    audit(db, { actor: a.id, action: 'cert_links', entity: 'settings', payload: clean });
    return { ok: true };
  });

  void rolesIn; void setCookie;
}
