let gesamt = 0;
let warenkorbDaten = {};

function bestellen(name, preis) {
  if(warenkorbDaten[name]){
    warenkorbDaten[name].menge += 1;
  }
  else{
    warenkorbDaten[name] = {
      name : name,
      preis : preis,
      menge : 1
    };
  }

  neuRendern();
}

async function abschicken() {
  let name = document.getElementById("name").value;
  let telefon = document.getElementById("telefon").value;
  let adresse = document.getElementById("adresse").value;
  let hinweis = document.getElementById("hinweis").value;

  if (name === "" || telefon === "" || adresse === "") {
    alert("Bitte Name, Telefonnummer und Adresse eingeben!");
    return;
  }

  if (Object.keys(warenkorbDaten).length === 0) {
    alert("Bitte zuerst etwas bestellen!");
    return;
  }

  let artikelListe = [];

  Object.values(warenkorbDaten).forEach(item => {
    for (let i = 0; i < item.menge; i++) {
      artikelListe.push({
        name: item.name,
        preis: item.preis
      });
    }
  });

  try {
    let response = await fetch("http://127.0.0.1:8000/bestellen", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: name,
        telefon: telefon,
        adresse: adresse,
        hinweis: hinweis,
        artikel: artikelListe,
        gesamt: gesamt
      })
    });

    let data = await response.json();

    if (data.status === "ok") {
      alert("Bestellung erfolgreich gesendet!");

      warenkorbDaten = {};
      neuRendern();
      document.getElementById("name").value = "";
      document.getElementById("telefon").value = "";
      document.getElementById("adresse").value = "";
      document.getElementById("hinweis").value = "";
    } else {
      alert(data.message || "Fehler bei der Bestellung.");
    }
  } catch (error) {
    alert("Backend nicht erreichbar oder Serverfehler.");
    console.error(error);
  }
}

function neuRendern() {
  let warenkorb = document.getElementById("warenkorb");
  warenkorb.innerHTML = "";

  gesamt = 0;

   Object.values(warenkorbDaten).forEach((item) => {
    let li = document.createElement("li");

   li.innerHTML = `
  <div class="warenkorb-links">
    ${item.name} - ${(item.preis * item.menge).toFixed(2)} €
  </div>

  <div class="mengen-buttons">
    <button class="menge-btn" onclick="minus('${item.name}')">−</button>
    <span class="menge-zahl">${item.menge}</span>
    <button class="menge-btn" onclick="plus('${item.name}')">+</button>
  </div>
`;

    warenkorb.appendChild(li);
    gesamt += item.preis * item.menge;
  });

  document.getElementById("summe").textContent = gesamt.toFixed(2);
}

function entfernen(index) {
  warenkorbDaten.splice(index, 1);
  neuRendern();
}
function plus(name) {
  warenkorbDaten[name].menge += 1;
  neuRendern();
}

function minus(name) {
  warenkorbDaten[name].menge -= 1;

  if (warenkorbDaten[name].menge <= 0) {
    delete warenkorbDaten[name];
  }

  neuRendern();
}