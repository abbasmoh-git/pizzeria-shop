from fastapi import FastAPI, Request, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel
from typing import List, Optional
import os
import json
import re
import sqlite3
import secrets
import uuid
import requests
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
import stripe
from dotenv import load_dotenv

load_dotenv()  # Liest die .env Datei im gleichen Ordner

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ===== STRIPE KONFIGURATION =====
# Trage hier deinen Stripe Secret Key ein (aus https://dashboard.stripe.com/apikeys)
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "whsec_HIER_WEBHOOK_SECRET_EINTRAGEN")
# URL deiner Webseite (für Weiterleitung nach Zahlung)
SITE_URL = os.getenv("SITE_URL", "http://localhost:5500")

# ===== DASHBOARD-ZUGANG (fürs Bestell-Dashboard) =====
DASHBOARD_USER = os.getenv("DASHBOARD_USER", "pinocchio")
DASHBOARD_PASSWORD = os.getenv("DASHBOARD_PASSWORD", "bitte_in_env_aendern")

# ===== E-MAIL (Brevo, transaktionale E-Mails) =====
# Zugangsdaten kommen ausschließlich aus der .env / den Server-Umgebungsvariablen.
# Es liegen niemals Zugangsdaten, SMTP-Passwörter oder API-Keys im Frontend.
BREVO_API_KEY = os.getenv("BREVO_API_KEY", "")
MAIL_ABSENDER_ADRESSE = os.getenv("MAIL_ABSENDER_ADRESSE", "")
MAIL_ABSENDER_NAME = os.getenv("MAIL_ABSENDER_NAME", "Pizzeria Pinocchio")

security = HTTPBasic()


def pruefe_dashboard_login(credentials: HTTPBasicCredentials = Depends(security)):
    richtiger_user = secrets.compare_digest(credentials.username, DASHBOARD_USER)
    richtiges_passwort = secrets.compare_digest(credentials.password, DASHBOARD_PASSWORD)
    if not (richtiger_user and richtiges_passwort):
        raise HTTPException(
            status_code=401,
            detail="Falscher Benutzername oder Passwort",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username


# ===== DATENBANK (SQLite, eine einzelne Datei neben main.py) =====
DB_PFAD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bestellungen.db")


def get_db():
    conn = sqlite3.connect(DB_PFAD)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS bestellungen (
            id TEXT PRIMARY KEY,
            erstellt_um TEXT NOT NULL,
            name TEXT NOT NULL,
            telefon TEXT NOT NULL,
            adresse TEXT NOT NULL,
            hinweis TEXT,
            artikel_json TEXT NOT NULL,
            gesamt REAL NOT NULL,
            zahlung TEXT NOT NULL,
            status TEXT NOT NULL,
            eta_minuten INTEGER,
            eta_gesetzt_um TEXT
        )
    """)
    # Migration: bestellart wurde nachträglich ergänzt. Bestehende Datenbanken
    # (vor dieser Änderung angelegt) bekommen die Spalte per ALTER TABLE dazu,
    # ohne dass vorhandene Bestellungen verloren gehen.
    vorhandene_spalten = {row["name"] for row in conn.execute("PRAGMA table_info(bestellungen)")}
    if "bestellart" not in vorhandene_spalten:
        conn.execute("ALTER TABLE bestellungen ADD COLUMN bestellart TEXT NOT NULL DEFAULT 'lieferung'")
    # Migration: E-Mail-Adresse wurde nachträglich ergänzt (für Bestell- und
    # ETA-Bestätigungsmails). Bestehende Datenbanken bekommen die Spalte per
    # ALTER TABLE dazu, ohne dass vorhandene Bestellungen verloren gehen.
    if "email" not in vorhandene_spalten:
        conn.execute("ALTER TABLE bestellungen ADD COLUMN email TEXT NOT NULL DEFAULT ''")
    conn.commit()
    conn.close()


init_db()


def neue_bestellungs_id() -> str:
    return uuid.uuid4().hex[:8]


def jetzt_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def bestellung_speichern(bestellung: "Bestellung", status: str) -> str:
    order_id = neue_bestellungs_id()
    conn = get_db()
    conn.execute(
        """INSERT INTO bestellungen
           (id, erstellt_um, name, telefon, adresse, hinweis, artikel_json, gesamt, zahlung, status, bestellart, email)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            order_id,
            jetzt_iso(),
            bestellung.name,
            bestellung.telefon,
            bestellung.adresse or "",
            bestellung.hinweis or "",
            json.dumps([a.dict() for a in bestellung.artikel], ensure_ascii=False),
            bestellung.gesamt,
            bestellung.zahlung or "bar",
            status,
            bestellung.bestellart or "lieferung",
            bestellung.email or "",
        ),
    )
    conn.commit()
    conn.close()
    return order_id


class Artikel(BaseModel):
    name: str
    preis: float

class Bestellung(BaseModel):
    name: str
    telefon: str
    email: str
    # Bei Abholung wird keine Lieferadresse benötigt, deshalb optional.
    adresse: Optional[str] = ""
    hinweis: Optional[str] = ""
    artikel: List[Artikel]
    gesamt: float
    zahlung: Optional[str] = "bar"
    # "lieferung" oder "abholung"
    bestellart: Optional[str] = "lieferung"


class EtaEingabe(BaseModel):
    eta_minuten: int


EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def bestellart_fehler(bestellung: "Bestellung") -> Optional[str]:
    """Prüft, ob Bestellart, Adresse und E-Mail zusammenpassen. Gibt eine
    Fehlermeldung zurück, oder None wenn alles in Ordnung ist."""
    if bestellung.bestellart not in ("lieferung", "abholung"):
        return "Ungültige Bestellart."
    if bestellung.bestellart == "lieferung" and not (bestellung.adresse or "").strip():
        return "Für eine Lieferung wird eine Adresse benötigt."
    if not EMAIL_REGEX.match((bestellung.email or "").strip()):
        return "Bitte gib eine gültige E-Mail-Adresse an."
    return None


# ===== ÖFFNUNGSZEITEN (einzige Quelle der Wahrheit für die ganze Anwendung) =====
# Wird sowohl serverseitig (Bestellungen ablehnen) als auch für die Anzeige im
# Frontend über /oeffnungszeiten verwendet - so steht die Konfiguration nur
# an dieser einen Stelle.
# 0 = Montag ... 6 = Sonntag. None = Ruhetag. Zeiten als "HH:MM".
OEFFNUNGSZEITEN = {
    0: None,                # Montag: Ruhetag
    1: ("12:00", "21:00"),  # Dienstag
    2: ("12:00", "21:00"),  # Mittwoch
    3: ("12:00", "21:00"),  # Donnerstag
    4: ("12:00", "21:00"),  # Freitag
    5: ("12:00", "21:00"),  # Samstag
    6: ("12:00", "21:00"),  # Sonntag
}
BERLIN_TZ = ZoneInfo("Europe/Berlin")


def oeffnungszeiten_text() -> str:
    return "Dienstag bis Sonntag, 12:00–21:00 Uhr. Montags Ruhetag."


def ist_geoeffnet(zeitpunkt: Optional[datetime] = None) -> bool:
    zeitpunkt = zeitpunkt or datetime.now(BERLIN_TZ)
    zeiten = OEFFNUNGSZEITEN.get(zeitpunkt.weekday())
    if zeiten is None:
        return False
    start_std, start_min = (int(x) for x in zeiten[0].split(":"))
    ende_std, ende_min = (int(x) for x in zeiten[1].split(":"))
    start = zeitpunkt.replace(hour=start_std, minute=start_min, second=0, microsecond=0)
    ende = zeitpunkt.replace(hour=ende_std, minute=ende_min, second=0, microsecond=0)
    return start <= zeitpunkt <= ende


def pruefe_oeffnungszeiten() -> Optional[str]:
    if not ist_geoeffnet():
        return f"Wir haben aktuell geschlossen. Öffnungszeiten: {oeffnungszeiten_text()}"
    return None


@app.get("/oeffnungszeiten")
def oeffnungszeiten_status():
    geoeffnet = ist_geoeffnet()
    return {
        "geoeffnet": geoeffnet,
        "text": "Aktuell geöffnet." if geoeffnet else f"Wir haben aktuell geschlossen. Öffnungszeiten: {oeffnungszeiten_text()}",
    }


# ===== LIEFERGEBIET & ADRESSPRÜFUNG =====
# Die Zone (und damit Lieferkosten/Mindestbestellwert) wird automatisch anhand
# der Adresse bestimmt - niemals vom Kunden ausgewählt, und dem Kunden auch
# nie als "Innerorts"/"Außerorts" angezeigt.
RESTAURANT_LAT = 51.7089
RESTAURANT_LON = 7.3753
MAX_LIEFERRADIUS_KM = 7.5

LIEFERZONEN = {
    "olfen":     {"mindest": 20.0, "kosten": 1.0},
    "erweitert": {"mindest": 35.0, "kosten": 2.5},
}


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    from math import radians, sin, cos, asin, sqrt
    R = 6371
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return R * 2 * asin(sqrt(a))


def geocodiere_adresse(adresse_text: str):
    """Fragt die Adresse serverseitig bei OpenStreetMap/Nominatim ab -
    unabhängig davon, was das Frontend behauptet. So wird sichergestellt,
    dass die Adresse wirklich existiert (eine erfundene Adresse wie
    "Kackwurst" liefert hier keinen Treffer) und niemand der Anfrage vom
    Browser aus vertraut werden muss."""
    adresse_text = (adresse_text or "").strip()
    if not adresse_text:
        return None
    try:
        res = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "format": "json",
                "q": adresse_text,
                "countrycodes": "de",
                "limit": 1,
                "addressdetails": 1,
            },
            headers={"User-Agent": "PizzeriaPinocchioBestellsystem/1.0 (abbas.m@aol.de)"},
            timeout=6,
        )
        daten = res.json()
    except Exception as e:
        print("Geokodierung fehlgeschlagen:", e)
        return None

    if not daten:
        return None

    treffer = daten[0]
    addr = treffer.get("address", {})
    try:
        return {
            "lat": float(treffer["lat"]),
            "lon": float(treffer["lon"]),
            "ort": addr.get("city") or addr.get("town") or addr.get("village") or addr.get("municipality") or "",
            "plz": addr.get("postcode") or "",
        }
    except (KeyError, ValueError):
        return None


def liefergebiet_bestimmen(adresse_text: str) -> Optional[str]:
    """Prüft die Adresse serverseitig und bestimmt automatisch die Lieferzone.
    Gibt None zurück, wenn die Adresse nicht auffindbar ist oder außerhalb
    unseres Liefergebiets liegt (genaue Radius-/Zonenlogik kann später
    verfeinert werden - hier zählt vor allem: echte, geokodierbare Adresse
    innerhalb des Radius)."""
    geo = geocodiere_adresse(adresse_text)
    if geo is None:
        return None
    distanz = haversine_km(RESTAURANT_LAT, RESTAURANT_LON, geo["lat"], geo["lon"])
    if distanz > MAX_LIEFERRADIUS_KM:
        return None
    ist_olfen = geo["plz"] == "59399" or "olfen" in geo["ort"].lower()
    return "olfen" if ist_olfen else "erweitert"


def berechne_bestellung(bestellung: "Bestellung"):
    """Zentrale Prüfung für /bestellen und /checkout-session: Öffnungszeiten,
    Bestellart/Adresse/E-Mail, Artikelpreise und - bei Lieferung - serverseitig
    bestimmte Lieferzone samt Lieferkosten/Mindestbestellwert. Gibt
    (finale_artikel, endsumme, fehler) zurück; fehler ist None, wenn alles in
    Ordnung ist."""
    fehler = pruefe_oeffnungszeiten()
    if fehler:
        return None, None, fehler

    fehler = bestellart_fehler(bestellung)
    if fehler:
        return None, None, fehler

    artikel_summe = 0.0
    for artikel in bestellung.artikel:
        if artikel.name not in PREISE:
            return None, None, "Unbekannter Artikel!"
        artikel_summe += PREISE[artikel.name]
    artikel_summe = round(artikel_summe, 2)

    if round(bestellung.gesamt, 2) != artikel_summe:
        return None, None, "Preis stimmt nicht!"

    finale_artikel = list(bestellung.artikel)
    lieferkosten = 0.0

    if bestellung.bestellart == "lieferung":
        zone = liefergebiet_bestimmen(bestellung.adresse)
        if zone is None:
            return None, None, (
                "Diese Adresse konnte nicht bestätigt werden oder liegt außerhalb "
                "unseres Liefergebiets. Bitte wähle eine Adresse aus den Vorschlägen aus."
            )
        zonendaten = LIEFERZONEN[zone]
        if artikel_summe < zonendaten["mindest"]:
            mindest_text = f"{zonendaten['mindest']:.2f}".replace(".", ",")
            return None, None, f"Mindestbestellwert für deine Adresse: {mindest_text} €"
        lieferkosten = zonendaten["kosten"]
        finale_artikel.append(Artikel(name="Lieferkosten", preis=lieferkosten))

    endsumme = round(artikel_summe + lieferkosten, 2)
    return finale_artikel, endsumme, None


# ===== E-MAIL-VERSAND =====
def sende_email(empfaenger: str, betreff: str, text: str) -> None:
    """Verschickt eine transaktionale E-Mail über die Brevo-API. Ein
    fehlgeschlagener Versand wird nur geloggt - eine Bestellung darf daran nie
    scheitern. Der API-Key kommt ausschließlich aus der Server-.env."""
    if not empfaenger:
        return
    if not BREVO_API_KEY or not MAIL_ABSENDER_ADRESSE:
        print("E-Mail nicht gesendet (BREVO_API_KEY/MAIL_ABSENDER_ADRESSE fehlt in .env):", betreff)
        return
    try:
        requests.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={
                "api-key": BREVO_API_KEY,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            json={
                "sender": {"name": MAIL_ABSENDER_NAME, "email": MAIL_ABSENDER_ADRESSE},
                "to": [{"email": empfaenger}],
                "subject": betreff,
                "textContent": text,
            },
            timeout=8,
        )
    except Exception as e:
        print("E-Mail-Versand fehlgeschlagen:", e)


def artikel_text_liste(artikel_liste) -> str:
    zeilen = []
    for a in artikel_liste:
        name = a["name"] if isinstance(a, dict) else a.name
        preis = a["preis"] if isinstance(a, dict) else a.preis
        preis_text = f"{preis:.2f}".replace(".", ",")
        zeilen.append(f"  - {name}: {preis_text} €")
    return "\n".join(zeilen)


def sende_bestellbestaetigung(empfaenger_email: str, name: str, order_id: str, bestellart: str, artikel_liste, gesamt: float) -> None:
    bestellart_text = "Abholung" if bestellart == "abholung" else "Lieferung"
    gesamt_text = f"{gesamt:.2f}".replace(".", ",")
    betreff = f"Deine Bestellung bei Pizzeria Pinocchio (#{order_id})"
    text = (
        f"Hallo {name},\n\n"
        f"vielen Dank für deine Bestellung bei Pizzeria Pinocchio!\n\n"
        f"Bestellnummer: {order_id}\n"
        f"Bestellart: {bestellart_text}\n\n"
        f"Deine Artikel:\n{artikel_text_liste(artikel_liste)}\n\n"
        f"Gesamt: {gesamt_text} €\n\n"
        f"Wir bestätigen dir die voraussichtliche {'Abholzeit' if bestellart == 'abholung' else 'Lieferzeit'} "
        f"in Kürze per E-Mail. Du kannst deine Bestellung außerdem jederzeit hier verfolgen:\n"
        f"{SITE_URL}/verfolgen.html?id={order_id}\n\n"
        f"Bei Fragen erreichst du uns unter 02595 7688.\n\n"
        f"Pizzeria Pinocchio"
    )
    sende_email(empfaenger_email, betreff, text)


def sende_eta_bestaetigung(empfaenger_email: str, name: str, order_id: str, bestellart: str, eta_minuten: int, fertig_um: datetime) -> None:
    """Schickt die zweite Bestätigungsmail, sobald das Restaurant die Zeit
    gesetzt hat. Der Haupttext folgt exakt dem vorgegebenen Wortlaut."""
    ist_abholung = bestellart == "abholung"
    uhrzeit_text = fertig_um.strftime("%H:%M")
    if ist_abholung:
        haupttext = (
            f"Ihre Bestellung wurde bestätigt. Voraussichtlich abholbereit in ca. "
            f"{eta_minuten} Minuten. Voraussichtlich abholbereit gegen {uhrzeit_text} Uhr."
        )
    else:
        haupttext = (
            f"Ihre Bestellung wurde bestätigt. Voraussichtliche Lieferzeit: ca. "
            f"{eta_minuten} Minuten. Voraussichtliche Lieferung gegen {uhrzeit_text} Uhr."
        )
    betreff = f"Deine Bestellung ist bestätigt (#{order_id})"
    text = (
        f"Hallo {name},\n\n"
        f"{haupttext}\n\n"
        f"Du kannst den Status auch jederzeit hier verfolgen:\n"
        f"{SITE_URL}/verfolgen.html?id={order_id}\n\n"
        f"Bei Fragen erreichst du uns unter 02595 7688.\n\n"
        f"Pizzeria Pinocchio"
    )
    sende_email(empfaenger_email, betreff, text)


@app.get("/")
def read_root():
    return {"message": "Backend läuft!"}

PREISE = {
    "Antipasti Scampi Spezial": 11.9,
    "Broccoli Roma": 12.9,
    "Bruschetta": 6.9,
    "Bruschetta con Scampi e Rucola": 11.9,
    "Caprese-Pizza (Groß)": 14.9,
    "Caprese-Pizza (Normal)": 13.9,
    "Cheeseburger-Pizza leicht scharf (Groß)": 14.9,
    "Cheeseburger-Pizza leicht scharf (Normal)": 13.9,
    "Chianti (0,75l)": 9.9,
    "Coca Cola (1,0l)": 3.9,
    "Coca Cola light (1,0l)": 3.9,
    "Döner-Pfanne": 14.9,
    "Familienpizza F1": 20.0,
    "Familienpizza F2": 24.0,
    "Familienpizza F3": 24.0,
    "Familienpizza F4": 25.0,
    "Familienpizza F5": 25.0,
    "Familienpizza F6": 30.0,
    "Fanta Orange (1,0l)": 3.9,
    "Filetto ai 4 Formaggi": 17.9,
    "Filetto di Maiale": 17.9,
    "Garnelen-Salat (Normal)": 13.9,
    "Gefüllte Tasche": 7.9,
    "Gemischter Salat (Normal)": 10.0,
    "Hähnchenfilet": 17.9,
    "Krabbenpfännchen": 11.9,
    "Käse-Tasche": 6.5,
    "Lachs-Pizza (Groß)": 14.9,
    "Lachs-Pizza (Normal)": 13.9,
    "Lambrusco (0,75l)": 9.9,
    "Lasagne": 11.5,
    "Lasagne Spezial": 13.5,
    "Lula-Pfanne extra scharf": 14.9,
    "Lunch-Pizza leicht scharf (Groß)": 14.9,
    "Lunch-Pizza leicht scharf (Normal)": 13.9,
    "Makkaroni dello Chef": 12.5,
    "Mineralwasser (0,75l)": 3.9,
    "Nudelplatte (10 Pers.)": 60.0,
    "Nudelplatte (6 Pers.)": 40.0,
    "Nudelplatte (8 Pers.)": 50.0,
    "Parmaschinken-Pizza (Groß)": 14.9,
    "Parmaschinken-Pizza (Normal)": 13.9,
    "Partypizza P1": 33.0,
    "Partypizza P2": 33.0,
    "Partypizza P3": 38.0,
    "Partypizza P4": 38.0,
    "Petti di Pollo": 17.9,
    "Pfifferling-Pizza (Groß)": 14.9,
    "Pfifferling-Pizza (Normal)": 13.9,
    "Pilzpfanne Spezial": 14.9,
    "Pinocchio-Lachssalat (Normal)": 13.9,
    "Pizza Biancaneve (Groß)": 14.9,
    "Pizza Biancaneve (Normal)": 12.9,
    "Pizza Bolognese Spezial (Groß)": 13.9,
    "Pizza Bolognese Spezial (Normal)": 12.9,
    "Pizza Broccoli (Groß)": 13.9,
    "Pizza Broccoli (Klein)": 7.0,
    "Pizza Broccoli (Normal)": 12.9,
    "Pizza Bruschetta (Groß)": 13.9,
    "Pizza Bruschetta (Normal)": 12.9,
    "Pizza Calzone gefüllt (Groß)": 12.9,
    "Pizza Calzone gefüllt (Normal)": 11.9,
    "Pizza Capricciosa (Groß)": 12.9,
    "Pizza Capricciosa (Normal)": 11.9,
    "Pizza Cipolla (Groß)": 11.0,
    "Pizza Cipolla (Klein)": 5.0,
    "Pizza Cipolla (Normal)": 9.0,
    "Pizza Döner (Groß)": 14.9,
    "Pizza Döner (Normal)": 12.9,
    "Pizza Florida (Groß)": 13.9,
    "Pizza Florida (Normal)": 12.9,
    "Pizza Frutti di Mare (Groß)": 14.9,
    "Pizza Frutti di Mare (Normal)": 13.9,
    "Pizza Fuego (Groß)": 13.9,
    "Pizza Fuego (Normal)": 11.9,
    "Pizza Funghi (Groß)": 11.0,
    "Pizza Funghi (Klein)": 5.0,
    "Pizza Funghi (Normal)": 9.0,
    "Pizza Gamberetti (Groß)": 13.9,
    "Pizza Gamberetti (Normal)": 12.9,
    "Pizza Garnelen (Groß)": 14.9,
    "Pizza Garnelen (Normal)": 12.9,
    "Pizza Gepetto (Maxi)": 14.9,
    "Pizza Gepetto (Normal)": 13.9,
    "Pizza Hawaii (Groß)": 12.9,
    "Pizza Hawaii (Klein)": 7.0,
    "Pizza Hawaii (Normal)": 11.9,
    "Pizza Inferno (Groß)": 12.9,
    "Pizza Inferno (Klein)": 7.0,
    "Pizza Inferno (Normal)": 11.9,
    "Pizza Italia (Groß)": 12.9,
    "Pizza Italia (Klein)": 7.0,
    "Pizza Italia (Normal)": 11.9,
    "Pizza Jamaica (Maxi)": 14.9,
    "Pizza Jamaica (Normal)": 13.9,
    "Pizza Lula (Maxi)": 14.9,
    "Pizza Lula (Normal)": 13.9,
    "Pizza Mafioso gefüllt (Groß)": 12.9,
    "Pizza Mafioso gefüllt (Normal)": 11.9,
    "Pizza Margherita (Groß)": 10.0,
    "Pizza Margherita (Klein)": 4.5,
    "Pizza Margherita (Normal)": 8.5,
    "Pizza Marinara (Groß)": 13.9,
    "Pizza Marinara (Normal)": 12.9,
    "Pizza Milano (Groß)": 13.9,
    "Pizza Milano (Klein)": 7.0,
    "Pizza Milano (Normal)": 12.9,
    "Pizza Mimo (Maxi)": 14.9,
    "Pizza Mimo (Normal)": 13.9,
    "Pizza Mista (Groß)": 12.9,
    "Pizza Mista (Klein)": 7.0,
    "Pizza Mista (Normal)": 11.9,
    "Pizza Mozzarella (Groß)": 12.9,
    "Pizza Mozzarella (Klein)": 7.0,
    "Pizza Mozzarella (Normal)": 11.9,
    "Pizza Muscheln (Groß)": 13.9,
    "Pizza Muscheln (Normal)": 12.9,
    "Pizza Napoletana (Groß)": 12.9,
    "Pizza Napoletana (Klein)": 7.0,
    "Pizza Napoletana (Normal)": 11.9,
    "Pizza New Dehli (Maxi)": 14.9,
    "Pizza New Dehli (Normal)": 13.9,
    "Pizza Paprica (Groß)": 11.0,
    "Pizza Paprica (Klein)": 5.0,
    "Pizza Paprica (Normal)": 9.5,
    "Pizza Patate (Maxi)": 14.9,
    "Pizza Patate (Normal)": 13.9,
    "Pizza Picante (Groß)": 12.9,
    "Pizza Picante (Klein)": 7.0,
    "Pizza Picante (Normal)": 11.9,
    "Pizza Pollo (Groß)": 14.9,
    "Pizza Pollo (Normal)": 13.9,
    "Pizza Popeye (Groß)": 13.9,
    "Pizza Popeye (Klein)": 7.0,
    "Pizza Popeye (Normal)": 12.9,
    "Pizza Popeye mit Ei (Groß)": 13.9,
    "Pizza Popeye mit Ei (Klein)": 7.0,
    "Pizza Popeye mit Ei (Normal)": 12.9,
    "Pizza Primavera (Groß)": 12.9,
    "Pizza Primavera (Klein)": 7.0,
    "Pizza Primavera (Normal)": 11.9,
    "Pizza Prosciutto (Groß)": 11.0,
    "Pizza Prosciutto (Klein)": 5.5,
    "Pizza Prosciutto (Normal)": 9.5,
    "Pizza Quattro Formaggi (Groß)": 13.9,
    "Pizza Quattro Formaggi (Normal)": 12.9,
    "Pizza Quattro Stagioni (Groß)": 12.9,
    "Pizza Quattro Stagioni (Normal)": 11.9,
    "Pizza Ramacca (Groß)": 12.9,
    "Pizza Ramacca (Klein)": 7.0,
    "Pizza Ramacca (Normal)": 11.9,
    "Pizza Rimini (Maxi)": 14.9,
    "Pizza Rimini (Normal)": 13.9,
    "Pizza Robertino (Maxi)": 14.9,
    "Pizza Robertino (Normal)": 13.9,
    "Pizza Romana (Groß)": 12.9,
    "Pizza Romana (Klein)": 7.0,
    "Pizza Romana (Normal)": 11.9,
    "Pizza Rustica (Groß)": 14.9,
    "Pizza Rustica (Normal)": 13.9,
    "Pizza Salami (Groß)": 11.0,
    "Pizza Salami (Klein)": 5.5,
    "Pizza Salami (Normal)": 9.5,
    "Pizza Salmone (Groß)": 14.9,
    "Pizza Salmone (Normal)": 13.9,
    "Pizza Scampi (Groß)": 13.9,
    "Pizza Scampi (Normal)": 12.9,
    "Pizza Scampi Spezial (Maxi)": 14.9,
    "Pizza Scampi Spezial (Normal)": 13.9,
    "Pizza Siciliana (Groß)": 12.9,
    "Pizza Siciliana (Klein)": 7.0,
    "Pizza Siciliana (Normal)": 11.0,
    "Pizza Spaghetti (Groß)": 13.9,
    "Pizza Spaghetti (Normal)": 12.9,
    "Pizza Spinaci (Groß)": 13.9,
    "Pizza Spinaci (Klein)": 7.0,
    "Pizza Spinaci (Normal)": 12.9,
    "Pizza Sucuk Hollandaise (Maxi)": 14.9,
    "Pizza Sucuk Hollandaise (Normal)": 13.9,
    "Pizza Tonnarella (Groß)": 14.9,
    "Pizza Tonnarella (Normal)": 12.9,
    "Pizza Tonno (Groß)": 11.9,
    "Pizza Tonno (Klein)": 6.5,
    "Pizza Tonno (Normal)": 10.9,
    "Pizza Tonno-Cipolla (Groß)": 12.9,
    "Pizza Tonno-Cipolla (Klein)": 7.0,
    "Pizza Tonno-Cipolla (Normal)": 11.9,
    "Pizza Tutti Frutti (Groß)": 12.9,
    "Pizza Tutti Frutti (Klein)": 7.0,
    "Pizza Tutti Frutti (Normal)": 11.9,
    "Pizza Valcone extra scharf (Groß)": 12.9,
    "Pizza Valcone extra scharf (Klein)": 7.0,
    "Pizza Valcone extra scharf (Normal)": 11.9,
    "Pizza Vegetaria (Groß)": 14.9,
    "Pizza Vegetaria (Normal)": 12.9,
    "Pizza Venezia gefüllt (Maxi)": 14.9,
    "Pizza Venezia gefüllt (Normal)": 13.9,
    "Pizza Vesuvio (Groß)": 12.9,
    "Pizza Vesuvio (Normal)": 11.9,
    "Pizza della Casa (Groß)": 13.9,
    "Pizza della Casa (Normal)": 12.9,
    "Pizza nach Art des Hauses (Groß)": 14.9,
    "Pizza nach Art des Hauses (Normal)": 13.9,
    "Butter": 1.0,
    "Soße": 1.5,
    "Oliven": 3.9,
    "Peperoni": 3.9,
    "Schafskäse": 3.9,
    "Pizzabrot": 3.9,
    "Pizzabrötchen mit Soße": 3.5,
    "Pizzabrötchen mit Butter": 3.5,
    "Pizzabrötchen Döner gefüllt": 7.9,
    "Pizzabrötchen Käse gefüllt": 6.5,
    "Pizzabrötchen Rucola gefüllt": 7.5,
    "Pizzabrötchen Salami gefüllt": 7.5,
    "Pizzabrötchen Schinken gefüllt": 7.5,
    "Pizzabrötchen Spinat gefüllt": 7.5,
    "Pizzabrötchen Sucuk gefüllt": 7.9,
    "Pizzabrötchen Tonno gefüllt": 7.5,
    "Pollo Picante scharf": 17.9,
    "Pollo al Pepe": 17.9,
    "Pollo all Aglio": 17.9,
    "Pollo alla Griglia": 17.9,
    "Pollo della Casa": 17.9,
    "Puten-Pfanne": 14.9,
    "Putengeschnetzeltes Currysauce": 13.9,
    "Putengeschnetzeltes mit Pilzen": 13.9,
    "Putengeschnetzeltes mit Pilzen, Tomaten...": 13.9,
    "Rafaello-Pfanne": 14.9,
    "Rigatoni Bolognese": 9.0,
    "Rigatoni Carbonara": 11.9,
    "Rigatoni Cortoccio": 12.5,
    "Rigatoni Italia": 13.5,
    "Rigatoni ai Funghi": 13.5,
    "Rigatoni ai Quattro Formaggi": 13.5,
    "Rigatoni al Forno": 11.9,
    "Rigatoni alla Napoletana": 9.0,
    "Rigatoni alla Panna": 9.5,
    "Rigatoni alla Vegetaria": 11.5,
    "Rigatoni nach Art des Hauses": 12.5,
    "Rollo Atlanta gefüllt": 14.5,
    "Rollo Dallas gefüllt": 13.5,
    "Rollo Florida gefüllt": 14.5,
    "Rollo Lula gefüllt": 14.5,
    "Rollo Mimo gefüllt": 14.5,
    "Rollo Phönix gefüllt": 13.5,
    "Rollo alla Chili gefüllt": 14.5,
    "Rollo alla Hawaii gefüllt": 14.5,
    "Rollo alla Marinara gefüllt": 14.5,
    "Rollo alla Mexicana gefüllt": 14.5,
    "Rollo alla Peppino Spezial gefüllt": 14.5,
    "Rollo alla Pino gefüllt": 13.5,
    "Rollo alla Popeye gefüllt": 14.5,
    "Rollo con Pollo gefüllt": 14.5,
    "Rucola-Salat (Normal)": 12.9,
    "Salat Cipolla (Klein)": 5.0,
    "Salat Cipolla (Normal)": 9.5,
    "Salat Frutti di Mare (Normal)": 13.9,
    "Salat Hawaii (Normal)": 11.9,
    "Salat Italia (Normal)": 11.9,
    "Salat Milano (Normal)": 10.9,
    "Salat Mimo (Normal)": 13.9,
    "Salat Mista (Klein)": 5.0,
    "Salat Mista (Normal)": 8.5,
    "Salat Pollo (Normal)": 13.9,
    "Salat Pomodoro Cipolla (Klein)": 5.0,
    "Salat Pomodoro Cipolla (Normal)": 8.5,
    "Salat Pomodoro Mozzarella (Normal)": 10.9,
    "Salat Primavera (Normal)": 11.9,
    "Salat Roma (Normal)": 11.9,
    "Salat Siciliana (Normal)": 11.9,
    "Salat della Casa (Normal)": 11.9,
    "Salatplatte (10 Pers.)": 55.0,
    "Salatplatte (6 Pers.)": 35.0,
    "Salatplatte (8 Pers.)": 45.0,
    "Schweinefilet Canterella": 17.9,
    "Schweinefilet Diavolo": 17.9,
    "Schweinefilet Funghi": 17.9,
    "Schweinefilet Gorgonzola": 17.9,
    "Schweinefilet Toscana": 17.9,
    "Schweinefilet al Pepe": 17.9,
    "Spaghetti Aglio Olio e Peperoncino": 11.5,
    "Spaghetti Bolognese": 9.0,
    "Spaghetti Caprese": 12.5,
    "Spaghetti Carbonara": 13.5,
    "Spaghetti Italia": 13.5,
    "Spaghetti Pesto": 11.5,
    "Spaghetti Salmone": 12.5,
    "Spaghetti Scampi": 14.5,
    "Spaghetti Tonno": 12.5,
    "Spaghetti Vulcano scharf": 11.5,
    "Spaghetti ai Frutti di Mare": 12.5,
    "Spaghetti al Forno": 11.9,
    "Spaghetti alla Italia": 11.5,
    "Spaghetti alla Napoletana": 8.9,
    "Spaghetti alla Panna": 9.5,
    "Spaghetti alla Vegetaria": 11.5,
    "Spaghetti della Casa": 11.5,
    "Spaghetti della Chef scharf": 14.5,
    "Spinat-Tasche": 7.5,
    "Sprite (1,0l)": 3.9,
    "Steak-Pizza (Groß)": 14.9,
    "Steak-Pizza (Normal)": 13.9,
    "Steinpilz-Pizza (Groß)": 14.9,
    "Steinpilz-Pizza (Normal)": 13.9,
    "Sucuk-Pizza 1 (Groß)": 14.9,
    "Sucuk-Pizza 1 (Normal)": 13.9,
    "Sucuk-Pizza 2 (Groß)": 14.9,
    "Sucuk-Pizza 2 (Normal)": 13.9,
    "Tagliatelle Bolognese": 10.5,
    "Tagliatelle Corteccio": 12.5,
    "Tagliatelle Funghi": 10.5,
    "Tagliatelle Gamberetti": 12.9,
    "Tagliatelle Italia": 12.5,
    "Tagliatelle Napoli": 10.5,
    "Tagliatelle Romana": 11.5,
    "Tagliatelle Rustica": 13.5,
    "Tagliatelle Salmone": 13.5,
    "Tiramisu": 6.5,
    "Tonno-Tasche": 7.5,
    "Tortellini Bolognese": 10.5,
    "Tortellini Boscaiola": 11.5,
    "Tortellini Carbonara": 11.5,
    "Tortellini Italia": 13.5,
    "Tortellini Maximo": 13.5,
    "Tortellini al Forno": 13.5,
    "Tortellini alla Panna": 13.5,
    "Tortellini alla Pinocchio": 11.5,
    "Tortellini con Salmone": 13.5,
    "Tortellini nach Art des Hauses": 12.5,
    "Tris di Pasta": 13.5,
    "Vegetarische Pizza (Groß)": 14.9,
    "Vegetarische Pizza (Normal)": 13.9,
    "Vino Bianco (0,75l)": 9.9,
    "Vino Rose (0,75l)": 9.9,
    "Vino Rosso (0,75l)": 9.9,
    "Überbackener Camembert": 6.9,
    "Überbackener Schafskäse": 6.9,
    # === EXTRAS NACH GRÖẞENTIER ===
    # Tierische Extras: Dönerfleisch, Garnelen, Gorgonzola, Hähnchenbrust,
    #                   Lachs, Meeresfrüchte, Mozzarella, Muscheln, Scampi
    # --- Klein (Kleine Pizza, Taschen, gefüllte Brötchen) ---
    "Extra [Klein]: Ananas": 1.0,
    "Extra [Klein]: Artischocken": 1.0,
    "Extra [Klein]: Banane": 1.0,
    "Extra [Klein]: Blattspinat": 1.0,
    "Extra [Klein]: Broccoli": 1.0,
    "Extra [Klein]: Champignons": 1.0,
    "Extra [Klein]: Ei": 1.0,
    "Extra [Klein]: Extra Käse": 1.0,
    "Extra [Klein]: Kapern": 1.0,
    "Extra [Klein]: Knoblauch": 1.0,
    "Extra [Klein]: Mais": 1.0,
    "Extra [Klein]: Oliven": 1.0,
    "Extra [Klein]: Paprika": 1.0,
    "Extra [Klein]: Peperoni": 1.0,
    "Extra [Klein]: Salami": 1.0,
    "Extra [Klein]: Sardellen": 1.0,
    "Extra [Klein]: Schafskäse": 1.0,
    "Extra [Klein]: Schinken": 1.0,
    "Extra [Klein]: Spargel": 1.0,
    "Extra [Klein]: Spinat": 1.0,
    "Extra [Klein]: Thunfisch": 1.0,
    "Extra [Klein]: Tomaten (frisch)": 1.0,
    "Extra [Klein]: Zwiebeln": 1.0,
    "Extra [Klein]: mit extra dünnem Teig": 1.0,
    "Extra [Klein]: Dönerfleisch": 2.0,
    "Extra [Klein]: Garnelen": 2.0,
    "Extra [Klein]: Gorgonzola": 2.0,
    "Extra [Klein]: Hähnchenbrust": 2.0,
    "Extra [Klein]: Krabben": 1.0,
    "Extra [Klein]: Lachs": 2.0,
    "Extra [Klein]: Meeresfrüchte": 2.0,
    "Extra [Klein]: Mozzarella": 2.0,
    "Extra [Klein]: Muscheln": 2.0,
    "Extra [Klein]: Scampi": 2.0,
    # --- Normal (Normale/Große Pizza, Rollo, Pasta, Al Forno) ---
    "Extra: Ananas": 1.5,
    "Extra: Artischocken": 1.5,
    "Extra: Banane": 1.5,
    "Extra: Blattspinat": 1.5,
    "Extra: Broccoli": 1.5,
    "Extra: Champignons": 1.5,
    "Extra: Ei": 1.5,
    "Extra: Extra Käse": 1.5,
    "Extra: Kapern": 1.5,
    "Extra: Knoblauch": 1.5,
    "Extra: Mais": 1.5,
    "Extra: Oliven": 1.5,
    "Extra: Paprika": 1.5,
    "Extra: Peperoni": 1.5,
    "Extra: Salami": 1.5,
    "Extra: Sardellen": 1.5,
    "Extra: Schafskäse": 1.5,
    "Extra: Schinken": 1.5,
    "Extra: Spargel": 1.5,
    "Extra: Spinat": 1.5,
    "Extra: Thunfisch": 1.5,
    "Extra: Tomaten (frisch)": 1.5,
    "Extra: Zwiebeln": 1.5,
    "Extra: mit extra dünnem Teig": 1.5,
    "Extra: Dönerfleisch": 2.5,
    "Extra: Garnelen": 2.5,
    "Extra: Gorgonzola": 2.5,
    "Extra: Hähnchenbrust": 2.5,
    "Extra: Krabben": 1.5,
    "Extra: Lachs": 2.5,
    "Extra: Meeresfrüchte": 2.5,
    "Extra: Mozzarella": 2.5,
    "Extra: Muscheln": 2.5,
    "Extra: Scampi": 2.5,
    # --- Maxi ---
    "Extra [Maxi]: Ananas": 2.0,
    "Extra [Maxi]: Artischocken": 2.0,
    "Extra [Maxi]: Banane": 2.0,
    "Extra [Maxi]: Blattspinat": 2.0,
    "Extra [Maxi]: Broccoli": 2.0,
    "Extra [Maxi]: Champignons": 2.0,
    "Extra [Maxi]: Ei": 2.0,
    "Extra [Maxi]: Extra Käse": 2.0,
    "Extra [Maxi]: Kapern": 2.0,
    "Extra [Maxi]: Knoblauch": 2.0,
    "Extra [Maxi]: Mais": 2.0,
    "Extra [Maxi]: Oliven": 2.0,
    "Extra [Maxi]: Paprika": 2.0,
    "Extra [Maxi]: Peperoni": 2.0,
    "Extra [Maxi]: Salami": 2.0,
    "Extra [Maxi]: Sardellen": 2.0,
    "Extra [Maxi]: Schafskäse": 2.0,
    "Extra [Maxi]: Schinken": 2.0,
    "Extra [Maxi]: Spargel": 2.0,
    "Extra [Maxi]: Spinat": 2.0,
    "Extra [Maxi]: Thunfisch": 2.0,
    "Extra [Maxi]: Tomaten (frisch)": 2.0,
    "Extra [Maxi]: Zwiebeln": 2.0,
    "Extra [Maxi]: mit extra dünnem Teig": 2.0,
    "Extra [Maxi]: Dönerfleisch": 3.5,
    "Extra [Maxi]: Garnelen": 3.5,
    "Extra [Maxi]: Gorgonzola": 3.5,
    "Extra [Maxi]: Hähnchenbrust": 3.5,
    "Extra [Maxi]: Krabben": 2.0,
    "Extra [Maxi]: Lachs": 3.5,
    "Extra [Maxi]: Meeresfrüchte": 3.5,
    "Extra [Maxi]: Mozzarella": 3.5,
    "Extra [Maxi]: Muscheln": 3.5,
    "Extra [Maxi]: Scampi": 3.5,
    # --- Familie (Familienpizza) ---
    "Extra [Familie]: Ananas": 2.0,
    "Extra [Familie]: Artischocken": 2.0,
    "Extra [Familie]: Banane": 2.0,
    "Extra [Familie]: Blattspinat": 2.0,
    "Extra [Familie]: Broccoli": 2.0,
    "Extra [Familie]: Champignons": 2.0,
    "Extra [Familie]: Ei": 2.0,
    "Extra [Familie]: Extra Käse": 2.0,
    "Extra [Familie]: Kapern": 2.0,
    "Extra [Familie]: Knoblauch": 2.0,
    "Extra [Familie]: Krabben": 2.0,
    "Extra [Familie]: Mais": 2.0,
    "Extra [Familie]: Oliven": 2.0,
    "Extra [Familie]: Paprika": 2.0,
    "Extra [Familie]: Peperoni": 2.0,
    "Extra [Familie]: Salami": 2.0,
    "Extra [Familie]: Sardellen": 2.0,
    "Extra [Familie]: Schafskäse": 2.0,
    "Extra [Familie]: Schinken": 2.0,
    "Extra [Familie]: Spargel": 2.0,
    "Extra [Familie]: Spinat": 2.0,
    "Extra [Familie]: Thunfisch": 2.0,
    "Extra [Familie]: Tomaten (frisch)": 2.0,
    "Extra [Familie]: Zwiebeln": 2.0,
    "Extra [Familie]: mit extra dünnem Teig": 2.0,
    "Extra [Familie]: Dönerfleisch": 3.5,
    "Extra [Familie]: Garnelen": 3.5,
    "Extra [Familie]: Gorgonzola": 3.5,
    "Extra [Familie]: Hähnchenbrust": 3.5,
    "Extra [Familie]: Lachs": 3.5,
    "Extra [Familie]: Meeresfrüchte": 3.5,
    "Extra [Familie]: Mozzarella": 3.5,
    "Extra [Familie]: Muscheln": 3.5,
    "Extra [Familie]: Scampi": 3.5,
    # --- Party (Partypizza) ---
    "Extra [Party]: Ananas": 3.0,
    "Extra [Party]: Artischocken": 3.0,
    "Extra [Party]: Banane": 3.0,
    "Extra [Party]: Blattspinat": 3.0,
    "Extra [Party]: Broccoli": 3.0,
    "Extra [Party]: Champignons": 3.0,
    "Extra [Party]: Ei": 3.0,
    "Extra [Party]: Extra Käse": 3.0,
    "Extra [Party]: Kapern": 3.0,
    "Extra [Party]: Knoblauch": 3.0,
    "Extra [Party]: Krabben": 3.0,
    "Extra [Party]: Mais": 3.0,
    "Extra [Party]: Oliven": 3.0,
    "Extra [Party]: Paprika": 3.0,
    "Extra [Party]: Peperoni": 3.0,
    "Extra [Party]: Salami": 3.0,
    "Extra [Party]: Sardellen": 3.0,
    "Extra [Party]: Schafskäse": 3.0,
    "Extra [Party]: Schinken": 3.0,
    "Extra [Party]: Spargel": 3.0,
    "Extra [Party]: Spinat": 3.0,
    "Extra [Party]: Thunfisch": 3.0,
    "Extra [Party]: Tomaten (frisch)": 3.0,
    "Extra [Party]: Zwiebeln": 3.0,
    "Extra [Party]: mit extra dünnem Teig": 3.0,
    "Extra [Party]: Dönerfleisch": 4.5,
    "Extra [Party]: Garnelen": 4.5,
    "Extra [Party]: Gorgonzola": 4.5,
    "Extra [Party]: Hähnchenbrust": 4.5,
    "Extra [Party]: Lachs": 4.5,
    "Extra [Party]: Meeresfrüchte": 4.5,
    "Extra [Party]: Mozzarella": 4.5,
    "Extra [Party]: Muscheln": 4.5,
    "Extra [Party]: Scampi": 4.5,
        # Pizzabrötchen als Extra (fixer Preis)
    "Extra: Pizzabrötchen mit Soße": 3.5,
    "Extra: Pizzabrötchen mit Butter": 3.5,
    # Grill/Pfanne Extras
    "Extra: Pommes + Gemischter Salat": 0.0,
    "Extra: Palatine Fritti": 3.5,
    "Extra: Ketchup": 0.5,
    "Extra: Mayonnaise": 0.5,
    # Salat-Extras
    "Extra: Extra Dressing Joghurt": 0.5,
    "Extra: Extra Dressing Cocktail": 0.5,
    "Extra: Extra Dressing Balsamico-Essig": 0.5,
}

@app.post("/bestellen")
def bestellen(bestellung: Bestellung):
    finale_artikel, endsumme, fehler = berechne_bestellung(bestellung)
    if fehler:
        print("❌ Bestellung abgelehnt:", fehler)
        return {"status": "error", "message": fehler}

    #  NUR HIER ist es wirklich eine gültige Bestellung
    bestellung.artikel = finale_artikel
    bestellung.gesamt = endsumme
    order_id = bestellung_speichern(bestellung, status="eingegangen")

    print("✅ Neue Bestellung akzeptiert:", order_id)
    print("Name:", bestellung.name)
    print("Telefon:", bestellung.telefon)
    print("E-Mail:", bestellung.email)
    print("Adresse:", bestellung.adresse)
    print("Hinweis:", bestellung.hinweis)
    print("Artikel:")

    for artikel in bestellung.artikel:
        print("-", artikel.name, "-", artikel.preis, "€")

    print("Gesamt:", endsumme, "€")

    sende_bestellbestaetigung(bestellung.email, bestellung.name, order_id, bestellung.bestellart, bestellung.artikel, endsumme)

    return {"status": "ok", "order_id": order_id, "tracking_url": f"verfolgen.html?id={order_id}"}


# ===== STRIPE: CHECKOUT SESSION ERSTELLEN =====
@app.post("/checkout-session")
def checkout_session(bestellung: Bestellung):
    # Preise, Öffnungszeiten, Adresse/Liefergebiet zuerst validieren (genau wie bei /bestellen)
    finale_artikel, endsumme, fehler = berechne_bestellung(bestellung)
    if fehler:
        return {"status": "error", "message": fehler}

    bestellung.artikel = finale_artikel
    bestellung.gesamt = endsumme
    berechnete_summe = endsumme

    # Artikelliste als lesbaren Text für Stripe-Beschreibung
    artikel_text = ", ".join(
        f"{a.name}" for a in bestellung.artikel
    )

    # Zahlungsmethoden je nach Auswahl
    if bestellung.zahlung == "paypal":
        payment_methods = ["paypal"]
    elif bestellung.zahlung == "kreditkarte":
        payment_methods = ["card"]
    else:
        payment_methods = ["card", "paypal"]

    # Bestellung schon jetzt speichern (Status: wartet auf Zahlung), damit wir
    # eine order_id haben, die wir Stripe mitgeben und in die Erfolgsseite packen können
    order_id = bestellung_speichern(bestellung, status="warte_auf_zahlung")

    try:
        session = stripe.checkout.Session.create(
            payment_method_types=payment_methods,
            line_items=[{
                "price_data": {
                    "currency": "eur",
                    "product_data": {
                        "name": "Bestellung Pizzeria Pinocchio",
                        "description": artikel_text[:500],  # max 500 Zeichen
                    },
                    "unit_amount": int(round(berechnete_summe * 100)),  # in Cent
                },
                "quantity": 1,
            }],
            mode="payment",
            success_url=f"{SITE_URL}/success.html?order_id={order_id}&session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{SITE_URL}/#bestellen",
            metadata={
                "order_id": order_id,
                "kunde_name": bestellung.name,
                "telefon": bestellung.telefon,
                "adresse": bestellung.adresse,
                "hinweis": bestellung.hinweis or "",
                "artikel": artikel_text[:500],
                "gesamt": str(berechnete_summe),
            }
        )
        print("━" * 40)
        print(f"💳 NEUE ONLINE-BESTELLUNG ({bestellung.zahlung.upper()})")
        print(f"Name:     {bestellung.name}")
        print(f"Telefon:  {bestellung.telefon}")
        print(f"E-Mail:   {bestellung.email}")
        print(f"Adresse:  {bestellung.adresse}")
        if bestellung.hinweis:
            print(f"Hinweis:  {bestellung.hinweis}")
        print("Artikel:")
        for artikel in bestellung.artikel:
            print(f"  - {artikel.name}  {artikel.preis:.2f} €")
        print(f"Gesamt:   {berechnete_summe:.2f} €")
        print("━" * 40)
        return {"url": session.url}

    except stripe.error.AuthenticationError:
        return {"status": "error", "message": "Stripe API-Key fehlt oder ungültig."}
    except Exception as e:
        print("Stripe Fehler:", e)
        return {"status": "error", "message": "Fehler beim Erstellen der Zahlung."}


# ===== STRIPE: WEBHOOK (Zahlung bestätigt) =====
@app.post("/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, STRIPE_WEBHOOK_SECRET
        )
    except stripe.error.SignatureVerificationError:
        return {"status": "error", "message": "Ungültige Webhook-Signatur"}

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        meta = session.get("metadata", {})
        order_id = meta.get("order_id")

        if order_id:
            conn = get_db()
            conn.execute(
                "UPDATE bestellungen SET status = 'eingegangen' WHERE id = ? AND status = 'warte_auf_zahlung'",
                (order_id,),
            )
            conn.commit()
            zeile = conn.execute("SELECT * FROM bestellungen WHERE id = ?", (order_id,)).fetchone()
            conn.close()
            # Bestellbestätigung erst jetzt verschicken (Zahlung ist bestätigt,
            # nicht schon beim Erstellen der Stripe-Session).
            if zeile is not None:
                sende_bestellbestaetigung(
                    zeile["email"], zeile["name"], order_id, zeile["bestellart"],
                    json.loads(zeile["artikel_json"]), zeile["gesamt"],
                )

        print("✅ Zahlung eingegangen!", order_id or "")
        print("Name:", meta.get("kunde_name"))
        print("Telefon:", meta.get("telefon"))
        print("Adresse:", meta.get("adresse"))
        print("Hinweis:", meta.get("hinweis"))
        print("Artikel:", meta.get("artikel"))
        print("Gesamt:", meta.get("gesamt"), "€")
        print("Zahlungs-ID:", session.get("id"))

    return {"status": "ok"}


def maskiere_email(email: str) -> str:
    """Maskiert eine E-Mail-Adresse für die Anzeige auf der öffentlichen
    Tracking-Seite (kein Login nötig), z. B. max@gmail.com -> m***@gmail.com.
    Die volle Adresse wird dabei nie an diesen öffentlichen Endpunkt gegeben."""
    if not email or "@" not in email:
        return ""
    lokal, _, domain = email.partition("@")
    if not lokal or not domain:
        return ""
    return f"{lokal[0]}***@{domain}"


# ===== ÖFFENTLICH: STATUS EINER BESTELLUNG (für verfolgen.html) =====
@app.get("/status/{order_id}")
def bestell_status(order_id: str):
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM bestellungen WHERE id = ?", (order_id,)
    ).fetchone()
    conn.close()

    if row is None or row["status"] == "warte_auf_zahlung":
        raise HTTPException(status_code=404, detail="Bestellung nicht gefunden")

    return {
        "order_id": row["id"],
        "status": row["status"],
        "bestellart": row["bestellart"],
        "erstellt_um": row["erstellt_um"],
        "artikel": json.loads(row["artikel_json"]),
        "gesamt": row["gesamt"],
        "eta_minuten": row["eta_minuten"],
        "eta_gesetzt_um": row["eta_gesetzt_um"],
        "email_maskiert": maskiere_email(row["email"]),
    }


# ===== DASHBOARD: BESTELLUNGEN AUFLISTEN (passwortgeschützt) =====
@app.get("/dashboard/api/bestellungen")
def dashboard_bestellungen(user: str = Depends(pruefe_dashboard_login)):
    conn = get_db()
    rows = conn.execute(
        """SELECT * FROM bestellungen
           WHERE status IN ('eingegangen', 'bestaetigt')
           ORDER BY erstellt_um ASC"""
    ).fetchall()
    conn.close()

    return [
        {
            "order_id": r["id"],
            "erstellt_um": r["erstellt_um"],
            "name": r["name"],
            "telefon": r["telefon"],
            "adresse": r["adresse"],
            "hinweis": r["hinweis"],
            "artikel": json.loads(r["artikel_json"]),
            "gesamt": r["gesamt"],
            "zahlung": r["zahlung"],
            "status": r["status"],
            "bestellart": r["bestellart"],
            "eta_minuten": r["eta_minuten"],
            "eta_gesetzt_um": r["eta_gesetzt_um"],
        }
        for r in rows
    ]


# ===== DASHBOARD: FERTIGSTELLUNGSZEIT SETZEN =====
@app.post("/dashboard/api/bestellungen/{order_id}/eta")
def dashboard_eta_setzen(order_id: str, eingabe: EtaEingabe, user: str = Depends(pruefe_dashboard_login)):
    conn = get_db()
    row = conn.execute("SELECT * FROM bestellungen WHERE id = ?", (order_id,)).fetchone()
    if row is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Bestellung nicht gefunden")

    conn.execute(
        "UPDATE bestellungen SET status = 'bestaetigt', eta_minuten = ?, eta_gesetzt_um = ? WHERE id = ?",
        (eingabe.eta_minuten, jetzt_iso(), order_id),
    )
    conn.commit()
    conn.close()

    # Zweite Bestätigungsmail: Zeit ist jetzt vom Restaurant bestätigt.
    fertig_um = datetime.now(timezone.utc).astimezone(BERLIN_TZ) + timedelta(minutes=eingabe.eta_minuten)
    sende_eta_bestaetigung(row["email"], row["name"], order_id, row["bestellart"], eingabe.eta_minuten, fertig_um)

    return {"status": "ok"}


# ===== DASHBOARD: BESTELLUNG ALS FERTIG MARKIEREN =====
@app.post("/dashboard/api/bestellungen/{order_id}/fertig")
def dashboard_fertig(order_id: str, user: str = Depends(pruefe_dashboard_login)):
    conn = get_db()
    row = conn.execute("SELECT id FROM bestellungen WHERE id = ?", (order_id,)).fetchone()
    if row is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Bestellung nicht gefunden")

    conn.execute("UPDATE bestellungen SET status = 'fertig' WHERE id = ?", (order_id,))
    conn.commit()
    conn.close()
    return {"status": "ok"}