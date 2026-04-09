let gesamt = 0;
let warenkorbDaten = {};
let pendingItem = null;

// ===== EXTRAS KONFIGURATION =====
const TIERISCHE_EXTRAS = new Set([
  'Dönerfleisch','Garnelen','Gorgonzola','Hähnchenbrust','Lachs',
  'Meeresfrüchte','Mozzarella','Muscheln','Scampi'
]);

const PASTA_EXTRAS_SET = new Set(['Gorgonzola','Mozzarella','Schafskäse','Extra Käse']);

// Preis-Tier-Konfiguration
const TIER_PREISE = {
  klein:   { tierisch: 2.0, normal: 1.0, key: 'Extra [Klein]: ',   noBroetchen: true },
  normal:  { tierisch: 2.5, normal: 1.5, key: 'Extra: ',           noBroetchen: false },
  maxi:    { tierisch: 3.5, normal: 2.0, key: 'Extra [Maxi]: ',    noBroetchen: false },
  pasta:   { tierisch: 2.5, normal: 1.5, key: 'Extra: ',           noBroetchen: true, onlyPasta: true },
  familie: { tierisch: 3.5, normal: 2.0, key: 'Extra [Familie]: ', noBroetchen: false },
  party:   { tierisch: 4.5, normal: 3.0, key: 'Extra [Party]: ',   noBroetchen: false },
};

function toggleMenu() {
  let nav = document.getElementById("navMobile");
  nav.classList.toggle("open");
}

// Erkennt Tier/Kategorie anhand von Artikelname + Akkordeon-Kontext
function erkenneKategorie(name, btn) {
  const nameLower = name.toLowerCase();
  const akkordeon = btn ? btn.closest('.akkordeon') : null;
  const kopfText = akkordeon ? (akkordeon.querySelector('.akkordeon-kopf')?.textContent || '').toLowerCase() : '';

  if (kopfText.includes('getränk') || kopfText.includes('dessert')) return 'getränk';
  if (kopfText.includes('salat') && !kopfText.includes('famili') && !kopfText.includes('party')) return 'salat';
  if (kopfText.includes('vorspeise') || kopfText.includes('beilagen')) return 'keine';
  if (kopfText.includes('grill') || kopfText.includes('pfannen') || kopfText.includes('geschnetzelt')) return 'begrenzt';
  if (kopfText.includes('spaghetti') || kopfText.includes('rigatoni') || kopfText.includes('tagliatelle')) return 'pasta';
  if (nameLower.includes('nudelplatte')) return 'pasta';
  if (nameLower.includes('salatplatte')) return 'salat';
  if (nameLower.includes('familienpizza')) return 'familie';
  if (nameLower.includes('partypizza')) return 'party';

  if (nameLower.includes('(maxi)')) return 'maxi';
  if (nameLower.includes('(klein)')) return 'klein';
  if (kopfText.includes('taschen')) return 'klein';
  if (nameLower.includes('gefüllt')) return 'klein';

  return 'normal';
}

// Aktualisiert Preise + Sichtbarkeit in extrasSektion-voll je nach Tier
function aktualisiereExtrasModal(tier) {
  const sektion = document.getElementById('extrasSektion-voll');
  if (!sektion) return;
  const config = TIER_PREISE[tier];
  if (!config) return;

  sektion.querySelectorAll('input[type=checkbox]').forEach(cb => {
    const extraName = cb.value;
    const container = cb.closest('.pb-wrapper') || cb.closest('label.extra-item');
    if (!container) return;

    let sichtbar = true;
    if (config.onlyPasta && !PASTA_EXTRAS_SET.has(extraName)) sichtbar = false;
    if (config.noBroetchen && extraName === 'Pizzabrötchen') sichtbar = false;

    container.style.display = sichtbar ? '' : 'none';
    if (!sichtbar) { cb.checked = false; return; }

    const isTierisch = TIERISCHE_EXTRAS.has(extraName);
    const newPreis = isTierisch ? config.tierisch : config.normal;
    cb.dataset.preis = newPreis.toFixed(2);

    const label = cb.closest('label.extra-item');
    if (label) {
      const span = label.querySelector('span');
      if (span) span.textContent = `+${newPreis.toFixed(2).replace('.', ',')} €`;
    }
  });
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

  const kategorie = erkenneKategorie(name, btn);

  if (kategorie === 'getränk' || kategorie === 'keine') {
    bestellenDirekt(name, preis, btn);
    return;
  }

  pendingItem = { name, preis, btn, kategorie };

  const modal = document.getElementById("extrasModal");
  // Reset aller Inputs
  modal.querySelectorAll("input[type=checkbox]").forEach(cb => { cb.checked = false; });
  modal.querySelectorAll(".pb-auswahl").forEach(el => el.classList.remove('sichtbar'));
  const ersterDressing = modal.querySelector('input[name="dressing"]');
  if (ersterDressing) ersterDressing.checked = true;
  modal.querySelectorAll('input[name^="pbSauce"]').forEach((r, i) => { r.checked = (i % 2 === 0); });
  const ersteBeilage = modal.querySelector('input[name="beilage"]');
  if (ersteBeilage) ersteBeilage.checked = true;
  const ersterExtraDressingTyp = modal.querySelector('input[name="extraDressingTyp"]');
  if (ersterExtraDressingTyp) ersterExtraDressingTyp.checked = true;

  // Passende Sektion anzeigen
  if (kategorie === 'salat') {
    document.getElementById("modalSub").textContent = "Dressing wählen für";
    zeigeSektion('extrasSektion-dressing');
  } else if (kategorie === 'begrenzt') {
    document.getElementById("modalSub").textContent = "Extras hinzufügen für";
    zeigeSektion('extrasSektion-begrenzt');
  } else {
    // klein, normal, maxi, pasta → volle Extraliste mit tier-spezifischen Preisen
    document.getElementById("modalSub").textContent = "Extras hinzufügen für";
    zeigeSektion('extrasSektion-voll');
    aktualisiereExtrasModal(kategorie);
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
    const tierConfig = TIER_PREISE[kategorie];
    const tierKey = tierConfig ? tierConfig.key : 'Extra: ';

    // Hauptartikel
    if (warenkorbDaten[name]) { warenkorbDaten[name].menge += 1; }
    else { warenkorbDaten[name] = { name, preis, menge: 1 }; }

    // Beilage-Auswahl (Grill/Pfanne)
    if (kategorie === 'begrenzt') {
      const beilageRadio = modal.querySelector('input[name="beilage"]:checked');
      if (beilageRadio && beilageRadio.dataset.preis) {
        const beilagePreis = parseFloat(beilageRadio.dataset.preis);
        const beilageKey = 'Extra: Pommes + Gemischter Salat';
        if (warenkorbDaten[beilageKey]) { warenkorbDaten[beilageKey].menge += 1; }
        else { warenkorbDaten[beilageKey] = { name: 'Extra: Pommes + Gemischter Salat', preis: beilagePreis, menge: 1 }; }
      }
    }

    // Extras einlesen
    const sektion = document.getElementById(sektionId);
    sektion.querySelectorAll("input[type=checkbox]:checked").forEach(cb => {
      let extrasName = cb.value;
      const extrasPreis = parseFloat(cb.dataset.preis);

      // Alle anderen Extras mit Tier-Key für Backend-Validierung
      const ekKey = `${tierKey}${extrasName}`;
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

    const anzeigeName = item.displayName || item.name;
    li.innerHTML = `
  <div class="warenkorb-links">
    ${anzeigeName} × ${item.menge} &nbsp;— ${(item.preis * item.menge).toFixed(2).replace('.', ',')} €
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

// ===== SPEISE-SUCHE =====
function speiseSuchen(query) {
  const clearBtn = document.getElementById('speiseSucheClear');
  const keinErgebnis = document.getElementById('sucheKeinErgebnis');
  const q = query.trim().toLowerCase();

  clearBtn.style.display = q ? 'block' : 'none';

  // Alle Akkordeons holen
  const akkordeons = document.querySelectorAll('.akkordeon');
  let irgendwasGefunden = false;

  if (!q) {
    // Suche leer: alles zurücksetzen
    akkordeons.forEach(ak => {
      ak.style.display = '';
      ak.querySelectorAll('.menu-zeile').forEach(z => z.style.display = '');
      ak.querySelectorAll('.pasta-sub-titel').forEach(t => t.style.display = '');
      // Akkordeon wieder schließen
      ak.removeAttribute('open');
    });
    keinErgebnis.style.display = 'none';
    return;
  }

  akkordeons.forEach(ak => {
    const zeilen = ak.querySelectorAll('.menu-zeile');
    let treffer = 0;

    zeilen.forEach(zeile => {
      const h3 = zeile.querySelector('h3');
      const p  = zeile.querySelector('p');
      const text = ((h3 ? h3.textContent : '') + ' ' + (p ? p.textContent : '')).toLowerCase();
      if (text.includes(q)) {
        zeile.style.display = '';
        treffer++;
      } else {
        zeile.style.display = 'none';
      }
    });

    if (treffer > 0) {
      ak.style.display = '';
      ak.setAttribute('open', '');  // Akkordeon aufklappen
      // Sub-Titel: zeige nur die, bei denen danach noch sichtbare Zeilen kommen
      const subTitel = ak.querySelectorAll('.pasta-sub-titel');
      subTitel.forEach(titel => {
        // Nächstes menu-liste nach diesem Titel
        let sibling = titel.nextElementSibling;
        let hatSichtbareZeile = false;
        while (sibling && !sibling.classList.contains('pasta-sub-titel')) {
          if (sibling.classList.contains('menu-liste')) {
            sibling.querySelectorAll('.menu-zeile').forEach(z => {
              if (z.style.display !== 'none') hatSichtbareZeile = true;
            });
          }
          sibling = sibling.nextElementSibling;
        }
        titel.style.display = hatSichtbareZeile ? '' : 'none';
      });
      irgendwasGefunden = true;
    } else {
      ak.style.display = 'none';
    }
  });

  keinErgebnis.style.display = irgendwasGefunden ? 'none' : 'block';
}

function speiseSucheLeeren() {
  const input = document.getElementById('speiseSuche');
  input.value = '';
  speiseSuchen('');
  input.focus();
}

