# Prüfung Aufgaben & Schulungen (Stand 25.11.2026)

Geprüft wurden alle Aufgaben-Vorlagen, alle Schulungen, die zugehörigen Sperren auf dem Server und die Abläufe in der App.

## Aufgaben – gefunden und behoben

| Befund | Behoben |
|---|---|
| „Türen abschließen“, Schädlingskontrolle und monatliche Geräteprüfung sah jeder Mitarbeiter | Neue Aufgabenrolle **Schichtführer**: diese Aufgaben sehen und erledigen nur Schichtführer/Leitung (auch per direktem API-Aufruf gesperrt). In den Vorlagen umschaltbar |
| Es gab keine **Abschlusskontrolle** am Ende der Schließung | Neue Aufgabe „Abschlusskontrolle“ (Schichtführer, Pflichtfoto) |
| Keine regelmäßige **Inventur** | Wöchentliche Inventur je Filiale mit eigenem Zählbildschirm, Erinnerung und Sperre (siehe unten) |
| Kein Ablauf „älteste Ware nach vorne“ | Wöchentliche Aufgabe „Lager: älteste Ware nach vorne“ |
| Abgeschlossene Schicht ohne Schichtführer-Aufgaben | Schichtbericht zählt Schichtführer-Aufgaben mit; offene Punkte blockieren die Freigabe ohne Begründung |

## Wöchentliche Inventur mit automatischer Erinnerung

- Inventur-Tag je Filiale einstellbar (Standard Montag); die Aufgabe „Wöchentliche Inventur“ erscheint an diesem Tag in der Schließung für Schichtführer.
- **Erinnerung automatisch:** am Inventur-Tag „heute fällig“, danach „überfällig“ – in der Übersicht und den Benachrichtigungen, jede Erinnerung nur einmal je Woche. Der Server prüft stündlich.
- Alle Mitarbeiter dürfen mitzählen und zwischenspeichern; **abschließen** nur Schichtführer/Leitung und nur, wenn **jeder Artikel** gezählt ist.
- Beim Abschluss wird jede Abweichung als Inventurbuchung gespeichert (mit Soll, Ist, Woche); Verlauf der letzten 8 Wochen.
- Die Aufgabe lässt sich erst abhaken, wenn die Inventur der Woche abgeschlossen ist.

## Schulungen – gefunden und behoben

| Befund | Behoben |
|---|---|
| Nur 2 Schulungen; laut #9 fehlten Wareneingang, Reinigung, Allergene | 3 neue Pflichtschulungen in DE/AR/EN/TR mit Bildfrage: **Wareneingang & Kühlkette**, **Reinigen & Desinfizieren**, **Allergene & Gästefragen** – ohne erfundene Grenzwerte oder Dosierungen (Verweis auf HACCP-Plan, Etikett/SDB, Allergenliste) |
| Wareneingang ohne Schulung möglich | Annahme/Ablehnung nur nach bestandener Schulung „Wareneingang & Kühlkette“ |
| Station „Kasse & Theke“ prüft Allergenfragen, hatte aber keine Schulung als Voraussetzung | Stationscheck erst nach Schulung „Allergene“ |
| Schulungen galten für immer | Gültigkeit je Schulung einstellbar (6/12/24/36 Monate oder unbegrenzt, nur Admin). Abgelaufen = nicht mehr qualifiziert → zugehörige Aufgaben/Stationen wieder gesperrt |
| Mitarbeiter sahen nicht, welche Pflichtschulung fehlt | Hinweis „Offene Pflichtschulungen“ oben auf der Aufgabenseite; Leitung bekommt **wöchentlich** eine Erinnerung mit Namen; Kachel in der Übersicht |
| Übersetzungen könnten andere Lösungen haben als Deutsch | Automatischer Test: alle Sprachen haben gleich viele Schritte/Fragen und dieselbe richtige Antwort |

## Bewusst offen / Risiken

- Prüfungsfragen kommen immer in derselben Reihenfolge; ein Fragenpool mit Zufallsauswahl würde Auswendiglernen erschweren.
- Inhalte der Stationscheck-Listen, SOPs und Schulungen sind meine Entwürfe → fachlich prüfen; Übersetzungen muttersprachlich prüfen.
- Erinnerungen erscheinen nur in der App. Für E-Mail/Push wird ein Zugang (z. B. SMTP) benötigt.
- Gesetzliche Pflichten (z. B. Belehrung nach Infektionsschutzgesetz, Arbeitsschutz-Unterweisung) ersetzt die App nicht; Fristen dafür mit Ihrem Fachberater festlegen und als Gültigkeit eintragen.

## Tests

- `npm test`: 43/43 (neu: ISO-Woche, Inventurstatus, Erinnerungen einmalig, Inventur-Ablauf und -Sperre, Gültigkeit, Wareneingang nur mit Schulung, Schichtführer-Aufgaben, Konsistenz aller Schulungssprachen)
- `npm run e2e`: 31/31 im Browser (neu: Inventur mit Erinnerung, Hinweis auf offene Pflichtschulungen)
