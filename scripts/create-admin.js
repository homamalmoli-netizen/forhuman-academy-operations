// Sichere Admin-Erstfreigabe: legt den ersten Betreiber-Account direkt in der Datenbank an.
// Aufruf auf dem Server: DATABASE_FILE=/pfad/app.db node scripts/create-admin.js <benutzername> "<Anzeigename>"
// Das Passwort wird verdeckt abgefragt (nie als Argument, nie im Repository).
import { openDb, audit } from '../server/db.js';
import { seedBase } from '../server/seed.js';
import { hashPassword } from '../server/auth.js';
import { createInterface } from 'node:readline';

const [username, displayName] = process.argv.slice(2);
if (!process.env.DATABASE_FILE || !username || !displayName) {
  console.error('Aufruf: DATABASE_FILE=/pfad/app.db node scripts/create-admin.js <benutzername> "<Anzeigename>"');
  process.exit(1);
}
function askHidden(q) {
  return new Promise((res) => {
    if (process.env.ADMIN_PASSWORD_STDIN === '1') {
      let d = ''; process.stdin.on('data', (c) => (d += c)); process.stdin.on('end', () => res(d.trim())); return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(s); };
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); res(a); });
  });
}
const pw = await askHidden('Passwort (min. 12 Zeichen): ');
if (pw.length < 12) { console.error('Passwort zu kurz.'); process.exit(1); }
const db = openDb(process.env.DATABASE_FILE);
seedBase(db);
if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) { console.error('Benutzer existiert bereits.'); process.exit(1); }
const id = Number(db.prepare('INSERT INTO users (username, display_name, password_hash, is_admin) VALUES (?,?,?,1)').run(username, displayName, hashPassword(pw)).lastInsertRowid);
audit(db, { actor: id, action: 'create_admin_cli', entity: 'user', id });
console.log(`Admin "${username}" angelegt. Bitte jetzt anmelden und SOPs prüfen und freigeben.`);
