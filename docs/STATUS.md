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

**Ehrlicher Stand der Inhalte:** 600 allgemeine Fragen (10 Bereiche × 3 Stufen × 20), davon 175 Sicherheitsfragen. Sie behandeln Hygiene, Sicherheit, Abläufe, Dokumentation und Verantwortung. Rezeptwerte, Garzeiten, Geräteabläufe und Grenzwerte sind **nicht** erfunden; die Fragen verweisen auf „Vorgabe der Filiale“, „Herstelleranleitung“ oder den HACCP-Plan. Jede mitgelieferte Frage hat einen festen Schlüssel: Neue Fragen kommen auch in bestehende Datenbanken. Fragen, die der Betreiber geändert oder archiviert hat, werden dabei nie überschrieben. Rezepte, Garzeiten, Geräteabläufe und Grenzwerte sind bewusst **nicht** erfunden; sie stehen als offene Punkte im Modul. Die Übersetzungen ins Englische und Arabische sind Entwürfe und müssen fachlich geprüft werden.

## Zählrhythmus, Marinieren, Wareneingang
- Jeder Artikel wird entweder „täglich“ gezählt (Tagesinventur Früh und Spät) oder „nur wöchentlich“. Die Leitung stellt das unter **Leitung → Bestand & Codes → Zählrhythmus** um.
- Standard: Saucen und Marinaden nur wöchentlich, alle anderen Artikel täglich. Die Wocheninventur zählt immer alle Artikel.
- Täglich in Früh- und Spätschicht gibt es die Aufgabe „Fleisch marinieren“. Erledigen lässt sie sich erst, wenn eine neue Charge im Marinierprotokoll eingetragen ist.
- Wöchentlich (Standard: Montag, Schichtführer) gibt es die Aufgabe „Wareneingang der Woche prüfen“. Der Wochentag lässt sich unter **Leitung → Vorlagen** ändern.

## Kontrolllisten (Issue #20, Nachtrag des Betreibers)
- Einfache Ist-Mengen-Kontrolle als persönliche Aufgabe. Keine Buchungen, keine Einkaufspreise, keine automatischen Bestellungen, keine POS-Anbindung, keine Zeiterfassung. Wareneingang und Inventur bleiben zusätzlich bestehen (Entscheidung des Betreibers).
- Listen je Filiale: Regal 1, Regal 2 (Saucen), Reinigungsmittel/Hygiene (wöchentlich, Standard Montag); Tiefkühlware (alle 3 Kalendertage ab Startdatum); Küche/Burger-Zutaten und frische Ware (täglich); mariniertes Fleisch (täglich 17:10 und 23:30). Rhythmus, Wochentag, Intervall, Startdatum, Uhrzeiten, Pflichtfoto, Einheiten und Mindestwerte stellt die Leitung je Filiale ein.
- Artikel aus der Betreiberliste. Fehlende Mindestwerte und ungeklärte Einheiten sind als **offen** markiert und nicht erfunden; es betrifft z. B. Granatapfel Sauce, Tiefkühlware, Fleisch/Pommes, Eisberg und Tomaten. Vom Betreiber bestätigt: Marinade in Tüten, Panade (Mehl) in kg, Bacon und Sucuk in Packungen à 500 g.
- Pflichtfelder: Jede Position braucht eine Menge; 0 ist gültig, ein leeres Feld wird abgelehnt. Liegt die Menge unter dem Mindestwert, erscheint ein Nachbestellhinweis, und die Leitung wird informiert.
- Mariniertes Fleisch: kg je Teil, mild und pikant getrennt, Marinierzeit, Kühltemperatur, Pflichtfoto. Eine Verbrauchsfrist wird nur berechnet, wenn die Leitung Stunden **mit Quelle** hinterlegt; sonst steht „laut freigegebenem Plan – noch nicht hinterlegt“.
- Zuweisung: faire Verteilung an anwesende Mitarbeiter, Neuverteilung bei Abwesenheit, Leitung kann umverteilen. „Nicht zuweisbar“ wird ab 60 Minuten vor Fälligkeit an die Leitung gemeldet.
- Erinnerung (Standard, je Filiale änderbar): 10 Minuten vorher, bei Fälligkeit und 5 Minuten danach an die verantwortliche Person; 10 Minuten danach an die Filialleitung. Der Minutentakt läuft auf dem Server, der Zustand liegt in der Datenbank. Nach einem Neustart wird nur die zuletzt erreichte Stufe gesendet; nach Erledigung kommt nichts mehr.
- **Kein automatischer Telefonanruf** (Entscheidung des Betreibers). Externe Push- oder E-Mail-Kanäle sind nicht eingerichtet; die Erinnerungen erscheinen in der App.
- Managerkontrolle: Bestätigen oder Nacharbeit mit Begründung; die Person, die eine Kontrolle erledigt hat, kann sie nicht selbst bestätigen.
- Temperatur-Alarm beim marinierten Fleisch: Liegt die eingetragene Kühltemperatur über dem Höchstwert, geht sofort eine Meldung an die Filialleitung, und die Kontrolle wird in der Übersicht markiert. Standard ist +4 °C (DIN 10508, Geflügelfleisch und -zubereitungen). Der Wert ist je Filiale nur mit Quellenangabe änderbar.
