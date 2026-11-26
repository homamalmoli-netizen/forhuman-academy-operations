# Architektur (umgesetzter Stand)

## Systemgrenzen
Eigenständige Web-App/PWA. **Keine Verbindung zum Kassensystem/POS**, keine Zeiterfassung. Filialen Halle und Leuna, weitere über die Admin-Oberfläche.

## Technik
- **Server:** Node.js (≥ 22.13) nur mit Bordmitteln: `node:http`, `node:sqlite`, `node:crypto`. Keine Fremdpakete.
- **Datenbank:** SQLite-Datei mit Fremdschlüsseln, eindeutigen Schlüsseln, Prüfbedingungen und automatischen Migrationen (`server/db.js`).
- **Oberfläche:** ES-Module ohne Build-Schritt (`public/`), mobile first, RTL über `dir="rtl"` und logische CSS-Eigenschaften, Service Worker nur für die App-Hülle (API wird nie zwischengespeichert).
- **Gemeinsam:** `shared/codes.js` (Barcode/QR-Erkennung) läuft im Browser und auf dem Server.

## Sicherheitsmodell
- Rollen: Admin (global), je Filiale `manager`, `trainer`, `employee`. Jede API-Anfrage prüft Sitzung, Rolle **und** Filiale auf dem Server.
- Passwörter: scrypt mit Salt. Sitzung: zufälliges Token im HttpOnly/SameSite=Strict-Cookie, in der Datenbank nur als SHA-256-Hash.
- CSRF: zusätzlicher Header `x-fh-request` für alle schreibenden Anfragen.
- Login-Sperre nach 8 Fehlversuchen / 15 Minuten.
- Uploads: Typ nach Dateiinhalt (JPG/PNG/WEBP, Beleg auch PDF), max. 8 MB, zufälliger Dateiname außerhalb des Web-Ordners, Auslieferung nur an Mitglieder der Filiale.
- Audit-Protokoll per Datenbank-Trigger unveränderlich.
- Content-Security-Policy ohne Inline-Skripte.
- Praktische Freigabe nur durch Trainer, Selbstfreigabe durch Datenbank-Bedingung und Server ausgeschlossen.

## Fachliche Regeln (bewusst streng)
- Aufgaben werden je Tag einmal erzeugt (`UNIQUE(template_id, work_date)`).
- Grenzwerte (HACCP, TPM) nur mit Quellenangabe; ohne Grenzwert keine automatische Freigabe.
- Prüfung erst, wenn alle Lernschritte serverseitig bestätigt sind; Lösungen werden nie an den Browser geschickt.
- Bestand ausschließlich über Buchungen (Wareneingang, Verderb, Inventur-Korrektur).
- QR-Links werden nie automatisch geöffnet; nur https-Domains aus `TRUSTED_QR_HOSTS` nach Bestätigung.
- Demo: eigene Instanz mit In-Memory-Datenbank; der Demo-Zugang existiert in Produktion nicht.

## Datenmodell (Kurzfassung)
`branches, users, memberships, sessions, media, sops, sop_versions, courses, course_progress, exam_attempts, practical_signoffs,
task_templates, task_occurrences, task_evidence, problems, shift_approvals, notifications, items, item_codes, stock_settings,
receipt_documents, goods_receipts, stock_movements, unknown_codes, fryers, oil_events, settings, audit_log`
