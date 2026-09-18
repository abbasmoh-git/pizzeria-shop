let gesamt = 0;
let warenkorbDaten = {};
let pendingItem = null;

// "lieferung" oder "abholung" - gesteuert über die Radiobuttons im Bestellformular
let bestellart = 'lieferung';

function bestellartGeaendert() {
  bestellart = document.querySelector('input[name="bestellart"]:checked')?.value || 'lieferung';
  const adresseGruppe = document.getElementById('adresse-gruppe');
  const lieferkostenZeile = document.getElementById('lieferkosten-zeile');
  const istAbholung = bestellart === 'abholung';

  if (adresseGruppe) adresseGruppe.style.display = istAbholung ? 'none' : '';
  if (lieferkostenZeile) lieferkostenZeile.style.display = istAbholung ? 'none' : '';

  neuRendern();
}

// Die Lieferzone (und damit Lieferkosten/Mindestbestellwert) wird automatisch
// anhand der Adresse bestimmt - der Kunde wählt sie nie selbst aus, und die
// Namen "Olfen"/"erweitert" tauchen an keiner Stelle in der Oberfläche auf.
// Maßgeblich ist am Ende ohnehin die serverseitige Prüfung beim Absenden.
const LIEFERZONEN = {
  olfen:     { kosten: 1.0, mindest: 20.0 },
  erweitert: { kosten: 2.5, mindest: 35.0 },
};

// ===== ADRESSE AUTOCOMPLETE & LIEFERGEBIET ERKENNUNG =====
const RESTAURANT_LAT = 51.7089;
const RESTAURANT_LON = 7.3753;
const MAX_LIEFERRADIUS_KM = 7.5;

let adresseGeoResult = null; // { lat, lon, gebiet: 'innerorts'|'ausserorts'|null }
let adresseDebounceTimer = null;

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function adresseEingabe() {
  clearTimeout(adresseDebounceTimer);
  adresseGeoResult = null;
  const q = document.getElementById('adresse').value.trim();
  if (q.length < 3) {
    document.getElementById('adresse-vorschlaege').style.display = 'none';
    document.getElementById('lieferstatus').style.display = 'none';
    aktualisierelieferkosten();
    return;
  }
  adresseDebounceTimer = setTimeout(() => ladeVorschlaege(q), 420);
}

async function ladeVorschlaege(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=de&limit=5&addressdetails=1`;
  try {
    const res = await fetch(url, { headers: { 'Accept-Language': 'de' } });
    const data = await res.json();
    zeigeVorschlaege(data);
  } catch (e) {
    console.error('Nominatim Fehler:', e);
  }
}

function zeigeVorschlaege(results) {
  const box = document.getElementById('adresse-vorschlaege');
  if (!results || results.length === 0) {
    box.style.display = 'none';
    return;
  }
  box._results = results;
  box.innerHTML = results.map((r, i) => {
    const dist = haversineKm(RESTAURANT_LAT, RESTAURANT_LON, parseFloat(r.lat), parseFloat(r.lon));
    const inRange = dist <= MAX_LIEFERRADIUS_KM;
    const distText = dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`;
    const addr = r.address || {};
    const hauptzeile = [
      addr.road && addr.house_number ? `${addr.road} ${addr.house_number}` : (addr.road || r.name || ''),
    ].filter(Boolean).join('');
    const nebenzeile = [
      addr.postcode,
      addr.city || addr.town || addr.village || addr.municipality || ''
    ].filter(Boolean).join(' ');
    return `<div class="adresse-vorschlag${inRange ? '' : ' av-ausserhalb'}" onclick="waehleAdresse(${i})">
      <span class="av-main">${hauptzeile || r.display_name.split(',')[0]}</span>
      <span class="av-sub">${nebenzeile}</span>
      <span class="av-dist">${distText}</span>
    </div>`;
  }).join('');
  box.style.display = 'block';
}

function waehleAdresse(idx) {
  const box = document.getElementById('adresse-vorschlaege');
  const r = box._results && box._results[idx];
  if (!r) return;

  const input = document.getElementById('adresse');
  const addr = r.address || {};
  const strasseMitNr = addr.road
    ? (addr.house_number ? `${addr.road} ${addr.house_number}` : addr.road)
    : '';
  const ort = addr.city || addr.town || addr.village || addr.municipality || '';
  const teile = [strasseMitNr, addr.postcode, ort].filter(Boolean);
  input.value = teile.length > 0 ? teile.join(', ') : r.display_name;

  box.style.display = 'none';

  const lat = parseFloat(r.lat);
  const lon = parseFloat(r.lon);
  const dist = haversineKm(RESTAURANT_LAT, RESTAURANT_LON, lat, lon);
  const statusEl = document.getElementById('lieferstatus');

  if (dist > MAX_LIEFERRADIUS_KM) {
    adresseGeoResult = { lat, lon, gebiet: null };
    statusEl.className = 'lieferstatus status-ausserhalb';
    statusEl.innerHTML = `<i data-feather="alert-circle"></i><span>Leider außerhalb unseres Liefergebiets (${dist.toFixed(1)} km · max. ${MAX_LIEFERRADIUS_KM} km Luftlinie)</span>`;
  } else {
    // Zone wird nur intern bestimmt (für Lieferkosten/Mindestbestellwert) -
    // dem Kunden wird nie "Innerorts"/"Außerorts" o.ä. angezeigt.
    const isOlfen = ort.toLowerCase().includes('olfen') || (addr.postcode || '') === '59399';
    const gebiet = isOlfen ? 'olfen' : 'erweitert';
    adresseGeoResult = { lat, lon, gebiet };
    const { kosten, mindest } = LIEFERZONEN[gebiet];
    statusEl.className = 'lieferstatus status-innerorts';
    statusEl.innerHTML = `<i data-feather="check-circle"></i><span>Lieferung möglich · Lieferkosten: ${kosten.toFixed(2).replace('.', ',')} € · Mindestbestellwert: ${mindest.toFixed(2).replace('.', ',')} €</span>`;
  }
  statusEl.style.display = 'flex';
  if (window.feather) feather.replace({ width: 16, height: 16, 'stroke-width': 2 });
  aktualisierelieferkosten();
}

// Vorschläge schließen bei Klick außerhalb
document.addEventListener('click', function (e) {
  const box = document.getElementById('adresse-vorschlaege');
  const input = document.getElementById('adresse');
  if (box && input && !box.contains(e.target) && e.target !== input) {
    box.style.display = 'none';
  }
});

// Zeigt eine Live-Schätzung der Lieferkosten, sobald die Adresse aus den
// Vorschlägen ausgewählt wurde. Vor der Auswahl (oder bei erfundenen/nicht
// bestätigten Adressen) wird noch nichts behauptet - maßgeblich ist ohnehin
// die serverseitige Prüfung beim Absenden der Bestellung.
function aktualisierelieferkosten() {
  const gesamtEl = document.getElementById('summe-gesamt');
  const anzeige = document.getElementById('lieferkosten-anzeige');

  if (bestellart === 'abholung') {
    if (gesamtEl) gesamtEl.textContent = gesamt.toFixed(2).replace('.', ',');
    return;
  }

  if (adresseGeoResult && adresseGeoResult.gebiet) {
    const { kosten } = LIEFERZONEN[adresseGeoResult.gebiet];
    if (anzeige) anzeige.textContent = kosten.toFixed(2).replace('.', ',') + ' €';
    if (gesamtEl) gesamtEl.textContent = (gesamt + kosten).toFixed(2).replace('.', ',');
  } else {
    if (anzeige) anzeige.textContent = 'wird anhand der Adresse berechnet';
    if (gesamtEl) gesamtEl.textContent = gesamt.toFixed(2).replace('.', ',');
  }
}

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
  if (kopfText.includes('grill')) return 'begrenzt';
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
    document.getElementById("modalSub").textContent = "Extras hinzufügen für";
    zeigeSektion('extrasSektion-dressing');
    // Zusätzlich volle Extras mit Normal-Preisen anzeigen
    document.getElementById('extrasSektion-voll').classList.add('aktiv');
    aktualisiereExtrasModal('normal');
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

  // Hauptartikel anlegen oder menge erhöhen
  if (!warenkorbDaten[name]) {
    warenkorbDaten[name] = { name, preis, menge: 1, extras: [] };
  } else {
    warenkorbDaten[name].menge += 1;
  }
  const eintrag = warenkorbDaten[name];

  // === Salat: Dressing + Extras ===
  if (kategorie === 'salat') {
    const dressingRadio = modal.querySelector('input[name="dressing"]:checked');
    const dressing = dressingRadio ? dressingRadio.value : 'Joghurt';
    eintrag.note = `Dressing: ${dressing}`;

    // Extra Dressing
    const extraDressingCheck = modal.querySelector('#extraDressingCheck');
    if (extraDressingCheck && extraDressingCheck.checked) {
      const typRadio = modal.querySelector('input[name="extraDressingTyp"]:checked');
      const typ = typRadio ? typRadio.value : 'Joghurt';
      eintrag.extras.push({ key: `Extra: Extra Dressing ${typ}`, label: `Extra Dressing (${typ})`, preis: 0.5 });
    }
    // Normale Extras mit Normal-Preisen
    const tierKey = TIER_PREISE['normal'].key;
    document.getElementById('extrasSektion-voll').querySelectorAll('input[type=checkbox]:checked').forEach(cb => {
      eintrag.extras.push({ key: `${tierKey}${cb.value}`, label: cb.value, preis: parseFloat(cb.dataset.preis) });
    });

  } else if (kategorie === 'begrenzt') {
    // Beilage als Note
    const beilageRadio = modal.querySelector('input[name="beilage"]:checked');
    if (beilageRadio && beilageRadio.value) {
      eintrag.note = beilageRadio.value;
    }
    // Mayo / Ketchup
    document.getElementById('extrasSektion-begrenzt').querySelectorAll('input[type=checkbox]:checked').forEach(cb => {
      eintrag.extras.push({ key: `Extra: ${cb.value}`, label: cb.value, preis: parseFloat(cb.dataset.preis) });
    });

  } else {
    // Alle anderen: volle Extras mit Tier-Preisen
    const tierConfig = TIER_PREISE[kategorie];
    const tierKey = tierConfig ? tierConfig.key : 'Extra: ';
    document.getElementById('extrasSektion-voll').querySelectorAll('input[type=checkbox]:checked').forEach(cb => {
      eintrag.extras.push({ key: `${tierKey}${cb.value}`, label: cb.value, preis: parseFloat(cb.dataset.preis) });
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
  let name = document.getElementById("name").value.trim();
  let telefon = document.getElementById("telefon").value.trim();
  let email = document.getElementById("email").value.trim();
  let adresse = document.getElementById("adresse").value.trim();
  let hinweis = document.getElementById("hinweis").value.trim();
  let zahlung = document.querySelector('input[name="zahlung"]:checked')?.value || 'bar';
  let button = document.getElementById("bestellButton");
  let buttonText = document.getElementById("buttonText");
  let buttonSpinner = document.getElementById("buttonSpinner");

  const istAbholung = bestellart === 'abholung';
  const EMAIL_MUSTER = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  if (name === "" || telefon === "" || email === "" || (!istAbholung && adresse === "")) {
    zeigeMeldung(istAbholung
      ? "Bitte Name, Telefonnummer und E-Mail-Adresse eingeben!"
      : "Bitte Name, Telefonnummer, E-Mail-Adresse und Adresse eingeben!", "error");
    return;
  }

  if (!EMAIL_MUSTER.test(email)) {
    zeigeMeldung("Bitte gib eine gültige E-Mail-Adresse ein.", "error");
    return;
  }

  if (Object.keys(warenkorbDaten).length === 0) {
    zeigeMeldung("Bitte zuerst etwas bestellen!", "error");
    return;
  }

  let artikelListe = [];
  Object.values(warenkorbDaten).forEach(item => {
    for (let i = 0; i < item.menge; i++) {
      artikelListe.push({ name: item.name, preis: item.preis });
      (item.extras || []).forEach(e => {
        artikelListe.push({ name: e.key, preis: e.preis });
      });
    }
  });

  let bestellungsDaten;

  if (istAbholung) {
    // Abholung: keine Adresse, kein Liefergebiet, keine Lieferkosten/Mindestbestellwert
    bestellungsDaten = {
      name, telefon, email, adresse: "", hinweis,
      artikel: artikelListe,
      gesamt: gesamt,
      zahlung: zahlung,
      bestellart: 'abholung',
    };
  } else {
    // Die Adresse muss aus den Vorschlägen ausgewählt worden sein - eine frei
    // getippte, nicht bestätigte Adresse (z. B. eine erfundene Adresse) wird
    // hier abgelehnt. Der Server prüft die Adresse beim Absenden ohnehin noch
    // einmal unabhängig, das hier ist nur die schnelle Rückmeldung im Formular.
    if (!adresseGeoResult || !adresseGeoResult.gebiet) {
      zeigeMeldung("Bitte wähle deine Adresse aus der Vorschlagsliste aus, damit wir sie prüfen können.", "error");
      return;
    }

    const { mindest } = LIEFERZONEN[adresseGeoResult.gebiet];

    if (gesamt < mindest) {
      zeigeMeldung(`Mindestbestellwert für deine Adresse: ${mindest.toFixed(2).replace('.', ',')} €`, "error");
      return;
    }

    // Die Lieferkosten werden serverseitig anhand der Adresse berechnet und
    // als eigener Posten ergänzt - hier wird nur die Artikelsumme geschickt.
    bestellungsDaten = {
      name, telefon, email, adresse, hinweis,
      artikel: artikelListe,
      gesamt: gesamt,
      zahlung: zahlung,
      bestellart: 'lieferung',
    };
  }

  button.disabled = true;
  buttonSpinner.style.display = "inline-block";

  // === Online-Zahlung (PayPal / Kreditkarte) ===
  if (zahlung === 'paypal' || zahlung === 'kreditkarte') {
    buttonText.textContent = "Weiterleitung zur Zahlung...";
    try {
      let response = await fetch(`${BACKEND_URL}/checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bestellungsDaten)
      });
      let data = await response.json();
      if (data.url) {
        window.location.href = data.url;  // → zu Stripe weiterleiten
      } else {
        zeigeMeldung(data.message || "Fehler beim Erstellen der Zahlung.", "error");
        button.disabled = false;
        buttonText.textContent = "Bestellung abschicken";
        buttonSpinner.style.display = "none";
      }
    } catch (error) {
      zeigeMeldung("Backend nicht erreichbar oder Serverfehler.", "error");
      console.error(error);
      button.disabled = false;
      buttonText.textContent = "Bestellung abschicken";
      buttonSpinner.style.display = "none";
    }
    return;
  }

  // === Barzahlung ===
  buttonText.textContent = "Wird gesendet...";
  await new Promise(resolve => setTimeout(resolve, 2000));

  try {
    let response = await fetch(`${BACKEND_URL}/bestellen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bestellungsDaten)
    });

    let data = await response.json();

    if (data.status === "ok") {
      warenkorbDaten = {};
      neuRendern();
      document.getElementById("name").value = "";
      document.getElementById("telefon").value = "";
      document.getElementById("email").value = "";
      document.getElementById("adresse").value = "";
      document.getElementById("hinweis").value = "";
      // Weiter zur Tracking-Seite, damit der Kunde den Status verfolgen kann
      window.location.href = data.tracking_url || "verfolgen.html";
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
  const warenkorb = document.getElementById("warenkorb");
  warenkorb.innerHTML = "";
  gesamt = 0;

  if (Object.keys(warenkorbDaten).length === 0) {
    const leer = document.createElement("li");
    leer.className = "warenkorb-leer";
    leer.textContent = "Noch nichts im Warenkorb.";
    warenkorb.appendChild(leer);
    document.getElementById("summe").textContent = "0,00";
    document.getElementById("summe-gesamt").textContent = "0,00";
    return;
  }

  Object.values(warenkorbDaten).forEach((item) => {
    const extras = item.extras || [];
    const extrasPreis = extras.reduce((s, e) => s + e.preis, 0);
    const zeilenPreis = (item.preis + extrasPreis) * item.menge;
    gesamt += zeilenPreis;

    const anzeigeName = item.displayName || item.name;

    // Extras als HTML-Liste
    const extrasHtml = extras.map((e, idx) => `
      <div class="warenkorb-extra">
        <span>+ ${e.label} &nbsp;(${e.preis.toFixed(2).replace('.', ',')} €)</span>
        <button class="extra-entfernen" onclick="extraEntfernen('${item.name}', ${idx})" title="Entfernen">×</button>
      </div>`).join('');

    const li = document.createElement("li");
    li.innerHTML = `
      <div class="warenkorb-links">
        <div class="warenkorb-name">${anzeigeName} × ${item.menge} &nbsp;— ${zeilenPreis.toFixed(2).replace('.', ',')} €</div>
        ${item.note ? `<div class="warenkorb-note">${item.note}</div>` : ''}
        ${extrasHtml}
      </div>
      <div class="mengen-buttons">
        <button class="menge-btn" onclick="minus('${item.name}')">−</button>
        <span class="menge-zahl">${item.menge}</span>
        <button class="menge-btn" onclick="plus('${item.name}')">+</button>
      </div>`;
    warenkorb.appendChild(li);
  });

  document.getElementById("summe").textContent = gesamt.toFixed(2).replace('.', ',');
  aktualisierelieferkosten();
}

function plus(name) {
  warenkorbDaten[name].menge += 1;
  neuRendern();
}

function minus(name) {
  warenkorbDaten[name].menge -= 1;
  if (warenkorbDaten[name].menge <= 0) delete warenkorbDaten[name];
  neuRendern();
}

function extraEntfernen(itemName, idx) {
  if (warenkorbDaten[itemName]) {
    warenkorbDaten[itemName].extras.splice(idx, 1);
    neuRendern();
  }
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


// ===== DIASHOW =====
let diashowAktiv = 0;
const diashowAnzahl = 6;
let diashowTimer;

function diashowZeige(index) {
  const slides = document.querySelectorAll('.diashow-slide');
  const dots = document.querySelectorAll('.diashow-dot');
  slides.forEach(s => s.classList.remove('active', 'leaving'));
  dots.forEach(d => d.classList.remove('active'));
  diashowAktiv = (index + diashowAnzahl) % diashowAnzahl;
  slides[diashowAktiv].classList.add('active');
  if (dots[diashowAktiv]) dots[diashowAktiv].classList.add('active');
}

function diashowVor(richtung) {
  clearInterval(diashowTimer);
  diashowZeige(diashowAktiv + richtung);
  diashowAutoplay();
}

function diashowAutoplay() {
  diashowTimer = setInterval(() => diashowZeige(diashowAktiv + 1), 4000);
}

function diashowInit() {
  const container = document.getElementById('diashowDots');
  if (!container) return;
  for (let i = 0; i < diashowAnzahl; i++) {
    const dot = document.createElement('button');
    dot.className = 'diashow-dot' + (i === 0 ? ' active' : '');
    dot.onclick = () => { clearInterval(diashowTimer); diashowZeige(i); diashowAutoplay(); };
    container.appendChild(dot);
  }
  diashowAutoplay();
}

document.addEventListener('DOMContentLoaded', diashowInit);

// ===== ÖFFNUNGSZEITEN =====
// Die Öffnungszeiten kommen ausschließlich vom Backend (einzige Quelle der
// Wahrheit, siehe main.py). Hier wird nur angezeigt/gesperrt, nie erneut
// festgelegt - die eigentliche Prüfung passiert beim Absenden serverseitig.
async function pruefeOeffnungszeiten() {
  try {
    const res = await fetch(`${BACKEND_URL}/oeffnungszeiten`);
    const daten = await res.json();
    aktualisiereOeffnungsstatus(daten.geoeffnet, daten.text);
  } catch (e) {
    console.error('Öffnungszeiten konnten nicht geladen werden:', e);
  }
}

function aktualisiereOeffnungsstatus(geoeffnet, text) {
  let banner = document.getElementById('geschlossen-banner');
  const button = document.getElementById('bestellButton');

  if (!geoeffnet) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'geschlossen-banner';
      banner.className = 'geschlossen-banner';
      document.body.prepend(banner);
    }
    banner.textContent = text;
    if (button) {
      button.disabled = true;
      button.title = text;
    }
  } else {
    if (banner) banner.remove();
    if (button) {
      button.disabled = false;
      button.title = '';
    }
  }
}

document.addEventListener('DOMContentLoaded', pruefeOeffnungszeiten);
// Regelmäßig erneut prüfen, falls die Seite über eine Öffnungs-/Schließzeit
// hinweg geöffnet bleibt.
setInterval(pruefeOeffnungszeiten, 5 * 60 * 1000);
