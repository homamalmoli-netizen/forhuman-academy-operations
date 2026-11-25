// Startpunkt. Produktion: DATABASE_FILE + UPLOAD_DIR setzen. Demo: DEMO_MODE=1 (immer In-Memory, isoliert).
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { openDb } from './db.js';
import { createApp, purgeExpiredMedia } from './app.js';
import { runReminders } from './inventory.js';
import { seedBase, seedDemo } from './seed.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const demo = process.env.DEMO_MODE === '1';
const port = Number(process.env.PORT || (demo ? 3001 : 3000));

let db, uploadDir;
if (demo) {
  // Demo ist von Produktion getrennt: eigene In-Memory-Datenbank, eigener temporärer Upload-Ordner.
  db = openDb(':memory:');
  seedDemo(db);
  uploadDir = mkdtempSync(join(tmpdir(), 'fh-demo-uploads-'));
} else {
  if (!process.env.DATABASE_FILE || !process.env.UPLOAD_DIR) {
    console.error('DATABASE_FILE und UPLOAD_DIR müssen gesetzt sein (außerhalb des Web-Verzeichnisses). Siehe docs/DEPLOYMENT.md');
    process.exit(1);
  }
  db = openDb(process.env.DATABASE_FILE);
  seedBase(db);
  uploadDir = process.env.UPLOAD_DIR;
}

const handler = createApp({
  db, demo, uploadDir,
  publicDir: join(root, 'public'), sharedDir: join(root, 'shared'),
  trustedHosts: (process.env.TRUSTED_QR_HOSTS || 'metro.de').split(',').map((s) => s.trim()).filter(Boolean),
  cookieSecure: process.env.COOKIE_SECURE === '1',
  log: (lvl, e) => console.error(new Date().toISOString(), lvl, e),
});

if (!demo) {
  purgeExpiredMedia(db, uploadDir);
  setInterval(() => purgeExpiredMedia(db, uploadDir), 24 * 3600e3).unref();
}

// Erinnerungen regelmäßig prüfen (Inventur fällig/überfällig, offene Pflichtschulungen)
const reminderRun = () => { for (const b of db.prepare('SELECT id FROM branches WHERE active = 1').all()) { try { runReminders(db, b.id); } catch (e) { console.error('reminder', e); } } };
reminderRun();
setInterval(reminderRun, 10 * 60e3).unref(); // alle 10 Minuten (Fristen 17:00 / 23:00)

createServer(handler).listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`ForHuman Academy & Operations ${demo ? 'DEMO (fiktive Daten, In-Memory)' : 'PRODUKTION'} auf Port ${port}`);
});
