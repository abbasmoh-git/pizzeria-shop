# Pizzeria Pinocchio Olfen – Website & Bestellsystem

Dieses README ist die Betriebs- und Entwicklerdokumentation für das aktuelle Bestellsystem der Pizzeria Pinocchio Olfen.

> **Wichtig:** Niemals echte Passwörter, Stripe-Secrets, Brevo-API-Keys oder Kundendaten in dieses README eintragen. Geheimnisse gehören ausschließlich in `backend/.env`.

## 1. Systemüberblick

Das System besteht aus vier Hauptteilen:

- **Frontend:** Website, Warenkorb und Bestelloberfläche für Kunden.
- **Backend:** FastAPI-Anwendung in `backend/main.py`. Sie verarbeitet Bestellungen, Preise, Öffnungszeiten, Liefergebiet, Zahlungen, E-Mails und Statusänderungen.
- **Datenbank:** SQLite-Datei `backend/bestellungen.db`.
- **Restaurant-Dashboard:** `dashboard.html` für eingehende Bestellungen, ETA, Status, Druck und Bestellalarm.

Externe Dienste:

- **Stripe** – Onlinezahlung.
- **Brevo** – Bestell- und ETA-E-Mails.
- **OpenStreetMap/Nominatim** – Adressprüfung und Geocoding.

Vereinfachter Ablauf:

```text
Kunde
  |
  v
Frontend (index.html / script.js)
  |
  v
FastAPI Backend (backend/main.py)
  |----> SQLite (backend/bestellungen.db)
  |----> Stripe
  |----> Brevo
  `----> OpenStreetMap / Nominatim

Restaurant
  |
  v
dashboard.html
  |
  v
FastAPI Backend
```

## 2. Wichtige Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Hauptseite und Bestelloberfläche |
| `script.js` | Warenkorb, Bestellablauf und Frontend-Logik |
| `style.css` | Design der Website |
| `config.js` | Zentrale Backend-Adresse |
| `verfolgen.html` | Kundenansicht für Bestellstatus und ETA |
| `success.html` | Erfolgsseite nach Stripe-Zahlung |
| `dashboard.html` | Restaurant-Dashboard |
| `impressum.html` | Impressum |
| `datenschutz.html` | Datenschutzerklärung |
| `backend/main.py` | Gesamte Backend-Logik |
| `backend/bestellungen.db` | SQLite-Datenbank |
| `backend/.env` | Geheimnisse und lokale Konfiguration |
| `backend/requirements.txt` | Python-Abhängigkeiten |
| `.gitignore` | Verhindert u. a. das Committen von `.env` und Datenbank |

## 3. Lokaler Start

### Backend

Voraussetzung: Python und `pip`.

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

Standardmäßig läuft das Backend dann unter:

```text
http://127.0.0.1:8000
```

Nach Änderungen an `backend/.env` das Backend neu starten, damit die neuen Werte geladen werden.

### Frontend

Das Frontend über einen lokalen Webserver starten, zum Beispiel über VS Code Live Server.

Die Backend-Adresse wird zentral in `config.js` festgelegt:

```js
const BACKEND_URL = "http://127.0.0.1:8000";
```

Beim späteren Livegang muss dort die öffentliche Backend-Adresse eingetragen werden.

## 4. `.env` – geheime Konfiguration

Die Datei `backend/.env` enthält sensible Daten und darf nicht veröffentlicht werden.

Benötigte Variablen:

```dotenv
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
SITE_URL=
DASHBOARD_USER=
DASHBOARD_PASSWORD=
BREVO_API_KEY=
MAIL_ABSENDER_ADRESSE=
MAIL_ABSENDER_NAME=
```

Bedeutung:

| Variable | Zweck |
|---|---|
| `STRIPE_SECRET_KEY` | Serverzugriff auf Stripe |
| `STRIPE_WEBHOOK_SECRET` | Verifiziert Stripe-Webhook-Nachrichten |
| `SITE_URL` | Adresse des Frontends |
| `DASHBOARD_USER` | Benutzername Restaurant-Dashboard |
| `DASHBOARD_PASSWORD` | Passwort Restaurant-Dashboard |
| `BREVO_API_KEY` | Serverzugriff auf Brevo |
| `MAIL_ABSENDER_ADRESSE` | Absenderadresse der Bestellmails |
| `MAIL_ABSENDER_NAME` | Sichtbarer Absendername |

**Regel:** Keys und Passwörter nur hier ändern, nicht hart in HTML oder JavaScript eintragen.

## 5. Accounts und externe Dienste

### GitHub

Zweck: Quellcode und Versionsverwaltung.

Repository der aktuellen Projektkonfiguration:

```text
abbasmoh-git/pizzeria-shop
```

`.env` und `backend/bestellungen.db` sind über `.gitignore` ausgeschlossen.

### Stripe

Zweck: Onlinezahlungen.

Der aktuelle Projektstand verwendet einen **Stripe-Testschlüssel**. Damit werden keine echten Kundenzahlungen durchgeführt.

Für einen späteren Livegang werden benötigt:

1. Stripe-Live-Schlüssel.
2. Ein korrekt eingerichteter Webhook.
3. Der echte Webhook-Secret in `STRIPE_WEBHOOK_SECRET`.
4. Ein vollständiger Test des Zahlungsablaufs.

### Brevo

Zweck: Transaktionale E-Mails.

Aktuell werden darüber Bestellbestätigungen und ETA-Bestätigungen verschickt.

Der API-Key liegt ausschließlich in `backend/.env`.

Aktueller Absender in dieser Entwicklungsfassung:

```text
Pizzeria Pinocchio Olfen <maximabbas@gmx.de>
```

Für den Livebetrieb ist eine eigene Domain-Mailadresse mit sauber eingerichteter Domain-Authentifizierung empfehlenswert, um die Zustellbarkeit zu verbessern.

### OpenStreetMap / Nominatim

Zweck: Prüfung und Geocoding von Lieferadressen.

Für die aktuelle Integration wird kein eigener Login oder API-Key im Projekt gespeichert.

## 6. Dashboard

Datei:

```text
dashboard.html
```

Der Login wird vom eigenen Backend kontrolliert. Benutzername und Passwort stehen in `backend/.env`.

Funktionen umfassen:

- eingegangene Bestellungen anzeigen,
- voraussichtliche Liefer-/Abholzeit setzen,
- Bestellstatus ändern,
- Bestellbon drucken,
- Bestellalarm.

Nach Änderung von `DASHBOARD_USER` oder `DASHBOARD_PASSWORD` muss das Backend neu gestartet werden.

## 7. Datenbank und Backups

Datenbank:

```text
backend/bestellungen.db
```

SQLite benötigt in dieser Konfiguration keinen separaten Datenbankaccount und kein Datenbankpasswort.

Die Datei enthält Bestell- und Kundendaten. Sie darf deshalb nicht öffentlich veröffentlicht oder in Git eingecheckt werden.

### Backup

Bei lokalem Betrieb kann ein Backup erstellt werden, indem das Backend beendet und anschließend `backend/bestellungen.db` an einen sicheren Ort kopiert wird.

Vor größeren Änderungen am Backend oder an der Datenbank immer ein Backup anlegen.

## 8. Öffnungszeiten

Die Öffnungszeiten werden zentral im Backend verwaltet.

Aktuelle Konfiguration:

| Tag | Öffnungszeit |
|---|---|
| Montag | geschlossen |
| Dienstag | 12:00–21:00 |
| Mittwoch | 12:00–21:00 |
| Donnerstag | 12:00–21:00 |
| Freitag | 12:00–21:00 |
| Samstag | 12:00–21:00 |
| Sonntag | 12:00–21:00 |

Änderungen an der zentralen Konfiguration in `backend/main.py` durchführen.

## 9. Liefergebiet und Mindestbestellwert

Aktuelle Backend-Konfiguration:

- maximaler Lieferradius: **7,5 km Luftlinie**
- **Olfen:** Mindestbestellwert 20 €, Liefergebühr 1,00 €
- **außerhalb Olfen innerhalb des Liefergebiets:** Mindestbestellwert 35 €, Liefergebühr 2,50 €

Der Kunde wählt die Zone nicht selbst. Das Backend bestimmt sie anhand der Lieferadresse.

Adressprüfung und Entfernung werden serverseitig kontrolliert.

## 10. E-Mail-Ablauf

Aktuell vorgesehen:

```text
Bestellung aufgegeben
        |
        v
Bestellbestätigung per E-Mail
        |
        v
Restaurant setzt ETA
        |
        v
ETA-Bestätigung per E-Mail
```

Die Kunden-E-Mail wird serverseitig gespeichert.

Auf öffentlichen Statusseiten darf nicht unnötig die vollständige E-Mail-Adresse ausgegeben werden. Für Hinweise wird eine maskierte Darstellung wie `m***@gmail.com` verwendet.

## 11. Bestellablauf

Vorgesehener Ablauf:

1. Kunde legt Produkte in den Warenkorb.
2. Kunde wählt Lieferung oder Abholung.
3. Bei Lieferung wird die Adresse geprüft.
4. Öffnungszeiten, Liefergebiet, Mindestbestellwert und Preise werden vom Backend kontrolliert.
5. Bestellung wird gespeichert.
6. Restaurant sieht die Bestellung im Dashboard.
7. Bestellalarm macht auf eine neue unbestätigte Bestellung aufmerksam.
8. Restaurant setzt die ETA.
9. Kunde sieht den aktualisierten Status und erhält die ETA per E-Mail.
10. Bestellung kann gedruckt und später als fertig markiert werden.

## 12. Bekannte offene Punkte

Diese Punkte sind in der aktuellen Entwicklungsfassung noch nicht als abgeschlossen anzusehen:

- **Bestellalarm:** Code ist vorhanden, funktioniert im realen Ablauf derzeit jedoch nicht zuverlässig.
- **E-Mail-Hinweis:** Code für die Kundeninformation ist vorhanden, wurde im realen Ablauf aber zuletzt nicht zuverlässig sichtbar.
- **Stripe Webhook:** noch nicht für den echten Livebetrieb eingerichtet.
- **Stripe:** aktuell Testmodus.
- **Hosting:** Frontend und Backend laufen aktuell lokal; `config.js` zeigt auf `127.0.0.1:8000`.
- **E-Mail-Zustellbarkeit:** GMX-Absender kann im Spam landen; vor Livebetrieb eigene Domain-Mail und Authentifizierung prüfen.
- **Serverkonfiguration:** vor Veröffentlichung noch einmal gezielt für den Livebetrieb prüfen.

Diese Punkte nicht als „fertig“ dokumentieren, bevor sie in einem echten End-to-End-Test bestätigt wurden.

## 13. End-to-End-Test vor Veröffentlichung

Vor einem Livegang mindestens folgenden Ablauf vollständig testen:

```text
Website öffnen
→ Liefer-/Abholbestellung erstellen
→ Bestellung erscheint im Dashboard
→ Alarm ertönt
→ erste Kundenmail kommt an
→ ETA im Dashboard setzen
→ Tracking aktualisiert sich
→ zweite Kundenmail kommt an
→ Bon drucken
→ Bestellung fertig markieren
```

Danach zusätzlich einen vollständigen Stripe-Live-Test nach Einrichtung des Live-Webhooks durchführen.

## 14. Wenn sich Zugangsdaten ändern

| Änderung | Was ist zu tun? |
|---|---|
| Dashboard-Passwort | `DASHBOARD_PASSWORD` in `.env` ändern, Backend neu starten |
| Dashboard-Benutzer | `DASHBOARD_USER` ändern, Backend neu starten |
| Brevo API-Key | `BREVO_API_KEY` ändern, Backend neu starten |
| Mail-Absender | Absender bei Brevo einrichten/verifizieren und `.env` ändern |
| Stripe-Key | `STRIPE_SECRET_KEY` ändern, Backend neu starten |
| Stripe-Webhook | `STRIPE_WEBHOOK_SECRET` aktualisieren |
| Backend-Domain | `config.js` aktualisieren |
| Frontend-Domain | `SITE_URL` aktualisieren |
| Telefonnummer eines externen Accounts | direkt im jeweiligen Dienst aktualisieren; sie gehört nicht automatisch zum Website-Code |

## 15. Sicherheitsregeln für die Projektpflege

- `.env` niemals an Kunden oder öffentlich weitergeben.
- API-Keys niemals in `script.js`, HTML oder `config.js` eintragen.
- `bestellungen.db` nicht auf GitHub veröffentlichen.
- Vor größeren Änderungen Datenbank sichern.
- Änderungen zuerst lokal testen.
- Nach Änderungen an `.env` Backend neu starten.
- Vor Livebetrieb Test- durch Live-Zugangsdaten ersetzen und anschließend den kompletten Bestellablauf erneut testen.
- Echte Secrets nicht in Screenshots, README-Dateien oder Support-Nachrichten kopieren.

## 16. Kurzreferenz

Wenn später unklar ist, wo etwas liegt:

```text
Website                  -> index.html
Frontend-Logik           -> script.js
Design                   -> style.css
Backend-Adresse          -> config.js
Tracking                 -> verfolgen.html
Stripe-Erfolg            -> success.html
Restaurant-Dashboard     -> dashboard.html
Backend / Geschäftslogik -> backend/main.py
Bestellungen             -> backend/bestellungen.db
Passwörter / API-Keys    -> backend/.env
Python-Pakete            -> backend/requirements.txt
```

---

**Projekt:** Pizzeria Pinocchio Olfen  
**Dokumentationsstand:** 19.09.2026  
**Status:** lokale Entwicklungsfassung, noch nicht als Livebetrieb freigegeben
