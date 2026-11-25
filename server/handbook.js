// Mitarbeiter-Handbuch (Vorlage des Betreibers). Kapitel 9 (Kasse) betrifft das Kassensystem und wird hier nur als Regel angezeigt.
export const HANDBOOK_VERSION = 1;

export const HANDBOOK = [
  { id: 'verantwortung', title: '1. Allgemeine Verantwortung', intro: 'Jeder Mitarbeiter ist für Sauberkeit, Hygiene und ordnungsgemäßes Arbeiten in seinem Aufgabenbereich verantwortlich.',
    items: ['Arbeitsanweisungen einhalten', 'Kontrolllisten vollständig ausfüllen', 'Keine Eintragungen im Voraus vornehmen', 'Nur tatsächlich durchgeführte Kontrollen bestätigen',
      'Fehler und Abweichungen sofort melden', 'Lebensmittel sorgfältig behandeln', 'Betriebseigentum und Arbeitsgeräte sorgfältig behandeln'] },
  { id: 'hygiene', title: '2. Persönliche Hygiene', intro: 'Vor Arbeitsbeginn und während der Schicht sind die Hygienevorgaben einzuhalten.',
    items: ['Saubere Arbeitskleidung tragen', 'Hände gründlich waschen', 'Nach Toilette, Pause, Müllkontakt und unreinen Tätigkeiten Hände erneut waschen',
      'Wunden hygienisch und vollständig abdecken', 'Arbeitsbereich sauber halten', 'Saubere und unreine Tätigkeiten voneinander trennen',
      'Hygienisch relevante Erkrankungen/Beschwerden unverzüglich der verantwortlichen Person melden'] },
  { id: 'haccp', title: '3. HACCP & Lebensmittelkontrolle', intro: '',
    items: ['Vorgeschriebene Temperaturkontrollen durchführen', 'Temperaturen korrekt dokumentieren', 'Kühlkette einhalten', 'Lebensmittel abdecken und korrekt lagern',
      'Rohware und verzehrfertige Lebensmittel trennen', 'Kreuzkontamination verhindern', 'Haltbarkeit und Zustand der Lebensmittel kontrollieren', 'FIFO-Prinzip anwenden',
      'Abweichungen unverzüglich melden'],
    rule: 'Kontrolllisten dürfen niemals ausgefüllt oder unterschrieben werden, wenn die entsprechende Kontrolle nicht tatsächlich durchgeführt wurde.' },
  { id: 'fleisch', title: '4. Fleisch – Lagerung und Verarbeitung', intro: 'Fleisch ist besonders sorgfältig zu behandeln.',
    items: ['Temperatur und Zustand bei Warenannahme kontrollieren', 'Fleisch unverzüglich korrekt einlagern', 'Rohes Fleisch getrennt von anderen Lebensmitteln lagern',
      'Vorgesehene Messer, Bretter und Arbeitsgeräte benutzen', 'Arbeitsflächen nach Verarbeitung reinigen', 'Fleisch nicht unnötig außerhalb der Kühlung stehen lassen',
      'Haltbarkeit und Kennzeichnung kontrollieren', 'Nicht einwandfreie Ware sofort melden und nicht ohne Freigabe verwenden'] },
  { id: 'fleischinventur', title: '5. Fleisch-Inventur', intro: 'Die Fleischinventur ist nach betrieblichem Plan vollständig durchzuführen. Erfasst werden: Datum – Fleischart – Anfangsbestand – Zugang – Verbrauch – Restbestand – Differenz – Mitarbeiter. In der App: Ware → Tagesinventur.',
    items: ['Gesamten Fleischbestand wiegen bzw. zählen', 'Alle Kühl- und Lagerbereiche berücksichtigen', 'Angebrochene Ware berücksichtigen', 'Mariniertes Fleisch separat erfassen',
      'Nicht verwendbare Ware dokumentieren', 'Soll-/Ist-Differenzen prüfen', 'Ungewöhnliche Differenzen sofort melden', 'Inventur mit Namen bestätigen'] },
  { id: 'marinaden', title: '6. Marinaden & mariniertes Fleisch', intro: 'Für jede Marinade gilt eine feste Rezeptur. Die vorgegebene Rezeptur darf nicht eigenmächtig verändert werden. Zu dokumentieren: Marinade – Fleischart – Fleischmenge – Zutaten/Mengen – Datum – Charge/Kennzeichnung – Mitarbeiter.',
    items: ['Rezept genau einhalten', 'Mengen korrekt abwiegen', 'Allergene gemäß betrieblicher Vorgabe berücksichtigen', 'Herstellung bzw. Marinieren dokumentieren',
      'Mariniertes Fleisch kennzeichnen', 'Kühlvorgaben einhalten', 'Restmengen dokumentieren', 'Keine nicht freigegebenen Zutaten verwenden'],
    rule: 'Dadurch bleiben Geschmack, Qualität, Lebensmittelsicherheit und Warenverbrauch nachvollziehbar.' },
  { id: 'reinigung', title: '7. Reinigung & Spülplan', intro: 'Jeder Mitarbeiter ist für die ihm zugeteilten Reinigungsaufgaben verantwortlich.',
    groups: [
      { title: 'Während der Schicht', items: ['Arbeitsflächen sauber halten', 'Geräte und Werkzeuge reinigen', 'Verschüttetes sofort beseitigen', 'Müll regelmäßig entsorgen', 'Spülbereich sauber halten', 'Sauberes und schmutziges Geschirr trennen'] },
      { title: 'Bei Schichtende', items: ['Arbeitsflächen vollständig reinigen', 'Messer und Schneidebretter reinigen', 'Geräte reinigen', 'Spülbereich reinigen', 'Boden reinigen', 'Müll entsorgen',
        'Lebensmittel abdecken und korrekt einlagern', 'Kühlung kontrollieren', 'Reinigungsmittel ordnungsgemäß verstauen', 'Reinigungsplan ausfüllen'] }] },
  { id: 'oel', title: '8. Fritteusenöl & Ölwechsel', intro: 'Der Zustand des Frittieröls ist nach dem betrieblichen Kontrollplan zu überprüfen. Dokumentiert wird im Ölmanager: Datum – Uhrzeit – Fritteuse – Kontrolle – Ölwechsel – Mitarbeiter.',
    items: ['Ölzustand kontrollieren', 'Erforderlichen Ölwechsel durchführen', 'Fritteuse nach Herstellervorgaben reinigen', 'Neues Öl korrekt einfüllen', 'Ölwechsel dokumentieren',
      'Altöl ordnungsgemäß sammeln und entsorgen', 'Auffälligkeiten melden'],
    rule: 'Ein Ölwechsel darf nicht als durchgeführt eingetragen werden, wenn er nicht tatsächlich erfolgt ist.' },
  { id: 'kasse', title: '9. Kassenbuch & Kassenabschluss', intro: 'Die Kasse muss korrekt und nachvollziehbar geführt werden. (Wird im Kassensystem erledigt, nicht in dieser App.)',
    items: ['Kassenbestand kontrollieren', 'Einnahmen korrekt erfassen', 'Barausgaben ordnungsgemäß erfassen', 'Erforderliche Belege aufbewahren und zuordnen',
      'Bareinlagen und Barentnahmen dokumentieren', 'Soll-/Ist-Bestand vergleichen', 'Kassendifferenzen sofort melden', 'Tagesabschluss durchführen', 'Kassenbuch ordnungsgemäß führen'],
    rule: 'Ungeklärte Kassendifferenzen dürfen nicht eigenmächtig durch falsche Buchungen ausgeglichen oder verschwiegen werden.' },
  { id: 'tagesabschluss', title: '10. Tagesabschluss', intro: 'Vor Feierabend ist zu kontrollieren:',
    items: ['Lebensmittel korrekt gelagert', 'Fleisch kontrolliert', 'Kühlung kontrolliert', 'Arbeitsflächen sauber', 'Geräte gereinigt', 'Spülbereich sauber', 'Böden gereinigt',
      'Müll entsorgt', 'Fritteuse/Öl kontrolliert', 'HACCP-Dokumentation vollständig', 'Kassenabschluss durchgeführt', 'Auffälligkeiten gemeldet'] },
  { id: 'nichteinhaltung', title: '11. Vorgehen bei Nichteinhaltung', intro: 'Die Einhaltung dieses Handbuchs ist Bestandteil der betrieblichen Organisation. Werden Vorgaben nicht eingehalten, wird der Vorfall abhängig von Art, Schwere und Wiederholung dokumentiert und mit dem Mitarbeiter besprochen.',
    steps: ['Feststellung und Dokumentation: Der Verstoß bzw. die Abweichung wird nachvollziehbar festgehalten.',
      'Mitarbeitergespräch / erneute Einweisung: Der Mitarbeiter wird auf den Fehler hingewiesen und bei Bedarf erneut in den korrekten Arbeitsablauf eingewiesen.',
      'Wiederholte oder erhebliche Verstöße: Bei erneuten oder erheblichen Verstößen können weitere arbeitsrechtlich zulässige Maßnahmen geprüft und ergriffen werden.',
      'Schwerwiegende Fälle: Bei vorsätzlichen Manipulationen, falschen Dokumentationen, erheblichen Hygiene- oder Lebensmittelsicherheitsverstößen, Diebstahl oder anderen schwerwiegenden Pflichtverletzungen behält sich der Betrieb vor, nach Prüfung des Einzelfalls angemessene arbeitsrechtliche Maßnahmen zu ergreifen.'],
    rule: 'Arbeitsrechtliche Maßnahmen erfolgen immer unter Berücksichtigung der konkreten Umstände und der geltenden gesetzlichen Bestimmungen.' },
  { id: 'verstoesse', title: '12. Besonders wichtige Verstöße', intro: 'Folgende Punkte müssen unverzüglich der verantwortlichen Person gemeldet werden:',
    items: ['Falsche oder erfundene HACCP-Eintragungen', 'Nicht durchgeführte Temperaturkontrollen', 'Erhebliche Hygienemängel', 'Unsachgemäßer Umgang mit Fleisch',
      'Verwendung nicht einwandfreier Lebensmittel', 'Nicht dokumentierte oder unerklärliche Fleischverluste', 'Manipulation von Inventurlisten', 'Nicht gemeldete Kassendifferenzen',
      'Manipulation des Kassenbuchs', 'Nicht durchgeführte, aber bestätigte Reinigungsarbeiten', 'Nicht durchgeführte, aber dokumentierte Ölwechsel'] },
];

// 13. Einarbeitungsbestätigung: Bereiche
export const ONBOARDING_AREAS = ['Persönliche Hygiene', 'HACCP', 'Lebensmittelhygiene', 'Fleischverarbeitung und Lagerung', 'Fleischinventur', 'Marinaden', 'Reinigung',
  'Spülplan', 'Fritteusenöl / Ölwechsel', 'Kassenbuch', 'Kassenabschluss', 'Tagesabschluss', 'Verhalten bei Abweichungen'];

export const ONBOARDING_STATEMENT = 'Ich bestätige, dass mir die für meinen Aufgabenbereich geltenden Arbeitsabläufe erklärt wurden und ich Gelegenheit hatte, Fragen zu stellen.';

// Schädlingskontrolle (Vorlage des Betreibers)
export const PEST_AREAS = ['Küche', 'Lager / Privatraum', 'Kühlraum', 'Trockenlager', 'Theke / Kasse', 'Toiletten', 'Müllbereich', 'Eingangsbereich', 'Türen / Fenster', 'Außenbereich'];

export const PEST_GUIDE = {
  watch: ['Mäuse oder Ratten sowie Kot- oder Nagespuren', 'Kakerlaken / Schaben', 'Fliegen und andere Insekten', 'Ameisen', 'Lebensmittelmotten oder Larven',
    'Beschädigte oder angenagte Verpackungen', 'Ungewöhnliche Löcher, Nester oder Verstecke', 'Auffällige Gerüche oder Verschmutzungen',
    'Schädlinge in der Nähe von Lebensmitteln, Geräten oder Abfällen'],
  prevent: ['Lebensmittel immer geschlossen und geschützt lagern.', 'Lebensmittel nicht direkt auf dem Boden lagern.', 'Verschüttete Lebensmittel und Getränke sofort entfernen.',
    'Arbeitsflächen und Böden sauber halten.', 'Essensreste nicht offen stehen lassen.', 'Müll regelmäßig entsorgen und Müllbehälter geschlossen halten.',
    'Türen möglichst geschlossen halten.', 'Lager und schwer zugängliche Bereiche regelmäßig kontrollieren.', 'Kartons und Verpackungen beim Wareneingang auf Schädlingsspuren prüfen.'],
  found: ['Lebensmittel im betroffenen Bereich schützen und nicht weiterverwenden, wenn eine Verunreinigung möglich ist.', 'Fundstelle nicht unnötig verändern.',
    'Sofort Schichtleitung / Verantwortlichen informieren.', 'Fund und Bereich dokumentieren (Foto).', 'Keine eigenen Schädlingsbekämpfungsmittel in Lebensmittelbereichen einsetzen.',
    'Verantwortliche Person entscheidet über Reinigung, Sperrung des Bereichs und ggf. Schädlingsbekämpfer.'],
};

// Tägliche Inventurliste (Vorlage des Betreibers): [Name, Einheit, Kategorie, Fleisch]
export const DAILY_ITEMS = [
  ['Hähnchenbrust', 'kg', 'Fleisch', 1], ['Chicken Wings', 'kg', 'Fleisch', 1], ['Hähnchenschenkel', 'kg', 'Fleisch', 1],
  ['Burger Buns', 'Stück', 'Backware', 0], ['Wraps', 'Stück', 'Backware', 0], ['Pommes frites', 'kg', 'Tiefkühlware', 0], ['Panade', 'kg', 'Trockenware', 0],
  ['Marinade mild', 'kg', 'Marinade', 0], ['Marinade scharf', 'kg', 'Marinade', 0],
  ['Knoblauchsauce', 'L', 'Sauce', 0], ['BBQ-Sauce', 'L', 'Sauce', 0], ['Smokey-Sauce', 'L', 'Sauce', 0], ['Cheese-Sauce', 'L', 'Sauce', 0],
  ['Verpackungen', 'Stück', 'Verbrauch', 0], ['Getränke', 'Stück', 'Getränke', 0], ['Frittieröl', 'L', 'Trockenware', 0],
];
