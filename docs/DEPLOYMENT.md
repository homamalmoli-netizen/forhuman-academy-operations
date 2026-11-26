# Echtbetrieb (z. B. STRATO VPS unter forhumanfriedchicken.org)

## Hosting-Voraussetzung

Die App ist ein dauerhaft laufender Node.js-Server. **Klassisches STRATO-Webhosting reicht nicht** (für PHP ausgelegt, kein Root-Zugang).
Nötig ist ein **STRATO VPS / V-Server mit Linux** (Ubuntu oder Debian). Die Domain bei STRATO wird per DNS (A-Record) auf den Server gezeigt.

- Node.js ab 22.13, empfohlen aktuelle LTS
- Keine weiteren Pakete nötig (`npm install` entfällt)
- Speicher: Datenbank (SQLite-Datei) + Fotos; Fotos werden auf ca. 1600 px verkleinert

## Einrichtung (einmalig, auf dem Server)

```bash
# 1. Code holen
git clone https://github.com/homamalmoli-netizen/forhuman-academy-operations.git /opt/forhuman-academy
# 2. Daten außerhalb des Code-Ordners anlegen
sudo mkdir -p /var/lib/forhuman/uploads && sudo chown -R forhuman:forhuman /var/lib/forhuman && sudo chmod 700 /var/lib/forhuman
# 3. Ersten Betreiber anlegen – Passwort wird verdeckt abgefragt (min. 12 Zeichen), nie im Repository
cd /opt/forhuman-academy
DATABASE_FILE=/var/lib/forhuman/app.db node --no-warnings scripts/create-admin.js betreiber "Name des Betreibers"
```

Danach anmelden, unter **Leitung → Benutzer & Filialen** Filialleitungen, Trainer und Mitarbeiter für Halle und Leuna anlegen.
Es gibt keine Standardpasswörter und keinen Demo-Zugang im Echtbetrieb.

## Dienst starten (systemd)

`/etc/systemd/system/forhuman-academy.service`:

```ini
[Unit]
Description=ForHuman Academy & Operations
After=network.target

[Service]
User=forhuman
WorkingDirectory=/opt/forhuman-academy
Environment=DATABASE_FILE=/var/lib/forhuman/app.db
Environment=UPLOAD_DIR=/var/lib/forhuman/uploads
Environment=PORT=3000
Environment=HOST=127.0.0.1
Environment=COOKIE_SECURE=1
Environment=TRUSTED_QR_HOSTS=metro.de
ExecStart=/usr/bin/node --no-warnings server/index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now forhuman-academy
```

## HTTPS (Pflicht)

Reverse Proxy (nginx oder Caddy) vor Port 3000, Zertifikat über Let's Encrypt. Beispiel nginx:

```nginx
server {
  server_name forhumanfriedchicken.org;
  client_max_body_size 10m;
  location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto https; }
  listen 443 ssl; # Zertifikat per certbot --nginx
}
```

`COOKIE_SECURE=1` setzt das Sitzungs-Cookie nur über HTTPS.

## Öffentliche Demo getrennt betreiben (optional)

Eigener Dienst, eigene Subdomain (z. B. `demo.forhumanfriedchicken.org`), eigener Port:

```ini
Environment=DEMO_MODE=1
Environment=PORT=3001
```

Die Demo ignoriert `DATABASE_FILE`/`UPLOAD_DIR`, nutzt nur Arbeitsspeicher und einen temporären Ordner und hat keinen Zugriff auf die echte Datenbank. Neustart setzt sie zurück.

## Backup

```bash
# täglich, konsistent trotz laufendem Betrieb
sqlite3 /var/lib/forhuman/app.db ".backup '/var/backups/forhuman/app-$(date +%F).db'"
rsync -a /var/lib/forhuman/uploads/ /var/backups/forhuman/uploads/
```

Wiederherstellung testen: Backup-Datei als `DATABASE_FILE` in einer Testinstanz starten.

## Aktualisieren

```bash
cd /opt/forhuman-academy && git pull && sudo systemctl restart forhuman-academy
```

Datenbank-Migrationen laufen beim Start automatisch (Tabelle `schema_version`).

## Datenschutz

- Fotos liegen privat in `UPLOAD_DIR`, nur angemeldete Personen derselben Filiale können sie öffnen.
- Aufbewahrungsfrist (Standard 365 Tage, 30–3650 einstellbar unter Leitung → Benutzer & Filialen → Datenschutz): danach wird die Datei gelöscht, der Nachweis-Eintrag bleibt.
- Vor Echtbetrieb: Datenschutzhinweis für Mitarbeiter, Verzeichnis der Verarbeitungstätigkeiten und ggf. Betriebsvereinbarung klären (Fotos von Arbeitsergebnissen, keine Zeiterfassung).
