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
| Stationen & Positionen | 6 Stationen je Filiale (Panieren, Hochdruckfritteuse, Pommes, Burger & Wraps, Kasse & Theke, Packen & Ausgabe), jede mit Anleitung, Schulung und eigener Stationscheck-Liste; **jede Aufgabe gehört zu einer Station oder „Allgemein“** |
| Stationscheck & Stufen | Trainer beobachtet an der Station und bewertet jeden Punkt; kritische Punkte müssen erfüllt sein. Bestanden → Station freigegeben. Stufen 1 Neu · 2 Crew · 3 Allrounder · 4 Trainer · 5 Schichtführer |
| Positionsplan | Schichtführer/Leitung teilt je Schicht Personen den Stationen zu – nur mit Freigabe, neue Leute nur als Einarbeitung neben einer freigegebenen Person. Mitarbeiter sehen oben „Deine Station heute“ und zuerst deren Aufgaben, fremde Stationen ausgeblendet |
| Haltezeit-Timer | Timer je Produkt mit Countdown, Ton/Vibration bei Ablauf; abgelaufene Ware kann nur noch als „entsorgt“ gebucht werden. Zeiten trägt nur die Leitung **mit Quelle** ein, ohne Zeit kein Timer |
| Mitarbeiter-Modus | Filiale + Schicht (Öffnung / laufender Betrieb / Schließung), **immer nur die nächste Aufgabe**, große Symbole, kurze Sätze, Buttons *Vorlesen*, *Anleitung*, *Problem melden*, *Erledigt* |
| Aufgaben | Automatisch je Filiale, Schicht, Wochentag bzw. Monatstag erzeugt, **keine Dubletten** (Datenbank-Schlüssel); Pflichtfoto, Messwerte, Nacharbeit wird zuerst angezeigt |
| Checklisten | Öffnung, Betrieb, Schließung inkl. Licht, Hygiene, Temperaturen, Ware, Müll, Geräte (Kühlung bleibt an), Türen; wöchentliche Reinigung, Schädlingskontrolle, monatliche Geräte-Sichtprüfung |
| Abweichungen | Problem melden mit Foto → Leitung fordert Nacharbeit an oder bestätigt mit Maßnahme; Grenzwertverletzung erzeugt automatisch eine Abweichung (nur wenn Grenzwert **mit Quelle** hinterlegt) |
| Academy | Ablauf nach #9: Sprache selbst wählen → bebilderte Schritte der Reihe nach bestätigen (serverseitig) → Prüfung (inkl. Bildfrage) → Ergebnis mit richtig/falsch → Wiederholen. Gefährliche Geräte zusätzlich **praktische Freigabe durch Trainer** (keine Selbstfreigabe). Aufgaben und Ölmanager sind ohne Qualifikation gesperrt |
| Anleitungen (SOP) | Versioniert: Entwurf → Freigabe durch Admin; Mitarbeiter sehen nur freigegebene Version. Sicherheitsstatus „Entwurf – nicht zur Anwendung“, bis Herstelleranleitung/Fachfreigabe vorliegt |
| Wareneingang | Kamera-Scanner (wo der Browser es unterstützt) oder Eingabe; erkennt EAN/GTIN mit Prüfziffer, GS1-Codes mit Charge/MHD, GS1 Digital Link, METRO-Artikelnummern aus dem Artikelstamm; unbekannte Codes → Zuordnung durch Leitung; Links nur nach Bestätigung und nur von erlaubten https-Domains; Menge, Charge, MHD, Temperatur (wo nötig), Zustand, Pflichtfoto, Annahme/Ablehnung |
| Tagesinventur | Liste der Betreiber-Vorlage (16 Artikel), Frühschicht bis 17:00, Spätschicht bis 23:00 (je Filiale änderbar); jeder Mitarbeiter füllt digital aus, Abgabe nur vollständig; Fleisch mit „davon mariniert“ und „nicht verwendbar“; Leitung sieht je Tag wer, wann, rechtzeitig/verspätet/verpasst; Erinnerung 60 Min vor Frist und Meldung bei verpasster Frist; Fleisch-Auswertung Anfang – Zugang – Verbrauch – Rest |
| Schädlingskontrolle | Hinweise für Mitarbeiter (worauf achten, Vorbeugung, Vorgehen bei Fund), Kontrolle aller 10 Bereiche, bei Befund Beschreibung + Foto Pflicht → automatisch Problem und Meldung an Leitung, Schädlingsbekämpfer ja/nein, Verlauf |
| Marinaden-Protokoll | Feste, versionierte Rezeptur (nur Betreiber, nur in der Datenbank); App berechnet Zutatenmengen je kg Fleisch, Mitarbeiter trägt Abgewogenes ein, Zutaten nicht änderbar, Toleranz optional; Charge mit Etikett-Code, Datum, Mitarbeiter, Allergenen, Verwendungsfrist (nur mit Quelle); Fleisch wird im Bestand verbucht; Restmengen und Entsorgung mit Grund |
| Mitarbeiter-Handbuch | 12 Kapitel der Betreiber-Vorlage in der App; Einarbeitungsbestätigung digital: Trainer trägt Bereiche ein, Mitarbeiter bestätigt selbst (keine Selbstbestätigung des Trainers) |
| Wöchentliche Inventur | Inventur-Tag je Filiale, automatische Erinnerung (fällig/überfällig), alle zählen mit, Abschluss nur Schichtführer/Leitung und nur vollständig, Abweichungen werden gebucht, Verlauf |
| Pflichtschulungen | 5 Schulungen (Hygiene, Fritteuse, Wareneingang, Reinigung, Allergene), Gültigkeit einstellbar, wöchentliche Erinnerung an offene/abgelaufene Schulungen |
| Bestand | Je Filiale über Buchungen (Wareneingang, Verderb, Inventur), Mindestbestand, Nachbestellliste, METRO-Belegnummer gegen Doppelerfassung |
| Ölmanager | Je Fritteuse: tägliche Prüfung (TPM, Temperatur, zulässig ja/nein, Foto); unzulässig oder Grenzwert erreicht → **gesperrt** und sofort Ölwechsel-Aufgabe. **Nächster Wechsel = letzter tatsächlicher Wechsel + Intervall** (z. B. 7 Tage); vorzeitiger Wechsel setzt neu, Filtern/Nachfüllen/Messen nicht. Wechsel mit Grund (planmäßig/vorzeitig/Qualität), Menge, Temperatur, Foto optional. Import von Messwerten (Seriennummer, Duplikatschutz, Testdaten gekennzeichnet) – siehe docs/VITO.md |
| Reinigungsplan | Eigener Menüpunkt: täglich/wöchentlich/monatlich, „nach Benutzung“ beliebig oft; Status offen / in Arbeit / erledigt / überfällig; Verantwortlicher, Erledigungszeit, Reinigungsmittel laut Plan, Pflichtfoto konfigurierbar; Leitung gibt zur Nachreinigung zurück; überfällige Wochenreinigung bleibt sichtbar |
| Persönliche Aufgaben | Keine Zeiterfassung. Wer in der Schicht eingeteilt ist (Positionsplan, Leitung oder „Ich arbeite in dieser Schicht“), bekommt Aufgaben automatisch und gleichmäßig nach Rolle, Schulung und Station; jede Aufgabe genau einer Person; Abwesenheit → neu verteilen; nicht zuweisbar → Meldung; Leitung kann Zuständigkeit wechseln. Intervall-Wartung ab letzter Erledigung. Wochenbericht je Filiale |
| Leitung | Übersicht je Filiale, Probleme mit Fotos, Schichtbericht (druckbar) mit Freigabe, Vorlagen sortieren/ändern, Schulungsstatus und Freigaben, Bestand & Codes, Öl-Grenzwerte, unveränderliches Protokoll |
| Sprachen | Deutsch, Arabisch (RTL), Englisch, Türkisch; ungeprüfte Übersetzungen werden gekennzeichnet; Vorlesen über die Sprachausgabe des Geräts |
| Sicherheit | Passwörter mit scrypt, Sitzungen nur als Hash gespeichert, Rollen und Filialtrennung **serverseitig**, CSRF-Schutz, Login-Sperre, Upload-Prüfung nach Dateiinhalt, Fotos privat außerhalb des Web-Ordners, Aufbewahrungsfrist für Fotos, Content-Security-Policy |

Was noch fehlt, steht ehrlich in [docs/STATUS.md](docs/STATUS.md). Prüfbericht zu Aufgaben und Schulungen: [docs/REVIEW.md](docs/REVIEW.md).

## Tests

```bash
npm test     # 67 API- und Logiktests (node:test)
npm run e2e  # 40 Browser-Abläufe in Chrome (Handy-Ansicht), erzeugt docs/screenshots/ und docs/E2E_RESULTS.md
```

## Echtbetrieb

Siehe [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (STRATO VPS, HTTPS, sichere Admin-Erstfreigabe, Backup).

## Aufbau

```
server/   index.js (Start) · app.js (API) · stations.js (Stationen, Plan, Timer) · inventory.js (Inventur, Erinnerungen) · daily.js (Tagesinventur, Schädlinge, Einarbeitung) · marinades.js · oil.js · assign.js (Verteilung, Reinigung, Wochenbericht) · handbook.js · courses-extra.js · db.js (Schema/Migrationen) · auth.js · seed.js (Startvorlagen, Demo-Daten)
shared/   codes.js (Barcode-/QR-Erkennung, Server + Browser)
public/   index.html · app.js · i18n.js · icons.js · style.css · sw.js · manifest
scripts/  create-admin.js (erster Betreiber-Account)
test/     API-Tests · e2e/ Browser-Test
```

Symbole: Material Design Icons (Google, Apache License 2.0).

## Zugänge & Nachweise (Block 2)
- Jeder Mitarbeiter bekommt ein eigenes Konto. Die Leitung legt es an und erhält einen **Einladungscode** (7 Tage gültig, nur einmal angezeigt, nur als Hash gespeichert). Die Person meldet sich mit dem Code an und legt ihr Passwort selbst fest (mind. 10 Zeichen).
- Passwort zurücksetzen = neuer Code; das alte Passwort und alle Sitzungen werden ungültig. Deaktivieren sperrt sofort.
- Von der Leitung direkt gesetzte Startpasswörter müssen beim ersten Login geändert werden.
- **Nachweise:** Belehrung nach §43 IfSG, METRO-Hygieneschulung, Folgebelehrungen. Upload als Foto/PDF, privat (nur Person, Leitung, Betreiber). Leitung bestätigt oder lehnt mit Begründung ab; keine Selbstprüfung.
- Die METRO-Schulung ersetzt die §43-Belehrung nicht. Fristen für Folgebelehrungen sind **nicht** fest eingebaut – bitte mit dem Fachberater festlegen. Offizielle Links pflegt der Betreiber.

## Schulungsbereiche (Block 3)
- 10 Bereiche (Fleisch & Hähnchen, Küche, Lager & Wareneingang, Inventur, Öl/Filter/Geräte, Reinigung & HACCP, Burger/Wraps/Menüs, Verpackung & Ausgabe, Verkaufstheke, Ladenbetrieb) × 3 Stufen (Grundlagen, Praxis, Verantwortung), Texte in DE/EN/AR.
- Prüfung: bis zu 20 Fragen je Stufe. Fragen und Antworten mischt der Server, die Lösungen gehen nicht an den Browser. Bestanden ab 80 % und nur, wenn **alle Sicherheitsfragen richtig** sind. Falsche Antworten werden mit der richtigen Antwort und einer Erklärung angezeigt. Wiederholen ist jederzeit möglich.
- Die nächste Stufe wird erst nach bestandener Prüfung frei. Danach folgt die praktische Freigabe durch Trainer oder Leitung (nie durch die Person selbst) und dann das Zertifikat mit Prüfcode.
- Jeder Bereich zeigt die zugehörigen Stationen. Die Leitung sieht eine Übersicht aller Mitarbeiter und Bereiche mit der höchsten zertifizierten Stufe.
- „Wie mache ich das?“ durchsucht Schulungen, das Handbuch und freigegebene Anleitungen.
- Der Betreiber bearbeitet Lernschritte, Video-Link (nur https), offene Punkte und Fragen (Status aktiv, offen oder archiviert) und markiert geprüfte Übersetzungen.

**Ehrlicher Stand der Inhalte:** 450 allgemeine Fragen, davon 136 Sicherheitsfragen. Die Stufen 1 und 2 haben in jedem Bereich die vollen 20 Fragen, Stufe 3 hat je 5. Damit ist jede Stufe prüfbar. Für das Ziel von 20 Fragen fehlen in Stufe 3 noch je 15. Jede mitgelieferte Frage hat einen festen Schlüssel: Neue Fragen kommen auch in bestehende Datenbanken. Fragen, die der Betreiber geändert oder archiviert hat, werden dabei nie überschrieben. Rezepte, Garzeiten, Geräteabläufe und Grenzwerte sind bewusst **nicht** erfunden; sie stehen als offene Punkte im Modul. Die Übersetzungen ins Englische und Arabische sind Entwürfe und müssen fachlich geprüft werden.
