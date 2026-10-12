// Test end-to-end della scheda 03 (QFT approssimata) in un browser vero.
// Uso: demo avviata su http://localhost:8501, poi  node tests/e2e_aqft.mjs [url] [chromium]
// Esce con codice 1 al primo controllo fallito e stampa l'elenco dei controlli.
import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:8501/";
const executablePath = process.argv[3] || undefined;
const risultati = [];
let falliti = 0;
function verifica(nome, condizione, dettaglio = "") {
  risultati.push(`${condizione ? "OK  " : "FAIL"} ${nome}${dettaglio ? ` — ${dettaglio}` : ""}`);
  if (!condizione) falliti += 1;
}

const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const errori = [];
async function nuovaPagina(viewport = { width: 1440, height: 900 }, lang = "it") {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (e) => errori.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errori.push(m.text()); });
  await page.goto(`${base}?lang=${lang}`);
  await page.waitForFunction(() => window.ShorAqft && window.ShorAqft.pronta(), null, { timeout: 90000 });
  return page;
}

const page = await nuovaPagina();
const struttura = await page.evaluate(() => fetch("/api/aqft/structure").then((r) => r.json()));

// --- schede e tastiera ------------------------------------------------------
verifica("tre schede", (await page.locator("[role=tab]").count()) === 3);
await page.click("#noiseTab");
await page.keyboard.press("ArrowRight");
verifica("freccia destra dal laboratorio apre la scheda 03",
  await page.locator("#aqftPanel").isVisible() && (await page.getAttribute("#aqftTab", "aria-selected")) === "true");
verifica("le altre schede sono nascoste", await page.locator("#noisePanel").isHidden() && await page.locator("#idealPanel").isHidden());

// --- ogni grado ---------------------------------------------------------------
async function impostaK(k) {
  await page.evaluate((v) => { const el = document.getElementById("aqK"); el.value = String(v); el.dispatchEvent(new Event("input")); }, k);
}
for (const g of struttura.degrees) {
  await impostaK(g.k);
  const tenute = await page.locator("#aqCircuitSvg .aq-cp.is-kept").count();
  const tolte = await page.locator("#aqCircuitSvg .aq-cp.is-removed").count();
  const chip = await page.textContent("#aqCircuitChip");
  const costo = await page.locator("#aqCost .aq-cost-row.is-main b").allTextContents();
  const idealeK = await page.locator("#aqIdealKpis .kpi-aqft strong").textContent();
  const disabilitato = await page.isDisabled("#aqRunBtn");
  // La scheda 03 disegna solo il circuito che gira: le rotazioni tolte non compaiono.
  verifica(`k=${g.k} rotazioni disegnate`, tenute === g.rotations_kept && tolte === 0, `${tenute}+${tolte}`);
  verifica(`k=${g.k} etichetta`, chip.includes(`${g.rotations_kept}/28`), chip);
  verifica(`k=${g.k} CX mostrate = API`, costo[1]?.replace(/\D/g, "") === String(g.compiled.cx) && costo[0]?.replace(/\D/g, "") === "224", costo.join("/"));
  verifica(`k=${g.k} resa ideale 75%`, /75[,.]00%/.test(idealeK), idealeK);
  verifica(`k=${g.k} pulsante ${g.k === 7 ? "disabilitato" : "attivo"}`, disabilitato === (g.k === 7));
  const angoli = await page.locator("#aqCircuitSvg .aq-cp.is-kept title").allTextContents();
  verifica(`k=${g.k} nessuna rotazione tenuta oltre k`, angoli.every((txt) => Number(txt.match(/d = (\d)/)[1]) <= g.k));
}
verifica("un solo anello sulla rotazione c6→c7", (await page.locator("#aqCircuitSvg .aq-only-ring").count()) === 1);
verifica("SWAP disegnati", (await page.locator("#aqCircuitSvg .aq-swap").count()) === 4);
verifica("Hadamard disegnate", (await page.locator("#aqCircuitSvg .aq-h").count()) === 8);

// --- dati precalcolati e tesi ------------------------------------------------
await page.waitForSelector("#aqThesisPanel:not([hidden])", { timeout: 20000 });
verifica("pannello curva visibile", await page.locator("#aqCurvePanel").isVisible());
verifica("tabella N=15 con 7 righe", (await page.locator("#aqN15Table tbody tr").count()) === 7);
verifica("forest plot con 9 intervalli", (await page.locator("#aqQpeChart .aq-forest-dot").count()) === 9);
const verdetto15 = await page.textContent("#aqN15Verdict");
verifica("verdetto N=15 riporta 0,1487 e l'IC", verdetto15.includes("0,1487") && verdetto15.includes("0,1273") && verdetto15.includes("0,1699"), verdetto15.slice(0, 90));

// --- esperimento --------------------------------------------------------------
await impostaK(1);
await page.click("[data-aq-preset=uc1]");
await page.selectOption("#aqShots", "256");
await page.fill("#aqSeed", "1234");
await page.click("#aqRunBtn");
await page.waitForSelector("#aqResults:not([hidden])", { timeout: 120000 });
const atteso = await page.evaluate(() => fetch("/api/aqft/experiment", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ k: 1, shots: 256, seed: 1234, noise: { eps_1q: 0.001, eps_2q: 0.01, t1_us: 100, t2_us: 80, readout_0to1: 0.02, readout_1to0: 0.02, coherent_overrotation_deg: 0 } }),
}).then((r) => r.json()));
const kpi = await page.locator("#aqKpis .kpi strong").allTextContents();
const pct = (v) => `${(v * 100).toFixed(1).replace(".", ",")}%`;
verifica("5 KPI", kpi.length === 5);
verifica("KPI piena = API con lo stesso seed", kpi[0] === pct(atteso.full.factor_yield), `${kpi[0]} vs ${pct(atteso.full.factor_yield)}`);
verifica("KPI AQFT = API con lo stesso seed", kpi[1] === pct(atteso.aqft.factor_yield), `${kpi[1]} vs ${pct(atteso.aqft.factor_yield)}`);
verifica("CX risparmiate = 42", kpi[3] === "42", kpi[3]);
verifica("barre nel grafico", (await page.locator("#aqDistChart rect").count()) > 8);
verifica("provenienza con 7 voci", (await page.locator("#aqProvList dt").count()) === 7);

await impostaK(3);
verifica("avviso di risultato non aggiornato", (await page.textContent("#aqRunStatus")).includes("k = 1"));
await page.click("[data-aq-preset=uc2]");
verifica("snapshot del rumore aggiornato", (await page.textContent("#aqNoiseSnapshot")).includes("5,00%"));

// errore del server: il pulsante torna utilizzabile e il messaggio e' visibile
await page.route("**/api/aqft/experiment", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Simulazione temporaneamente non disponibile." }) }));
await page.click("#aqRunBtn");
await page.waitForFunction(() => document.getElementById("aqRunStatus").classList.contains("is-error"), null, { timeout: 10000 });
verifica("errore 503 mostrato", (await page.textContent("#aqRunStatus")).includes("non disponibile"));
verifica("pulsante riabilitato dopo l'errore", !(await page.isDisabled("#aqRunBtn")));
await page.route("**/api/aqft/experiment", (route) => route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ detail: "occupato" }) }));
await page.click("#aqRunBtn");
await page.waitForFunction(() => document.getElementById("aqRunStatus").textContent.includes("sta finendo un altro calcolo"), null, { timeout: 10000 });
verifica("429: messaggio di attesa e nuovo tentativo automatico", true);
await page.unroute("**/api/aqft/experiment");

// --- lingua ------------------------------------------------------------------
await page.click("#langToggle");
const testoEn = await page.locator("#aqftPanel").innerText();
verifica("inglese: nessuna chiave grezza", !/\baq\.[a-z]/.test(testoEn), (testoEn.match(/\baq\.[a-z.]+/) || [""])[0]);
verifica("inglese: titoli tradotti", testoEn.includes("Dropping rotations to drop noise") && testoEn.includes("What the thesis measured"));
verifica("inglese: decimali con il punto", (await page.textContent("#aqN15Verdict")).includes("0.1487"));
await page.click("#langToggle");
const testoIt = await page.locator("#aqftPanel").innerText();
verifica("italiano: nessuna chiave grezza", !/\baq\.[a-z]/.test(testoIt));
verifica("scheda tradotta anche nella barra", (await page.textContent("#aqftTab")).includes("QFT approssimata"));

// --- tema chiaro e telefono ---------------------------------------------------
{
  // Il tema si sceglie dal selettore nell'intestazione: chiaro, poi di nuovo scuro.
  await page.click('#themeToggle [data-tema="chiaro"]');
  const sfondo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  verifica("tema chiaro applicato", /255, 255, 255/.test(sfondo), sfondo);
  const angoliChiaro = await page.locator("#aqCircuitSvg .aq-cp.is-kept").count();
  verifica("circuito AQFT ridisegnato nel tema chiaro", angoliChiaro > 0, String(angoliChiaro));
  await page.click('#themeToggle [data-tema="scuro"]');
  verifica("ritorno al tema scuro", await page.evaluate(() => !document.documentElement.dataset.tema));
}

// --- preset "Solo readout": come nel laboratorio, T1/T2 spenti ---------------------
await page.click("[data-aq-preset=readout]");
const snapRo = await page.textContent("#aqNoiseSnapshot");
verifica("Solo readout spegne T₁/T₂", /T₁\/T₂ (spenti|off)/.test(snapRo), snapRo);
verifica("etichetta uguale al laboratorio", (await page.textContent("[data-aq-preset=readout]")).trim()
  === (await page.textContent("[data-preset=readout]")).trim());

const tel = await nuovaPagina({ width: 390, height: 844 });
await tel.click("#aqftTab");
await tel.waitForSelector("#aqThesisPanel:not([hidden])", { timeout: 20000 });
const overflow = await tel.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
verifica("telefono: nessuno scorrimento orizzontale della pagina", overflow <= 1, `${overflow}px`);

const en = await nuovaPagina({ width: 1280, height: 800 }, "en");
await en.click("#aqftTab");
verifica("avvio diretto in inglese", (await en.textContent("#aqTitle")).includes("Dropping rotations"));

// I 503 e 429 sopra sono provocati apposta: il browser li registra come risorse fallite.
const inattesi = errori.filter((e) => !/status of (503|429)/.test(e));
verifica("console senza errori inattesi", inattesi.length === 0, inattesi.slice(0, 3).join(" | "));
await browser.close();
console.log(risultati.join("\n"));
console.log(`\n${risultati.length - falliti}/${risultati.length} controlli superati`);
process.exit(falliti ? 1 : 0);
