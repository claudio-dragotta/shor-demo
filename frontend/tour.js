"use strict";

/* Tour guidato della demo, e copione del video dimostrativo.

   Un solo elenco di passi serve a due modalita':
     - guida  (pulsante nell'intestazione, oppure ?tour=guida): si avanza con "Avanti";
     - video  (?tour=video): parte da sola e avanza con i tempi del copione, senza
               pulsanti ne' cursore, cosi' la registrazione dello schermo esce pulita.
   ?lang=it|en sceglie la lingua, ?ritmo=1.2 allunga tutti i tempi del 20%.

   Ogni passo evidenzia un elemento vero della pagina con un velo ritagliato e
   aziona la demo attraverso window.ShorDemo, cioe' le stesse funzioni dei
   pulsanti: il video mostra quello che la demo fa davvero, non una messinscena.
   Un elemento che non c'e' (per esempio i pannelli della tesi se l'API delle
   curve non risponde) fa saltare il passo: il tour non resta mai bloccato. */
(() => {
  const t = (key, values) => window.I18N.t(key, values);
  const D = () => window.ShorDemo;
  const dorme = (ms) => new Promise((r) => window.setTimeout(r, ms));

  async function attendi(condizione, timeout = 60000) {
    const inizio = Date.now();
    while (!condizione()) {
      if (Date.now() - inizio > timeout) return false;
      await dorme(150);
    }
    return true;
  }

  /* Il copione. `durata` e' il tempo minimo sullo schermo in modalita' video, in ms;
     `prima` prepara la pagina prima di inquadrare, `azione` gira mentre il
     fumetto e' gia' visibile e `coda` e' quanto restare fermi dopo che l'azione
     e' finita. Un passo senza `target` e' un cartello a tutto schermo. */
  const PASSI = [
    { id: "intro", durata: 5000 },
    {
      id: "istanza", target: "#idealPanel > .control-panel", durata: 4500,
      prima: async () => { D().scheda("ideal"); D().istanza15(); await attendi(() => D().pronta()); await D().stadioIdeale(0); },
    },
    { id: "stato0", target: "#idealPanel .circuit-panel", durata: 6000,
      prima: () => D().stadioIdeale(0) },
    { id: "hadamard", target: "#idealPanel .circuit-panel", durata: 5500,
      azione: () => D().stadioIdeale(1) },
    { id: "moltiplicazioni", target: "#idealPanel .circuit-panel", durata: 8500,
      azione: async () => { await D().stadioIdeale(2); await dorme(3800); await D().stadioIdeale(3); } },
    { id: "qft", target: "#idealPanel .circuit-panel", durata: 6000,
      azione: () => D().stadioIdeale(4) },
    {
      id: "misura", target: "#idealPanel .math-panel", durata: 8500, coda: 3500,
      // Uno shot su quattro non da' i fattori (y = 0). Ripetere la misura fa
      // parte dell'algoritmo: il tour la ripete finche' non riesce, a vista.
      azione: async () => {
        for (let tentativo = 0; tentativo < 6; tentativo += 1) {
          const shot = await D().stadioIdeale(5);
          if (!shot || shot.ok) return;
          await dorme(2600);
          D().chiudiPopup();
        }
      },
    },
    { id: "rumore", target: "#noiseTab", durata: 5500, chiudiPopup: true, inCima: true,
      prima: () => { D().scheda("noise"); D().dettaglioRumore(false); D().vistaRumore("noisy"); } },
    {
      // Il circuito rumoroso gira a tutta larghezza: nella vista affiancata le
      // sfere di Bloch diventano troppo piccole per leggerle in un video.
      id: "bloch", target: "#noiseStageView", durata: 8500, coda: 600,
      prima: async () => {
        D().scheda("noise");
        await attendi(() => D().pronta());
        D().vistaRumore("noisy");
        D().stadioRumore(0);
      },
      azione: async () => {
        await dorme(1000);
        D().corsaRumore();
        await attendi(() => !D().rumoreInCorsa(), 30000);
      },
    },
    {
      // Prima il confronto affiancato all'ultimo stadio, poi il riepilogo della
      // demo, che misura la decoerenza solo sui qubit che senza rumore restavano
      // puri: un numero misurato, non una lettura a occhio delle frecce.
      id: "differenza", target: "#noiseStageView", durata: 8000, chiudiPopup: true,
      prima: () => { D().chiudiPopup(); D().vistaRumore("compare"); D().stadioRumore(5); },
      azione: async () => { await dorme(2600); D().riepilogoRumore(); },
    },
    { id: "anatomia", target: ".anatomy-panel .anatomy-scroller", durata: 8000,
      prima: () => { D().scheda("noise"); D().vistaRumore("noisy"); D().dettaglioRumore(true); } },
    { id: "esegui", target: ".run-config", durata: 4500, coda: 600,
      prima: () => { D().scheda("noise"); D().dettaglioRumore(true); },
      azione: async () => { await D().esperimento(); await attendi(() => D().haRisultato(), 120000); } },
    { id: "risultati", target: "#experimentResults .kpi-grid", durata: 7000,
      prima: () => attendi(() => D().haRisultato(), 120000) },
    { id: "grafico", target: "#experimentResults .chart-block", durata: 5500 },
    { id: "entropia", target: "#thesisPanel .thesis-card:nth-of-type(1)", durata: 6500 },
    { id: "qec", target: "#thesisPanel .thesis-card:nth-of-type(3)", durata: 8000 },
    { id: "shor", target: "#thesisPanel .thesis-card:nth-of-type(4)", durata: 7500 },
    { id: "fine", durata: 6000 },
  ];

  const MARGINE = 12;     // aria fra l'elemento e il bordo dello spotlight
  const TESTA = 84;       // la barra delle schede resta agganciata in alto

  let ui = null;
  let corsa = null;       // { modo, indice, token, ritmo }

  function crea(tag, classe, genitore) {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (genitore) genitore.appendChild(el);
    return el;
  }

  function costruisciUi() {
    if (ui) return ui;
    const radice = crea("div", "tour", document.body);
    radice.hidden = true;
    const velo = crea("div", "tour-velo", radice);
    const luce = crea("div", "tour-luce", radice);
    const cartello = crea("div", "tour-cartello", radice);
    cartello.setAttribute("role", "dialog");
    cartello.setAttribute("aria-live", "polite");
    const cKicker = crea("p", "kicker", cartello);
    const cTitolo = crea("h2", "", cartello);
    const cTesto = crea("p", "", cartello);
    const barra = crea("div", "tour-barra", radice);
    barra.setAttribute("role", "dialog");
    barra.setAttribute("aria-live", "polite");
    const avanz = crea("div", "tour-avanzamento", barra);
    const avanzRiempi = crea("i", "", avanz);
    const corpo = crea("div", "tour-corpo", barra);
    const testi = crea("div", "tour-testi", corpo);
    const bKicker = crea("p", "kicker", testi);
    const bTitolo = crea("h2", "", testi);
    const bTesto = crea("p", "", testi);
    const comandi = crea("div", "tour-comandi", corpo);
    const indietro = crea("button", "button button-secondary", comandi);
    const avanti = crea("button", "button button-primary", comandi);
    const esci = crea("button", "tour-esci", comandi);
    [indietro, avanti, esci].forEach((b) => { b.type = "button"; });
    indietro.addEventListener("click", () => { corsa.indietro = true; vaiA(corsa.indice - 1); });
    avanti.addEventListener("click", () => vaiA(corsa.indice + 1));
    esci.addEventListener("click", ferma);
    const avvio = crea("div", "tour-avvio", radice);
    const aTitolo = crea("h2", "", avvio);
    const aTesto = crea("p", "", avvio);
    const aStato = crea("p", "tour-avvio-stato", avvio);
    ui = { radice, velo, luce, cartello, cKicker, cTitolo, cTesto, barra, avanzRiempi,
           bKicker, bTitolo, bTesto, indietro, avanti, esci, avvio, aTitolo, aTesto, aStato };
    return ui;
  }

  /* I testi possono citare valori vivi della pagina con {#id}: il fumetto dei
     risultati legge i numeri appena misurati invece di inventarne di fissi. */
  function testo(chiave) {
    return t(chiave).replace(/\{#(\w+)\}/g, (_, id) => {
      const el = document.getElementById(id);
      return el ? el.textContent.trim() : "—";
    });
  }

  function elementoVisibile(selettore) {
    const el = document.querySelector(selettore);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? el : null;
  }

  // In una scheda in secondo piano lo scorrimento morbido non avanza: si salta.
  const scorrimento = () => (document.hidden ? "instant" : "smooth");

  // Porta l'elemento nello spazio libero fra la barra delle schede e il fumetto:
  // centrato se ci sta, altrimenti allineato in alto.
  function inquadra(el) {
    const r = el.getBoundingClientRect();
    const basso = window.innerHeight - ui.barra.offsetHeight - 16;
    const spazio = basso - TESTA;
    const scarto = r.height <= spazio ? TESTA + (spazio - r.height) / 2 : TESTA + MARGINE;
    window.scrollTo({ top: Math.max(0, window.scrollY + r.top - scarto), behavior: scorrimento() });
  }

  // Lo spotlight insegue l'elemento a ogni frame: segue lo scroll morbido e i
  // pannelli che cambiano altezza mentre la demo carica. Il timer di riserva
  // copre la scheda in secondo piano, dove i frame non arrivano.
  let target = null;
  let riserva = null;
  function segui() {
    if (!corsa) return;
    aggiornaLuce();
    window.requestAnimationFrame(segui);
  }

  function aggiornaLuce() {
    if (corsa && target && document.contains(target)) {
      const r = target.getBoundingClientRect();
      const basso = window.innerHeight - (ui.barra.hidden ? 0 : ui.barra.offsetHeight) - 6;
      const top = Math.max(6, r.top - MARGINE);
      const bottom = Math.min(basso, r.bottom + MARGINE);
      const s = ui.luce.style;
      s.top = `${top}px`;
      s.left = `${Math.max(6, r.left - MARGINE)}px`;
      s.width = `${Math.min(window.innerWidth - 12, r.width + 2 * MARGINE)}px`;
      s.height = `${Math.max(0, bottom - top)}px`;
    }
  }

  function mostraPasso(passo, numero, totale) {
    const chiave = `tour.${passo.id}`;
    const cartello = !passo.target;
    ui.cartello.hidden = !cartello;
    ui.barra.hidden = cartello && corsa.modo === "video";
    ui.luce.hidden = cartello;
    ui.velo.hidden = !cartello;
    const kicker = t(`${chiave}.kicker`) === `${chiave}.kicker`
      ? t("tour.step", { i: numero, n: totale })
      : t(`${chiave}.kicker`);
    if (cartello) {
      ui.cKicker.textContent = kicker;
      ui.cTitolo.textContent = testo(`${chiave}.title`);
      ui.cTesto.textContent = testo(`${chiave}.text`);
    }
    ui.bKicker.textContent = kicker;
    ui.bTitolo.textContent = cartello ? "" : testo(`${chiave}.title`);
    ui.bTesto.textContent = cartello ? "" : testo(`${chiave}.text`);
    ui.indietro.textContent = t("tour.prev");
    ui.avanti.textContent = numero === totale ? t("tour.end") : t("tour.next");
    ui.esci.textContent = t("tour.close");
    ui.indietro.disabled = numero === 1;
  }

  function avviaAvanzamento(ms) {
    const s = ui.avanzRiempi.style;
    s.transition = "none";
    s.width = "0%";
    void ui.avanzRiempi.offsetWidth;
    s.transition = `width ${ms}ms linear`;
    s.width = "100%";
  }

  async function vaiA(indice) {
    if (!corsa) return;
    if (indice < 0) return;
    if (indice >= PASSI.length) { ferma(); return; }
    const token = ++corsa.token;
    corsa.indice = indice;
    const passo = PASSI[indice];
    const vivo = () => corsa && corsa.token === token;
    ui.avanti.disabled = true;

    if (passo.chiudiPopup) D().chiudiPopup();
    try { if (passo.prima) await passo.prima(); } catch (e) { /* il passo prosegue comunque */ }
    if (!vivo()) return;

    target = passo.target ? elementoVisibile(passo.target) : null;
    if (passo.target && !target) { vaiA(indice + (corsa.indietro ? -1 : 1)); return; }
    corsa.indietro = false;
    mostraPasso(passo, indice + 1, PASSI.length);
    // Un elemento agganciato in alto (la barra delle schede) non si inquadra
    // scorrendo: si torna in cima alla pagina.
    if (passo.inCima) window.scrollTo({ top: 0, behavior: scorrimento() });
    else if (target) inquadra(target);

    const durata = (passo.durata || 6000) * corsa.ritmo;
    if (corsa.modo === "video") avviaAvanzamento(durata);
    const azione = (async () => {
      try { if (passo.azione) await passo.azione(); } catch (e) { /* idem */ }
      if (passo.azione && passo.coda) await dorme(passo.coda * corsa.ritmo);
    })();

    if (corsa.modo === "video") {
      await Promise.all([dorme(durata), azione]);
      if (vivo()) vaiA(indice + 1);
    } else {
      await azione;
      if (!vivo()) return;
      // I testi con {#id} leggono i valori arrivati durante l'azione.
      mostraPasso(passo, indice + 1, PASSI.length);
      ui.avanti.disabled = false;
      ui.avanti.focus({ preventScroll: true });
    }
  }

  function tasti(evento) {
    if (!corsa) return;
    if (evento.key === "Escape") { evento.preventDefault(); ferma(); return; }
    if (corsa.modo === "attesa" && (evento.key === "Enter" || evento.key === " ")) {
      evento.preventDefault(); parti();
    }
  }

  function apri(modo, ritmo = 1) {
    costruisciUi();
    if (corsa) ferma();
    corsa = { modo, indice: -1, token: 0, ritmo, indietro: false };
    document.body.classList.add("tour-attivo");
    document.body.classList.toggle("tour-video", modo !== "guida");
    ui.radice.hidden = false;
    ui.radice.classList.toggle("is-video", modo !== "guida");
    document.addEventListener("keydown", tasti);
    window.requestAnimationFrame(segui);
    riserva = window.setInterval(aggiornaLuce, 100);
  }

  function avviaGuida() {
    apri("guida");
    ui.avvio.hidden = true;
    vaiA(0);
  }

  /* In modalita' video la pagina prima si prepara (circuito ideale e sfere sotto
     rumore gia' calcolati), poi aspetta un Invio: cosi' si avvia la registrazione
     con calma e il primo fotogramma utile e' gia' il cartello d'apertura. */
  async function preparaVideo(ritmo) {
    apri("attesa", ritmo);
    ui.cartello.hidden = true;
    ui.barra.hidden = true;
    ui.luce.hidden = true;
    ui.velo.hidden = false;
    ui.avvio.hidden = false;
    ui.aTitolo.textContent = t("tour.video.ready.title");
    ui.aTesto.textContent = t("tour.video.ready.text");
    ui.aStato.textContent = t("tour.video.loading");
    ui.aStato.classList.remove("is-pronto");
    window.scrollTo({ top: 0 });
    await attendi(() => D() && D().pronta(), 300000);
    if (!corsa || corsa.modo !== "attesa") return;
    ui.aStato.textContent = t("tour.video.go");
    ui.aStato.classList.add("is-pronto");
    ui.avvio.onclick = parti;
  }

  function parti() {
    if (!corsa || corsa.modo !== "attesa" || !D().pronta()) return;
    corsa.modo = "video";
    ui.avvio.hidden = true;
    window.scrollTo({ top: 0 });
    vaiA(0);
  }

  function ferma() {
    if (!corsa) return;
    corsa = null;
    target = null;
    document.removeEventListener("keydown", tasti);
    window.clearInterval(riserva);
    document.body.classList.remove("tour-attivo", "tour-video");
    ui.radice.hidden = true;
  }

  function init() {
    const bottone = document.getElementById("tourBtn");
    if (bottone) bottone.addEventListener("click", avviaGuida);
    const parametri = new URLSearchParams(window.location.search);
    const lingua = parametri.get("lang");
    if (lingua) window.I18N.setLang(lingua);
    const ritmo = Math.min(3, Math.max(0.5, Number(parametri.get("ritmo")) || 1));
    const modo = parametri.get("tour");
    if (modo === "video") preparaVideo(ritmo);
    else if (modo === "guida" || modo === "guide") avviaGuida();
    // Cambiare lingua a tour aperto riscrive subito il fumetto corrente.
    window.I18N.onChange(() => {
      if (corsa && corsa.indice >= 0) mostraPasso(PASSI[corsa.indice], corsa.indice + 1, PASSI.length);
    });
  }

  init();
})();
