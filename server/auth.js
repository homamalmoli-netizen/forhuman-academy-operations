// Passwörter (scrypt), Sitzungen (zufälliges Token, nur Hash gespeichert) und Berechtigungen.
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

const SESSION_HOURS = 12;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltB64, keyB64] = stored.split('$');
  const expected = Buffer.from(keyB64, 'base64');
  const key = scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(key, expected);
}

const sha = (t) => createHash('sha256').update(t).digest('hex');

export function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_HOURS * 3600e3).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').run(sha(token), userId, expires);
  return token;
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

export function userFromToken(db, token) {
  if (!token) return null;
  const row = db.prepare(`SELECT u.id, u.username, u.display_name, u.is_admin, u.lang FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`).get(sha(token), new Date().toISOString());
  if (!row) return null;
  const memberships = db.prepare(`SELECT m.branch_id, m.role, b.name AS branch_name, b.code AS branch_code
    FROM memberships m JOIN branches b ON b.id = m.branch_id WHERE m.user_id = ? AND b.active = 1`).all(row.id);
  return { ...row, is_admin: !!row.is_admin, memberships };
}

/** Rollen einer Person in einer Filiale. Admin hat überall alle Rechte. */
export function rolesIn(user, branchId) {
  if (!user) return [];
  if (user.is_admin) return ['admin', 'manager', 'shift_lead', 'trainer', 'employee'];
  return user.memberships.filter((m) => m.branch_id === Number(branchId)).map((m) => m.role);
}

export function can(user, branchId, ...roles) {
  const r = rolesIn(user, branchId);
  return roles.some((x) => r.includes(x));
}

export function branchIdsFor(db, user) {
  if (user.is_admin) return db.prepare('SELECT id FROM branches WHERE active = 1').all().map((b) => b.id);
  return [...new Set(user.memberships.map((m) => m.branch_id))];
}

// Einfache Begrenzung von Anmeldeversuchen je Benutzername+IP.
const attempts = new Map();
export function loginAllowed(key) {
  const now = Date.now();
  const a = (attempts.get(key) || []).filter((t) => now - t < 15 * 60e3);
  attempts.set(key, a);
  return a.length < 8;
}
export function loginFailed(key) {
  const a = attempts.get(key) || [];
  a.push(Date.now());
  attempts.set(key, a);
}
export function loginSucceeded(key) { attempts.delete(key); }
