// Datenbank: SQLite über das eingebaute Node-Modul node:sqlite (keine Fremdpakete).
// Alle Tabellen sind relational, mit Fremdschlüsseln und eindeutigen Schlüsseln.
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = [
  // 1: Grundschema
  `
  CREATE TABLE branches (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    lang TEXT NOT NULL DEFAULT 'de',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE memberships (
    user_id INTEGER NOT NULL REFERENCES users(id),
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    role TEXT NOT NULL CHECK (role IN ('manager','trainer','employee')),
    PRIMARY KEY (user_id, branch_id, role)
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE media (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    storage_key TEXT NOT NULL UNIQUE,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    purpose TEXT NOT NULL,
    purged_at TEXT,                      -- gesetzt, wenn Datei nach Aufbewahrungsfrist gelöscht wurde
    uploaded_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  -- Anleitungen (SOP) mit Versionen. Nur freigegebene Versionen sehen Mitarbeiter.
  CREATE TABLE sops (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'book',
    -- 'pending' = fachlich/hersteller-seitig noch nicht geprüft -> Hinweis "Entwurf – nicht zur Anwendung"
    safety_review TEXT NOT NULL DEFAULT 'pending' CHECK (safety_review IN ('pending','verified','not_required'))
  );
  CREATE TABLE sop_versions (
    id INTEGER PRIMARY KEY,
    sop_id INTEGER NOT NULL REFERENCES sops(id),
    version_no INTEGER NOT NULL CHECK (version_no > 0),
    status TEXT NOT NULL CHECK (status IN ('draft','approved','archived')),
    content TEXT NOT NULL,               -- JSON: { de: {title, steps:[{text, icon}]}, ar: ..., en: ..., tr: ... }
    reviewed_langs TEXT NOT NULL DEFAULT 'de', -- Sprachen, deren Übersetzung fachlich geprüft ist
    created_by INTEGER REFERENCES users(id),
    approved_by INTEGER REFERENCES users(id),
    approved_at TEXT,
    UNIQUE (sop_id, version_no),
    CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
  );
  CREATE TABLE courses (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    icon TEXT NOT NULL DEFAULT 'school',
    safety_critical INTEGER NOT NULL DEFAULT 0,   -- 1 = praktische Freigabe durch Trainer zwingend
    pass_percent INTEGER NOT NULL DEFAULT 100 CHECK (pass_percent BETWEEN 1 AND 100),
    content TEXT NOT NULL,              -- JSON je Sprache: {title, intro, steps:[{text, icon}], questions:[{q, options:[...], correct, icon?}]}
    reviewed_langs TEXT NOT NULL DEFAULT 'de',
    version INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE course_progress (
    user_id INTEGER NOT NULL REFERENCES users(id),
    course_id INTEGER NOT NULL REFERENCES courses(id),
    course_version INTEGER NOT NULL,
    lang TEXT NOT NULL,
    steps_done INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (user_id, course_id)
  );
  CREATE TABLE exam_attempts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    course_id INTEGER NOT NULL REFERENCES courses(id),
    course_version INTEGER NOT NULL,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    lang TEXT NOT NULL,
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    passed INTEGER NOT NULL,
    answers TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE practical_signoffs (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    course_id INTEGER NOT NULL REFERENCES courses(id),
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    signed_by INTEGER NOT NULL REFERENCES users(id),
    note TEXT,
    signed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (user_id, course_id, branch_id),
    CHECK (user_id <> signed_by)
  );
  -- Aufgabenvorlagen je Filiale und Schicht. shift: open = Öffnung/Frühschicht, run = laufender Betrieb, close = Schließung/Spätschicht
  CREATE TABLE task_templates (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    shift TEXT NOT NULL CHECK (shift IN ('open','run','close')),
    position INTEGER NOT NULL,
    category TEXT NOT NULL DEFAULT 'routine' CHECK (category IN ('routine','hygiene','cleaning','haccp','equipment','goods','pest','maintenance','safety')),
    frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily','weekly','monthly')),
    weekdays TEXT NOT NULL DEFAULT '1234567',   -- ISO-Wochentage 1=Mo ... 7=So (bei daily/weekly)
    month_day INTEGER CHECK (month_day IS NULL OR month_day BETWEEN 1 AND 28),
    icon TEXT NOT NULL DEFAULT 'check',
    title TEXT NOT NULL,                        -- JSON je Sprache
    hint TEXT NOT NULL DEFAULT '{}',            -- JSON je Sprache, ein kurzer Satz
    requires_photo INTEGER NOT NULL DEFAULT 0,
    measure_unit TEXT,                          -- z. B. '°C' -> Messwert erforderlich
    limit_min REAL,                             -- nur aus freigegebenem HACCP-Plan, sonst NULL
    limit_max REAL,
    limit_source TEXT,
    sop_id INTEGER REFERENCES sops(id),
    required_course_id INTEGER REFERENCES courses(id),
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE task_occurrences (
    id INTEGER PRIMARY KEY,
    template_id INTEGER NOT NULL REFERENCES task_templates(id),
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    shift TEXT NOT NULL,
    work_date TEXT NOT NULL,
    position INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','problem','rework','approved')),
    completed_by INTEGER REFERENCES users(id),
    completed_at TEXT,
    measured_value REAL,
    note TEXT,
    UNIQUE (template_id, work_date)               -- verhindert doppelte Aufgaben
  );
  CREATE TABLE task_evidence (
    id INTEGER PRIMARY KEY,
    occurrence_id INTEGER NOT NULL REFERENCES task_occurrences(id),
    media_id INTEGER NOT NULL REFERENCES media(id),
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE problems (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    occurrence_id INTEGER REFERENCES task_occurrences(id),
    source TEXT NOT NULL DEFAULT 'employee' CHECK (source IN ('employee','limit','oil','goods')),
    description TEXT NOT NULL,
    media_id INTEGER REFERENCES media(id),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','rework','resolved')),
    reported_by INTEGER NOT NULL REFERENCES users(id),
    reported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    manager_note TEXT,
    resolved_by INTEGER REFERENCES users(id),
    resolved_at TEXT
  );
  CREATE TABLE shift_approvals (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    work_date TEXT NOT NULL,
    shift TEXT NOT NULL,
    approved_by INTEGER NOT NULL REFERENCES users(id),
    note TEXT,
    approved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (branch_id, work_date, shift)
  );
  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    ref TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    read_at TEXT
  );
  -- Warenwirtschaft
  CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Ware',
    metro_article_no TEXT UNIQUE,
    needs_temperature INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE item_codes (
    code TEXT PRIMARY KEY,                       -- normalisiert (GTIN 14-stellig)
    item_id INTEGER NOT NULL REFERENCES items(id),
    kind TEXT NOT NULL CHECK (kind IN ('gtin','metro_article','other'))
  );
  CREATE TABLE stock_settings (
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    item_id INTEGER NOT NULL REFERENCES items(id),
    min_qty REAL NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
    PRIMARY KEY (branch_id, item_id)
  );
  CREATE TABLE receipt_documents (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    supplier TEXT NOT NULL DEFAULT 'METRO',
    receipt_no TEXT NOT NULL,
    media_id INTEGER REFERENCES media(id),
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (branch_id, supplier, receipt_no)      -- Dubletten verhindern
  );
  CREATE TABLE goods_receipts (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    item_id INTEGER NOT NULL REFERENCES items(id),
    document_id INTEGER REFERENCES receipt_documents(id),
    scanned_code TEXT,
    quantity REAL NOT NULL CHECK (quantity > 0),
    unit TEXT NOT NULL,
    batch TEXT,
    best_before TEXT,
    temperature REAL,
    condition_ok INTEGER NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('accepted','rejected')),
    reject_reason TEXT,
    media_id INTEGER REFERENCES media(id),
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE stock_movements (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    item_id INTEGER NOT NULL REFERENCES items(id),
    qty_delta REAL NOT NULL CHECK (qty_delta <> 0),
    type TEXT NOT NULL CHECK (type IN ('receipt','consumption','waste','count')),
    receipt_id INTEGER REFERENCES goods_receipts(id),
    note TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE unknown_codes (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    code TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned')),
    assigned_item_id INTEGER REFERENCES items(id),
    seen_by INTEGER NOT NULL REFERENCES users(id),
    seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (branch_id, code)
  );
  -- Ölmanager
  CREATE TABLE fryers (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    name TEXT NOT NULL,
    manufacturer TEXT,
    model TEXT,
    model_verified INTEGER NOT NULL DEFAULT 0,
    oil_product TEXT,
    tpm_limit REAL,          -- nur aus Herstellerangabe / freigegebenem HACCP-Plan; NULL = nicht festgelegt
    tpm_warn REAL,
    limit_source TEXT,
    course_id INTEGER REFERENCES courses(id),
    UNIQUE (branch_id, name)
  );
  CREATE TABLE oil_events (
    id INTEGER PRIMARY KEY,
    fryer_id INTEGER NOT NULL REFERENCES fryers(id),
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    type TEXT NOT NULL CHECK (type IN ('tpm','filter','change')),
    tpm REAL CHECK (tpm IS NULL OR (tpm >= 0 AND tpm <= 100)),
    media_id INTEGER NOT NULL REFERENCES media(id),
    note TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    actor_id INTEGER REFERENCES users(id),
    branch_id INTEGER REFERENCES branches(id),
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id INTEGER,
    payload TEXT NOT NULL DEFAULT '{}',
    at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_occ_branch_date ON task_occurrences(branch_id, work_date, shift);
  CREATE INDEX idx_mov_item ON stock_movements(branch_id, item_id);
  CREATE INDEX idx_audit_branch ON audit_log(branch_id, at);
  CREATE INDEX idx_oil_fryer ON oil_events(fryer_id, created_at);
  -- Audit-Protokoll ist nur anfügbar
  CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log ist unveränderlich'); END;
  CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log ist unveränderlich'); END;
  `,
];

export function openDb(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get();
  let version = row ? row.version : 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  for (let i = version; i < MIGRATIONS.length; i++) {
    tx(db, () => {
      db.exec(MIGRATIONS[i]);
      db.prepare('UPDATE schema_version SET version = ?').run(i + 1);
    });
  }
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function audit(db, { actor, branch, action, entity, id = null, payload = {} }) {
  db.prepare('INSERT INTO audit_log (actor_id, branch_id, action, entity, entity_id, payload) VALUES (?,?,?,?,?,?)')
    .run(actor ?? null, branch ?? null, action, entity, id, JSON.stringify(payload));
}
