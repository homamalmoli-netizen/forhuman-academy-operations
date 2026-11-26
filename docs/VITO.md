# VITO-Messgeräte (VITOconnect, FT CONNECT) – Stand der Anbindung

**Kurz:** Es gibt noch **keine Live-Verbindung**. Gebaut ist der Fallback: manuelle Eingabe und Import von Messwerten mit Gerätezuordnung, Duplikatschutz und gekennzeichneten Testdaten.

## Was geprüft werden muss (offen)
Der Abruf der Hersteller-Seiten (vito.ag, handling.vito.ag) war in dieser Sitzung nicht möglich (Freigabe ausstehend). Daher ist **nicht verifiziert**, ob VITO eine offizielle API/SDK, einen Cloud-Export oder eine HACCP-Schnittstelle anbietet und zu welchen Bedingungen.

Bitte beim Hersteller klären und hier eintragen:
1. Gibt es eine offizielle Schnittstelle (API/SDK, Webhook, Export) für FT CONNECT (TPM, Temperatur) und VITOconnect (Nutzungsdaten VM/VL)?
2. Zugangsdaten / Vertrag / Kosten, Datenformat, Zeitstempel (Zeitzone), Geräte-Seriennummern.
3. Testzugang mit echtem Gerät.

Es werden **keine Endpunkte erfunden**. Eine Live-Anbindung wird erst gebaut und als fertig gemeldet, wenn sie mit echtem Gerät/Zugang getestet ist.

## Was bereits funktioniert
- Jede Fritteuse kann eine **Seriennummer des Messgeräts** bekommen (Leitung → Öl-Grenzwerte). Eine Seriennummer gehört genau zu einer Fritteuse.
- **Import** (Leitung → Öl-Grenzwerte → Messwerte importieren): je Zeile `Seriennummer;Zeitpunkt (ISO 8601);TPM;Temperatur`.
  - Zuordnung über Seriennummer innerhalb der Filiale; unbekannte Geräte werden gemeldet, nicht importiert.
  - **Duplikatschutz:** gleiche Fritteuse + gleicher Messzeitpunkt wird nur einmal gespeichert.
  - Ungültige Zeilen (kein Zeitpunkt, Werte außerhalb 0–100 % bzw. −20…300 °C) werden gezählt und übersprungen.
  - Importierte Messwerte über dem freigegebenen TPM-Grenzwert **sperren die Fritteuse** wie eine manuelle Prüfung.
  - **Testdaten** (Häkchen „Testdaten“) werden mit „TESTDATEN – kein echter Messwert“ gespeichert und sperren nie eine Fritteuse.
- Manuelle tägliche Prüfung (TPM, Temperatur, zulässig ja/nein, Foto) bleibt jederzeit möglich.
