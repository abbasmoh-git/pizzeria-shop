from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Artikel(BaseModel):
    name: str
    preis: float

class Bestellung(BaseModel):
    name: str
    telefon: str
    adresse: str
    hinweis: str
    artikel: List[Artikel]
    gesamt: float

@app.get("/")
def read_root():
    return {"message": "Backend läuft!"}

PREISE = {
    "Margherita": 8.5,
    "Salami": 9.5,
    "Funghi": 9.0
}

@app.post("/bestellen")
def bestellen(bestellung: Bestellung):
    berechnete_summe = 0

    for artikel in bestellung.artikel:
        if artikel.name not in PREISE:
            print("❌ Unbekannter Artikel")
            return {"status": "error", "message": "Unbekannter Artikel!"}

        berechnete_summe += PREISE[artikel.name]

    berechnete_summe = round(berechnete_summe, 2)

    print("Frontend Summe:", bestellung.gesamt)
    print("Backend Summe:", berechnete_summe)

    if round(bestellung.gesamt, 2) != berechnete_summe:
        print("❌ Bestellung abgelehnt (Preis stimmt nicht)")
        return {"status": "error", "message": "Preis stimmt nicht!"}

    #  NUR HIER ist es wirklich eine gültige Bestellung
    print("✅ Neue Bestellung akzeptiert:")
    print("Name:", bestellung.name)
    print("Telefon:", bestellung.telefon)
    print("Adresse:", bestellung.adresse)
    print("Hinweis:", bestellung.hinweis)
    print("Artikel:")

    for artikel in bestellung.artikel:
        print("-", artikel.name, "-", PREISE[artikel.name], "€")

    print("Gesamt:", berechnete_summe, "€")

    return {"status": "ok"}