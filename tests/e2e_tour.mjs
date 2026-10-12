// Test end-to-end del tour video: tutte le tappe, nell'ordine, senza salti ne' errori.
// Uso: demo avviata su http://localhost:8501, poi
//   node tests/e2e_tour.mjs [url] [chromium] [it|en] [completo|aqft|presentazione|passaggi|n15]
// Il tour gira a ritmo 0.5 (meta' dei tempi): circa due minuti.
import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:8501/";
const executablePath = process.argv[3] || undefined;
const lang = process.argv[4] || "it";
const copione = process.argv[5] || "completo";
const TAPPE = { completo: 26, aqft: 13, presentazione: 17, passaggi: 13, n15: 15 }[copione];

const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errori = [];
page.on("pageerror", (e) => errori.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errori.push(m.text()); });
await page.goto(`${base}?tour=video&lang=${lang}&ritmo=0.5${copione !== "completo" ? `&copione=${copione}` : ""}`);
await page.waitForSelector(".tour-avvio-stato.is-pronto", { timeout: 300000 });
await page.keyboard.press("Enter");

const visti = [];
let ultimo = "";
const inizio = Date.now();
while (Date.now() - inizio < 420000) {
  const s = await page.evaluate(() => ({
    chiuso: document.querySelector(".tour")?.hidden !== false,
    kicker: document.querySelector(".tour-barra .kicker")?.textContent || "",
    titolo: document.querySelector(".tour-barra h2")?.textContent
      || document.querySelector(".tour-cartello h2")?.textContent || "",
    testo: document.querySelector(".tour-barra p:not(.kicker)")?.textContent || "",
  }));
  if (s.chiuso) break;
  const chiave = `${s.kicker}|${s.titolo}`;
  if (!s.kicker && !s.titolo) { await page.waitForTimeout(150); continue; }  // prima del cartello d'apertura
  if (chiave !== ultimo) { ultimo = chiave; visti.push(s); }
  else if (visti.length) visti[visti.length - 1].testo = s.testo;  // i {#id} si riempiono durante l'azione
  await page.waitForTimeout(150);
}
await browser.close();

const risultati = [];
let falliti = 0;
const verifica = (nome, ok, dettaglio = "") => {
  risultati.push(`${ok ? "OK  " : "FAIL"} ${nome}${dettaglio ? ` — ${dettaglio}` : ""}`);
  if (!ok) falliti += 1;
};
verifica(`${TAPPE} tappe mostrate`, visti.length === TAPPE, String(visti.length));
const numeri = visti.map((v) => Number((v.kicker.match(/(\d+)\s+(di|of)\s+\d+/) || [])[1])).filter(Boolean);
verifica("numerazione consecutiva, nessun salto", numeri.every((n, i) => i === 0 || n === numeri[i - 1] + 1), numeri.join(","));
verifica("nessuna chiave di traduzione grezza", visti.every((v) => !/\btour\.|\baq\./.test(v.titolo + v.testo)));
verifica("valori live riempiti (nessun —)", visti.every((v) => !/(^|\s)—(\s|\.|,|$)/.test(v.testo)),
  (visti.find((v) => /(^|\s)—(\s|\.|,|$)/.test(v.testo)) || {}).titolo || "");
verifica("ultima tappa: cartello finale", /Tesi magistrale|Master/.test(visti[visti.length - 1]?.kicker || ""));
verifica("console senza errori", errori.length === 0, errori.slice(0, 3).join(" | "));
console.log(visti.map((v) => `${v.kicker} | ${v.titolo}`).join("\n"));
console.log(risultati.join("\n"));
process.exit(falliti ? 1 : 0);
