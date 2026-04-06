let gesamt = 0;
let warenkorbDaten = {};
let pendingItem = null;

function toggleMenu() {
  let nav = document.getElementById("navMobile");
  nav.classList.toggle("open");
}

// Erkennt Kategorie anhand des übergeordneten Akkordeons
function erkenneKategorie(btn) {
  const akkordeon = btn ? btn.closest('.akkordeon') : null;
  if (!akkordeon) return 'voll';
  const kopf = akkordeon.querySelector('.akkordeon-kopf');
  if (!kopf) return 'voll';
  const text = kopf.textContent.toLowerCase();
  if (text.includes('getränk') || text.includes('cola') || text.includes('wasser')) return 'getränk';
  if (text.includes('salat')) return 'salat';
  if (text.includes('grill') || text.includes('pfannen') || text.includes('geschnetzelt')) return 'begrenzt';
  return 'voll';
}

// Zeigt eine Modal-Sektion, blendet die anderen aus
function zeigeSektion(sektionId) {
  document.querySelectorAll('.extras-sektion').forEach(s => s.classList.remove('aktiv'));
  const el = document.getElementById(sektionId);
  if (el) el.classList.add('aktiv');
}

// Toggle für Pizzabrötchen-Unterauswahl
function togglePbAuswahl(auswahlId, checkbox) {
  const el = document.getElementById(auswahlId);
  if (!el) return;
  el.classList.toggle('sichtbar', checkbox.checked);
}

// Toggle für Extra-Dressing-Auswahl
function toggleDressingExtra(checkbox) {
  const el = document.getElementById('extraDressingAuswahl');
  if (!el) return;
  el.classList.toggle('sichtbar', checkbox.checked);
}

function bestellen(name, preis, btn) {
  // Ungefülltes Pizzabrötchen → nur Soße/Butter-Auswahl
  if (name === 'Pizzabrötchen') {
    pendingItem = { name, preis, btn, kategorie: 'brötchen' };
    const modal = document.getElementById("extrasModal");
    const erstesBrötchen = modal.querySelector('input[name="brötchenSauce"]');
    if (erstesBrötchen) erstesBrötchen.checked = true;
    document.getElementById("modalSub").textContent = "Auswahl für";
    document.getElementById("modalGerichtName").textContent = name;
    zeigeSektion('extrasSektion-brötchen');
    modal.classList.add("aktiv");
    return;
  }

  const kategorie = erkenneKategorie(btn);

  if (kategorie === 'getränk') {
    bestellenDirekt(name, preis, btn);
    return;
  }

  pendingItem = { name, preis, btn, kategorie };

  const modal = document.getElementById("extrasModal");
  // Reset aller Inputs
  modal.querySelectorAll("input[type=checkbox]").forEach(cb => { cb.checked = false; });
  modal.querySelectorAll(".pb-auswahl").forEach(el => el.classList.remove('sichtbar'));
  // Dressing auf ersten Wert zurücksetzen
  const ersterDressing = modal.querySelector('input[name="dressing"]');
  if (ersterDressing) ersterDressing.checked = true;
  // PB-Radio auf ersten zurücksetzen
  modal.querySelectorAll('input[name^="pbSauce"]').forEach((r, i) => { r.checked = (i % 2 === 0); });
  // Extra-Dressing-Typ auf ersten zurücksetzen
  const ersterExtraDressingTyp = modal.querySelector('input[name="extraDressingTyp"]');
  if (ersterExtraDressingTyp) ersterExtraDressingTyp.checked = true;

  // Passende Sektion anzeigen
  if (kategorie === 'salat') {
    document.getElementById("modalSub").textContent = "Dressing wählen für";
    zeigeSektion('extrasSektion-dressing');
  } else if (kategorie === 'brötchen') {
    document.getElementById("modalSub").textContent = "Auswahl für";
    zeigeSektion('extrasSektion-brötchen');
    // Brötchen-Radio zurücksetzen
    const erstesBrötchen = modal.querySelector('input[name="brötchenSauce"]');
    if (erstesBrötchen) erstesBrötchen.checked = true;
  } else if (kategorie === 'begrenzt') {
    document.getElementById("modalSub").textContent = "Extras hinzufügen für";
    zeigeSektion('extrasSektion-begrenzt');
  } else {
    document.getElementById("modalSub").textContent = "Extras hinzufügen für";
    zeigeSektion('extrasSektion-voll');
  }

  document.getElementById("modalGerichtName").textContent = name;
  modal.classList.add("aktiv");
}

function bestellenDirekt(name, preis, btn) {
  if (warenkorbDaten[name]) {
    warenkorbDaten[name].menge += 1;
  } else {
    warenkorbDaten[name] = { name, preis, menge: 1 };
  }
  neuRendern();
  blinkBtn(btn);
}

function extrasBestaetigen() {
  if (!pendingItem) return;

  const { name, preis, btn, kategorie } = pendingItem;
  const modal = document.getElementById("extrasModal");

  // === Pizzabrötchen: Sauce in Artikelname aufnehmen ===
  if (kategorie === 'brötchen') {
    const sauceRadio = modal.querySelector('input[name="brötchenSauce"]:checked');
    const sauce = sauceRadio ? sauceRadio.value : 'Soße';
    const fullName = `${name} mit ${sauce}`;
    if (warenkorbDaten[fullName]) { warenkorbDaten[fullName].menge += 1; }
    else { warenkorbDaten[fullName] = { name: fullName, preis, menge: 1 }; }
    neuRendern();
    blinkBtn(btn);
    modal.classList.remove("aktiv");
    pendingItem = null;
    return;
  }

  // === Salat: Dressing als Note speichern ===
  if (kategorie === 'salat') {
    const dressingRadio = modal.querySelector('input[name="dressing"]:checked');
    const dressing = dressingRadio ? dressingRadio.value : 'Joghurt';
    const key = name;
    if (warenkorbDaten[key]) {
      warenkorbDaten[key].menge += 1;
    } else {
      warenkorbDaten[key] = { name, preis, menge: 1, note: `Dressing: ${dressing}` };
    }
    // Extra Dressing – mit Typ
    const extraDressingCheck = modal.querySelector('#extraDressingCheck');
    if (extraDressingCheck && extraDressingCheck.checked) {
      const typRadio = modal.querySelector('input[name="extraDressingTyp"]:checked');
      const typ = typRadio ? typRadio.value : 'Joghurt';
      const ekKey = `Extra: Extra Dressing ${typ}`;
      if (warenkorbDaten[ekKey]) { warenkorbDaten[ekKey].menge += 1; }
      else { warenkorbDaten[ekKey] = { name: `Extra: Extra Dressing ${typ}`, preis: 0.5, menge: 1 }; }
    }

  } else {
    // === Andere Kategorien: Extras einsammeln ===
    const sektionId = kategorie === 'begrenzt' ? 'extrasSektion-begrenzt' : 'extrasSektion-voll';
    const pbSauceName = kategorie === 'begrenzt' ? 'pbSauceBegrenzt' : 'pbSauceVoll';

    // Hauptartikel
    if (warenkorbDaten[name]) { warenkorbDaten[name].menge += 1; }
    else { warenkorbDaten[name] = { name, preis, menge: 1 }; }

    // Extras einlesen
    const sektion = document.getElementById(sektionId);
    sektion.querySelectorAll("input[type=checkbox]:checked").forEach(cb => {
      let extrasName = cb.value;
      const extrasPreis = parseFloat(cb.dataset.preis);

      // Pizzabrötchen: Sauce dazunehmen
      if (extrasName === 'Pizzabrötchen') {
        const sauceRadio = modal.querySelector(`input[name="${pbSauceName}"]:checked`);
        const sauce = sauceRadio ? sauceRadio.value : 'Knoblauchsauce';
        extrasName = `Pizzabrötchen mit ${sauce}`;
      }

      const ekKey = `Extra: ${extrasName}`;
      if (warenkorbDaten[ekKey]) { warenkorbDaten[ekKey].menge += 1; }
      else { warenkorbDaten[ekKey] = { name: `Extra: ${extrasName}`, preis: extrasPreis, menge: 1 }; }
    });
  }

  neuRendern();
  blinkBtn(btn);
  modal.classList.remove("aktiv");
  pendingItem = null;
}

function schliesseExtras(event) {
  if (!event || event.target === document.getElementById("extrasModal") || event.currentTarget.classList.contains("modal-schliessen")) {
    document.getElementById("extrasModal").classList.remove("aktiv");
    pendingItem = null;
  }
}

function blinkBtn(btn) {
  if (!btn) return;
  btn.classList.add("hinzugefuegt");
  const originalHTML = btn.innerHTML;
  btn.innerHTML = btn.innerHTML.replace(/[\d,]+ €/, "✓");
  setTimeout(() => {
    btn.innerHTML = originalHTML;
    btn.classList.remove("hinzugefuegt");
  }, 800);
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
    ${item.note ? `<br><small class="warenkorb-note">${item.note}</small>` : ''}
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
function toggleAkkordeon(kopf) {
  const inhalt = kopf.nextElementSibling;
  kopf.classList.toggle('offen');
  inhalt.classList.toggle('offen');
}
