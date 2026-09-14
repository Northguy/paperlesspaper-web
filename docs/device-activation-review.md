# Nebenwirkungsprüfung der Geräteaktivierung

## Aktualisierung nach PR-Review vom 14. September 2026

Auf Wunsch wurde die Transaktionsanforderung aus der Geräteaktivierung entfernt.
Der Ablauf nutzt sequenzielle Schreiboperationen auf einer Standalone-MongoDB;
Teilfehler ohne Rollback sind akzeptiert. Papers bleiben erhalten, ihre alten
Verknüpfungen können nach einem Fehler bereits getrennt sein. Polling kann den
Abschluss mit frischem IoT-Nachweis erneut versuchen. Der Test für „Start again“
bildet jetzt das bereits akzeptierte Zurücksetzen eines aktiven Orphans ab.

Vor dem Speichern einer neuen Gerätezuordnung wird das bisherige Vergleichsbild
unter `ePaperDeviceImages/<Seriennummer>.png` gelöscht. Ein Fehler dabei wird
weitergereicht und beim nächsten Abschluss erneut versucht. Paper-Originale
und Vorschaubilder bleiben erhalten. Wiederholter Abschluss derselben Zuordnung
und normaler WLAN-Wechsel löschen diesen Cache nicht. Die drei neuen
Aktivierungstexte sind jetzt auch auf Niederländisch vorhanden.

Aktuelle Prüfung: **102 Tests bestanden, 2 fehlgeschlagen**; der separate
Hardwaretest wurde ohne explizite Freigabevariable übersprungen. Die
Registrierungstests liefen gegen eine isolierte lokale Standalone-MongoDB;
IoT und S3 waren simuliert. Keine produktiven Daten oder Bilder wurden geändert.

Weiter offen sind die fremden Upload-Logs (Befund 1) und der hängende
Polling-Request (Befund 4). Die folgende ursprüngliche Prüfung und die
Hardware-Testnotizen dokumentieren den vorherigen Stand; ihre Aussagen zu
Transaktionspflicht, Bild-Cache und fehlenden Übersetzungen sind damit überholt.

## Ursprüngliche Prüfung

Geprüfter Stand: `e33f44f`, Branch `feat/device-activation-takeover`.
Datum: 14. September 2026.

Ergebnis: **Vor einem Deployment sind Korrekturen erforderlich.**
117 Tests ausgeführt: 112 bestanden, 5 fehlgeschlagen. Vier neue Regressionstests
reproduzieren funktionale Probleme; die breitere Testsuite findet zusätzlich
fehlende niederländische Übersetzungen. Produktionscode wurde bei dieser Prüfung
nicht geändert. Die neuen Regressionstests sind absichtlich noch rot.

## 1. P1 – Die neue Organisation kann alte Upload-Logs sehen

Nach erfolgreicher Übernahme wird für die neue Organisation ein neuer
Datenbank-Geräteeintrag erstellt. `getDeviceUploadLogs` sucht jedoch nach
Datenbank-ID **oder Seriennummer**. Die Seriennummer bleibt beim Wechsel gleich.
Der Integrationstest erhält deshalb einen Logeintrag des Vorbesitzers inklusive
Paper-ID und der im Test hinterlegten privaten Dashboard-URL zurück.

Betroffen: `packages/paperlesspaper-api/src/devicesLogs/devicesLogs.service.ts:90`.

Korrektur: Nutzerseitige Logs auf die konkrete Gerätezuordnung begrenzen.
Historische Logs ohne Datenbank-ID dürfen nicht ungeprüft über die Seriennummer
der neuen Organisation zugänglich werden. Das Löschen der Papers ist dafür weder
nötig noch vorgesehen.

## 2. Akzeptiertes Wiederherstellungsverhalten – Erneuter Start kann einen Reset auslösen

Nach Rücksprache darf dieser Fall vorerst durch erneutes Registrieren behoben
werden. Er ist damit kein priorisierter Änderungsauftrag; die folgenden
technischen Auswirkungen bleiben bestehen.

Reproduktion: IoT bestätigt die Aktivierung für die Zielorganisation, der erste
MongoDB-Insert schlägt fehl. Beim erneuten Start mit `enable:true` ist das Gerät
aktiv, hat aber noch keinen lokalen Eintrag. Die Orphan-Reparatur ruft deshalb
`reset:true` auf, obwohl hier ein unterbrochener Aktivierungsabschluss vorliegt.
Der Test bestätigt den Reset-Aufruf. Dessen Bild-/WLAN-Folgen stammen aus Daniels
API-Dokumentation und wurden nicht an echter Hardware ausgeführt.

Betroffen: `packages/paperlesspaper-api/src/devices/deviceRegistration.service.ts:138`.

Korrektur: Echte verwaiste Geräte von laufenden beziehungsweise unterbrochenen
Aktivierungsversuchen unterscheiden. Einen bekannten bestätigten Versuch mit
frischer Organisationsprüfung fertig speichern, statt ihn beim Wiederholen
zurückzusetzen. Die vorgesehene Reparatur echter Orphans muss erhalten bleiben.

## 3. P2 – Alter Bild-Cache kann den ersten Upload verhindern

Der eigene Cache unter `ePaperDeviceImages/<Seriennummer>.png` gehört zur
Seriennummer und wird im Aktivierungsabschluss nicht ungültig gemacht. Das ist
ein anderer Pfad als die in Daniels Dokumentation genannten `epdPicture-*`-Bilder.
Ein Test mit neuer Geräte-ID und einem passenden alten Cache-Bild erhält
`skippedUpload:true`; es erfolgt kein IoT-Upload. Nach einer Übernahme mit
gelöschtem IoT-Bild kann das Display deshalb leer beziehungsweise zurückgesetzt
bleiben, obwohl das erste Bild gesendet werden sollte.

Betroffen: `packages/paperlesspaper-api/src/iotdevice/iotdevice.service.ts:581`.

Korrektur: Den Cache an die konkrete Gerätezuordnung binden oder ihn beim
Besitzerwechsel zuverlässig invalidieren. Der erste Upload nach Übernahme darf
nicht aufgrund eines Bilds aus der vorherigen Zuordnung übersprungen werden.
Ein normaler WLAN-Wechsel darf diese Bereinigung nicht auslösen.

## 4. P2 – Ein hängender HTTP-Request umgeht das Fünf-Minuten-Limit

Der Test startet die Aktivierung, lässt den nächsten Polling-Request dauerhaft
offen und stellt die Uhr auf 304 Sekunden vor. Der Countdown steht bei null,
der Status bleibt dennoch `pending`. Die Ablaufprüfung erfolgt erst nach der
Antwort beziehungsweise dem Fehler des Requests. Auch die verwendete
`fetchBaseQuery` hat keinen eigenen konfigurierten Timeout.

Betroffen: `packages/paperlesspaper-web/src/helpers/devices/useDeviceActivation.ts:66`.

Korrektur: Unabhängige Frist mit Request-Abbruch und Schutz vor verspäteten
Antworten. Bei unklarem Netzwerkzustand keinen bestätigten IoT-Timeout behaupten;
stattdessen eine verständliche Verbindungsfehlermeldung anbieten.

## 5. P3 – Zwei neue Texte fehlen auf Niederländisch

Der vorhandene Übersetzungs-Audit scheitert an den neuen Texten für den
Tastendruck und die Zeitüberschreitung. Englisch und Deutsch sind vorhanden.
Die Anwendung fällt für diese Texte auf Englisch zurück.

## Erfolgreich geprüft

- Kein Reset beim regulären Start einer Übernahme mit bestehender Zuordnung.
- Kein Eigentümerwechsel allein aufgrund von `success` ohne Key.
- Papers bleiben bei erfolgreicher Übernahme erhalten und werden nur getrennt.
- MongoDB-Rollback bei einem Speicherfehler erhält die vorherige Zuordnung und
  Paper-Verknüpfungen; reines Polling kann den Abschluss anschließend wiederholen.
- Wiederholte erfolgreiche Abschlüsse erzeugen kein zweites Gerät.
- WLAN-Daten werden erst nach bestätigtem Aktivierungsstart geschrieben.
- Normaler WLAN-Wechsel startet im Web-Code keinen Claim oder Reset.
- Abbruch und Organisationswechsel ignorieren verspätete Aktivierungsantworten.
- Bestehende Autorisierung und Handler anderer Gerätefamilien bleiben erhalten.

## Testumfang und Grenzen

MongoDB mit echtem Gerätemodell in einem isolierten lokalen Replica Set; IoT,
Auth0, S3 und BLE wurden simuliert. Keine echten Geräte, Produktionsdatenbanken
oder Produktions-APIs wurden verändert.

Die bekannte Bildlöschung bei normalem WLAN-Wechsel laut `act:0`-Dokumentation
und die mögliche versehentliche Übernahmebestätigung durch einen Tastendruck
bleiben gesonderte IoT-/Firmware-Punkte. Konkurrierende Claims von B und C waren
wie vereinbart nicht Gegenstand dieser Prüfung.

Ausgeführte Suites: sämtliche Web-Unit-Tests sowie API-Tests für Registrierung,
Deaktivierung, Upload-Logs, Bild-Uploads und Registrierungspersistenz.

## Echter Gerätetest – Zwischenstand 14. September 2026

Gerät: `epd7-e4b0634f3354`, bestehende Zielorganisation `paperlesspaper`.
Die neue Registrierungslogik läuft gegen eine isolierte lokale MongoDB mit
Replica Set; ausschließlich die IoT-Aktivierungsaufrufe gehen an das echte
Gerät. Die produktive MongoDB wird im Test ausschließlich gelesen.

- Ausgangslage: IoT `reset`, kein Key; produktiv existieren die Gerätezuordnung
  und 11 damit verknüpfte Papers.
- 17:14 Uhr: `enable:true, reset:false` startet den Claim; Antwort `pending`.
  Nur in der lokalen Testdatenbank wird die veraltete Zuordnung entfernt und
  werden die 11 Papers davon getrennt. Alle Paper-Dokumente bleiben erhalten.
- Nach dem vom Nutzer bestätigten kurzen Tastendruck bleibt IoT `pending`.
  Der letzte Gerätekontakt ändert sich nicht.
- 17:19 Uhr: IoT antwortet `timeout` ohne Key. Die neue Logik gibt korrekt
  `registrationCompleted:false` zurück und legt kein lokales Gerät an.
- Eine Bluetooth-Suche über Chrome findet den exakt benannten Rahmen bislang
  nicht. WLAN-Zugangsdaten wurden noch nicht übertragen. Der Displaytext ist
  beim Nutzer angefragt.
- Nach jedem API-Testschritt sind die originale produktive Gerätezuordnung
  und dieselben 11 Paper-Verknüpfungen unverändert. Kein API-Reset ausgeführt.

Der erfolgreich beendete Testprozess bestätigt diese Zwischenzustände und den
Schutz der Produktionsdaten, **keine erfolgreiche Hardwareaktivierung**.
Erfolgsabschluss, Wiederholung nach Erfolg, Organisationsübernahme und normaler
WLAN-Wechsel sind an diesem Gerät noch offen. Die lokale Bluetooth-Hilfsseite
prüft nur den Transport; sie ersetzt keinen vollständigen Test der Weboberfläche.

Zusätzlich wurde bei der produktiven MongoDB per `hello` weder ein Replica Set
noch ein mongos festgestellt. Die neue Registrierungslogik benötigt derzeit
Transaktionen und ist damit für diese Produktionskonfiguration noch nicht
geeignet. Der lokale Replica-Set-Test hebt diese Einschränkung nicht auf.

### Korrektur der Zielorganisation (17:20 Uhr)

Der Nutzer hat als Ziel `6a5ca57c781f5d50017b9cc2` festgelegt; die Organisation
existiert unter dem Namen `AvatarMediKi paperlesspaper`. Der vorherige Versuch
betraf die bisherige Organisation und prüfte deshalb noch keine Übernahme.
Der manuelle Test trennt jetzt explizit Quell- und Zielorganisation und verwendet
für die Übernahme eine neue isolierte lokale Datenbank. Der Preflight für das
korrigierte Ziel liefert `available:true, mode:takeover`; IoT meldet weiterhin
`timeout` ohne Key. Ein neuer Claim wurde bei diesem Preflight nicht gestartet.
Die produktive Quellzuordnung und alle 11 Paper-Verknüpfungen sind unverändert.

### WLAN-Onboarding für die korrigierte Zielorganisation (17:22–17:24 Uhr)

Nach der Nutzerangabe „Ich schlafe …“ wurde der Claim um 17:22 Uhr mit
`enable:true, reset:false` für AvatarMediKi paperlesspaper gestartet. IoT antwortet
`pending` ohne Key. Die lokale Testdatenbank trennt wegen des zuvor inaktiven
IoT-Zustands die alte Zuordnung; die produktiven Verknüpfungen bleiben bestehen.

Nach einem weiteren kurzen Tastendruck meldet der Nutzer „WLAN verbinden“.
Chrome verbindet sich anschließend per BLE mit exakt `epd7-e4b0634f3354`.
Um 17:24 Uhr wurden WLAN-Name und Passwort über die vorhandenen SSID-/Passwort-
Characteristics übertragen. Eine unmittelbar vorherige echte API-Abfrage
bestätigt `pending` für die Zielorganisation. Die Hilfsseite erlaubt die
Übertragung nur mit einer maximal 30 Sekunden alten Bestätigung und leert
anschließend das Passwortfeld. Die BLE-Schreiboperationen wurden bestätigt;
der IoT-Erfolgsabschluss wird separat geprüft. Keine Zugangsdaten im Bericht.

### Bestätigter Hardwareabschluss (17:24–17:25 Uhr)

- IoT liefert `success` und einen Key für AvatarMediKi paperlesspaper. Der Nutzer
  bestätigt auf dem Display „Aktivierung abgeschlossen“.
- Die neue Registrierungslogik antwortet `registrationCompleted:true` und legt
  genau ein Gerät in der isolierten lokalen Datenbank an. Die 11 lokalen
  Paper-Dokumente bleiben erhalten und von der alten Zuordnung getrennt.
- Ein erneuter Start (`enable:true, reset:false`) liefert sofort denselben
  erfolgreichen Abschluss und dieselbe lokale Geräte-ID; kein Reset und kein
  doppeltes Gerät.
- Eine reine Statusabfrage für die alte Organisation liefert ebenfalls
  `success`, jedoch **keinen Key**. Die Zielorganisation erhält den Key. Damit
  ist der zentrale Unterschied zwischen Aktivierungsstatus und Eigentumsnachweis
  an der echten API bestätigt.
- Die produktive Web-Gerätezuordnung und ihre 11 Paper-Verknüpfungen bleiben
  unverändert in der alten Organisation. IoT gehört jetzt hingegen zur neuen
  Organisation. Der produktive Web-Abschluss ist ausdrücklich noch offen;
  die isolierte erfolgreiche MongoDB-Transaktion ist kein Produktionsabschluss.

Nicht an dieser Hardware getestet: Übernahme eines zu Beginn noch aktiven
Altgeräts (dieses war initial bereits inaktiv), Timeout einer solchen Übernahme
mit Rückkehr zum aktiven Vorbesitzer und gewöhnlicher WLAN-Wechsel nach Erfolg.
Auch die vollständige Weboberfläche wurde nicht durchlaufen; getestet wurden
reale BLE-Übertragung, IoT und der neue Service mit lokaler Datenbank.
