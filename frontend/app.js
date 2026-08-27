"use strict";

(() => {
  const NS = "http://www.w3.org/2000/svg";
  const MAX_SEED = 2147483647;
  const MAX_SHOTS = 2048;
  const INSTANCES = Object.freeze({
    15: Object.freeze({ N: 15, a: 7, nCount: 8, order: 4, factors: [3, 5], maxShots: 2048, dimension: 256, peaks: [0, 64, 128, 192], usefulPeaks: [64, 128, 192], idealYield: .75, randomFloor: 63 / 256 }),
    21: Object.freeze({ N: 21, a: 2, nCount: 10, order: 6, factors: [3, 7], maxShots: 128, dimension: 1024, peaks: [0, 171, 341, 512, 683, 853], usefulPeaks: [171, 512, 853], idealYield: .4925507740473057, randomFloor: 283 / 1024 }),
    35: Object.freeze({ N: 35, a: 6, nCount: 12, order: 2, factors: [5, 7], maxShots: 128, dimension: 4096, peaks: [0, 2048], usefulPeaks: [2048], idealYield: .5, randomFloor: 675 / 4096 }),
  });
  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const state = {
    instance: INSTANCES[15],
    ideal: { info: null, stage: 0, bloch: null, controller: null, requestId: 0, playing: false, timer: null },
    experiment: { controller: null, requestId: 0, running: false, preset: "uc1", hasResult: false },
  };

  function currentInstance() {
    const info = state.ideal.info;
    return info ? {
      ...state.instance,
      N: Number(info.N), a: Number(info.a), nCount: Number(info.n_count),
      order: Number(info.order), maxShots: Number(info.max_shots),
      peaks: Array.from(info.theoretical_peaks || []),
      usefulPeaks: Array.from(info.useful_peaks || []),
      idealYield: Number(info.ideal_factor_yield),
      randomFloor: Number(info.random_factor_floor),
      dimension: Number(info.dimension),
    } : state.instance;
  }

  const PRESETS = {
    none: {
      eps_1q: 0, eps_2q: 0, t1_us: 100, t2_us: 80,
      readout_0to1: 0, readout_1to0: 0, coherent_overrotation_deg: 0,
    },
    readout: {
      eps_1q: 0, eps_2q: 0, t1_us: 100, t2_us: 80,
      readout_0to1: 0.02, readout_1to0: 0.02, coherent_overrotation_deg: 0,
    },
    uc1: {
      eps_1q: 0.001, eps_2q: 0.01, t1_us: 100, t2_us: 80,
      readout_0to1: 0.02, readout_1to0: 0.02, coherent_overrotation_deg: 0,
    },
    uc2: {
      eps_1q: 0.005, eps_2q: 0.05, t1_us: 50, t2_us: 30,
      readout_0to1: 0.05, readout_1to0: 0.05, coherent_overrotation_deg: 0,
    },
  };

  const PRESET_LABELS = Object.freeze({ none: "Rumore off", readout: "Solo readout", uc1: "UC1 moderato", uc2: "UC2 stress", custom: "Personalizzato" });
  const QUANTUM_NOISE_CHANNELS = Object.freeze(["eps_1q", "eps_2q", "t1_us", "t2_us", "coherent_overrotation_deg"]);

  const CHANNELS = {
    eps_1q: { input: "eps1qInput", output: "eps1qOutput", format: percentControl },
    eps_2q: { input: "eps2qInput", output: "eps2qOutput", format: percentControl },
    t1_us: { input: "t1Input", output: "t1Output", format: (v) => `${numberIT(v, 0)} µs` },
    t2_us: { input: "t2Input", output: "t2Output", format: (v) => `${numberIT(v, 0)} µs` },
    readout_0to1: { input: "readout01Input", output: "readout01Output", format: percentControl },
    readout_1to0: { input: "readout10Input", output: "readout10Output", format: percentControl },
    coherent_overrotation_deg: { input: "overrotationInput", output: "overrotationOutput", format: (v) => `${numberIT(v, 1)}°` },
  };

  function numberIT(value, digits = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString("it-IT", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function percentControl(value) {
    const percentage = Number(value) * 100;
    const digits = percentage < 1 ? 3 : 2;
    return `${numberIT(percentage, digits)}%`;
  }

  function ratio(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.abs(n) > 1 ? n / 100 : n;
  }

  function percentMetric(value, digits = 1) {
    const r = ratio(value);
    return r == null ? "—" : `${numberIT(r * 100, digits)}%`;
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  function setStatus(id, message, kind = "") {
    const el = $(id);
    el.textContent = message;
    el.className = `status-line${kind ? ` is-${kind}` : ""}`;
  }

  function errorMessage(error) {
    if (!error) return "Errore sconosciuto.";
    if (typeof error === "string") return error;
    if (Array.isArray(error.detail)) return error.detail.map((item) => item.msg || String(item)).join("; ");
    return error.detail || error.message || "La richiesta non è riuscita.";
  }

  async function apiJSON(path, options = {}) {
    const response = await fetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(errorMessage(data) || `Errore HTTP ${response.status}`);
    return data;
  }

  function svgNode(tag, attributes = {}, text = null) {
    const element = document.createElementNS(NS, tag);
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
    if (text != null) element.textContent = String(text);
    return element;
  }

  function clearSvg(svg, title, description) {
    const labelIds = (svg.getAttribute("aria-labelledby") || "").trim().split(/\s+/).filter(Boolean);
    svg.replaceChildren();
    svg.append(
      svgNode("title", labelIds[0] ? { id: labelIds[0] } : {}, title),
      svgNode("desc", labelIds[1] ? { id: labelIds[1] } : {}, description),
    );
  }

  function activateTab(name, focus = false) {
    $$("[role='tab']").forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      $(tab.getAttribute("aria-controls")).hidden = !active;
      if (active && focus) tab.focus();
    });
    if (name !== "ideal") stopPlayback();
  }

  function setupTabs() {
    const tabs = $$("[role='tab']");
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => activateTab(tab.dataset.tab));
      tab.addEventListener("keydown", (event) => {
        let target = null;
        if (event.key === "ArrowRight") target = (index + 1) % tabs.length;
        if (event.key === "ArrowLeft") target = (index - 1 + tabs.length) % tabs.length;
        if (event.key === "Home") target = 0;
        if (event.key === "End") target = tabs.length - 1;
        if (target != null) { event.preventDefault(); activateTab(tabs[target].dataset.tab, true); }
      });
    });
  }

  const STAGE_COPY = {
    init0: {
      title: "Stato iniziale",
      text: "I qubit di conteggio e il registro di lavoro partono in stati computazionali definiti.",
      operation: "Preparazione |0…0⟩",
      observe: "Le frecce puntano verso |0⟩ e hanno lunghezza unitaria.",
    },
    init: {
      title: "Preparazione della sovrapposizione",
      text: "Gli Hadamard creano una sovrapposizione uniforme sugli otto qubit di conteggio; il registro di lavoro viene posto in |1⟩.",
      operation: "H⊗⁸ sul conteggio, X sul lavoro",
      observe: "Le frecce dei qubit di conteggio ruotano verso l’equatore.",
    },
    u: {
      title: "Esponenziazione modulare controllata",
      text: "Il controllo applica una potenza di Uₐ al registro di lavoro. La periodicità di 7ˣ mod 15 viene codificata nelle fasi.",
      operation: "U(a²ᵏ) controllata",
      observe: "Conteggio e lavoro si entangliano: alcune frecce di Bloch si accorciano.",
    },
    qft: {
      title: "Trasformata di Fourier inversa",
      text: "La QFT⁻¹ converte l’informazione di fase in picchi misurabili separati da 64.",
      operation: "QFT⁻¹ sul registro di conteggio",
      observe: "Le ampiezze interferiscono e si concentrano presso 0, 64, 128 e 192.",
    },
    measure: {
      title: "Misura e post-processing",
      text: "Gli otto qubit collassano in un bitstring. L’intero y alimenta la frazione continua e i MCD classici.",
      operation: "Misura c₀…c₇",
      observe: "Il simbolo ✓ indica un esito da cui il post-processing ricava i due fattori; × indica uno shot non risolutivo.",
    },
  };

  function setIdealBusy(busy) {
    ["prevStageBtn", "nextStageBtn", "newMeasureBtn", "stepModeBtn"].forEach((id) => { $(id).disabled = busy; });
    if (!busy) updateIdealButtons();
  }

  function updateIdealButtons() {
    const ready = Boolean(state.ideal.info);
    const last = ready ? state.ideal.info.stages.length - 1 : 0;
    $("playStageBtn").disabled = !ready;
    $("stepModeBtn").disabled = !ready;
    $("prevStageBtn").disabled = !ready || state.ideal.stage === 0;
    $("nextStageBtn").disabled = !ready || state.ideal.stage >= last;
    $("newMeasureBtn").disabled = !ready;
    $("stageNavCounter").textContent = ready ? `${state.ideal.stage + 1} / ${last + 1}` : "— / —";
  }

  function updateInstancePresentation() {
    const instance = currentInstance();
    const M = instance.dimension || 2 ** instance.nCount;
    const peaks = instance.peaks || [];
    const idealYield = Number.isFinite(instance.idealYield) ? instance.idealYield : null;
    const twoShot = idealYield == null ? null : 1 - (1 - idealYield) ** 2;
    const blochOk = state.ideal.info?.bloch_ok !== false;
    $("instanceABadge").textContent = `a = ${instance.a}`;
    $("instanceCountBadge").textContent = `t = ${instance.nCount} qubit`;
    $("theoreticalPeaks").textContent = peaks.length ? peaks.join(" · ") : "—";
    const spacing = M / instance.order;
    $("peakExplanation").innerHTML = `Posizioni vicine ai multipli di <span class="mono">2^${instance.nCount} / r = ${numberIT(spacing, Number.isInteger(spacing) ? 0 : 2)}</span>, con <span class="mono">r=${instance.order}</span>.`;
    $("singleShotProbability").textContent = idealYield == null ? "—" : `≈ ${percentMetric(idealYield, 2)}`;
    $("singleShotExplanation").textContent = `Il post-processing verifica ogni esito misurato e, quando è utile, ne ricava i due divisori di ${instance.N}.`;
    $("twoShotProbability").textContent = twoShot == null ? "—" : `≈ ${percentMetric(twoShot, 2)}`;
    $("twoShotExplanation").textContent = "Due tentativi indipendenti aumentano la probabilità cumulativa di osservare almeno un esito utile.";
    $("stateViewNoteTitle").textContent = blochOk ? "Nota sulle sfere" : "Vista strutturale";
    $("stateViewNote").textContent = blochOk
      ? "Mostra i soli qubit di conteggio. In presenza di entanglement, il singolo qubit ha uno stato misto e il vettore si contrae verso il centro."
      : "Gli stadi, i controlli e la misura restano quelli del circuito validato. L’esito ideale è campionato dalla legge QPE esatta a registro finito.";
    $("randomBaselineValue").textContent = percentMetric(instance.randomFloor);
    $("randomBaseline").title = `Successo del post-processing su una distribuzione uniforme dei ${M} esiti`;
    $("idealBaselineText").innerHTML = `<strong>Riferimento ideale teorico per N=${instance.N}:</strong> picchi presso <span class="mono">${peaks.join(", ")}</span>; probabilità teorica di fattorizzazione per shot ≈ <strong>${percentMetric(idealYield, 2)}</strong>. I dati dell’esperimento sono generati live con Qiskit Aer.`;
    $("chartAxisHelp").textContent = `Asse 0…${M - 1}. Le linee verticali segnano ${peaks.length} picchi teorici.`;
    resetPipeline();
    updateShotBudget();
    updateSnapshot();
  }

  function updateShotBudget() {
    const instance = currentInstance();
    let maximum = instance.maxShots || MAX_SHOTS;
    if (instance.N === 35) {
      const quantumActive = QUANTUM_NOISE_CHANNELS.some((key) => {
        const element = $(CHANNELS[key]?.input);
        const toggle = element?.closest(".noise-control")?.querySelector(".channel-toggle");
        return toggle?.checked && Number(element.value) !== 0;
      });
      if (quantumActive) maximum = Math.min(maximum, 32);
    }
    const select = $("shotsInput");
    Array.from(select.options).forEach((option) => { option.disabled = Number(option.value) > maximum; });
    if (Number(select.value) > maximum) select.value = maximum >= 64 ? "64" : String(maximum);
  }

  async function initIdeal() {
    const instance = state.instance;
    stopPlayback();
    state.ideal.info = null;
    state.ideal.bloch = null;
    state.ideal.stage = 0;
    state.ideal.controller?.abort();
    const requestId = ++state.ideal.requestId;
    setStatus("idealStatus", `Preparo il circuito ideale N=${instance.N}, a=${instance.a}…`, "loading");
    $("playStageBtn").disabled = true;
    try {
      const info = await apiJSON(`/api/factor?N=${instance.N}`);
      if (requestId !== state.ideal.requestId) return;
      if (info.done) throw new Error(`Il backend ha risolto N=${instance.N} nel pre-processing e non ha costruito il circuito.`);
      state.ideal.info = info;
      updateInstancePresentation();
      await loadStage(0);
    } catch (error) {
      setStatus("idealStatus", `Circuito non disponibile: ${errorMessage(error)}`, "error");
      renderCircuit(null, null);
    }
  }

  async function loadStage(index) {
    const info = state.ideal.info;
    if (!info) return;
    const target = clamp(Number(index) || 0, 0, info.stages.length - 1);
    const requestId = ++state.ideal.requestId;
    state.ideal.controller?.abort();
    const controller = new AbortController();
    state.ideal.controller = controller;
    setIdealBusy(true);
    setStatus("idealStatus", `${info.bloch_ok ? "Calcolo dello stato ridotto" : "Preparo lo stadio del circuito"} · ${info.stages[target].label}…`, "loading");
    try {
      let bloch;
      if (info.bloch_ok) {
        const query = new URLSearchParams({ N: String(info.N), a: String(info.a), n_count: String(info.n_count), stage: String(target) });
        bloch = await apiJSON(`/api/bloch?${query}`, { signal: controller.signal });
      } else {
        const stage = info.stages[target];
        let measuredShot = null;
        let measurementSeed = null;
        if (stage.kind === "measure") {
          const sample = await apiJSON(`/api/ideal-sample?N=${info.N}`, { signal: controller.signal });
          measuredShot = sample.measured_shot;
          measurementSeed = sample.seed;
        }
        bloch = {
          stage: target, n_stages: info.stages.length, label: stage.label,
          kind: stage.kind, control: stage.control, n_count: info.n_count,
          num_qubits: info.num_qubits, qubits: [], measured_shot: measuredShot,
          measurement_seed: measurementSeed, structural_view: true,
        };
      }
      if (requestId !== state.ideal.requestId) return;
      state.ideal.stage = target;
      state.ideal.bloch = bloch;
      renderCircuit(info, bloch);
      renderStageExplanation(info.stages[target], target, info.stages.length);
      if (bloch.kind === "measure" && bloch.measured_shot) renderPipeline(bloch.measured_shot);
      else resetPipeline();
      const source = info.bloch_ok ? "stato ridotto esatto" : "vista strutturale; misura dalla legge QPE esatta";
      setStatus("idealStatus", `Stadio ${target + 1} di ${info.stages.length}: ${bloch.label || info.stages[target].label} · ${source}.`, "success");
    } catch (error) {
      if (error.name !== "AbortError" && requestId === state.ideal.requestId) setStatus("idealStatus", `Impossibile calcolare lo stadio: ${errorMessage(error)}`, "error");
    } finally {
      if (requestId === state.ideal.requestId) setIdealBusy(false);
    }
  }

  function renderStageExplanation(stage, index, count) {
    const instance = currentInstance();
    const copy = { ...(STAGE_COPY[stage.kind] || STAGE_COPY.init0) };
    if (stage.kind === "init") {
      copy.text = `Gli Hadamard creano una sovrapposizione uniforme sui ${instance.nCount} qubit di conteggio; il registro di lavoro viene posto in |1⟩.`;
      copy.operation = `H⊗${instance.nCount} sul conteggio, X sul lavoro`;
    } else if (stage.kind === "u") {
      copy.text = `Il controllo applica una potenza di Uₐ al registro di lavoro. La periodicità di ${instance.a}ˣ mod ${instance.N} viene codificata nelle fasi.`;
    } else if (stage.kind === "qft") {
      copy.text = `La QFT⁻¹ converte l’informazione dell’ordine r=${instance.order} nei picchi misurabili della distribuzione.`;
      copy.observe = `Le ampiezze si concentrano presso ${instance.peaks.join(", ")}.`;
    } else if (stage.kind === "measure") {
      copy.text = `I ${instance.nCount} qubit di conteggio producono un bitstring; y alimenta frazioni continue e MCD.`;
      copy.operation = `Misura c₀…c${instance.nCount - 1}`;
      copy.observe = "✓ indica un esito da cui si ricavano i due fattori; × uno shot non risolutivo.";
    }
    $("stageExplanationTitle").textContent = copy.title;
    $("stageExplanation").textContent = copy.text;
    $("stageOperation").textContent = stage.label || copy.operation;
    $("stageObserve").textContent = copy.observe;
    $("stageChip").textContent = `Stadio ${index + 1}/${count}`;
  }

  function stopPlayback() {
    state.ideal.playing = false;
    if (state.ideal.timer) window.clearTimeout(state.ideal.timer);
    state.ideal.timer = null;
    $("playStageBtn").textContent = "Avvia automatico";
  }

  async function playbackStep() {
    if (!state.ideal.playing || !state.ideal.info) return;
    const last = state.ideal.info.stages.length - 1;
    if (state.ideal.stage >= last) { stopPlayback(); return; }
    await loadStage(state.ideal.stage + 1);
    if (!state.ideal.playing) return;
    if (state.ideal.stage >= last) { stopPlayback(); return; }
    state.ideal.timer = window.setTimeout(playbackStep, 1050);
  }

  function togglePlayback() {
    if (state.ideal.playing) { stopPlayback(); return; }
    if (!state.ideal.info) return;
    state.ideal.playing = true;
    $("playStageBtn").textContent = "Pausa";
    const last = state.ideal.info.stages.length - 1;
    const begin = state.ideal.stage >= last ? loadStage(0) : Promise.resolve();
    begin.then(() => { if (state.ideal.playing) state.ideal.timer = window.setTimeout(playbackStep, 350); });
  }

  function phaseColor(x, y) {
    const hue = ((((Math.atan2(y, x) / (2 * Math.PI)) + 1) % 1) * 360).toFixed(0);
    return `hsl(${hue} 78% 68%)`;
  }

  function renderCircuit(info, bloch) {
    const svg = $("circuitSvg");
    const instance = currentInstance();
    clearSvg(
      svg,
      `Circuito ideale di Shor per N uguale a ${instance.N}`,
      bloch ? `Stadio ${bloch.stage + 1}: ${bloch.label}. ${info?.bloch_ok ? `A destra sono rappresentati gli stati ridotti dei ${instance.nCount} qubit di conteggio.` : `Vista strutturale del circuito validato a ${info?.num_qubits} qubit.`}` : "Circuito non disponibile.",
    );
    if (!info) {
      svg.append(svgNode("text", { x: 540, y: 290, fill: "var(--red)", "text-anchor": "middle", "font-size": 16 }, "Circuito non disponibile"));
      return;
    }

    const stages = info.stages || [];
    const nCount = Number(info.n_count) || instance.nCount;
    const showBloch = info.bloch_ok !== false;
    const width = 1080;
    const top = 66;
    const row = 57;
    const workY = top + nCount * row + 30;
    const height = workY + 54;
    const wireStart = 62;
    const wireEnd = showBloch ? 790 : 1020;
    const sphereX = 984;
    const radius = 18;
    const stageStart = 105;
    const stageEnd = showBloch ? 735 : 960;
    const stageX = (index) => stages.length < 2 ? stageStart : stageStart + index * (stageEnd - stageStart) / (stages.length - 1);
    const yOf = (index) => top + index * row;
    const current = bloch ? Number(bloch.stage) : state.ideal.stage;

    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.append(svgNode("text", { x: 25, y: 28, class: "c-register" }, "REGISTRO DI CONTEGGIO"));
    svg.append(svgNode("text", { x: sphereX, y: 28, class: "c-state-label" }, showBloch ? "STATO RIDOTTO" : `${info.num_qubits} QUBIT TOTALI · VISTA STRUTTURALE`));

    for (let i = 0; i < nCount; i += 1) {
      const y = yOf(i);
      svg.append(svgNode("text", { x: 26, y: y + 4, class: "c-label" }, `c${i}`));
      svg.append(svgNode("line", { x1: wireStart, y1: y, x2: wireEnd, y2: y, class: "c-wire" }));
      if (showBloch) svg.append(svgNode("line", { x1: wireEnd, y1: y, x2: sphereX - radius - 8, y2: y, class: "c-wire", "stroke-dasharray": "2 5" }));
    }
    svg.append(svgNode("text", { x: 26, y: workY + 4, class: "c-label" }, "w"));
    svg.append(svgNode("line", { x1: wireStart, y1: workY, x2: wireEnd, y2: workY, class: "c-wire c-wire-work" }));
    svg.append(svgNode("text", { x: 68, y: workY + 25, class: "c-register" }, "REGISTRO DI LAVORO COMPRESSO"));

    stages.forEach((stage, index) => {
      const x = stageX(index);
      const activeClass = index === current ? " c-active" : "";
      if (stage.kind === "init") {
        for (let q = 0; q < nCount; q += 1) {
          svg.append(svgNode("rect", { x: x - 14, y: yOf(q) - 14, width: 28, height: 28, rx: 6, class: `c-gate${activeClass}` }));
          svg.append(svgNode("text", { x, y: yOf(q), class: "c-gate-label" }, "H"));
        }
        svg.append(svgNode("rect", { x: x - 14, y: workY - 14, width: 28, height: 28, rx: 6, class: `c-gate${activeClass}` }));
        svg.append(svgNode("text", { x, y: workY, class: "c-gate-label" }, "X"));
      } else if (stage.kind === "u") {
        const control = Number.isInteger(stage.control) ? stage.control : 0;
        const controlY = yOf(control);
        svg.append(svgNode("line", { x1: x, y1: controlY, x2: x, y2: workY, stroke: index === current ? "var(--amber)" : "var(--dim)", "stroke-width": index === current ? 2.2 : 1.4 }));
        svg.append(svgNode("circle", { cx: x, cy: controlY, r: 5.5, fill: index === current ? "var(--amber)" : "var(--dim)" }));
        svg.append(svgNode("rect", { x: x - 27, y: workY - 17, width: 54, height: 34, rx: 7, class: `c-gate${activeClass}` }));
        svg.append(svgNode("text", { x, y: workY, class: "c-gate-label" }, "Uₐ"));
      } else if (stage.kind === "qft") {
        const yTop = yOf(0) - 17;
        const boxHeight = yOf(nCount - 1) - yOf(0) + 34;
        svg.append(svgNode("rect", { x: x - 31, y: yTop, width: 62, height: boxHeight, rx: 9, class: `c-gate${activeClass}`, stroke: index === current ? "var(--amber)" : "var(--pink)" }));
        svg.append(svgNode("text", { x, y: yTop + boxHeight / 2, class: "c-gate-label", transform: `rotate(-90 ${x} ${yTop + boxHeight / 2})` }, "QFT⁻¹"));
      } else if (stage.kind === "measure") {
        for (let q = 0; q < nCount; q += 1) {
          svg.append(svgNode("rect", { x: x - 14, y: yOf(q) - 14, width: 28, height: 28, rx: 6, class: `c-gate${activeClass}`, stroke: index === current ? "var(--amber)" : "var(--green)" }));
          svg.append(svgNode("text", { x, y: yOf(q), class: "c-gate-label" }, "M"));
        }
      }
      if (stage.kind !== "init0") svg.append(svgNode("text", { x, y: height - 9, class: "c-state-label" }, index + 1));
    });

    const playX = stageX(current);
    svg.append(svgNode("line", { x1: playX, y1: 37, x2: playX, y2: height - 29, class: "c-playhead" }));
    svg.append(svgNode("text", { x: playX, y: 48, class: "c-play-label" }, "▼ ORA"));

    if (showBloch) for (let i = 0; i < nCount; i += 1) {
      const y = yOf(i);
      const q = bloch?.qubits?.[i];
      const group = svgNode("g", {});
      group.append(svgNode("circle", { cx: sphereX, cy: y, r: radius, class: "c-sphere", stroke: q?.active ? "var(--amber)" : "var(--line-strong)", "stroke-width": q?.active ? 2 : 1 }));
      group.append(svgNode("ellipse", { cx: sphereX, cy: y, rx: radius, ry: radius * .31, class: "c-sphere-axis" }));
      group.append(svgNode("line", { x1: sphereX, y1: y - radius, x2: sphereX, y2: y + radius, class: "c-sphere-axis" }));
      if (q) {
        const color = q.collapsed ? (q.ok ? "var(--green)" : "var(--red)") : (Number(q.len) < .82 ? "var(--cyan)" : phaseColor(Number(q.x), Number(q.y)));
        const endX = sphereX + Number(q.x) * radius * .9;
        const endY = y - Number(q.z) * radius * .88 + Number(q.y) * radius * .25;
        group.append(svgNode("line", { x1: sphereX, y1: y, x2: endX.toFixed(2), y2: endY.toFixed(2), class: "c-bloch-arrow", stroke: color }));
        group.append(svgNode("circle", { cx: endX.toFixed(2), cy: endY.toFixed(2), r: 3, fill: color }));
        const status = q.collapsed ? `${q.ok ? "✓" : "×"} ${q.ket}` : q.ket;
        group.append(svgNode("text", { x: sphereX, y: y + radius + 14, class: "c-ket", fill: color }, status));
      } else {
        group.append(svgNode("text", { x: sphereX, y: y + 3, class: "c-ket" }, "…"));
      }
      svg.append(group);
    }
  }

  function gcd(a, b) {
    let x = Math.abs(Math.trunc(a));
    let y = Math.abs(Math.trunc(b));
    while (y) [x, y] = [y, x % y];
    return x;
  }

  function modPow(base, exponent, modulus) {
    let result = 1;
    let value = base % modulus;
    let exp = Math.max(0, Math.trunc(exponent));
    while (exp > 0) {
      if (exp % 2 === 1) result = (result * value) % modulus;
      value = (value * value) % modulus;
      exp = Math.floor(exp / 2);
    }
    return result;
  }

  function closestFraction(value, maxDenominator) {
    let best = { numerator: 0, denominator: 1, error: Math.abs(value) };
    for (let denominator = 1; denominator <= maxDenominator; denominator += 1) {
      const numerator = Math.round(value * denominator);
      const error = Math.abs(value - numerator / denominator);
      if (error < best.error - Number.EPSILON) best = { numerator, denominator, error };
    }
    const divisor = gcd(best.numerator, best.denominator) || 1;
    return { numerator: best.numerator / divisor, denominator: best.denominator / divisor };
  }

  let resultPopupTimer = null;
  let resultPopupOpener = null;

  function hideResultPopup() {
    const popup = $("resultPopup");
    if (popup.hidden) return;
    if (resultPopupTimer) { window.clearTimeout(resultPopupTimer); resultPopupTimer = null; }
    popup.hidden = true;
    // Restituisce il focus a chi ha aperto il popup: senza, la tastiera
    // ripartirebbe dall'inizio del documento.
    if (resultPopupOpener && document.contains(resultPopupOpener)) resultPopupOpener.focus();
    resultPopupOpener = null;
  }

  function showResultPopup(success, title, detail) {
    const popup = $("resultPopup");
    popup.className = `result-popup ${success ? "is-success" : "is-failure"}`;
    $("resultPopupKicker").textContent = success ? "Fattori trovati" : "Shot non risolutivo";
    $("resultPopupTitle").textContent = title;
    $("resultPopupDetail").textContent = detail;
    if (popup.hidden) resultPopupOpener = document.activeElement;
    popup.hidden = false;
    $("resultPopupClose").focus();
    if (resultPopupTimer) window.clearTimeout(resultPopupTimer);
    resultPopupTimer = window.setTimeout(hideResultPopup, 5200);
  }

  function resetPipeline() {
    const instance = currentInstance();
    hideResultPopup();   // uscendo dallo stadio di misura il popup non resta appeso
    $("pipelineResult").className = "result-badge";
    $("pipelineResult").textContent = "In attesa della misura";
    $("mathPipeline").innerHTML = `
      <li><span>1</span><small>Misura</small><strong>y = —</strong><p>Esito sui ${instance.nCount} bit classici.</p></li>
      <li><span>2</span><small>Fase</small><strong>y / 2^${instance.nCount} = —</strong><p>Stima della fase periodica.</p></li>
      <li><span>3</span><small>Frazione continua</small><strong>≈ s / r</strong><p>Il denominatore propone l’ordine.</p></li>
      <li><span>4</span><small>Ordine candidato</small><strong>r = —</strong><p>Deve essere pari e verificabile.</p></li>
      <li><span>5</span><small>MCD</small><strong>gcd(${instance.a}ʳᐟ² ± 1, ${instance.N})</strong><p>Estrae eventuali divisori non banali.</p></li>`;
  }

  function renderPipeline(shot) {
    const instance = currentInstance();
    const dimension = instance.dimension || 2 ** instance.nCount;
    const y = clamp(Math.trunc(Number(shot.value) || 0), 0, dimension - 1);
    const phase = y / dimension;
    const fraction = closestFraction(phase, instance.N);
    const r = fraction.denominator;
    const even = r % 2 === 0;
    const verified = even && modPow(instance.a, r, instance.N) === 1;
    const halfPower = even ? instance.a ** (r / 2) : null;
    const gMinus = even ? gcd(halfPower - 1, instance.N) : null;
    const gPlus = even ? gcd(halfPower + 1, instance.N) : null;
    const computedFactors = [gMinus, gPlus].filter((v) => v != null && v > 1 && v < instance.N);
    const success = Boolean(shot.ok) || computedFactors.length > 0;
    const factorA = Number(shot.p) || computedFactors[0] || null;
    const factorB = Number(shot.q) || (factorA ? instance.N / factorA : null);
    const result = $("pipelineResult");
    result.className = `result-badge ${success ? "is-success" : "is-failure"}`;
    result.textContent = success ? `✓ ${instance.N} = ${factorA} × ${factorB}` : "× Shot non risolutivo";
    const orderText = verified ? "ordine verificato" : (even ? "candidato parziale" : "denominatore dispari");
    const gcdText = even ? `gcd(${halfPower}−1,${instance.N})=${gMinus}; gcd(${halfPower}+1,${instance.N})=${gPlus}` : "r dispari: MCD non applicabili";
    $("mathPipeline").innerHTML = `
      <li class="${success ? "is-success" : "is-failure"}"><span>1</span><small>Misura</small><strong>y = ${y}</strong><p>Bitstring ${String(shot.bits || y.toString(2).padStart(instance.nCount, "0"))}.</p></li>
      <li><span>2</span><small>Fase</small><strong>${y} / ${dimension} = ${numberIT(phase, 4)}</strong><p>Stima prodotta dalla QFT⁻¹.</p></li>
      <li><span>3</span><small>Frazione continua</small><strong>≈ ${fraction.numerator} / ${fraction.denominator}</strong><p>Denominatore limitato a N=${instance.N}.</p></li>
      <li class="${verified ? "is-success" : ""}"><span>4</span><small>Ordine candidato</small><strong>r = ${r}</strong><p>${orderText}; ${instance.a}ʳ mod ${instance.N} = ${modPow(instance.a, r, instance.N)}.</p></li>
      <li class="${success ? "is-success" : "is-failure"}"><span>5</span><small>MCD</small><strong>${gcdText}</strong><p>${success ? `Divisori non banali: ${factorA} e ${factorB}.` : "Ripetere lo shot è parte dell’algoritmo."}</p></li>`;
    showResultPopup(
      success,
      success ? `${instance.N} = ${factorA} × ${factorB}` : `y = ${y}`,
      success
        ? `Dallo shot y = ${y} le frazioni continue danno r = ${r}, e i MCD estraggono i due divisori.`
        : `Lo shot y = ${y} non porta a un ordine utilizzabile: ripetere la misura fa parte dell’algoritmo.`,
    );
  }

  function channelElements(key) {
    const config = CHANNELS[key];
    const input = $(config.input);
    const article = input.closest(".noise-control");
    return { config, input, output: $(config.output), article, toggle: article.querySelector(".channel-toggle") };
  }

  function constrainThermalTimes(changedKey = "") {
    const t1 = channelElements("t1_us");
    const t2 = channelElements("t2_us");
    const thermalOn = t1.toggle.checked && t2.toggle.checked;
    const maxT2 = thermalOn ? Math.min(300, Number(t1.input.value) * 2) : 300;
    t2.input.max = String(maxT2);
    if (thermalOn && Number(t2.input.value) > maxT2) {
      t2.input.value = String(maxT2);
      if (changedKey === "t1_us") setStatus("experimentStatus", `T₂ adeguato a ${maxT2} µs per rispettare T₂ ≤ 2T₁.`, "success");
    }
  }

  function refreshNoiseUI() {
    constrainThermalTimes();
    Object.keys(CHANNELS).forEach((key) => {
      const { config, input, output, article, toggle } = channelElements(key);
      const restricted = (state.instance.N === 21 && QUANTUM_NOISE_CHANNELS.includes(key))
        || (state.instance.N === 35 && key === "coherent_overrotation_deg");
      if (restricted) toggle.checked = false;
      toggle.disabled = restricted;
      input.disabled = restricted || !toggle.checked;
      article.classList.toggle("is-off", !toggle.checked);
      article.classList.toggle("is-restricted", restricted);
      output.textContent = config.format(input.value);
    });
    $$(".preset").forEach((button) => {
      const unavailable = state.instance.N === 21 && ["uc1", "uc2"].includes(button.dataset.preset);
      button.disabled = state.experiment.running || unavailable;
      button.title = unavailable ? "Per N=21 il rumore di gate supera il budget live; usa Solo readout." : "";
    });
    $("newRealizationBtn").disabled = $("seedLockInput").checked;
    updateShotBudget();
    updateSnapshot();
  }

  function markCustom() {
    state.experiment.preset = "custom";
    $$(".preset").forEach((button) => {
      const active = button.dataset.preset === "custom";
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (state.experiment.hasResult && !state.experiment.running) setStatus("experimentStatus", "Parametri modificati: riesegui per aggiornare il confronto.");
  }

  function setThermalEnabled(enabled) {
    channelElements("t1_us").toggle.checked = enabled;
    channelElements("t2_us").toggle.checked = enabled;
  }

  function applyPreset(name) {
    if (!PRESETS[name]) { markCustom(); return; }
    state.experiment.preset = name;
    Object.entries(PRESETS[name]).forEach(([key, value]) => {
      const { input, toggle } = channelElements(key);
      input.value = String(value);
      toggle.checked = name !== "none" && key !== "coherent_overrotation_deg"
        && (name !== "readout" || key.startsWith("readout_"));
    });
    setThermalEnabled(name === "uc1" || name === "uc2");
    $$(".preset").forEach((button) => {
      const active = button.dataset.preset === name;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    refreshNoiseUI();
    setStatus("experimentStatus", `${PRESET_LABELS[name]} caricato. Avvia il confronto per applicarlo.`);
  }

  function collectNoise() {
    const noise = {};
    Object.keys(CHANNELS).forEach((key) => {
      const { input, toggle } = channelElements(key);
      if (toggle.checked) noise[key] = Number(input.value);
      else noise[key] = key === "t1_us" || key === "t2_us" ? null : 0;
    });
    return noise;
  }

  function normalizedSeed() {
    const value = Math.trunc(Number($("seedInput").value));
    const seed = Number.isFinite(value) ? clamp(value, 0, MAX_SEED) : 42;
    $("seedInput").value = String(seed);
    return seed;
  }

  function randomSeed() {
    if (globalThis.crypto?.getRandomValues) {
      const values = new Uint32Array(1);
      globalThis.crypto.getRandomValues(values);
      return values[0] % (MAX_SEED + 1);
    }
    return Math.floor(Math.random() * (MAX_SEED + 1));
  }

  function configSnapshot() {
    const instance = currentInstance();
    return {
      N: instance.N,
      shots: clamp(Math.trunc(Number($("shotsInput").value)) || 512, 10, instance.maxShots || MAX_SHOTS),
      seed: normalizedSeed(),
      noise: collectNoise(),
      preset: state.experiment.preset,
    };
  }

  function updateSnapshot(snapshot = null, running = false) {
    const config = snapshot || configSnapshot();
    const active = Object.entries(config.noise).filter(([, value]) => value != null && Number(value) !== 0).map(([key]) => key);
    const label = PRESET_LABELS[config.preset] || "Personalizzato";
    $("configSnapshot").textContent = `${running ? "Esecuzione congelata" : "Configurazione pronta"}: N=${config.N} · ${label} · ${config.shots} shot · seed ${config.seed}${$("seedLockInput").checked ? " bloccato" : " modificabile"} · ${active.length ? `${active.length} parametri di rumore attivi` : "nessun rumore"}.`;
  }

  function setExperimentBusy(busy) {
    state.experiment.running = busy;
    $("experimentControls").disabled = busy;
    $("instanceSelect").disabled = busy;
    $$(".preset").forEach((button) => { button.disabled = busy; });
    if (!busy) refreshNoiseUI();
  }

  function setupNoiseControls() {
    $$(".preset").forEach((button) => button.addEventListener("click", () => applyPreset(button.dataset.preset)));
    Object.keys(CHANNELS).forEach((key) => {
      const { input, toggle } = channelElements(key);
      input.addEventListener("input", () => {
        if (key === "t1_us") constrainThermalTimes("t1_us");
        CHANNELS[key].format && ($(CHANNELS[key].output).textContent = CHANNELS[key].format(input.value));
        markCustom();
        updateSnapshot();
      });
      toggle.addEventListener("change", () => {
        if (key === "t1_us" || key === "t2_us") {
          setThermalEnabled(toggle.checked);
          setStatus("experimentStatus", toggle.checked ? "Canale termico T₁/T₂ attivato come coppia fisicamente valida." : "Canale termico T₁/T₂ disattivato.");
        }
        markCustom();
        refreshNoiseUI();
      });
    });
    $("shotsInput").addEventListener("change", updateSnapshot);
    $("seedInput").addEventListener("change", () => { normalizedSeed(); updateSnapshot(); });
    $("seedLockInput").addEventListener("change", refreshNoiseUI);
    $("newRealizationBtn").addEventListener("click", () => {
      if ($("seedLockInput").checked) return;
      $("seedInput").value = String(randomSeed());
      updateSnapshot();
      runExperiment();
    });
    $("runExperimentBtn").addEventListener("click", runExperiment);
    applyPreset("uc1");
  }

  async function runExperiment() {
    if (state.experiment.running) return;
    const snapshot = configSnapshot();
    if ((snapshot.noise.t1_us == null) !== (snapshot.noise.t2_us == null)) {
      setStatus("experimentStatus", "T₁ e T₂ devono essere attivati o disattivati insieme.", "error");
      return;
    }
    if (snapshot.noise.t1_us != null && snapshot.noise.t2_us > 2 * snapshot.noise.t1_us) {
      setStatus("experimentStatus", "Configurazione non fisica: deve valere T₂ ≤ 2T₁.", "error");
      return;
    }
    const requestId = ++state.experiment.requestId;
    state.experiment.controller?.abort();
    const controller = new AbortController();
    state.experiment.controller = controller;
    setExperimentBusy(true);
    updateSnapshot(snapshot, true);
    setStatus("experimentStatus", `Simulo N=${snapshot.N}: ${snapshot.shots} shot ideali e ${snapshot.shots} rumorosi con seed ${snapshot.seed}…`, "loading");
    try {
      const response = await apiJSON("/api/experiment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ N: snapshot.N, shots: snapshot.shots, seed: snapshot.seed, noise: snapshot.noise }),
        signal: controller.signal,
      });
      if (requestId !== state.experiment.requestId) return;
      renderExperiment(response, snapshot);
      state.experiment.hasResult = true;
      const independent = response.metadata?.simulation_seeds?.independent_streams === true;
      const streamNote = independent
        ? "stream ideali e rumorosi indipendenti"
        : "stesso campione riusato perché il rumore è disattivato";
      setStatus("experimentStatus", `Confronto completato: ${response.shots ?? response.config?.shots ?? snapshot.shots} shot per distribuzione; seed radice ${response.seed ?? response.config?.seed ?? snapshot.seed}, ${streamNote}.`, "success");
    } catch (error) {
      if (error.name !== "AbortError" && requestId === state.experiment.requestId) setStatus("experimentStatus", `Esperimento non riuscito: ${errorMessage(error)}`, "error");
    } finally {
      if (requestId === state.experiment.requestId) setExperimentBusy(false);
    }
  }

  function ciText(value) {
    if (!value) return "IC 95% non disponibile";
    const low = Array.isArray(value) ? value[0] : (value.lower ?? value.low ?? value.min);
    const high = Array.isArray(value) ? value[1] : (value.upper ?? value.high ?? value.max);
    return low == null || high == null ? "IC 95% non disponibile" : `IC 95% ${percentMetric(low)}–${percentMetric(high)}`;
  }

  function formatFactors(value) {
    if (value == null || (Array.isArray(value) && value.length === 0)) return "non osservati";
    if (Array.isArray(value)) {
      if (value.length === 2 && value.every((item) => typeof item !== "object")) return `${value[0]} × ${value[1]}`;
      return value.map((item) => Array.isArray(item) ? item.join(" × ") : String(item)).join(", ");
    }
    if (typeof value === "object") return Object.values(value).join(" × ");
    return String(value);
  }

  function normalizeDistribution(distribution, shots, dimension, peaks) {
    const bins = Array.from({ length: dimension }, (_, value) => ({ value, probability: 0, count: 0, ok: false, peak: peaks.includes(value) }));
    (Array.isArray(distribution) ? distribution : []).forEach((item) => {
      let value = Number(item.value);
      if (!Number.isFinite(value) && typeof item.value === "string") value = parseInt(item.value, 2);
      value = Math.trunc(value);
      if (value < 0 || value >= dimension) return;
      const count = Number(item.count) || 0;
      const probability = Number.isFinite(Number(item.probability)) ? Number(item.probability) : count / Math.max(1, shots);
      bins[value] = { value, count, probability, ok: Boolean(item.ok ?? item.factor_success), peak: Boolean(item.peak ?? item.theoretical_peak) || peaks.includes(value) };
    });
    return bins;
  }

  function renderExperiment(response, snapshot) {
    const ideal = response.ideal || {};
    const noisy = response.noisy || {};
    const comparison = response.comparison || {};
    const idealYield = ratio(ideal.factor_yield);
    const noisyYield = ratio(noisy.factor_yield);
    const delta = idealYield == null || noisyYield == null ? null : (noisyYield - idealYield) * 100;

    $("emptyResults").hidden = true;
    $("experimentResults").hidden = false;
    $("idealYield").textContent = percentMetric(ideal.factor_yield);
    $("noisyYield").textContent = percentMetric(noisy.factor_yield);
    $("idealCI").textContent = ciText(ideal.factor_ci || ideal.wilson_ci);
    $("noisyCI").textContent = ciText(noisy.factor_ci || noisy.wilson_ci);
    const deltaEl = $("yieldDelta");
    deltaEl.textContent = delta == null ? "—" : `${delta > 0 ? "+" : ""}${numberIT(delta, 1)} pp`;
    deltaEl.className = delta == null ? "" : delta < 0 ? "is-negative" : delta > 0 ? "is-positive" : "";
    const deltaCI = comparison.factor_yield_delta_ci;
    $("yieldDeltaCI").textContent = deltaCI
      ? `IC 95% ${numberIT(Number(deltaCI.low) * 100, 1)}–${numberIT(Number(deltaCI.high) * 100, 1)} pp`
      : "IC 95% della differenza non disponibile";
    $("peakMass").textContent = percentMetric(noisy.peak_mass);
    $("usefulPeakMass").textContent = `picchi utili: rumore ${percentMetric(noisy.useful_peak_mass)} · ideale ${percentMetric(ideal.useful_peak_mass)}`;
    $("tvdValue").textContent = Number.isFinite(Number(comparison.tvd)) ? numberIT(comparison.tvd, 3) : "—";

    const hasDistance = Number.isFinite(Number(comparison.hellinger_distance));
    const hellinger = hasDistance ? comparison.hellinger_distance : comparison.hellinger_fidelity;
    $("hellingerLabel").textContent = hasDistance ? "Distanza Hellinger" : "Fedeltà Hellinger";
    $("hellingerValue").textContent = Number.isFinite(Number(hellinger)) ? numberIT(hellinger, 3) : "—";
    $("hellingerHelp").textContent = hasDistance ? "0 = distribuzioni identiche" : "1 = distribuzioni identiche";
    const idealEntropy = ideal.entropy ?? ideal.entropy_bits;
    const noisyEntropy = noisy.entropy ?? noisy.entropy_bits;
    $("idealEntropy").textContent = Number.isFinite(Number(idealEntropy)) ? `${numberIT(idealEntropy, 3)} bit` : "—";
    $("noisyEntropy").textContent = Number.isFinite(Number(noisyEntropy)) ? `${numberIT(noisyEntropy, 3)} bit` : "—";
    $("idealFactors").textContent = formatFactors(ideal.factors_found);
    $("noisyFactors").textContent = formatFactors(noisy.factors_found);

    const shots = Number(response.shots ?? response.config?.shots) || snapshot.shots;
    const nCount = Number(response.config?.n_count) || currentInstance().nCount;
    const dimension = 2 ** nCount;
    const peaks = Array.from(response.metadata?.theoretical_peaks || currentInstance().peaks || []);
    const randomFloor = Number(response.random_factor_floor);
    if (Number.isFinite(randomFloor)) $("randomBaselineValue").textContent = percentMetric(randomFloor);
    const idealBins = normalizeDistribution(ideal.distribution, shots, dimension, peaks);
    const noisyBins = normalizeDistribution(noisy.distribution, shots, dimension, peaks);
    renderDistributionChart(idealBins, noisyBins, shots, dimension, peaks);
    renderIterations(noisy.iterations || []);
  }

  function renderDistributionChart(ideal, noisy, shots, dimension, peaks) {
    const svg = $("distributionChart");
    const width = 1120;
    const height = 390;
    const margin = { top: 32, right: 24, bottom: 54, left: 60 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const maxProbability = Math.max(.01, ...ideal.map((bin) => bin.probability), ...noisy.map((bin) => bin.probability));
    const yMax = Math.ceil(maxProbability * 1.12 * 100) / 100;
    const maxValue = dimension - 1;
    const x = (value) => margin.left + (value / maxValue) * plotWidth;
    const y = (probability) => margin.top + plotHeight - (probability / yMax) * plotHeight;
    const barGroupWidth = plotWidth / dimension;
    const barWidth = Math.max(1.25, barGroupWidth * .38);
    const topIdeal = [...ideal].sort((a, b) => b.probability - a.probability).slice(0, 4).map((bin) => bin.value);
    const topNoisy = [...noisy].sort((a, b) => b.probability - a.probability).slice(0, 4).map((bin) => bin.value);
    const summary = `Con ${shots} shot per distribuzione, i quattro esiti più probabili sono ${topIdeal.join(", ")} nell’ideale e ${topNoisy.join(", ")} nel caso rumoroso.`;
    clearSvg(svg, `Distribuzioni ideale e rumorosa su tutti i ${dimension} esiti`, `${summary} Le linee tratteggiate indicano i picchi teorici ${peaks.join(", ")}.`);

    for (let i = 0; i <= 4; i += 1) {
      const probability = (yMax * i) / 4;
      const yy = y(probability);
      svg.append(svgNode("line", { x1: margin.left, y1: yy, x2: width - margin.right, y2: yy, stroke: "rgba(188,195,225,.12)", "stroke-width": 1 }));
      svg.append(svgNode("text", { x: margin.left - 10, y: yy + 4, fill: "var(--dim)", "font-size": 10, "font-family": "var(--mono)", "text-anchor": "end" }, `${numberIT(probability * 100, probability < .1 ? 1 : 0)}%`));
    }

    peaks.forEach((peak) => {
      const xx = x(peak);
      svg.append(svgNode("line", { x1: xx, y1: margin.top - 7, x2: xx, y2: margin.top + plotHeight, stroke: "var(--cyan)", "stroke-width": 1.3, "stroke-dasharray": "4 5", opacity: .75 }));
      svg.append(svgNode("text", { x: xx + (peak === 0 ? 4 : 0), y: 17, fill: "var(--cyan)", "font-size": 9, "font-family": "var(--mono)", "text-anchor": peak === 0 ? "start" : "middle" }, `picco ${peak}`));
    });

    ideal.forEach((bin, index) => {
      if (bin.probability <= 0) return;
      const xx = x(index) - barWidth - .25;
      const yy = y(bin.probability);
      const rect = svgNode("rect", { x: xx, y: yy, width: barWidth, height: margin.top + plotHeight - yy, fill: "var(--violet)", opacity: .76, rx: .7 });
      rect.append(svgNode("title", {}, `Ideale · y=${index}: ${percentMetric(bin.probability, 2)} (${bin.count} conteggi)`));
      svg.append(rect);
    });
    noisy.forEach((bin, index) => {
      if (bin.probability <= 0) return;
      const xx = x(index) + .25;
      const yy = y(bin.probability);
      const rect = svgNode("rect", { x: xx, y: yy, width: barWidth, height: margin.top + plotHeight - yy, fill: "var(--amber)", opacity: .82, rx: .7 });
      rect.append(svgNode("title", {}, `Rumoroso · y=${index}: ${percentMetric(bin.probability, 2)} (${bin.count} conteggi)`));
      svg.append(rect);
    });

    Array.from(new Set(Array.from({ length: 9 }, (_, index) => Math.round(index * maxValue / 8)))).forEach((tick) => {
      const xx = x(tick);
      svg.append(svgNode("line", { x1: xx, y1: margin.top + plotHeight, x2: xx, y2: margin.top + plotHeight + 5, stroke: "var(--dim)" }));
      svg.append(svgNode("text", { x: xx, y: height - 27, fill: "var(--muted)", "font-size": 10, "font-family": "var(--mono)", "text-anchor": tick === 0 ? "start" : tick === maxValue ? "end" : "middle" }, tick));
    });
    svg.append(svgNode("text", { x: margin.left + plotWidth / 2, y: height - 6, fill: "var(--dim)", "font-size": 10, "font-family": "var(--mono)", "text-anchor": "middle" }, `esito misurato y (0…${maxValue})`));
    $("chartSummary").textContent = summary;
  }

  function renderIterations(iterations) {
    const list = $("iterationList");
    list.replaceChildren();
    const sample = Array.isArray(iterations) ? iterations.slice(0, 24) : [];
    if (!sample.length) {
      const empty = document.createElement("p");
      empty.className = "details-help";
      empty.textContent = "Il backend non ha restituito la memoria dei singoli shot.";
      list.append(empty);
      return;
    }
    sample.forEach((iteration, index) => {
      const ok = Boolean(iteration.ok);
      const cell = document.createElement("span");
      cell.className = `iteration${ok ? " is-ok" : ""}`;
      cell.title = `Shot ${index + 1}: esito ${iteration.value}; ${ok ? "estrae i fattori" : "non risolutivo"}`;
      const value = document.createElement("b");
      value.textContent = String(iteration.value);
      const status = document.createElement("small");
      status.textContent = ok ? "✓ utile" : "× no";
      cell.append(value, status);
      list.append(cell);
    });
  }

  function setupResultPopup() {
    $("resultPopupClose").addEventListener("click", hideResultPopup);
    $("resultPopup").addEventListener("click", (event) => {
      if (event.target === $("resultPopup")) hideResultPopup();   // solo lo sfondo, non la card
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hideResultPopup();
    });
  }

  function setupIdealControls() {
    $("playStageBtn").addEventListener("click", togglePlayback);
    // "A blocchi" non e' una modalita' con stato: ferma l'automatico e riporta all'inizio,
    // da dove le frecce fanno avanzare uno stadio per volta.
    $("stepModeBtn").addEventListener("click", () => { stopPlayback(); loadStage(0); });
    $("prevStageBtn").addEventListener("click", () => { stopPlayback(); loadStage(state.ideal.stage - 1); });
    $("nextStageBtn").addEventListener("click", () => { stopPlayback(); loadStage(state.ideal.stage + 1); });
    $("newMeasureBtn").addEventListener("click", () => { stopPlayback(); if (state.ideal.info) loadStage(state.ideal.info.stages.length - 1); });
  }

  function setupInstanceControl() {
    $("instanceSelect").addEventListener("change", (event) => {
      const next = INSTANCES[Number(event.target.value)];
      if (!next || next.N === state.instance.N) return;
      stopPlayback();
      state.ideal.controller?.abort();
      state.experiment.controller?.abort();
      state.experiment.requestId += 1;
      state.experiment.hasResult = false;
      state.instance = next;
      state.ideal.info = null;
      $("emptyResults").hidden = false;
      $("experimentResults").hidden = true;
      $("chartSummary").textContent = "Nessun dato disponibile per la nuova istanza.";
      updateInstancePresentation();
      if (next.N === 21) applyPreset("readout");
      else refreshNoiseUI();
      setStatus("experimentStatus", `Istanza N=${next.N} selezionata. Avvia il confronto per generare nuovi dati.`);
      initIdeal();
    });
  }

  function init() {
    setupTabs();
    setupIdealControls();
    setupResultPopup();
    setupNoiseControls();
    setupInstanceControl();
    resetPipeline();
    updateInstancePresentation();
    initIdeal();
  }

  init();
})();
