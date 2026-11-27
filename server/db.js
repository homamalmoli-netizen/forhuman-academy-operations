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
  // 2: Stationen, Stationscheck, Stufen, Positionsplan, Haltezeit-Timer
  `
  -- Rolle "shift_lead" (Schichtführer) ergänzen: Tabelle neu anlegen, Daten übernehmen
  CREATE TABLE memberships_new (
    user_id INTEGER NOT NULL REFERENCES users(id),
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    role TEXT NOT NULL CHECK (role IN ('manager','shift_lead','trainer','employee')),
    PRIMARY KEY (user_id, branch_id, role)
  );
  INSERT INTO memberships_new SELECT user_id, branch_id, role FROM memberships;
  DROP TABLE memberships;
  ALTER TABLE memberships_new RENAME TO memberships;

  CREATE TABLE stations (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    code TEXT NOT NULL,
    name TEXT NOT NULL,                 -- JSON je Sprache
    icon TEXT NOT NULL DEFAULT 'prep',
    position INTEGER NOT NULL,
    sop_id INTEGER REFERENCES sops(id),
    course_id INTEGER REFERENCES courses(id),   -- Voraussetzung vor dem Stationscheck
    pass_percent INTEGER NOT NULL DEFAULT 100 CHECK (pass_percent BETWEEN 1 AND 100),
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE (branch_id, code)
  );
  CREATE TABLE observation_items (
    id INTEGER PRIMARY KEY,
    station_id INTEGER NOT NULL REFERENCES stations(id),
    position INTEGER NOT NULL,
    text TEXT NOT NULL,                 -- JSON je Sprache
    critical INTEGER NOT NULL DEFAULT 0, -- kritischer Punkt: muss immer erfüllt sein
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE observations (
    id INTEGER PRIMARY KEY,
    station_id INTEGER NOT NULL REFERENCES stations(id),
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    observer_id INTEGER NOT NULL REFERENCES users(id),
    results TEXT NOT NULL,              -- JSON [{item_id, ok}]
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    critical_failed INTEGER NOT NULL,
    passed INTEGER NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (user_id <> observer_id)
  );
  CREATE TABLE station_certifications (
    user_id INTEGER NOT NULL REFERENCES users(id),
    station_id INTEGER NOT NULL REFERENCES stations(id),
    observation_id INTEGER NOT NULL REFERENCES observations(id),
    certified_by INTEGER NOT NULL REFERENCES users(id),
    certified_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (user_id, station_id),
    CHECK (user_id <> certified_by)
  );
  CREATE TABLE position_plans (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    work_date TEXT NOT NULL,
    shift TEXT NOT NULL CHECK (shift IN ('open','run','close')),
    created_by INTEGER NOT NULL REFERENCES users(id),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (branch_id, work_date, shift)
  );
  CREATE TABLE position_assignments (
    plan_id INTEGER NOT NULL REFERENCES position_plans(id),
    station_id INTEGER NOT NULL REFERENCES stations(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    training INTEGER NOT NULL DEFAULT 0, -- 1 = in Einarbeitung, nur mit freigegebener Person an derselben Station
    PRIMARY KEY (plan_id, station_id, user_id)
  );
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    name TEXT NOT NULL,                 -- JSON je Sprache
    icon TEXT NOT NULL DEFAULT 'prep',
    station_id INTEGER REFERENCES stations(id),
    hold_minutes INTEGER CHECK (hold_minutes IS NULL OR hold_minutes BETWEEN 1 AND 720),   -- Haltezeit
    cook_seconds INTEGER CHECK (cook_seconds IS NULL OR cook_seconds BETWEEN 10 AND 7200), -- Garzeit/Programmzeit
    value_source TEXT,                  -- Pflicht, sobald ein Wert gesetzt ist
    active INTEGER NOT NULL DEFAULT 1,
    CHECK ((hold_minutes IS NULL AND cook_seconds IS NULL) OR value_source IS NOT NULL)
  );
  CREATE TABLE timers (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    kind TEXT NOT NULL CHECK (kind IN ('hold','cook')),
    started_by INTEGER NOT NULL REFERENCES users(id),
    started_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','discarded')),
    ended_by INTEGER REFERENCES users(id),
    ended_at TEXT
  );
  CREATE INDEX idx_timers_branch ON timers(branch_id, status);
  -- Aufgaben nach Station strukturieren (NULL = Allgemein)
  ALTER TABLE task_templates ADD COLUMN station_id INTEGER REFERENCES stations(id);
  CREATE INDEX idx_obs_user ON observations(user_id, station_id);
  `,

  // 3: Wöchentliche Inventur, Erinnerungen, Rollen für Aufgaben, Gültigkeit von Schulungen
  `
  ALTER TABLE task_templates ADD COLUMN role TEXT NOT NULL DEFAULT 'all' CHECK (role IN ('all','shift_lead'));
  ALTER TABLE task_templates ADD COLUMN link TEXT CHECK (link IS NULL OR link IN ('inventory'));
  ALTER TABLE courses ADD COLUMN valid_months INTEGER CHECK (valid_months IS NULL OR valid_months BETWEEN 1 AND 60);
  ALTER TABLE courses ADD COLUMN required INTEGER NOT NULL DEFAULT 1;
  CREATE TABLE branch_settings (
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (branch_id, key)
  );
  CREATE TABLE inventory_counts (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    week TEXT NOT NULL,                    -- ISO-Woche, z. B. 2026-W48
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
    started_by INTEGER NOT NULL REFERENCES users(id),
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    submitted_by INTEGER REFERENCES users(id),
    submitted_at TEXT,
    UNIQUE (branch_id, week)
  );
  CREATE TABLE inventory_lines (
    count_id INTEGER NOT NULL REFERENCES inventory_counts(id),
    item_id INTEGER NOT NULL REFERENCES items(id),
    counted REAL NOT NULL CHECK (counted >= 0),
    expected REAL,                          -- Soll-Bestand beim Abschluss
    counted_by INTEGER NOT NULL REFERENCES users(id),
    PRIMARY KEY (count_id, item_id)
  );
  -- Erinnerungen nur einmal je Anlass erzeugen
  CREATE UNIQUE INDEX idx_notif_remind ON notifications(branch_id, ref) WHERE ref LIKE 'remind:%';
  `,

  // 4: Tägliche Inventur (Früh/Spät mit Frist), Schädlingskontrolle, Handbuch-Einarbeitungsbestätigung
  `
  ALTER TABLE task_templates ADD COLUMN action TEXT;   -- verknüpfter Ablauf: inventory, daily_early, daily_late, pest_check
  UPDATE task_templates SET action = link WHERE link IS NOT NULL;
  ALTER TABLE items ADD COLUMN daily_count INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE items ADD COLUMN meat INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE daily_counts (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    work_date TEXT NOT NULL,
    shift TEXT NOT NULL CHECK (shift IN ('early','late')),
    deadline TEXT NOT NULL,                 -- HH:MM (Ortszeit Berlin) zum Zeitpunkt der Abgabe
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
    submitted_by INTEGER REFERENCES users(id),
    submitted_at TEXT,
    on_time INTEGER,
    note TEXT,
    UNIQUE (branch_id, work_date, shift)
  );
  CREATE TABLE daily_count_lines (
    count_id INTEGER NOT NULL REFERENCES daily_counts(id),
    item_id INTEGER NOT NULL REFERENCES items(id),
    counted REAL NOT NULL CHECK (counted >= 0),
    marinated REAL CHECK (marinated IS NULL OR marinated >= 0),   -- Fleisch: davon mariniert
    unusable REAL CHECK (unusable IS NULL OR unusable >= 0),      -- nicht verwendbare Ware
    counted_by INTEGER NOT NULL REFERENCES users(id),
    PRIMARY KEY (count_id, item_id)
  );
  CREATE TABLE pest_checks (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    infestation INTEGER NOT NULL,
    exterminator_needed INTEGER NOT NULL,
    remarks TEXT,
    media_id INTEGER REFERENCES media(id),
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (infestation = 0 OR media_id IS NOT NULL)
  );
  CREATE TABLE pest_check_areas (
    check_id INTEGER NOT NULL REFERENCES pest_checks(id),
    area TEXT NOT NULL,
    finding INTEGER NOT NULL,              -- 1 = Befall/Spuren
    note TEXT,
    measure TEXT,
    done INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (check_id, area)
  );
  CREATE TABLE onboarding_confirmations (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    handbook_version INTEGER NOT NULL,
    areas TEXT NOT NULL,                    -- JSON: eingewiesene Bereiche
    trainer_id INTEGER NOT NULL REFERENCES users(id),
    trainer_confirmed_at TEXT NOT NULL,
    employee_confirmed_at TEXT,
    UNIQUE (user_id, branch_id, handbook_version),
    CHECK (user_id <> trainer_id)
  );
  `,

  // 5: Marinaden-Protokoll mit fester, versionierter Rezeptur
  `
  CREATE TABLE marinades (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1,
    current_version INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE marinade_versions (
    marinade_id INTEGER NOT NULL REFERENCES marinades(id),
    version INTEGER NOT NULL,
    ingredients TEXT NOT NULL,             -- JSON [{name, per_kg, unit}] je kg Fleisch
    allergens TEXT,                         -- Text laut betrieblicher Allergenliste
    tolerance_percent REAL CHECK (tolerance_percent IS NULL OR (tolerance_percent >= 0 AND tolerance_percent <= 50)),
    use_within_hours INTEGER CHECK (use_within_hours IS NULL OR use_within_hours BETWEEN 1 AND 336),
    use_source TEXT,                        -- Pflicht, wenn use_within_hours gesetzt (z. B. HACCP-Plan)
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (marinade_id, version),
    CHECK (use_within_hours IS NULL OR use_source IS NOT NULL)
  );
  CREATE TABLE marinade_batches (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    marinade_id INTEGER NOT NULL REFERENCES marinades(id),
    recipe_version INTEGER NOT NULL,
    meat_item_id INTEGER NOT NULL REFERENCES items(id),
    meat_kg REAL NOT NULL CHECK (meat_kg > 0),
    ingredients TEXT NOT NULL,             -- JSON [{name, unit, target, actual}]
    deviations INTEGER NOT NULL DEFAULT 0,
    batch_code TEXT NOT NULL UNIQUE,
    use_by TEXT,
    remaining_kg REAL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','used','discarded')),
    discard_reason TEXT,
    note TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    closed_by INTEGER REFERENCES users(id),
    closed_at TEXT
  );
  CREATE INDEX idx_batches_branch ON marinade_batches(branch_id, status);
  `,

  // 6: Ölwechsel-Intervall, gesperrte Fritteuse, Messwert-Import; Reinigung/Intervall-Aufgaben; persönliche Aufgabenverteilung
  `
  -- oil_events neu: Foto beim Wechsel optional, neue Typen (topup), Grund/Menge/Temperatur, Quelle (manuell/Import)
  CREATE TABLE oil_events_new (
    id INTEGER PRIMARY KEY,
    fryer_id INTEGER NOT NULL REFERENCES fryers(id),
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    type TEXT NOT NULL CHECK (type IN ('tpm','filter','topup','change')),
    tpm REAL CHECK (tpm IS NULL OR (tpm >= 0 AND tpm <= 100)),
    temperature REAL CHECK (temperature IS NULL OR (temperature >= -20 AND temperature <= 300)),
    quality_ok INTEGER,                     -- tägliche Prüfung: 1 zulässig, 0 unzulässig
    reason TEXT CHECK (reason IS NULL OR reason IN ('planned','early','quality')),
    quantity_l REAL CHECK (quantity_l IS NULL OR quantity_l > 0),
    media_id INTEGER REFERENCES media(id),
    note TEXT,
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import','test')),
    measured_at TEXT,                       -- Zeitpunkt laut Gerät (Import)
    device_serial TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  INSERT INTO oil_events_new (id, fryer_id, branch_id, type, tpm, media_id, note, created_by, created_at)
    SELECT id, fryer_id, branch_id, type, tpm, media_id, note, created_by, created_at FROM oil_events;
  DROP TABLE oil_events;
  ALTER TABLE oil_events_new RENAME TO oil_events;
  CREATE INDEX idx_oil_fryer ON oil_events(fryer_id, created_at);
  CREATE UNIQUE INDEX idx_oil_import_dup ON oil_events(fryer_id, measured_at, type) WHERE measured_at IS NOT NULL;
  ALTER TABLE fryers ADD COLUMN change_interval_days INTEGER CHECK (change_interval_days IS NULL OR change_interval_days BETWEEN 1 AND 60);
  ALTER TABLE fryers ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE fryers ADD COLUMN blocked_reason TEXT;
  ALTER TABLE fryers ADD COLUMN device_serial TEXT;

  -- Aufgaben: Intervall (ab letzter Erledigung), Übertrag überfälliger Aufgaben, Fritteuse, Reinigungsmittel
  ALTER TABLE task_templates ADD COLUMN interval_days INTEGER CHECK (interval_days IS NULL OR interval_days BETWEEN 1 AND 365);
  ALTER TABLE task_templates ADD COLUMN carry_over INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE task_templates ADD COLUMN fryer_id INTEGER REFERENCES fryers(id);
  ALTER TABLE task_templates ADD COLUMN cleaning_agent TEXT;
  -- Persönliche Zuweisung und "in Arbeit"
  ALTER TABLE task_occurrences ADD COLUMN assigned_to INTEGER REFERENCES users(id);
  ALTER TABLE task_occurrences ADD COLUMN assignment_mode TEXT CHECK (assignment_mode IS NULL OR assignment_mode IN ('auto','manual'));
  ALTER TABLE task_occurrences ADD COLUMN started_by INTEGER REFERENCES users(id);
  ALTER TABLE task_occurrences ADD COLUMN started_at TEXT;
  CREATE INDEX idx_occ_assigned ON task_occurrences(assigned_to, status);
  -- Anwesenheit je Schicht (keine Zeiterfassung: nur "eingeteilt/abwesend" für die Aufgabenverteilung)
  CREATE TABLE shift_presence (
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    work_date TEXT NOT NULL,
    shift TEXT NOT NULL CHECK (shift IN ('open','run','close')),
    user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present','absent')),
    source TEXT NOT NULL CHECK (source IN ('self','manager','plan')),
    updated_by INTEGER NOT NULL REFERENCES users(id),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (branch_id, work_date, shift, user_id)
  );
  -- Reinigung "nach Benutzung" (ereignisbasiert, beliebig oft am Tag)
  CREATE TABLE cleaning_logs (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    area TEXT NOT NULL,
    media_id INTEGER REFERENCES media(id),
    note TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  `,
  // 7: Persönliche Zugänge (Einladung, Erstpasswort, Zurücksetzen, Deaktivieren) und Nachweise (§43 IfSG, METRO-Hygieneschulung)
  `
  ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN created_by INTEGER REFERENCES users(id);
  CREATE TABLE invites (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    code_hash TEXT NOT NULL UNIQUE,
    purpose TEXT NOT NULL CHECK (purpose IN ('invite','reset')),
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE TABLE certificates (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    type TEXT NOT NULL CHECK (type IN ('ifsg43','metro_hygiene','ifsg_followup','other')),
    issued_on TEXT,
    valid_until TEXT,
    media_id INTEGER REFERENCES media(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    note TEXT,
    uploaded_by INTEGER NOT NULL REFERENCES users(id),
    uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TEXT,
    review_note TEXT,
    CHECK (type = 'ifsg_followup' OR media_id IS NOT NULL)
  );
  CREATE INDEX idx_cert_user ON certificates(user_id, type);
  `,
  // 8: Schulungsbereiche (10 Bereiche × 3 Stufen), Fragenpool mit Sicherheitsfragen, Prüfungsversuche mit Zufallsreihenfolge,
  //    praktische Freigabe, Zertifikate. Inhalte und Fragen pflegt der Betreiber.
  `
  CREATE TABLE train_areas (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    icon TEXT NOT NULL DEFAULT 'school',
    position INTEGER NOT NULL,
    title TEXT NOT NULL,                 -- JSON je Sprache
    stations TEXT NOT NULL DEFAULT '',   -- Stations-Codes (Komma), für die der Bereich Voraussetzung ist
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE train_modules (
    id INTEGER PRIMARY KEY,
    area_id INTEGER NOT NULL REFERENCES train_areas(id),
    level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 3),
    content TEXT NOT NULL,               -- JSON je Sprache: {steps:[text]}
    video_url TEXT CHECK (video_url IS NULL OR video_url LIKE 'https://%'),
    open_points TEXT NOT NULL DEFAULT '[]',
    practical_required INTEGER NOT NULL DEFAULT 1,
    reviewed_langs TEXT NOT NULL DEFAULT 'de',
    version INTEGER NOT NULL DEFAULT 1,
    updated_by INTEGER REFERENCES users(id),
    updated_at TEXT,
    UNIQUE (area_id, level)
  );
  CREATE TABLE train_questions (
    id INTEGER PRIMARY KEY,
    module_id INTEGER NOT NULL REFERENCES train_modules(id),
    position INTEGER NOT NULL,
    safety INTEGER NOT NULL DEFAULT 0,   -- Sicherheits-/Hygienefrage: muss richtig sein
    content TEXT NOT NULL,               -- JSON je Sprache: {q, options:[richtig, falsch...], explain}
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','open','archived')),
    updated_by INTEGER REFERENCES users(id),
    updated_at TEXT
  );
  CREATE INDEX idx_tq_module ON train_questions(module_id, status);
  CREATE TABLE train_attempts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    module_id INTEGER NOT NULL REFERENCES train_modules(id),
    module_version INTEGER NOT NULL,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    lang TEXT NOT NULL,
    plan TEXT NOT NULL,                  -- JSON: [{q: id, order: [Antwort-Indizes]}]
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    submitted_at TEXT,
    answers TEXT,
    score INTEGER,
    total INTEGER,
    safety_ok INTEGER,
    passed INTEGER
  );
  CREATE INDEX idx_ta_user ON train_attempts(user_id, module_id);
  CREATE TABLE train_signoffs (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    module_id INTEGER NOT NULL REFERENCES train_modules(id),
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    signed_by INTEGER NOT NULL REFERENCES users(id),
    note TEXT,
    signed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (user_id, module_id, branch_id),
    CHECK (user_id <> signed_by)
  );
  CREATE TABLE train_certificates (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    module_id INTEGER NOT NULL REFERENCES train_modules(id),
    module_version INTEGER NOT NULL,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    attempt_id INTEGER NOT NULL REFERENCES train_attempts(id),
    code TEXT NOT NULL UNIQUE,
    issued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (user_id, module_id, branch_id)
  );
  `,
  // 9: Mitgelieferte Fragen bekommen einen festen Schlüssel, damit neue Fragen auch in bestehende Datenbanken kommen,
  //    ohne vom Betreiber gelöschte oder geänderte Fragen wieder einzuspielen.
  `
  ALTER TABLE train_questions ADD COLUMN seed_key TEXT;
  UPDATE train_questions SET seed_key = (SELECT a.code || ':' || m.level || ':' || (train_questions.position - 1)
    FROM train_modules m JOIN train_areas a ON a.id = m.area_id WHERE m.id = train_questions.module_id) WHERE updated_by IS NULL;
  CREATE UNIQUE INDEX idx_tq_seed ON train_questions(seed_key) WHERE seed_key IS NOT NULL;
  `,
  // 10: Zählrhythmus je Artikel – Saucen und Marinaden nur noch in der Wocheninventur, nicht mehr täglich.
  `
  UPDATE items SET daily_count = 0 WHERE daily_count = 1 AND category IN ('Sauce','Marinade');
  `,
  // 11: Periodische Bestands-Kontrolllisten (keine Warenwirtschaft), persönliche Erinnerungen an Mitarbeiter.
  `
  CREATE TABLE control_lists (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    schedule TEXT NOT NULL CHECK (schedule IN ('daily','weekly','interval')),
    weekday INTEGER CHECK (weekday IS NULL OR weekday BETWEEN 1 AND 7),
    interval_days INTEGER CHECK (interval_days IS NULL OR interval_days BETWEEN 2 AND 60),
    start_date TEXT,
    due_times TEXT NOT NULL,                 -- HH:MM[,HH:MM] Ortszeit Berlin
    photo_required INTEGER NOT NULL DEFAULT 0,
    marinated INTEGER NOT NULL DEFAULT 0,    -- zusätzlich Kühltemperatur und Marinierzeit je Position
    role TEXT NOT NULL DEFAULT 'all' CHECK (role IN ('all','shift_lead')),
    active INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0,
    UNIQUE (branch_id, code)
  );
  CREATE TABLE control_items (
    id INTEGER PRIMARY KEY,
    list_id INTEGER NOT NULL REFERENCES control_lists(id),
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    min_qty REAL CHECK (min_qty IS NULL OR min_qty >= 0),   -- NULL = Mindestwert offen
    position INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE control_runs (
    id INTEGER PRIMARY KEY,
    list_id INTEGER NOT NULL REFERENCES control_lists(id),
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    due_date TEXT NOT NULL,
    slot INTEGER NOT NULL DEFAULT 0,
    due_time TEXT NOT NULL,
    due_at TEXT NOT NULL,                    -- UTC
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','rework')),
    assigned_to INTEGER REFERENCES users(id),
    assignment_mode TEXT CHECK (assignment_mode IS NULL OR assignment_mode IN ('auto','manager')),
    completed_by INTEGER REFERENCES users(id),
    completed_at TEXT,
    on_time INTEGER,
    temperature REAL,
    media_id INTEGER REFERENCES media(id),
    note TEXT,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TEXT,
    review_note TEXT,
    UNIQUE (list_id, due_date, slot)
  );
  CREATE INDEX idx_ctl_runs ON control_runs(branch_id, due_date, status);
  CREATE TABLE control_run_lines (
    run_id INTEGER NOT NULL REFERENCES control_runs(id),
    item_id INTEGER NOT NULL REFERENCES control_items(id),
    qty REAL NOT NULL CHECK (qty >= 0),
    reorder INTEGER,                         -- 1 = unter Mindestwert, 0 = ok, NULL = Mindestwert offen
    marinated_at TEXT,
    use_by TEXT,
    PRIMARY KEY (run_id, item_id)
  );
  ALTER TABLE notifications ADD COLUMN user_id INTEGER REFERENCES users(id);
  ALTER TABLE notifications ADD COLUMN audience TEXT NOT NULL DEFAULT 'manager';
  `,
  // 12: Einheiten vom Betreiber bestätigt (27.11.): Marinade in Tüten, Panade (Mehl) in kg, Bacon/Sucuk in Packungen à 500 g.
  `
  UPDATE control_items SET unit = 'Tüten' WHERE unit = 'offen' AND name IN ('Milde Marinade','Pikante Marinade');
  UPDATE control_items SET name = 'Panda Panade (Mehl)' WHERE name = 'Panda Panade';
  UPDATE control_items SET unit = 'Packungen (500 g)' WHERE unit = 'offen' AND name IN ('Bacon','Sucuk');
  `,
  // 13: Temperatur-Alarm bei der Kontrolle des marinierten Fleisches (Höchstwert +4 °C für Geflügelfleischzubereitungen, DIN 10508).
  `
  ALTER TABLE control_runs ADD COLUMN temp_alarm INTEGER NOT NULL DEFAULT 0;
  `,
  // 14: Produktdaten je Artikel (Lieferant, zeitkritisch, Gebinde, Artikelnummer, dringende Schwelle, Zielbestand, Bildfeld),
  //     Bestandsalarme mit Bestätigung, einfache Nachbestellungen mit (Teil-)Lieferung – ohne Preise, ohne automatische Bestellung.
  `
  ALTER TABLE control_items ADD COLUMN supplier TEXT;
  ALTER TABLE control_items ADD COLUMN critical INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE control_items ADD COLUMN urgent_below REAL CHECK (urgent_below IS NULL OR urgent_below >= 0);
  ALTER TABLE control_items ADD COLUMN target_qty REAL CHECK (target_qty IS NULL OR target_qty >= 0);
  ALTER TABLE control_items ADD COLUMN article_no TEXT;
  ALTER TABLE control_items ADD COLUMN pack_info TEXT;
  ALTER TABLE control_items ADD COLUMN image_media_id INTEGER REFERENCES media(id);
  ALTER TABLE control_items ADD COLUMN storage_hint TEXT;
  CREATE TABLE stock_alerts (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    item_id INTEGER NOT NULL REFERENCES control_items(id),
    run_id INTEGER REFERENCES control_runs(id),
    level TEXT NOT NULL CHECK (level IN ('below','urgent','zero')),
    qty REAL NOT NULL,
    min_qty REAL,
    shortfall REAL,
    reported_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
    ack_by INTEGER REFERENCES users(id),
    ack_at TEXT,
    resolved_at TEXT
  );
  CREATE INDEX idx_alerts_open ON stock_alerts(branch_id, status);
  CREATE TABLE stock_orders (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    item_id INTEGER NOT NULL REFERENCES control_items(id),
    supplier TEXT,
    qty_ordered REAL NOT NULL CHECK (qty_ordered > 0),
    unit TEXT NOT NULL,
    ordered_on TEXT NOT NULL,
    expected_on TEXT,
    ordered_by INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered','partial','received','cancelled')),
    qty_received REAL NOT NULL DEFAULT 0,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE stock_order_receipts (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES stock_orders(id),
    qty REAL NOT NULL CHECK (qty > 0),
    stock_after REAL NOT NULL CHECK (stock_after >= 0),
    received_by INTEGER NOT NULL REFERENCES users(id),
    received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    note TEXT
  );
  `,
  // 15: Einarbeitungs-Freigabe und täglicher Hygiene-Check (Antworten werden nach Aufbewahrungsfrist gelöscht).
  `
  CREATE TABLE work_releases (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    released_by INTEGER NOT NULL REFERENCES users(id),
    released_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    prior_activity INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    revoked_at TEXT,
    UNIQUE (user_id, branch_id),
    CHECK (user_id <> released_by)
  );
  CREATE TABLE hygiene_checks (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    work_date TEXT NOT NULL,
    shift TEXT NOT NULL CHECK (shift IN ('open','run','close')),
    answers TEXT,                              -- JSON Ja/Nein; nach Aufbewahrungsfrist NULL
    all_ok INTEGER NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'none' CHECK (review_status IN ('none','pending','cleared','blocked')),
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (branch_id, user_id, work_date, shift)
  );
  `,
  // 16: Reinigungsmittel-Stamm – fachliche Angaben nur aus Etikett/Sicherheitsdatenblatt, sichtbar erst nach Freigabe.
  `
  CREATE TABLE cleaning_products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    manufacturer TEXT,
    product_url TEXT CHECK (product_url IS NULL OR product_url LIKE 'https://%'),
    article_no TEXT,
    application TEXT,
    dosage TEXT,
    contact_time TEXT,
    ppe TEXT,
    material_notes TEXT,
    sds_url TEXT CHECK (sds_url IS NULL OR sds_url LIKE 'https://%'),
    sop_code TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
    approved_by INTEGER REFERENCES users(id),
    approved_at TEXT,
    CHECK (status <> 'approved' OR (dosage IS NOT NULL AND contact_time IS NOT NULL AND ppe IS NOT NULL AND application IS NOT NULL AND sds_url IS NOT NULL))
  );
  `,
  // 17: Fahrer & Fahrzeuge – persönliche Fahrzeugkontrolle je Schicht, Sperre bei Sicherheitsmangel, dokumentierte Führerscheinkontrolle (ohne Kopie/Nummer).
  `
  CREATE TABLE vehicles (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    label TEXT NOT NULL,
    plate TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    blocked INTEGER NOT NULL DEFAULT 0,
    blocked_reason TEXT,
    blocked_at TEXT,
    blocked_check_id INTEGER,
    unblocked_by INTEGER REFERENCES users(id),
    unblocked_at TEXT,
    unblock_note TEXT
  );
  CREATE TABLE driver_profiles (
    user_id INTEGER NOT NULL REFERENCES users(id),
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    active INTEGER NOT NULL DEFAULT 1,
    licence_class TEXT,
    licence_checked_on TEXT,
    licence_checked_by INTEGER REFERENCES users(id),
    licence_note TEXT,
    PRIMARY KEY (user_id, branch_id)
  );
  CREATE TABLE vehicle_checks (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    work_date TEXT NOT NULL,
    shift TEXT NOT NULL CHECK (shift IN ('early','late')),
    kind TEXT NOT NULL CHECK (kind IN ('start','end')),
    answers TEXT NOT NULL,
    fuel_level TEXT,
    fuel_media_id INTEGER REFERENCES media(id),
    interior_media_id INTEGER REFERENCES media(id),
    safety_defect INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (vehicle_id, work_date, shift, kind)
  );
  CREATE INDEX idx_vehicle_checks_day ON vehicle_checks (branch_id, work_date);
  `,
  // 18: Strukturierte Allergenkennzeichnung der Marinaden-Rezeptur (14 Hauptallergene nach LMIV Anhang II)
  `
  ALTER TABLE marinade_versions ADD COLUMN allergen_codes TEXT;
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
