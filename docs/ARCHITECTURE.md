# ForHuman Academy & Operations — Zielarchitektur

## Systemgrenzen
Eigenständige Web-App/PWA; keine direkten Änderungen am bestehenden POS. Ein späterer POS-Datenaustausch erfolgt über versionierte, authentifizierte APIs. Filialen: Halle und Leuna, später Franchise.

## Technik
Frontend React + TypeScript (Migration des ersten JSX-Prototyps), Backend mit REST API, PostgreSQL, Objekt-Storage für Schulungsvideos und Fotos, Queue für wiederkehrende Aufgaben und Benachrichtigungen. Hosting ist vorab mit den tatsächlichen STRATO-Tarifmerkmalen abzugleichen; ggf. externer App-Server bei STRATO-Domain.

## Sicherheitsmodell
Rollen system_admin, operations_manager, branch_manager, trainer, employee, auditor. Alle API-Requests prüfen Session, Berechtigung und branch_id serverseitig. Nur genehmigte Trainer können SOPs freigeben, nur Filialleiter können praktische Gerätefreigaben erteilen. Passwörter sicher hashen, CSRF/Rate Limits, signierte Upload-URLs, Dateitypprüfung, Virenscan, Backups, Datenschutzkonzept.

## Kerndomänen
- identity: users, memberships, branches, roles
- learning: courses, lessons, media_assets, quiz_questions, attempts, completions, practical_signoffs, certificates
- operations: sop_documents, sop_versions, task_templates, task_occurrences, task_evidence
- safety: haccp_plans, monitoring_points, measurements, deviations, corrective_actions, traceability_lots
- inventory: items, storage_locations, stock_movements, counts, count_lines, suppliers
- equipment: devices, inspections, maintenance_events, oil_checks
- hygiene: cleaning_plans, cleaning_runs, chemical_register, pest_points, pest_inspections
- governance: audit_events, attachments, notifications

## Datenintegrität
Sicherheitskritische Messwerte und Korrekturmaßnahmen append-only erfassen; Änderungen als neue Revision dokumentieren. UTC-Zeitstempel und Europe/Berlin für Anzeige. Einheiten explizit (°C, kg, L, Stück); Grenzwerte nur aus freigegebenen HACCP-Plänen. Inventurbuchungen atomar; Bestandsänderungen ausschließlich über Bewegungen, nicht direkt per Frontend.

## Medien
Echte Videos und Fotos müssen vom ForHuman-Team erstellt oder rechtmäßig lizenziert werden. Niemals Platzhalter als echte Schulungsmedien darstellen. Ungeprüfte Geräte-SOPs bleiben Entwurf.

## Umsetzung
Phase 1 Auth, Filialen, SOPs, Aufgaben, Auditlog; Phase 2 HACCP und Reinigung; Phase 3 Inventur; Phase 4 vollständiges E-Learning; Phase 5 Geräte, Schädlingsmonitoring, Reporting, PWA/Deployment.
