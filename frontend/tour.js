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
  const A = () => window.ShorAqft;
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
    // --- Scheda 03: la QFT approssimata, attraverso window.ShorAqft (aqft.js) ---
    { id: "aqft", target: "#aqftTab", durata: 5500, inCima: true,
      prima: async () => {
        D().scheda("aqft");
        await attendi(() => A() && A().pronta());
        A().preset("uc1");
        A().grado(7);
      } },
    { id: "aqftCircuito", target: "#aqftPanel .circuit-panel", durata: 10000,
      prima: () => A().grado(7),
      // Si scende da 7 a 1 a vista: le rotazioni tolte si spengono una distanza alla volta.
      azione: async () => {
        await dorme(1600);
        for (let k = 6; k >= 1; k -= 1) { A().grado(k); await dorme(1100); }
      } },
    { id: "aqftCosto", target: "#aqftPanel .aq-two > section:first-child", durata: 7000,
      prima: () => A().grado(1) },
    { id: "aqftEsatta", target: "#aqftPanel .aq-two > section:last-child", durata: 9500,
      prima: () => A().grado(1) },
    { id: "aqftEsegui", target: "#aqftPanel .aq-run-config", durata: 4500, coda: 600,
      prima: () => { A().grado(1); A().preset("uc1"); },
      azione: async () => { await A().confronta(); await attendi(() => A().haRisultato(), 120000); } },
    { id: "aqftRisultati", target: "#aqKpis", durata: 8000,
      prima: () => attendi(() => A().haRisultato(), 120000) },
    { id: "aqftCurva", target: "#aqCurvePanel .chart-block", durata: 7500 },
    { id: "aqftTesi", target: "#aqThesisPanel .thesis-card:nth-of-type(1) .chart-scroller", durata: 9000 },
    { id: "fine", durata: 6000 },
  ];

  /* Secondo copione, piu' corto: il circuito classico senza rumore e la sua resa,
     poi la QFT approssimata e il confronto sotto rumore. ?tour=video&copione=aqft */
  const PASSI_AQFT = [
    { id: "cfIntro", durata: 5500,
      prima: async () => { D().scheda("ideal"); D().istanza15(); await attendi(() => D().pronta()); await D().stadioIdeale(0); } },
    { id: "cfIstanza", target: "#idealPanel > .control-panel", durata: 4500,
      prima: async () => { D().scheda("ideal"); await D().stadioIdeale(0); } },
    { id: "cfCircuito", target: "#idealPanel .circuit-panel", durata: 8000,
      azione: async () => {
        for (const stadio of [1, 2, 3, 4]) { await D().stadioIdeale(stadio); await dorme(1500); }
      } },
    {
      id: "cfMisura", target: "#idealPanel .math-panel", durata: 7500, coda: 2500,
      azione: async () => {
        for (let tentativo = 0; tentativo < 6; tentativo += 1) {
          const shot = await D().stadioIdeale(5);
          if (!shot || shot.ok) return;
          await dorme(2400);
          D().chiudiPopup();
        }
      },
    },
    { id: "cfPercentuale", target: "#idealPanel .probability-strip", durata: 6500, chiudiPopup: true },
    { id: "cfAqft", target: "#aqftTab", durata: 5000, inCima: true, chiudiPopup: true,
      prima: async () => {
        D().chiudiPopup();
        D().scheda("aqft");
        await attendi(() => A() && A().pronta());
        A().preset("uc1");
        A().grado(7);
      } },
    { id: "cfTronca", target: "#aqftPanel .circuit-panel", durata: 9500,
      prima: () => A().grado(7),
      azione: async () => {
        await dorme(1500);
        for (let k = 6; k >= 1; k -= 1) { A().grado(k); await dorme(1050); }
      } },
    { id: "cfIdeale", target: "#aqftPanel .aq-two > section:last-child", durata: 8500,
      prima: () => A().grado(1) },
    { id: "cfCosto", target: "#aqftPanel .aq-two > section:first-child", durata: 6000,
      prima: () => A().grado(1) },
    { id: "cfEsegui", target: "#aqftPanel .aq-run-config", durata: 4500, coda: 600,
      prima: async () => { A().grado(1); A().preset("uc1"); A().shot(1024); A().seed(42); await attendi(() => D().pronta(), 120000); },
      azione: async () => { await A().confronta(); await attendi(() => A().haRisultato(), 120000); } },
    { id: "cfRisultati", target: "#aqKpis", durata: 8500,
      prima: () => attendi(() => A().haRisultato(), 120000) },
    { id: "cfGrafico", target: "#aqftPanel .results-panel .chart-block", durata: 6500 },
    { id: "cfFine", durata: 8000 },
  ];
  /* Copione per la commissione: scelta del numero, circuito passo per passo, Shor senza
     e con rumore, QFT approssimata. ?tour=video&copione=presentazione
     Laboratorio e scheda AQFT usano 1024 shot e lo stesso seed (42): il backend applica alla
     QFT piena la regola di seed del campione rumoroso del laboratorio, quindi il braccio
     "piena" coincide shot per shot e la stessa grandezza non compare con due valori. */
  const da = (elenco, id, extra = {}) => ({ ...elenco.find((p) => p.id === id), ...extra });
  const SEED_LAB = 42;
  async function scriviNumero(testo) {
    D().apriAltro();
    await dorme(900);
    for (let i = 1; i <= testo.length; i += 1) { D().digita(testo.slice(0, i)); await dorme(420); }
    await dorme(500);
    D().confermaNumero();
    await dorme(300);
    await attendi(() => D().istanzaPronta(), 60000);
  }
  // Durata massima del video: 1:50. Ogni tappa ha il tempo per leggere il suo fumetto.
  const PASSI_PRESENTAZIONE = [
    { id: "pIntro", durata: 4500,
      prima: async () => { D().scheda("ideal"); D().istanza15(); await attendi(() => D().pronta()); await D().stadioIdeale(0); } },
    { id: "pScelta", target: "#idealPanel > .control-panel", durata: 5500,
      prima: async () => { D().scheda("ideal"); await D().stadioIdeale(0); },
      azione: async () => { await dorme(900); D().numero(21); await attendi(() => D().istanzaPronta(), 60000); } },
    { id: "pAltro", target: "#idealPanel > .control-panel", durata: 6500,
      azione: () => scriviNumero("33") },
    { id: "pClassico", target: "#idealPanel > .control-panel", durata: 6500, coda: 1200,
      azione: async () => { await scriviNumero("14"); await dorme(500); D().avvia(); } },
    { id: "p15", target: "#idealPanel > .control-panel", durata: 3500, chiudiPopup: true,
      prima: () => D().chiudiPopup(),
      // Scegliendo 21 la demo passa al preset "Solo readout" (l'unico che N=21 regge live):
      // tornando a 15 si rimette UC1, lo stesso rumore della scheda AQFT.
      azione: async () => { await dorme(500); D().numero(15); D().preset("uc1"); await attendi(() => D().pronta(), 60000); await D().stadioIdeale(0); } },
    { id: "pCircuito", target: "#idealPanel .circuit-panel", durata: 9000,
      azione: async () => {
        for (const stadio of [1, 2, 3, 4]) { await dorme(1500); await D().stadioIdeale(stadio); }
      } },
    da(PASSI, "misura", { durata: 6500, coda: 2000 }),
    { id: "pPipeline", target: "#idealPanel .math-panel", durata: 6000, chiudiPopup: true,
      prima: () => D().chiudiPopup() },
    da(PASSI_AQFT, "cfPercentuale", { durata: 5000 }),
    // Si aspetta che le sfere sotto rumore abbiano finito: l'esperimento e il loro
    // calcolo condividono lo stesso slot di simulazione sul server.
    { id: "pEsegui", target: ".run-config", durata: 5000, coda: 600, chiudiPopup: true, inCima: false,
      prima: async () => { D().chiudiPopup(); D().scheda("noise"); D().vistaRumore("noisy"); D().dettaglioRumore(true); D().shotRumore(1024); await attendi(() => D().pronta(), 120000); },
      azione: async () => { await D().esperimento(); await attendi(() => D().haRisultato(), 120000); } },
    { id: "pRisultati", target: "#experimentResults .kpi-grid", durata: 7000,
      prima: () => attendi(() => D().haRisultato(), 120000) },
    da(PASSI_AQFT, "cfAqft", { durata: 4500 }),
    { id: "pTronca", target: "#aqftPanel .circuit-panel", durata: 7500,
      prima: () => A().grado(7),
      azione: async () => {
        await dorme(1000);
        for (let k = 6; k >= 1; k -= 1) { A().grado(k); await dorme(850); }
      } },
    da(PASSI_AQFT, "cfIdeale", { durata: 6500 }),
    { id: "pAqftEsegui", target: "#aqftPanel .aq-run-config", durata: 4500, coda: 600,
      prima: async () => { A().grado(1); A().preset("uc1"); A().shot(1024); A().seed(SEED_LAB); await attendi(() => D().pronta(), 120000); },
      azione: async () => { await A().confronta(); await attendi(() => A().haRisultato(), 120000); } },
    { id: "pAqftRisultati", target: "#aqKpis", durata: 7500,
      prima: () => attendi(() => A().haRisultato(), 120000) },
    { id: "pFine", durata: 6500 },
  ];
  /* Copione "passaggi": N = 15 stadio per stadio con QFT piena e AQFT affiancate, prima
     senza rumore e poi con UC1, e infine la resa. Durata fra 1:30 e 1:50. */
  const VISTA_STADI = "#aqStadiPanel .aq-stadi-view";
  const stadiPronti = () => attendi(() => A().stadiPronti(), 180000);
  const PASSI_PASSAGGI = [
    { id: "sIntro", durata: 5500,
      prima: async () => {
        D().scheda("aqft");
        await attendi(() => A() && A().pronta());
        A().preset("uc1"); A().grado(7);
      } },
    da(PASSI_PRESENTAZIONE, "pTronca", { durata: 8500 }),
    da(PASSI_AQFT, "cfCosto", { durata: 6000 }),
    { id: "sStato0", target: VISTA_STADI, durata: 6000,
      prima: async () => { A().grado(1); await A().stadiModo("ideale"); await stadiPronti(); A().stadiVai(0); } },
    { id: "sHadamard", target: VISTA_STADI, durata: 6000,
      azione: async () => { await dorme(700); A().stadiVai(1); } },
    { id: "sMoltiplicazioni", target: VISTA_STADI, durata: 7500,
      azione: async () => { await dorme(700); A().stadiVai(2); await dorme(2600); A().stadiVai(3); } },
    { id: "sQft", target: VISTA_STADI, durata: 8000,
      azione: async () => { await dorme(700); A().stadiVai(A().stadiQft()); } },
    da(PASSI_AQFT, "cfIdeale", { durata: 6500 }),
    { id: "sRumore", target: VISTA_STADI, durata: 10500,
      prima: async () => { await A().stadiModo("rumore"); await stadiPronti(); A().stadiVai(0); },
      azione: async () => {
        for (let i = 1; i <= A().stadiQft() - 1; i += 1) { await dorme(1800); A().stadiVai(i); }
      } },
    { id: "sRumoreQft", target: "#aqStadiPanel", durata: 10000,
      prima: () => A().stadiVai(A().stadiQft()) },
    da(PASSI_PRESENTAZIONE, "pAqftEsegui"),
    da(PASSI_PRESENTAZIONE, "pAqftRisultati", { durata: 8500 }),
    { id: "sFine", durata: 8000 },
  ];
  /* Copione "n15": solo N = 15. In ogni scheda si vede (ingrandito) che il numero e' 15,
     si esegue il circuito e sotto si legge che cosa vuol dire il risultato e il tasso di
     successo: laboratorio senza e con rumore, poi la QFT approssimata. Durata 1:30-1:50. */
  const PASSI_N15 = [
    da(PASSI_PRESENTAZIONE, "pIntro", { id: "nIntro", durata: 4500 }),
    { id: "nNumero", target: "#instancePicker", durata: 8000, zoom: 2.6,
      prima: async () => { D().scheda("ideal"); await D().stadioIdeale(0); D().apriAltro(); },
      azione: async () => { await dorme(1500); await scriviNumero("15"); await attendi(() => D().pronta(), 60000); await D().stadioIdeale(0); } },
    { id: "nEsegui", target: "#idealPanel .circuit-panel", durata: 8000,
      azione: async () => {
        for (const stadio of [1, 2, 3, 4]) { await dorme(1400); await D().stadioIdeale(stadio); }
      } },
    // Una sola misura, con il seme che da' y = 64 (periodo r = 4): niente tentativi a vista.
    da(PASSI, "misura", { durata: 6000, coda: 1800,
      azione: async () => { D().semeMisura(2); await D().stadioIdeale(5); D().semeMisura(null); } }),
    { id: "nSignificato", target: "#idealPanel .math-panel", durata: 8500, chiudiPopup: true,
      zoom: 1.3, zoomSu: "#mathPipeline", prima: () => D().chiudiPopup() },
    { id: "nSuccesso", target: "#idealPanel .probability-strip", durata: 7500, zoom: 1.5,
      zoomSu: "#idealPanel .probability-strip > article:nth-child(n+2)" },
    { id: "nRumoreN", target: "#noisePanel .noise-topbar", durata: 4500, zoom: 2.6, taglio: true,
      zoomSu: "#noisePanel .noise-topbar-row > div:first-child > .kicker", chiudiPopup: true,
      prima: async () => { D().chiudiPopup(); D().scheda("noise"); D().preset("uc1"); window.scrollTo({ top: 0 }); } },
    { id: "nRumoreConfronto", target: "#noiseStageView", durata: 9500,
      prima: async () => { D().vistaRumore("compare"); D().stadioRumore(0); await attendi(() => D().pronta(), 120000); },
      azione: async () => { for (const i of [1, 2, 3, 4]) { await dorme(1500); D().stadioRumore(i); } } },
    da(PASSI_PRESENTAZIONE, "pEsegui", { id: "nRumoreEsegui",
      prima: async () => { D().chiudiPopup(); D().scheda("noise"); D().preset("uc1"); D().vistaRumore("noisy"); D().dettaglioRumore(true); D().shotRumore(1024); await attendi(() => D().pronta(), 120000); } }),
    { id: "nRumoreRisultati", target: "#experimentResults .kpi-grid", durata: 8500, zoom: 1.9,
      zoomSu: "#experimentResults .kpi-grid > :nth-child(-n+2)",
      prima: () => attendi(() => D().haRisultato(), 120000) },
    { id: "nAqftN", target: "#aqftPanel .aq-hero .instance-badges", durata: 5500, zoom: 2.4, taglio: true,
      prima: async () => {
        D().scheda("aqft");
        await attendi(() => A() && A().pronta());
        A().preset("uc1"); A().grado(7);
        window.scrollTo({ top: 0 });
      } },
    { id: "nAqftTronca", target: "#aqftPanel .circuit-panel", durata: 7000,
      prima: () => A().grado(7),
      azione: async () => {
        await dorme(1000);
        for (let k = 6; k >= 1; k -= 1) { A().grado(k); await dorme(750); }
      } },
    da(PASSI_PRESENTAZIONE, "pAqftEsegui"),
    { id: "nAqftRisultati", target: "#aqKpis", durata: 9500, zoom: 1.9,
      zoomSu: "#aqKpis > :nth-child(-n+2)",
      prima: () => attendi(() => A().haRisultato(), 120000) },
    da(PASSI_PRESENTAZIONE, "pFine", { id: "nFine", durata: 7500 }),
  ];
  /* Copione "commissione": apertura, scelta di N = 15 ingrandita, circuito senza rumore e
     resa 75%, poi scheda 03 con QFT piena e AQFT (k = 1) affiancate, entrambe sotto UC1,
     e resa dell'AQFT. Durata fra 1:30 e 1:50. ?tour=video&copione=commissione */
  const PASSI_COMMISSIONE = [
    // Apertura come il primo video: cartello a tutto schermo con il titolo.
    { id: "kIntro", durata: 6500,
      prima: async () => { D().scheda("ideal"); D().istanza15(); await attendi(() => D().pronta()); await D().stadioIdeale(0); } },
    { id: "kNumero", target: "#instancePicker", durata: 7000, zoom: 2.6,
      prima: async () => { D().scheda("ideal"); D().istanza15(); await attendi(() => D().pronta(), 60000); await D().stadioIdeale(0); } },
    // Si inquadra solo il circuito, leggermente ingrandito.
    { id: "kCircuito", target: "#idealPanel .circuit-panel .circuit-scroller", durata: 14000,
      prima: async () => { await D().stadioIdeale(0); },
      azione: async () => {
        for (const stadio of [1, 2, 3, 4]) { await dorme(1900); await D().stadioIdeale(stadio); }
        await dorme(1900);
        D().semeMisura(2); await D().stadioIdeale(5); D().semeMisura(null);
      } },
    { id: "kSuccesso", target: "#idealPanel .probability-strip", durata: 8500, zoom: 1.5, chiudiPopup: true,
      zoomSu: "#idealPanel .probability-strip > article:nth-child(n+2)",
      prima: () => D().chiudiPopup() },
    { id: "kAqft", target: "#aqftTab", durata: 7500, inCima: true, taglio: true, chiudiPopup: true,
      prima: async () => {
        D().chiudiPopup();
        D().scheda("aqft");
        await attendi(() => A() && A().pronta());
        A().preset("uc1"); A().grado(7);
        window.scrollTo({ top: 0 });
      } },
    { id: "kTronca", target: "#aqftPanel .circuit-panel .circuit-scroller", durata: 9000, zoom: 1.2,
      prima: () => A().grado(7),
      azione: async () => {
        await dorme(1000);
        for (let k = 6; k >= 1; k -= 1) { A().grado(k); await dorme(750); }
      } },
    { id: "kStadi", target: VISTA_STADI, durata: 13500, zoom: 1.2,
      prima: async () => { A().grado(1); A().preset("uc1"); await A().stadiModo("rumore"); await stadiPronti(); A().stadiVai(0); },
      azione: async () => {
        for (let i = 1; i <= A().stadiQft() - 1; i += 1) { await dorme(1900); A().stadiVai(i); }
      } },
    { id: "kStadiQft", target: VISTA_STADI, durata: 9500, zoom: 1.2,
      prima: () => A().stadiVai(A().stadiQft()) },
    // Il confronto gira dietro le quinte: si mostra solo il risultato.
    { id: "kRisultati", target: "#aqKpis", durata: 11500, zoom: 1.9,
      zoomSu: "#aqKpis > :nth-child(-n+2)",
      prima: async () => {
        A().grado(1); A().preset("uc1"); A().shot(1024); A().seed(SEED_LAB);
        await attendi(() => D().pronta(), 120000);
        await A().confronta();
        await attendi(() => A().haRisultato(), 120000);
      } },
    { id: "kFine", durata: 9000 },
  ];
  const COPIONI = { completo: PASSI, aqft: PASSI_AQFT, presentazione: PASSI_PRESENTAZIONE, passaggi: PASSI_PASSAGGI, n15: PASSI_N15, commissione: PASSI_COMMISSIONE };
  let copione = PASSI;

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
  function inquadra(el, soloCalcolo = false) {
    const r = rettangoloLayout(el);
    const basso = window.innerHeight - ui.barra.offsetHeight - 16;
    const spazio = basso - TESTA;
    const scarto = r.height <= spazio ? TESTA + (spazio - r.height) / 2 : TESTA + MARGINE;
    // altezza di layout: quella con lo zoom gonfiato non vale, sta per sparire
    const massimo = Math.max(0, document.body.offsetHeight - window.innerHeight);
    const destinazione = Math.min(massimo, Math.max(0, r.top - scarto));
    if (!soloCalcolo) window.scrollTo({ top: destinazione, behavior: scorrimento() });
    return destinazione;
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
    ricentraZoom();
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

  /* Ingrandimento per il video. Tutto si calcola sulla posizione di layout (offsetTop),
     che la trasformazione non tocca: cosi' lo zoom parte insieme allo scorrimento, verso la
     posizione finale, e passare da uno zoom all'altro e' un solo movimento continuo.
     L'origine resta in alto a sinistra: traslazione e scala si interpolano in linea retta. */
  const DURATA_ZOOM = 1.1;   // secondi (nel video la pagina e' rallentata, la resa no)
  let zoomAttivo = false;
  let pulizia = 0;
  function rettangoloLayout(el) {
    let x = 0, y = 0, e = el;
    if (!("offsetParent" in el)) {
      const r = el.getBoundingClientRect();
      return { left: r.left + window.scrollX, top: r.top + window.scrollY, width: r.width, height: r.height };
    }
    while (e) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
    return { left: x, top: y, width: el.offsetWidth, height: el.offsetHeight };
  }
  function unione(elementi) {
    const rs = elementi.map(rettangoloLayout);
    const sx = Math.min(...rs.map((q) => q.left)), dx = Math.max(...rs.map((q) => q.left + q.width));
    const su = Math.min(...rs.map((q) => q.top)), giu = Math.max(...rs.map((q) => q.top + q.height));
    return { left: sx, top: su, width: dx - sx, height: giu - su };
  }
  function scriviZoom(shell, tx, ty, scala) {
    window.clearTimeout(pulizia);
    shell.style.transformOrigin = "0 0";
    shell.style.transition = `transform ${DURATA_ZOOM}s cubic-bezier(0.45, 0, 0.2, 1)`;
    shell.style.transform = `translate(${tx}px, ${ty}px) scale(${scala})`;
  }
  // scrollFinale: dove sta andando la pagina (lo scorrimento e' ancora in corso).
  function applicaZoom(elementi, scala, scrollFinale) {
    const shell = document.querySelector(".shell");
    if (!shell || !elementi.length) return;
    const r = unione(elementi);
    const massimo = Math.min(scala, (window.innerWidth * 0.94) / r.width, (window.innerHeight * 0.72) / r.height);
    if (massimo <= 1.02) { togliZoom(); return; }
    const sh = rettangoloLayout(shell);
    const pcx = r.left + r.width / 2 - sh.left, pcy = r.top + r.height / 2 - sh.top;
    // centro dell'elemento sullo schermo = posizione della shell + t + scala * p
    const tx = window.innerWidth / 2 - (sh.left - window.scrollX) - massimo * pcx;
    const ty = window.innerHeight * 0.42 - (sh.top - scrollFinale) - massimo * pcy;
    scriviZoom(shell, tx, ty, massimo);
    zoomAttivo = { elementi, tx, ty, massimo, da: Date.now() };
  }
  // Se mentre e' ingrandito l'elemento cambia posto (un campo che compare, un pannello
  // che si ridisegna), lo si riporta al centro spostando solo la traslazione.
  function ricentraZoom() {
    const z = zoomAttivo;
    if (!z || Date.now() - z.da < DURATA_ZOOM * 1000 + 400) return;
    const shell = document.querySelector(".shell");
    const rs = z.elementi.filter((e) => document.contains(e)).map((e) => e.getBoundingClientRect());
    if (!shell || !rs.length) return;
    const cx = (Math.min(...rs.map((q) => q.left)) + Math.max(...rs.map((q) => q.right))) / 2;
    const cy = (Math.min(...rs.map((q) => q.top)) + Math.max(...rs.map((q) => q.bottom))) / 2;
    const ddx = window.innerWidth / 2 - cx, ddy = window.innerHeight * 0.42 - cy;
    if (Math.abs(ddx) < 6 && Math.abs(ddy) < 6) return;
    z.tx += ddx; z.ty += ddy; z.da = Date.now();
    scriviZoom(shell, z.tx, z.ty, z.massimo);
  }
  function compensaScorrimento(destinazione) {
    const shell = document.querySelector(".shell");
    const salto = destinazione - window.scrollY;
    if (!shell || Math.abs(salto) < 1) return;
    const z = zoomAttivo || { tx: 0, ty: 0, massimo: 1 };
    window.clearTimeout(pulizia);
    shell.style.transition = "none";
    shell.style.transformOrigin = "0 0";
    shell.style.transform = `translate(${z.tx}px, ${z.ty + salto}px) scale(${z.massimo})`;
    window.scrollTo({ top: destinazione, behavior: "instant" });
    if (zoomAttivo) zoomAttivo.ty += salto; else zoomAttivo = { elementi: [], tx: 0, ty: salto, massimo: 1, da: Date.now() };
    void shell.offsetWidth;   // la posizione compensata e' quella da cui parte la transizione
  }
  function azzeraZoom() {
    const shell = document.querySelector(".shell");
    window.clearTimeout(pulizia);
    zoomAttivo = false;
    if (shell) { shell.style.transition = ""; shell.style.transform = ""; shell.style.transformOrigin = ""; }
  }
  // Non blocca: lo zoom si ritira mentre la tappa successiva scorre e prepara la pagina.
  function togliZoom() {
    if (!zoomAttivo) return;
    const shell = document.querySelector(".shell");
    zoomAttivo = false;
    if (!shell) return;
    shell.style.transition = `transform ${DURATA_ZOOM}s cubic-bezier(0.45, 0, 0.2, 1)`;
    shell.style.transform = "translate(0px, 0px) scale(1)";
    window.clearTimeout(pulizia);
    pulizia = window.setTimeout(() => {
      if (zoomAttivo) return;
      shell.style.transition = ""; shell.style.transform = ""; shell.style.transformOrigin = "";
    }, DURATA_ZOOM * 1000 + 100);
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
    if (indice >= copione.length) { ferma(); return; }
    const token = ++corsa.token;
    corsa.indice = indice;
    const passo = copione[indice];
    const vivo = () => corsa && corsa.token === token;
    ui.avanti.disabled = true;

    if (passo.chiudiPopup) D().chiudiPopup();
    // Cambio di scheda: e' un taglio, lo zoom della scheda vecchia sparisce di colpo.
    if (passo.taglio) azzeraZoom();
    try { if (passo.prima) await passo.prima(); } catch (e) { /* il passo prosegue comunque */ }
    if (!vivo()) return;

    target = passo.target ? elementoVisibile(passo.target) : null;
    if (passo.target && !target) { vaiA(indice + (corsa.indietro ? -1 : 1)); return; }
    corsa.indietro = false;
    mostraPasso(passo, indice + 1, copione.length);
    // Un elemento agganciato in alto (la barra delle schede) non si inquadra
    // scorrendo: si torna in cima alla pagina.
    if (passo.zoom || zoomAttivo) {
      // Con lo zoom c'e' un solo movimento: la pagina salta subito alla posizione finale e
      // una trasformazione compensa il salto (a schermo non cambia nulla), poi la
      // trasformazione scorre fino allo zoom nuovo, o a nessuno zoom.
      const destinazione = passo.inCima ? 0 : target ? inquadra(target, true) : window.scrollY;
      compensaScorrimento(destinazione);
      if (passo.zoom && target) {
        const scelti = passo.zoomSu ? [...document.querySelectorAll(passo.zoomSu)] : [];
        applicaZoom(scelti.length ? scelti : [target], passo.zoom, destinazione);
      } else togliZoom();
    } else if (passo.inCima) window.scrollTo({ top: 0, behavior: scorrimento() });
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
      mostraPasso(passo, indice + 1, copione.length);
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
    document.body.classList.toggle("tour-zoom", copione.some((p) => p.zoom));
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
    await attendi(() => D() && D().pronta() && (!A() || A().pronta()), 300000);
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
    togliZoom();
    document.removeEventListener("keydown", tasti);
    window.clearInterval(riserva);
    document.body.classList.remove("tour-attivo", "tour-video", "tour-zoom");
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
    copione = COPIONI[parametri.get("copione")] || PASSI;
    if (modo === "video") preparaVideo(ritmo);
    else if (modo === "guida" || modo === "guide") avviaGuida();
    // Cambiare lingua a tour aperto riscrive subito il fumetto corrente.
    window.I18N.onChange(() => {
      if (corsa && corsa.indice >= 0) mostraPasso(copione[corsa.indice], corsa.indice + 1, copione.length);
    });
  }

  init();
})();
