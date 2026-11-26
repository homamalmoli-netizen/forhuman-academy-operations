# Umsetzungsstand und offene Punkte (ehrlich)

Stand dieses Pull Requests. „Umgesetzt“ heißt: programmiert **und** durch automatische Tests abgedeckt (`npm test`, `npm run e2e`).

## Umgesetzt und getestet

- Rollen Admin / Filialleitung / Trainer / Mitarbeiter, Filialen Halle und Leuna, Filialtrennung serverseitig (Aufgaben, Probleme, Fotos, Berichte, Bestand, Öl)
- Mitarbeiter-Modus mit genau einer nächsten Aufgabe, Pflichtfoto, Messwert, Problem melden, Nacharbeit, Vorlesen, feste Anleitungen (kein Chatbot)
- Automatische Aufgaben je Filiale/Schicht/Wochentag/Monatstag ohne Dubletten; Leitung ändert Reihenfolge, Foto-Pflicht, aktiv/aus, legt neue Aufgaben an
- Schichtbericht mit Fotos, Messwerten, Problemen, Öl-Status; Schichtfreigabe (mit Begründung, wenn etwas offen ist)
- Academy-Ablauf nach #9 inkl. serverseitiger Sperre der Prüfung, Bildfragen, Ergebnis, Wiederholung, praktischer Freigabe, Qualifikations-Sperre für Aufgaben und Ölmanager
- SOP-Versionierung mit Freigabe und Sicherheitsstatus
- Wareneingang mit Code-Erkennung (GTIN/GS1/Digital Link/METRO-Nummer aus Artikelstamm), unbekannte Codes, sichere Links, Bestand, Verderb, Inventur, Mindestbestand, Nachbestellliste, Beleg-Dublettenschutz
- Ölmanager mit TPM, Filtern, Wechsel, Pflichtfoto, Warnungen nur bei hinterlegtem Grenzwert mit Quelle
- Dashboard, In-App-Benachrichtigungen, unveränderliches Audit-Protokoll
- DE / AR (RTL) / EN / TR, Kennzeichnung ungeprüfter Übersetzungen
- Demo ohne Login, isoliert (In-Memory, eigener Foto-Ordner); Produktion ohne Demo-Zugang und ohne Standardkonten
- Sichere Admin-Erstfreigabe per Server-Kommando (Passwort verdeckt)
- Offline: keine falsche Erfolgsmeldung, Eingaben bleiben auf dem Bildschirm
- Stationen mit Stationscheck (kritische Punkte), Stationsfreigabe, Stufen 1–5, Rolle Schichtführer
- Positionsplan je Schicht nur mit freigegebenen Personen bzw. Einarbeitung neben Freigegebenen; Aufgaben nach Station strukturiert
- Haltezeit-/Garzeit-Timer mit Ablaufwarnung; abgelaufen → nur Entsorgen; Übersicht zählt nicht entsorgte Ware
- Tagesinventur Früh (17:00) / Spät (23:00) mit Pünktlichkeits-Übersicht und Erinnerungen; Fleisch-Auswertung
- Schädlingskontrolle nach Betreiber-Vorlage; Mitarbeiter-Handbuch mit digitaler Einarbeitungsbestätigung
- Marinaden-Protokoll mit fester, versionierter Rezeptur, Chargen-Etikett, Restmengen und Entsorgung
- Ölwechsel nach Intervall ab tatsächlichem Wechsel, Sperre bei unzulässigem Öl, Messwert-Import
- Reinigungsplan als eigener Menüpunkt, persönliche faire Aufgabenverteilung, Nachreinigung, Wochenbericht

## Nicht umgesetzt / bewusst offen

| Punkt | Grund / was nötig ist |
|---|---|
| **Öffentlich erreichbare Demo-Adresse** | Aus dieser Entwicklungsumgebung kann ich keinen Server ins Internet stellen. Demo läuft lokal mit `npm run demo`; für eine Adresse: VPS oder Replit (siehe unten) |
| Abgleich mit dem Replit-Projekt | Kein Zugriff auf das Replit-Projekt aus dieser Sitzung. Dieser Branch ist vom Prototyp in PR #2 abgeleitet und ersetzt ihn vollständig |
| Echte Videos und Fotos in Schulungen | Müssen vom ForHuman-Team erstellt oder lizenziert werden. Aktuell Symbole statt Fotos |
| Geräte-Anleitungen (GGM, Frymaster, Henny Penny) | Herstellerhandbücher / genaues GGM-Modell fehlen. Inhalte sind als „Entwurf – nicht zur Anwendung“ markiert; keine Drücke, Temperaturen, Ölwechsel-Schritte erfunden |
| Echte Marinaden-Rezepturen, Toleranzen, Verwendungsfristen | Trägt der Betreiber selbst in der App ein (Leitung → Rezepturen). Nur in der Datenbank, nie im Repository |
| Kassenbuch / Kassenabschluss (Handbuch Kap. 9) | Gehört ins Kassensystem (POS); hier nur als Regeltext im Handbuch |
| Einheiten der Tagesinventur | Aus der Vorlage übernommen (Fleisch/Pommes/Panade/Marinade kg, Saucen/Öl L, Rest Stück) – bitte prüfen |
| Haltezeiten und Garzeiten je Produkt | Nur aus Herstellerangabe / freigegebener Rezeptur / HACCP-Plan. In Produktion leer; Demo-Werte sind als fiktiv markiert |
| Stationscheck-Listen | Eigene Entwürfe von mir (Hygiene, Sicherheit, Ablauf). Bitte fachlich prüfen und an Ihre Abläufe anpassen; Bearbeiten in der App folgt noch (aktuell in `server/seed.js`) |
| VITO Live-Anbindung | Offizielle Schnittstelle nicht verifiziert (siehe docs/VITO.md); Import als Fallback gebaut |
| Reinigungsmittel je Aufgabe | Feld vorhanden, leer – Eintrag laut Ihrem freigegebenen Reinigungsplan |
| HACCP-Grenzwerte, Öl-Grenzwert (TPM) | Nur aus Ihrem HACCP-Plan bzw. Herstellerangabe. Felder sind vorhanden, standardmäßig leer |
| Reinigungsmittel-Register (METRO, Dr. Becher), Dosierungen, Sicherheitsdatenblätter (#7, #8) | Konkrete Produkte, Etiketten und SDB fehlen; App verweist auf Etikett/SDB |
| METRO-Schnittstelle, automatische Belegerkennung (OCR) | Keine verifizierte METRO-API; OCR nicht eingebaut. Beleg wird als Foto/PDF mit Belegnummer gespeichert, Zuordnung manuell |
| E-Mail- / Push-Benachrichtigungen (#6) | Kein Kanal konfiguriert; Meldungen erscheinen in der App. Für E-Mail wird ein SMTP-Zugang benötigt |
| Zertifikate als PDF | Noch nicht gebaut |
| Arbeiten ohne Netz mit späterer Synchronisierung | Bewusst nicht: Ohne Verbindung wird nichts gespeichert und das klar angezeigt |
| Muttersprachliche Prüfung AR/EN/TR | Übersetzungen sind Entwürfe; vor Echtbetrieb prüfen und in der App als geprüft markieren |
| Offizielles ForHuman-Logo | Platzhalter-Signet in `public/logo.svg`; Datei durch Ihr Logo ersetzen |
| Technik-Abweichung vom Auftrag | Statt React/TypeScript + PostgreSQL: reines JavaScript ohne Build-Schritt und SQLite (Node-Bordmittel). Grund: in dieser Umgebung keine Paketinstallation möglich; Vorteil: keine Abhängigkeiten, einfacher Betrieb auf einem VPS. Wechsel auf PostgreSQL ist bei Bedarf möglich |
| Kamera-Scanner | Nutzt die Browser-Funktion `BarcodeDetector` (u. a. Chrome auf Android). Auf iPhone/Safari aktuell nicht verfügbar → Nummer eintippen. Für iPhone wäre eine Scanner-Bibliothek nötig |

## Was Sie als Eigentümer tun müssen

1. **Hosting:** STRATO VPS (Linux) bestellen oder vorhandenen Server nennen; Domain per DNS darauf zeigen. Anleitung: `docs/DEPLOYMENT.md`.
2. **Erster Admin:** auf dem Server `scripts/create-admin.js` ausführen (Passwort nur dort eingeben).
3. **Fachfreigaben:** HACCP-Plan, Herstellerhandbücher, genaues GGM-Modell, Reinigungsmittel mit SDB bereitstellen – dann SOPs prüfen und in der App auf „geprüft“ setzen.
4. **Medien:** eigene Fotos/Videos je Arbeitsschritt.
5. **Übersetzungen prüfen** lassen (AR, TR, EN).
6. **Repository privat stellen**, bevor echte Inhalte (Rezepte, interne Dokumente) dazukommen.
