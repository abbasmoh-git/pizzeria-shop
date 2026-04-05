let gesamt = 0;
let warenkorbDaten = {};

function toggleMenu() {
  let nav = document.getElementById("navMobile");
  nav.classList.toggle("open");
}

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
  let button = document.getElementById("bestellButton");
  let buttonText = document.getElementById("buttonText");
  let buttonSpinner = document.getElementById("buttonSpinner");

  if (name === "" || telefon === "" || adresse === "") {
    zeigeMeldung("Bitte Name, Telefonnummer und Adresse eingeben!", "error");
    return;
  }

  if (Object.keys(warenkorbDaten).length === 0) {
    zeigeMeldung("Bitte zuerst etwas bestellen!", "error");
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

  button.disabled = true;
  buttonText.textContent = "Wird gesendet...";
  buttonSpinner.style.display = "inline-block";
  await new Promise(resolve => setTimeout(resolve, 2000));

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
      zeigeMeldung("🍕 Bestellung erfolgreich!");

      warenkorbDaten = {};
      neuRendern();
      document.getElementById("name").value = "";
      document.getElementById("telefon").value = "";
      document.getElementById("adresse").value = "";
      document.getElementById("hinweis").value = "";
    } else {
      zeigeMeldung(data.message || "Fehler bei der Bestellung.", "error");
    }
  } catch (error) {
    zeigeMeldung("Backend nicht erreichbar oder Serverfehler.", "error");
    console.error(error);
  } finally {
    button.disabled = false;
    buttonText.textContent = "Bestellung abschicken";
    buttonSpinner.style.display = "none";
  }
}

function neuRendern() {
  let warenkorb = document.getElementById("warenkorb");
  warenkorb.innerHTML = "";

  gesamt = 0;

  if (Object.keys(warenkorbDaten).length === 0) {
    let leer = document.createElement("li");
    leer.className = "warenkorb-leer";
    leer.textContent = "Noch nichts im Warenkorb.";
    warenkorb.appendChild(leer);
    document.getElementById("summe").textContent = "0,00";
    return;
  }

  Object.values(warenkorbDaten).forEach((item) => {
    let li = document.createElement("li");

    li.innerHTML = `
  <div class="warenkorb-links">
    ${item.name} × ${item.menge} &nbsp;— ${(item.preis * item.menge).toFixed(2).replace('.', ',')} €
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

  document.getElementById("summe").textContent = gesamt.toFixed(2).replace('.', ',');
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
function zeigeMeldung(text, typ = "ok") {
  let box = document.getElementById("meldung");

  box.textContent = text;
  box.style.display = "block";

  if (typ === "error") {
    box.classList.add("fehler");
  } else {
    box.classList.remove("fehler");
  }

  setTimeout(() => {
    box.style.display = "none";
  }, 3000);
}