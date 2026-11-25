# ForHuman Academy & Operations

Eigenständige Web-App/PWA für ForHuman Fried Chicken: Schichtaufgaben, Schulungen, Wareneingang, Ölmanager und Leitungsübersicht.
**Keine Kassenanbindung, keine Zeiterfassung, keine Änderung am POS.**

> Dieses Repository ist öffentlich. Keine echten Mitarbeiterdaten, Rezepturen, Zugangsdaten oder internen Dokumente hochladen.
> Alle Demo-Daten sind erfunden und als „DEMO“/„fiktiv“ gekennzeichnet.

## Sofort ausprobieren (Demo ohne Login)

Voraussetzung: Node.js ab Version 22.13 (empfohlen: aktuelle LTS). Es werden **keine Pakete** installiert.

```bash
npm run demo        # startet auf http://localhost:3001
```

Auf der Startseite Sprache wählen und eine Rolle antippen (Mitarbeiter Halle/Leuna, Filialleitung, Trainer, Betreiber).
Die Demo nutzt eine eigene In-Memory-Datenbank und einen temporären Foto-Ordner – nichts davon berührt eine echte Installation, beim Neustart ist alles weg.

## Was die App kann

| Bereich | Umgesetzt |
|---|---|
| Mitarbeiter-Modus | Filiale + Schicht (Öffnung / laufender Betrieb / Schließung), **immer nur die nächste Aufgabe**, große Symbole, kurze Sätze, Buttons *Vorlesen*, *Anleitung*, *Problem melden*, *Erledigt* |
| Aufgaben | Automatisch je Filiale, Schicht, Wochentag bzw. Monatstag erzeugt, **keine Dubletten** (Datenbank-Schlüssel); Pflichtfoto, Messwerte, Nacharbeit wird zuerst angezeigt |
| Checklisten | Öffnung, Betrieb, Schließung inkl. Licht, Hygiene, Temperaturen, Ware, Müll, Geräte (Kühlung bleibt an), Türen; wöchentliche Reinigung, Schädlingskontrolle, monatliche Geräte-Sichtprüfung |
| Abweichungen | Problem melden mit Foto → Leitung fordert Nacharbeit an oder bestätigt mit Maßnahme; Grenzwertverletzung erzeugt automatisch eine Abweichung (nur wenn Grenzwert **mit Quelle** hinterlegt) |
| Academy | Ablauf nach #9: Sprache selbst wählen → bebilderte Schritte der Reihe nach bestätigen (serverseitig) → Prüfung (inkl. Bildfrage) → Ergebnis mit richtig/falsch → Wiederholen. Gefährliche Geräte zusätzlich **praktische Freigabe durch Trainer** (keine Selbstfreigabe). Aufgaben und Ölmanager sind ohne Qualifikation gesperrt |
| Anleitungen (SOP) | Versioniert: Entwurf → Freigabe durch Admin; Mitarbeiter sehen nur freigegebene Version. Sicherheitsstatus „Entwurf – nicht zur Anwendung“, bis Herstelleranleitung/Fachfreigabe vorliegt |
| Wareneingang | Kamera-Scanner (wo der Browser es unterstützt) oder Eingabe; erkennt EAN/GTIN mit Prüfziffer, GS1-Codes mit Charge/MHD, GS1 Digital Link, METRO-Artikelnummern aus dem Artikelstamm; unbekannte Codes → Zuordnung durch Leitung; Links nur nach Bestätigung und nur von erlaubten https-Domains; Menge, Charge, MHD, Temperatur (wo nötig), Zustand, Pflichtfoto, Annahme/Ablehnung |
| Bestand | Je Filiale über Buchungen (Wareneingang, Verderb, Inventur), Mindestbestand, Nachbestellliste, METRO-Belegnummer gegen Doppelerfassung |
| Ölmanager | Je Fritteuse: TPM-Messung, Filtern, Wechsel – jeweils mit Pflichtfoto und Verlauf. Status nur aus Messwert + hinterlegtem Grenzwert mit Quelle; **ohne Grenzwert keine Freigabe**, kein Bezug zu Umsatz oder Kasse |
| Leitung | Übersicht je Filiale, Probleme mit Fotos, Schichtbericht (druckbar) mit Freigabe, Vorlagen sortieren/ändern, Schulungsstatus und Freigaben, Bestand & Codes, Öl-Grenzwerte, unveränderliches Protokoll |
| Sprachen | Deutsch, Arabisch (RTL), Englisch, Türkisch; ungeprüfte Übersetzungen werden gekennzeichnet; Vorlesen über die Sprachausgabe des Geräts |
| Sicherheit | Passwörter mit scrypt, Sitzungen nur als Hash gespeichert, Rollen und Filialtrennung **serverseitig**, CSRF-Schutz, Login-Sperre, Upload-Prüfung nach Dateiinhalt, Fotos privat außerhalb des Web-Ordners, Aufbewahrungsfrist für Fotos, Content-Security-Policy |

Was noch fehlt, steht ehrlich in [docs/STATUS.md](docs/STATUS.md).

## Tests

```bash
npm test     # 27 API- und Logiktests (node:test)
npm run e2e  # 23 Browser-Abläufe in Chrome (Handy-Ansicht), erzeugt docs/screenshots/ und docs/E2E_RESULTS.md
```

## Echtbetrieb

Siehe [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (STRATO VPS, HTTPS, sichere Admin-Erstfreigabe, Backup).

## Aufbau

```
server/   index.js (Start) · app.js (API) · db.js (Schema/Migrationen) · auth.js · seed.js (Startvorlagen, Demo-Daten)
shared/   codes.js (Barcode-/QR-Erkennung, Server + Browser)
public/   index.html · app.js · i18n.js · icons.js · style.css · sw.js · manifest
scripts/  create-admin.js (erster Betreiber-Account)
test/     API-Tests · e2e/ Browser-Test
```

Symbole: Material Design Icons (Google, Apache License 2.0).
