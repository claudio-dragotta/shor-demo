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
  const t = (key, values = null) => window.I18N.t(key, values);

  const state = {
    instance: INSTANCES[15],
    ideal: { info: null, stage: 0, bloch: null, controller: null, requestId: 0, playing: false, timer: null, classical: null },
    experiment: { controller: null, requestId: 0, running: false, preset: "uc1", hasResult: false,
                  lastResponse: null, lastRenderSnapshot: null },
    cost: null,
    tesi: null,
    // Vista di Bloch sotto rumore: sempre N=15, l'unica istanza in cui la
    // matrice densita' resta calcolabile.
    bloch: { info: null, noisy: null, ideal: null, stage: 0, mode: "noisy", loading: false, token: 0, playing: false, timer: null },
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

  const PRESET_NAMES = Object.freeze(["readout", "uc1", "uc2", "custom"]);
  // Il nome del preset si legge dal dizionario a ogni uso: cambiando lingua
  // cambia anche dove e' gia' finito dentro una frase composta.
  const presetLabel = (name) => t(`preset.${PRESET_NAMES.includes(name) ? name : "custom"}`);
  const QUANTUM_NOISE_CHANNELS = Object.freeze(["eps_1q", "eps_2q", "t1_us", "t2_us", "coherent_overrotation_deg"]);

  const CHANNELS = {
    eps_1q: { input: "eps1qInput", output: "eps1qOutput", format: percentControl },
    eps_2q: { input: "eps2qInput", output: "eps2qOutput", format: percentControl },
    t1_us: { input: "t1Input", output: "t1Output", format: (v) => `${fmtNum(v, 0)} µs` },
    t2_us: { input: "t2Input", output: "t2Output", format: (v) => `${fmtNum(v, 0)} µs` },
    readout_0to1: { input: "readout01Input", output: "readout01Output", format: percentControl },
    readout_1to0: { input: "readout10Input", output: "readout10Output", format: percentControl },
    coherent_overrotation_deg: { input: "overrotationInput", output: "overrotationOutput", format: (v) => `${fmtNum(v, 1)}°` },
  };

  // La separazione decimale segue la lingua scelta: 0,75 in italiano, 0.75 in inglese.
  function fmtNum(value, digits = 2) {
    return window.I18N.formatNumber(value, digits);
  }

  function percentControl(value) {
    const percentage = Number(value) * 100;
    const digits = percentage < 1 ? 3 : 2;
    return `${fmtNum(percentage, digits)}%`;
  }

  function ratio(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.abs(n) > 1 ? n / 100 : n;
  }

  function percentMetric(value, digits = 1) {
    const r = ratio(value);
    return r == null ? "—" : `${fmtNum(r * 100, digits)}%`;
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  /* Le righe di stato si ricordano per chiave, non per testo gia' reso: cambiando
     lingua vanno riscritte, e un messaggio congelato in italiano resterebbe li'
     finche' l'utente non ripete l'azione che lo ha prodotto. */
  const statusState = new Map();

  function setStatus(id, key, values = null, kind = "") {
    statusState.set(id, { key, values, kind });
    renderStatus(id);
  }

  function renderStatus(id) {
    const entry = statusState.get(id);
    const el = $(id);
    if (!el || !entry) return;
    /* Un segnaposto puo' essere una funzione: cosi' i frammenti gia' tradotti che
       finiscono dentro la frase -- nome del preset, etichetta dello stadio --
       vengono ricalcolati al cambio lingua invece di restare congelati. */
    const values = entry.values && Object.fromEntries(Object.entries(entry.values)
      .map(([key, value]) => [key, typeof value === "function" ? value() : value]));
    el.textContent = t(entry.key, values || null);
    el.className = `status-line${entry.kind ? ` is-${entry.kind}` : ""}`;
  }

  /* Il dettaglio che arriva dal backend e' testo del server, non una chiave: si
     mostra com'e'. Le cornici attorno ("Esperimento non riuscito: …") sono invece
     tradotte, cosi' la frase non resta interamente in una sola lingua. */
  function errorMessage(error) {
    if (!error) return t("err.unknown");
    if (typeof error === "string") return error;
    if (Array.isArray(error.detail)) return error.detail.map((item) => item.msg || String(item)).join("; ");
    return error.detail || error.message || t("err.requestFailed");
  }

  async function apiJSON(path, options = {}) {
    const response = await fetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(errorMessage(data) || t("err.http", { code: response.status }));
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

  const STAGE_KINDS = Object.freeze(["init0", "init", "u", "qft", "measure"]);

  /* Il testo di ogni stadio vive nel dizionario gia' parametrizzato sull'istanza:
     non esiste un testo base da correggere a mano caso per caso. */
  function stageCopy(kind, instance) {
    const k = STAGE_KINDS.includes(kind) ? kind : "init0";
    const values = {
      t: instance.nCount ?? "—",
      last: instance.nCount == null ? "—" : instance.nCount - 1,
      a: instance.a ?? "a",
      N: instance.N,
      r: instance.order ?? "r",
      peaks: (instance.peaks || []).join(", "),
    };
    return {
      title: t(`stage.${k}.title`, values),
      text: t(`stage.${k}.text`, values),
      operation: t(`stage.${k}.operation`, values),
      observe: t(`stage.${k}.observe`, values),
    };
  }

  /* L'etichetta dello stadio si ricostruisce dalla struttura -- kind e ordinale
     delle moltiplicazioni controllate -- non dal testo italiano del backend, che
     resta un dettaglio dell'API e non una stringa da mostrare. */
  function stageLabel(stages, index) {
    const list = stages || [];
    const stage = list[index];
    if (!stage) return "";
    if (stage.kind !== "u") return t(`stageLabel.${STAGE_KINDS.includes(stage.kind) ? stage.kind : "init0"}`);
    let ordinal = 0;
    for (let i = 0; i <= index; i += 1) if (list[i].kind === "u") ordinal += 1;
    return t("stageLabel.u", { k: ordinal - 1, n: ordinal });
  }

  function setIdealBusy(busy) {
    ["prevStageBtn", "nextStageBtn", "stepModeBtn"].forEach((id) => { $(id).disabled = busy; });
    if (!busy) updateIdealButtons();
  }

  function updateIdealButtons() {
    const ready = Boolean(state.ideal.info);
    const last = ready ? state.ideal.info.stages.length - 1 : 0;
    const avviabile = ready || Boolean(state.ideal.classical);
    $("playStageBtn").disabled = !avviabile;
    $("stepModeBtn").disabled = !avviabile;
    $("prevStageBtn").disabled = !ready || state.ideal.stage === 0;
    $("nextStageBtn").disabled = !ready || state.ideal.stage >= last;
    $("stageNavCounter").textContent = ready ? `${state.ideal.stage + 1} / ${last + 1}` : "— / —";
  }

  function updateInstancePresentation() {
    const instance = currentInstance();
    const M = instance.dimension || 2 ** instance.nCount;
    const peaks = instance.peaks || [];
    const idealYield = Number.isFinite(instance.idealYield) ? instance.idealYield : null;
    const twoShot = idealYield == null ? null : 1 - (1 - idealYield) ** 2;
    const blochOk = state.ideal.info?.bloch_ok !== false;
    $("unvalidatedBadge").hidden = state.ideal.info ? state.ideal.info.validated !== false : !!INSTANCES[instance.N];
    $("instanceABadge").textContent = `a = ${instance.a ?? "—"}`;
    $("instanceCountBadge").textContent = t("badge.qubits", { n: instance.nCount });
    $("theoreticalPeaks").textContent = peaks.length ? peaks.join(" · ") : "—";
    const spacing = M / instance.order;
    $("peakExplanation").innerHTML = t("prob.peaks.help", {
      t: instance.nCount,
      spacing: fmtNum(spacing, Number.isInteger(spacing) ? 0 : 2),
      r: instance.order,
    });
    $("singleShotProbability").textContent = idealYield == null ? "—" : `≈ ${percentMetric(idealYield, 2)}`;
    $("singleShotExplanation").textContent = t("prob.singleShot.help", { N: instance.N });
    $("twoShotProbability").textContent = twoShot == null ? "—" : `≈ ${percentMetric(twoShot, 2)}`;
    $("twoShotExplanation").textContent = t("prob.twoShot.help");
    $("stateViewNoteTitle").textContent = t(blochOk ? "bloch.note.title" : "bloch.note.titleAbsent");
    // Il limite non e' un difetto della demo: disegnare le sfere significa
    // materializzare lo statevector, cioe' fare proprio il calcolo che il
    // computer quantistico evita. Misurato su questa macchina: N=15 (12 qubit)
    // rende l'intera vista in 22 ms; N=21 (22 qubit) supera i 120 s gia' alla
    // prima moltiplicazione modulare controllata.
    const nQubits = state.ideal.info?.num_qubits || 0;
    $("stateViewNote").textContent = blochOk
      ? t("bloch.note.text")
      : t("bloch.note.absent", { q: nQubits, milioni: fmtNum(2 ** nQubits / 1e6, 1) });
    $("randomBaselineValue").textContent = percentMetric(instance.randomFloor);
    $("randomBaseline").title = t("results.randomBaseline.title", { M });
    $("idealBaselineText").innerHTML = t("results.idealBaseline", {
      N: instance.N,
      peaks: peaks.join(", "),
      p: percentMetric(idealYield, 2),
    });
    $("chartAxisHelp").textContent = t("chart.axisHelp", { max: M - 1, n: peaks.length });
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

  // Scegliere il numero non deve produrre il risultato: lo prepara e basta.
  // L'esito -- classico o quantistico -- arriva quando si preme Avvia.
  function armClassicalOutcome(info) {
    state.ideal.info = null;
    state.ideal.bloch = null;
    state.ideal.classical = info;
    hideResultPopup();
    $("idealPanel").classList.add("is-classical");
    $("classicPanel").hidden = true;
    setStatus("idealStatus", "status.classicalReady", { N: info.N });
    updateIdealButtons();
  }

  /* Il motivo per cui il classico ha gia' chiuso arriva dal backend come chiave
     piu' parametri (reason_key/reason_params); il testo italiano che l'API manda
     ancora in `reason` resta solo come ripiego per un backend piu' vecchio. */
  function classicalReason(info) {
    if (info?.reason_key) return t(info.reason_key, info.reason_params || null);
    return info?.reason || "";
  }

  // Scrive il pannello senza annunciare nulla: serve anche al cambio lingua,
  // dove far ricomparire il popup sarebbe un annuncio che nessuno ha chiesto.
  function renderClassicalPanel(info) {
    const risolto = info.p != null && info.q != null;
    $("classicTitle").textContent = risolto
      ? `${info.N} = ${info.p} × ${info.q}`
      : t("classic.noFactors", { N: info.N });
    $("classicDetail").textContent = classicalReason(info);
    return risolto;
  }

  function runClassicalOutcome() {
    const info = state.ideal.classical;
    if (!info) return;
    const motivo = classicalReason(info);
    $("classicPanel").hidden = false;
    const risolto = renderClassicalPanel(info);
    setStatus("idealStatus", risolto ? "status.classicalSolved" : "status.classicalClosed",
      { N: info.N }, "success");
    showResultPopup(
      risolto,
      risolto ? `${info.N} = ${info.p} × ${info.q}` : `${info.N}`,
      t("popup.classical.detail", { reason: motivo }),
    );
  }

  async function initIdeal() {
    const instance = state.instance;
    stopPlayback();
    state.ideal.info = null;
    state.ideal.bloch = null;
    state.ideal.stage = 0;
    state.ideal.controller?.abort();
    const requestId = ++state.ideal.requestId;
    setStatus("idealStatus", "status.preparingIdeal", { N: instance.N, a: instance.a }, "loading");
    $("playStageBtn").disabled = true;
    try {
      const info = await apiJSON(`/api/factor?N=${instance.N}`);
      if (requestId !== state.ideal.requestId) return;
      if (info.done) { armClassicalOutcome(info); return; }
      state.ideal.classical = null;   // istanza con circuito: niente esito classico in sospeso
      $("idealPanel").classList.remove("is-classical");
      $("classicPanel").hidden = true;
      state.ideal.info = info;
      updateInstancePresentation();
      await loadStage(0);
    } catch (error) {
      setStatus("idealStatus", "status.idealUnavailable", { err: errorMessage(error) }, "error");
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
    setStatus("idealStatus", info.bloch_ok ? "status.stageLoading" : "status.stageLoadingStructural",
      { label: () => stageLabel(info.stages, target) }, "loading");
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
      renderStageExplanation(info.stages, target);
      if (bloch.kind === "measure" && bloch.measured_shot) renderPipeline(bloch.measured_shot);
      else resetPipeline();
      setStatus("idealStatus", "status.stageDone", {
        i: target + 1,
        n: info.stages.length,
        label: () => stageLabel(info.stages, target),
        source: () => t(info.bloch_ok ? "status.stageSource.exact" : "status.stageSource.structural"),
      }, "success");
    } catch (error) {
      if (error.name !== "AbortError" && requestId === state.ideal.requestId) setStatus("idealStatus", "status.stageFailed", { err: errorMessage(error) }, "error");
    } finally {
      if (requestId === state.ideal.requestId) setIdealBusy(false);
    }
  }

  function renderStageExplanation(stages, index) {
    const instance = currentInstance();
    const stage = stages[index];
    const copy = stageCopy(stage.kind, instance);
    $("stageExplanationTitle").textContent = copy.title;
    $("stageExplanation").textContent = copy.text;
    $("stageOperation").textContent = stageLabel(stages, index) || copy.operation;
    $("stageObserve").textContent = copy.observe;
    $("stageChip").textContent = t("stageChip", { i: index + 1, n: stages.length });
  }

  function stopPlayback() {
    state.ideal.playing = false;
    if (state.ideal.timer) window.clearTimeout(state.ideal.timer);
    state.ideal.timer = null;
    $("playStageBtn").textContent = t("btn.playAuto");
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
    if (state.ideal.classical) { runClassicalOutcome(); return; }
    if (state.ideal.playing) { stopPlayback(); return; }
    if (!state.ideal.info) return;
    state.ideal.playing = true;
    $("playStageBtn").textContent = t("btn.pause");
    const last = state.ideal.info.stages.length - 1;
    const begin = state.ideal.stage >= last ? loadStage(0) : Promise.resolve();
    begin.then(() => { if (state.ideal.playing) state.ideal.timer = window.setTimeout(playbackStep, 350); });
  }

  function phaseColor(x, y) {
    const hue = ((((Math.atan2(y, x) / (2 * Math.PI)) + 1) % 1) * 360).toFixed(0);
    return `hsl(${hue} 78% 68%)`;
  }

  function renderCircuit(info, bloch, targetId = "circuitSvg") {
    const svg = $(targetId);
    const instance = currentInstance();
    clearSvg(
      svg,
      t("circuit.svg.titleFor", { N: instance.N }),
      bloch ? t("circuit.desc.stage", {
        i: Number(bloch.stage) + 1,
        label: stageLabel(info?.stages, Number(bloch.stage)),
        coda: info?.bloch_ok
          ? t("circuit.desc.bloch", { t: instance.nCount })
          : t("circuit.desc.structural", { q: info?.num_qubits }),
      }) : `${t("circuit.unavailable")}.`,
    );
    if (!info) {
      svg.append(svgNode("text", { x: 540, y: 290, fill: "var(--red)", "text-anchor": "middle", "font-size": 16 }, t("circuit.unavailable")));
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
    svg.append(svgNode("text", { x: 25, y: 28, class: "c-register" }, t("circuit.registerCount")));
    svg.append(svgNode("text", { x: sphereX, y: 28, class: "c-state-label" },
      showBloch ? t("circuit.reducedState") : t("circuit.structural", { q: info.num_qubits })));

    for (let i = 0; i < nCount; i += 1) {
      const y = yOf(i);
      svg.append(svgNode("text", { x: 26, y: y + 4, class: "c-label" }, `c${i}`));
      svg.append(svgNode("line", { x1: wireStart, y1: y, x2: wireEnd, y2: y, class: "c-wire" }));
      if (showBloch) svg.append(svgNode("line", { x1: wireEnd, y1: y, x2: sphereX - radius - 8, y2: y, class: "c-wire", "stroke-dasharray": "2 5" }));
    }
    svg.append(svgNode("text", { x: 26, y: workY + 4, class: "c-label" }, "w"));
    svg.append(svgNode("line", { x1: wireStart, y1: workY, x2: wireEnd, y2: workY, class: "c-wire c-wire-work" }));
    svg.append(svgNode("text", { x: 68, y: workY + 25, class: "c-register" }, t("circuit.registerWork")));

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
    svg.append(svgNode("text", { x: playX, y: 48, class: "c-play-label" }, t("circuit.now")));

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

  function showResultPopup(success, title, detail, variante = null, occhiello = null) {
    const popup = $("resultPopup");
    popup.className = `result-popup ${variante || (success ? "is-success" : "is-failure")}`;
    $("resultPopupKicker").textContent = occhiello || t(success ? "popup.found" : "popup.notUseful");
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
    $("pipelineResult").textContent = t("pipeline.waiting");
    $("mathPipeline").innerHTML = `
      <li><span>1</span><small>${t("pipeline.1.label")}</small><strong>y = —</strong><p>${t("pipeline.1.help", { bits: instance.nCount })}</p></li>
      <li><span>2</span><small>${t("pipeline.2.label")}</small><strong>y / 2^${instance.nCount} = —</strong><p>${t("pipeline.2.help")}</p></li>
      <li><span>3</span><small>${t("pipeline.3.label")}</small><strong>≈ s / r</strong><p>${t("pipeline.3.help")}</p></li>
      <li><span>4</span><small>${t("pipeline.4.label")}</small><strong>r = —</strong><p>${t("pipeline.4.help")}</p></li>
      <li><span>5</span><small>${t("pipeline.5.label")}</small><strong>gcd(${instance.a}ʳᐟ² ± 1, ${instance.N})</strong><p>${t("pipeline.5.help")}</p></li>`;
  }

  function renderPipeline(shot, announce = true) {
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
    result.textContent = success
      ? t("pipeline.result.ok", { N: instance.N, p: factorA, q: factorB })
      : t("pipeline.result.fail");
    const orderText = verified
      ? t("pipeline.order.verified")
      : t(even ? "pipeline.order.partial" : "pipeline.order.odd");
    const gcdText = even
      ? `gcd(${halfPower}−1,${instance.N})=${gMinus}; gcd(${halfPower}+1,${instance.N})=${gPlus}`
      : t("pipeline.gcd.notApplicable");
    const bits = String(shot.bits || y.toString(2).padStart(instance.nCount, "0"));
    $("mathPipeline").innerHTML = `
      <li class="${success ? "is-success" : "is-failure"}"><span>1</span><small>${t("pipeline.1.label")}</small><strong>y = ${y}</strong><p>${t("pipeline.1.helpDone", { bits })}</p></li>
      <li><span>2</span><small>${t("pipeline.2.label")}</small><strong>${y} / ${dimension} = ${fmtNum(phase, 4)}</strong><p>${t("pipeline.2.helpDone")}</p></li>
      <li><span>3</span><small>${t("pipeline.3.label")}</small><strong>≈ ${fraction.numerator} / ${fraction.denominator}</strong><p>${t("pipeline.3.helpDone", { N: instance.N })}</p></li>
      <li class="${verified ? "is-success" : ""}"><span>4</span><small>${t("pipeline.4.label")}</small><strong>r = ${r}</strong><p>${t("pipeline.4.helpDone", { orderText, a: instance.a, N: instance.N, residuo: modPow(instance.a, r, instance.N) })}</p></li>
      <li class="${success ? "is-success" : "is-failure"}"><span>5</span><small>${t("pipeline.5.label")}</small><strong>${gcdText}</strong><p>${success ? t("pipeline.5.helpOk", { p: factorA, q: factorB }) : t("pipeline.5.helpFail")}</p></li>`;
    if (announce) showResultPopup(
      success,
      success ? `${instance.N} = ${factorA} × ${factorB}` : `y = ${y}`,
      t(success ? "popup.shot.ok" : "popup.shot.fail", { y, r }),
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
      if (changedKey === "t1_us") setStatus("experimentStatus", "status.t2Adjusted", { v: maxT2 }, "success");
    }
  }

  // --- Anatomia del rumore -------------------------------------------------
  // Il modello e' uniforme su tutti i qubit: cio' che cambia muovendo un cursore
  // e' su quante porte l'errore agisce e quanto pesa. I conteggi vengono dal
  // circuito compilato nella base rz/sx/x/cx, non da una stima.
  async function loadCircuitCost(N) {
    state.cost = null;
    updateNoiseAnatomy();
    try {
      state.cost = await apiJSON(`/api/circuit-cost?N=${N}`);
    } catch (error) {
      state.cost = null;
    }
    updateNoiseAnatomy();
  }

  function formatProxy(value) {
    if (!Number.isFinite(value)) return "—";
    if (value === 1) return "1";
    if (value >= 0.001) return fmtNum(value, 4);
    const exp = Math.floor(Math.log10(value));
    return `${fmtNum(value / 10 ** exp, 2)}·10^${exp}`;
  }

  function updateNoiseAnatomy() {
    const grid = $("anatomyGrid");
    const cost = state.cost;
    if (!cost) {
      grid.replaceChildren();
      $("anatomyScope").textContent = t("anatomy.unavailable");
      return;
    }
    const n = collectNoise();
    const c = cost.counts;
    $("anatomyScope").textContent = t("anatomy.scope", {
      N: cost.N, q: cost.num_qubits, depth: fmtNum(cost.depth, 0),
    });

    const eps1 = Number(n.eps_1q) || 0;
    const eps2 = Number(n.eps_2q) || 0;
    const ro01 = Number(n.readout_0to1) || 0;
    const ro10 = Number(n.readout_1to0) || 0;
    const over = Number(n.coherent_overrotation_deg) || 0;
    // Durata illustrativa: le rz sono virtuali e non durano nulla.
    const durataUs = (c.sx_x * cost.gate_time_1q_ns + c.cx * cost.gate_time_2q_ns) / 1000;

    const spento = t("anatomy.row.off");
    const righe = [
      { attivo: eps1 > 0, nome: t("ch.eps_1q.name"), su: t("anatomy.row.eps1.where", { n: fmtNum(c.sx_x, 0) }),
        detta: eps1 > 0
          ? t("anatomy.row.eps1.on", { v: formatProxy((1 - 3 * eps1 / 4) ** c.sx_x) })
          : spento },
      { attivo: eps2 > 0, nome: t("ch.eps_2q.name"), su: t("anatomy.row.eps2.where", { n: fmtNum(c.cx, 0) }),
        detta: eps2 > 0
          ? t("anatomy.row.eps2.on", { v: formatProxy((1 - 15 * eps2 / 16) ** c.cx) })
          : spento },
      { attivo: n.t1_us != null, nome: t("anatomy.row.thermal.name"),
        su: t("anatomy.row.thermal.where", { v: fmtNum(durataUs, 1) }),
        detta: n.t1_us != null
          ? t("anatomy.row.thermal.on", {
              ratio: fmtNum(durataUs / Number(n.t1_us), 3), t2: fmtNum(Number(n.t2_us), 0),
            })
          : spento },
      { attivo: over > 0, nome: t("anatomy.row.over.name"), su: t("anatomy.row.eps1.where", { n: fmtNum(c.sx_x, 0) }),
        detta: over > 0 ? t("anatomy.row.over.on", { deg: fmtNum(over, 1) }) : spento },
      { attivo: ro01 > 0 || ro10 > 0, nome: t("anatomy.row.readout.name"),
        su: t("anatomy.row.readout.where", { n: cost.n_count }),
        detta: (ro01 > 0 || ro10 > 0)
          ? t("anatomy.row.readout.on", { a: fmtNum(ro01 * 100, 2), b: fmtNum(ro10 * 100, 2) })
          : spento },
      { attivo: false, virtuale: true, nome: t("anatomy.row.rz.name"),
        su: t("anatomy.row.rz.where", { n: fmtNum(c.rz, 0) }),
        detta: t("anatomy.row.rz.on") },
    ];

    // Lo schema si accende dove il canale e' attivo, e riporta su quante porte agisce.
    const accendi = (id, on) => $(id).classList.toggle("is-on", Boolean(on));
    accendi("anaSx", eps1 > 0 || over > 0 || n.t1_us != null);
    accendi("anaCx", eps2 > 0 || n.t1_us != null);
    accendi("anaMeas", ro01 > 0 || ro10 > 0);
    $("anaSxCount").textContent = t("anatomy.gates", { n: fmtNum(c.sx_x, 0) });
    $("anaCxCount").textContent = t("anatomy.gates", { n: fmtNum(c.cx, 0) });
    $("anaRzCount").textContent = t("anatomy.gates", { n: fmtNum(c.rz, 0) });
    $("anaMeasCount").textContent = t("anatomy.bits", { n: cost.n_count });

    grid.replaceChildren(...righe.map((r) => {
      const el = document.createElement("article");
      el.className = `anatomy-row${r.attivo ? " is-on" : ""}${r.virtuale ? " is-virtual" : ""}`;
      const nome = document.createElement("strong");
      nome.textContent = r.nome;
      const dove = document.createElement("span");
      dove.className = "anatomy-where";
      dove.textContent = r.su;
      const val = document.createElement("span");
      val.className = "anatomy-value";
      val.textContent = r.detta;
      el.append(nome, dove, val);
      return el;
    }));
  }

  // --- Sfere di Bloch sotto rumore -----------------------------------------
  const BLOCH_N = 15;

  // Il readout agisce sull'esito della misura, non sull'evoluzione: se e' l'unico
  // canale attivo lo stato resta quello ideale e non serve simulare due volte.
  function quantumNoiseAttivo(noise) {
    return Number(noise.eps_1q) > 0 || Number(noise.eps_2q) > 0
      || noise.t1_us != null || Math.abs(Number(noise.coherent_overrotation_deg) || 0) > 0;
  }

  async function ensureBlochInfo() {
    if (!state.bloch.info) state.bloch.info = await apiJSON(`/api/factor?N=${BLOCH_N}`);
    return state.bloch.info;
  }

  // Il server ammette UNA simulazione per volta e rifiuta le altre con 429.
  // Le richieste vengono quindi incatenate: mai due in volo, e una richiesta
  // gia' superata da un preset piu' recente salta del tutto la rete.
  let codaBloch = Promise.resolve();

  function loadNoisyBloch() {
    const token = ++state.bloch.token;
    stopNoisePlayback();
    state.bloch.loading = true;
    setStatus("blochStatus", "status.blochLoading", null, "loading");
    updateBlochButtons();
    const noise = collectNoise();
    codaBloch = codaBloch.then(() => eseguiCaricamentoBloch(token, noise)).catch(() => {});
    return codaBloch;
  }

  async function eseguiCaricamentoBloch(token, noise) {
    if (token !== state.bloch.token) return;   // superata mentre era in coda
    try {
      const info = await ensureBlochInfo();
      // Il semaforo puo' essere occupato da un esperimento avviato dall'altra
      // meta' della scheda: in quel caso si aspetta, non si fallisce.
      const chiedi = async (payload) => {
        for (let tentativo = 0; ; tentativo += 1) {
          try {
            return await apiJSON("/api/noisy-bloch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ N: BLOCH_N, noise: payload }),
            });
          } catch (error) {
            const occupato = /gia' in esecuzione|già in esecuzione/i.test(String(error?.message || ""));
            if (!occupato || tentativo >= 5 || token !== state.bloch.token) throw error;
            setStatus("blochStatus", "status.blochBusy", null, "loading");
            await new Promise((r) => window.setTimeout(r, 2500));
          }
        }
      };
      const ideale = state.bloch.ideal || await chiedi({});
      if (token !== state.bloch.token) return;
      const quantistico = quantumNoiseAttivo(noise);
      const noisy = quantistico ? await chiedi(noise) : ideale;
      if (token !== state.bloch.token) return;
      const soloLettura = !quantistico
        && (Number(noise.readout_0to1) > 0 || Number(noise.readout_1to0) > 0);
      state.bloch.ideal = ideale;
      state.bloch.noisy = { ...noisy, readout_only: soloLettura, noisy: quantistico };
      state.bloch.stage = clamp(state.bloch.stage, 0, noisy.stages.length - 1);
      if (!info) return;
      renderBlochStage();
      setStatus("blochStatus", soloLettura
        ? "status.blochReadoutOnly"
        : quantistico ? "status.blochNoisy" : "status.blochIdeal", null, "success");
    } catch (error) {
      if (token !== state.bloch.token) return;
      setStatus("blochStatus", "status.blochFailed", { err: errorMessage(error) }, "error");
    } finally {
      if (token === state.bloch.token) { state.bloch.loading = false; updateBlochButtons(); }
    }
  }

  function updateBlochButtons() {
    const pronto = Boolean(state.bloch.noisy) && !state.bloch.loading;
    const ultimo = pronto ? state.bloch.noisy.stages.length - 1 : 0;
    $("noisePlayBtn").disabled = !pronto;
    $("noisePrevBtn").disabled = !pronto || state.bloch.stage === 0;
    $("noiseNextBtn").disabled = !pronto || state.bloch.stage >= ultimo;
    $("noiseStageCounter").textContent = pronto ? `${state.bloch.stage + 1} / ${ultimo + 1}` : "— / —";
  }

  function renderBlochStage() {
    const info = state.bloch.info;
    const dati = state.bloch.noisy;
    if (!info || !dati) return;
    const idx = clamp(state.bloch.stage, 0, dati.stages.length - 1);
    const confronto = state.bloch.mode === "compare";
    $("idealCirclePanel").hidden = !confronto;
    $("noisyCircuitKicker").textContent = t(confronto ? "noise.noisy.kicker" : "noise.noisy.kickerPlain");
    $("noiseStageChip").textContent = t("stageChip", { i: idx + 1, n: dati.stages.length });
    renderCircuit(info, { ...dati.stages[idx], n_count: dati.n_count }, "noisyCircuitSvg");
    if (confronto && state.bloch.ideal) {
      const rif = state.bloch.ideal.stages[idx];
      renderCircuit(info, { ...rif, n_count: state.bloch.ideal.n_count }, "idealCircuitSvg");
    }
    updateBlochButtons();
  }

  function setBlochStage(next) {
    if (!state.bloch.noisy) return;
    state.bloch.stage = clamp(next, 0, state.bloch.noisy.stages.length - 1);
    renderBlochStage();
  }

  function setBlochMode(mode) {
    state.bloch.mode = mode;
    $("viewNoisyBtn").classList.toggle("is-active", mode === "noisy");
    $("viewCompareBtn").classList.toggle("is-active", mode === "compare");
    $("viewNoisyBtn").setAttribute("aria-pressed", String(mode === "noisy"));
    $("viewCompareBtn").setAttribute("aria-pressed", String(mode === "compare"));
    $("noiseStageView").classList.toggle("is-compare", mode === "compare");
    renderBlochStage();
  }

  // La barra delle schede resta agganciata, ma attaccata copriva il circuito.
  // Una sentinella alta 1px dice quando la barra ha lasciato il flusso: da li'
  // si stringe a una riga sola. Niente listener di scroll: un observer basta.
  function setupStickyTabs() {
    const sentinella = document.querySelector(".tabs-sentinel");
    const barra = document.querySelector(".tabs");
    if (!sentinella || !barra || typeof IntersectionObserver !== "function") return;
    new IntersectionObserver(
      ([entry]) => barra.classList.toggle("is-stuck", !entry.isIntersecting),
      { threshold: 0 },
    ).observe(sentinella);
  }

  // Riproduzione automatica degli stadi nella scheda del rumore.
  function stopNoisePlayback() {
    state.bloch.playing = false;
    if (state.bloch.timer) window.clearTimeout(state.bloch.timer);
    state.bloch.timer = null;
    $("noisePlayBtn").textContent = t("btn.playAuto");
  }

  function noisePlaybackStep() {
    if (!state.bloch.playing || !state.bloch.noisy) return;
    const ultimo = state.bloch.noisy.stages.length - 1;
    if (state.bloch.stage >= ultimo) { stopNoisePlayback(); showNoiseSummary(); return; }
    setBlochStage(state.bloch.stage + 1);
    if (state.bloch.stage >= ultimo) { stopNoisePlayback(); showNoiseSummary(); return; }
    state.bloch.timer = window.setTimeout(noisePlaybackStep, 950);
  }

  function toggleNoisePlayback() {
    if (state.bloch.playing) { stopNoisePlayback(); return; }
    if (!state.bloch.noisy) return;
    state.bloch.playing = true;
    $("noisePlayBtn").textContent = t("btn.pause");
    const ultimo = state.bloch.noisy.stages.length - 1;
    if (state.bloch.stage >= ultimo) setBlochStage(0);
    state.bloch.timer = window.setTimeout(noisePlaybackStep, 400);
  }

  // Riepilogo onesto: nell'ideale alcuni qubit hanno gia' |r|=0 per
  // entanglement, non per rumore. La decoerenza si misura solo su quelli che
  // senza rumore restavano puri, altrimenti si sommano due fenomeni diversi.
  function showNoiseSummary() {
    const rumoroso = state.bloch.noisy;
    const ideale = state.bloch.ideal;
    if (!rumoroso || !ideale) return;
    const finiRum = rumoroso.stages[rumoroso.stages.length - 1].qubits;
    const finiId = ideale.stages[ideale.stages.length - 1].qubits;
    const puri = finiId.map((q, i) => ({ i, id: q.len, rum: finiRum[i]?.len ?? 0 })).filter((q) => q.id > 0.99);
    const etichetta = presetLabel(state.experiment.preset);

    if (rumoroso.readout_only) {
      showResultPopup(true, t("popup.readoutOnly.title"), t("popup.readoutOnly.text"),
        "is-info", t("popup.readoutOnly.kicker"));
      return;
    }
    if (!rumoroso.noisy || !puri.length) {
      showResultPopup(true, t("popup.noNoise.title"),
        t("popup.noNoise.text", { n: finiId.length - puri.length }),
        "is-info", t("popup.noNoise.kicker"));
      return;
    }
    const media = puri.reduce((acc, q) => acc + q.rum, 0) / puri.length;
    const minimo = Math.min(...puri.map((q) => q.rum));
    const massimo = Math.max(...puri.map((q) => q.rum));
    showResultPopup(false,
      t("popup.decoherence.title", { uno: fmtNum(1, 2), media: fmtNum(media, 2) }),
      t("popup.decoherence.text", {
        preset: etichetta,
        puri: puri.length,
        media: fmtNum(media, 2),
        min: fmtNum(minimo, 2),
        max: fmtNum(massimo, 2),
        altri: finiId.length - puri.length,
      }),
      "is-info", t("popup.decoherence.kicker"));
  }

  function mostraDettaglioRumore(aperto) {
    $("noiseDetail").hidden = !aperto;
    $("noiseDetailBtn").setAttribute("aria-expanded", String(aperto));
    $("noiseDetailBtn").classList.toggle("is-open", aperto);
  }

  function setupBlochView() {
    $("noisePlayBtn").addEventListener("click", toggleNoisePlayback);
    $("noiseDetailBtn").addEventListener("click", () => mostraDettaglioRumore($("noiseDetail").hidden));
    $("viewNoisyBtn").addEventListener("click", () => setBlochMode("noisy"));
    $("viewCompareBtn").addEventListener("click", () => setBlochMode("compare"));
    $("noisePrevBtn").addEventListener("click", () => { stopNoisePlayback(); setBlochStage(state.bloch.stage - 1); });
    $("noiseNextBtn").addEventListener("click", () => { stopNoisePlayback(); setBlochStage(state.bloch.stage + 1); });
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
      button.title = unavailable ? t("preset.unavailable21") : "";
    });
    $("newRealizationBtn").disabled = $("seedLockInput").checked;
    updateShotBudget();
    updateSnapshot();
    updateNoiseAnatomy();
  }

  function markCustom() {
    state.experiment.preset = "custom";
    $$(".preset").forEach((button) => {
      const active = button.dataset.preset === "custom";
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (state.experiment.hasResult && !state.experiment.running) setStatus("experimentStatus", "status.paramsChanged");
  }

  function setThermalEnabled(enabled) {
    channelElements("t1_us").toggle.checked = enabled;
    channelElements("t2_us").toggle.checked = enabled;
  }

  function applyPreset(name) {
    if (!PRESETS[name]) { markCustom(); return; }
    state.experiment.preset = name;
    // constrainThermalTimes stringe il max di T2 in base a T1, e un input range
    // tronca il proprio valore al max. Con il tetto del preset precedente ancora
    // in vigore, assegnare il nuovo T2 lo troncherebbe: con T1 a 10 us il tetto
    // e' 20, e UC1 arriverebbe con T2=20 invece di 80. Si riapre prima di scrivere.
    channelElements("t2_us").input.max = "300";
    Object.entries(PRESETS[name]).forEach(([key, value]) => {
      const { input, toggle } = channelElements(key);
      input.value = String(value);
      toggle.checked = key !== "coherent_overrotation_deg"
        && (name !== "readout" || key.startsWith("readout_"));
    });
    setThermalEnabled(name === "uc1" || name === "uc2");
    $$(".preset").forEach((button) => {
      const active = button.dataset.preset === name;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    refreshNoiseUI();
    loadNoisyBloch();
    if (state.tesi) renderQecChart(state.tesi.qec);
    setStatus("experimentStatus", "status.presetLoaded", { preset: () => presetLabel(name) });
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

  // L'ultimo snapshot reso si conserva: al cambio lingua va riscritto com'era,
  // non ricalcolato dai controlli, che nel frattempo possono essere cambiati.
  let lastSnapshot = { snapshot: null, running: false };

  function updateSnapshot(snapshot = null, running = false) {
    const config = snapshot || configSnapshot();
    lastSnapshot = { snapshot: config, running };
    const active = Object.entries(config.noise).filter(([, value]) => value != null && Number(value) !== 0).map(([key]) => key);
    $("configSnapshot").textContent = t("snapshot", {
      stato: t(running ? "snapshot.frozen" : "snapshot.ready"),
      N: config.N,
      preset: presetLabel(config.preset),
      shots: config.shots,
      seed: config.seed,
      lock: t($("seedLockInput").checked ? "snapshot.locked" : "snapshot.unlocked"),
      rumore: active.length ? t("snapshot.noiseActive", { n: active.length }) : t("snapshot.noiseNone"),
    });
  }

  function setExperimentBusy(busy) {
    state.experiment.running = busy;
    $("experimentControls").disabled = busy;
    $("emptyRunBtn").disabled = busy;
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
        if (state.tesi) renderQecChart(state.tesi.qec);
      });
      toggle.addEventListener("change", () => {
        if (key === "t1_us" || key === "t2_us") {
          setThermalEnabled(toggle.checked);
          setStatus("experimentStatus", toggle.checked ? "status.thermalOn" : "status.thermalOff");
        }
        markCustom();
        refreshNoiseUI();
        if (state.tesi) renderQecChart(state.tesi.qec);
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
    /* Il comando che avvia il confronto viveva solo dentro il pannello di
       dettaglio, che parte chiuso: lo stato vuoto invitava a premere un pulsante
       fuori dallo schermo, e chi premeva "Avvia automatico" -- l'unico visibile
       -- animava le sfere senza produrre alcun risultato qui sotto. Questo e' lo
       stesso comando dove l'utente sta guardando, e apre il pannello cosi' si
       vedono configurazione usata e riga di stato mentre gira. */
    $("emptyRunBtn").addEventListener("click", () => {
      mostraDettaglioRumore(true);
      runExperiment();
    });
    applyPreset("uc1");
  }

  async function runExperiment() {
    if (state.experiment.running) return;
    const snapshot = configSnapshot();
    if ((snapshot.noise.t1_us == null) !== (snapshot.noise.t2_us == null)) {
      setStatus("experimentStatus", "status.thermalPair", null, "error");
      return;
    }
    if (snapshot.noise.t1_us != null && snapshot.noise.t2_us > 2 * snapshot.noise.t1_us) {
      setStatus("experimentStatus", "status.nonPhysical", null, "error");
      return;
    }
    const requestId = ++state.experiment.requestId;
    state.experiment.controller?.abort();
    const controller = new AbortController();
    state.experiment.controller = controller;
    setExperimentBusy(true);
    updateSnapshot(snapshot, true);
    setStatus("experimentStatus", "status.simulating",
      { N: snapshot.N, shots: snapshot.shots, seed: snapshot.seed }, "loading");
    try {
      const response = await apiJSON("/api/experiment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ N: snapshot.N, shots: snapshot.shots, seed: snapshot.seed, noise: snapshot.noise }),
        signal: controller.signal,
      });
      if (requestId !== state.experiment.requestId) return;
      state.experiment.lastResponse = response;
      state.experiment.lastRenderSnapshot = snapshot;
      renderExperiment(response, snapshot);
      renderEntropia();
      renderGauge();
      state.experiment.hasResult = true;
      const independent = response.metadata?.simulation_seeds?.independent_streams === true;
      setStatus("experimentStatus", "status.experimentDone", {
        shots: response.shots ?? response.config?.shots ?? snapshot.shots,
        seed: response.seed ?? response.config?.seed ?? snapshot.seed,
        note: () => t(independent ? "status.streams.independent" : "status.streams.reused"),
      }, "success");
    } catch (error) {
      if (error.name !== "AbortError" && requestId === state.experiment.requestId) setStatus("experimentStatus", "status.experimentFailed", { err: errorMessage(error) }, "error");
    } finally {
      if (requestId === state.experiment.requestId) setExperimentBusy(false);
    }
  }

  function ciText(value) {
    if (!value) return t("ci.unavailable");
    const low = Array.isArray(value) ? value[0] : (value.lower ?? value.low ?? value.min);
    const high = Array.isArray(value) ? value[1] : (value.upper ?? value.high ?? value.max);
    return low == null || high == null
      ? t("ci.unavailable")
      : t("ci.range", { low: percentMetric(low), high: percentMetric(high) });
  }

  function formatFactors(value) {
    if (value == null || (Array.isArray(value) && value.length === 0)) return t("factors.none");
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
    deltaEl.textContent = delta == null ? "—" : `${delta > 0 ? "+" : ""}${fmtNum(delta, 1)} pp`;
    deltaEl.className = delta == null ? "" : delta < 0 ? "is-negative" : delta > 0 ? "is-positive" : "";
    const deltaCI = comparison.factor_yield_delta_ci;
    $("yieldDeltaCI").textContent = deltaCI
      ? t("ci.deltaRange", {
          low: fmtNum(Number(deltaCI.low) * 100, 1), high: fmtNum(Number(deltaCI.high) * 100, 1),
        })
      : t("ci.deltaUnavailable");
    $("peakMass").textContent = percentMetric(noisy.peak_mass);
    $("usefulPeakMass").textContent = t("kpi.usefulPeaks", {
      noisy: percentMetric(noisy.useful_peak_mass), ideal: percentMetric(ideal.useful_peak_mass),
    });
    $("tvdValue").textContent = Number.isFinite(Number(comparison.tvd)) ? fmtNum(comparison.tvd, 3) : "—";

    const hasDistance = Number.isFinite(Number(comparison.hellinger_distance));
    const hellinger = hasDistance ? comparison.hellinger_distance : comparison.hellinger_fidelity;
    $("hellingerLabel").textContent = t(hasDistance ? "kpi.hellinger.distance" : "kpi.hellinger.fidelity");
    $("hellingerValue").textContent = Number.isFinite(Number(hellinger)) ? fmtNum(hellinger, 3) : "—";
    $("hellingerHelp").textContent = t(hasDistance ? "kpi.identical0" : "kpi.identical1");
    const idealEntropy = ideal.entropy ?? ideal.entropy_bits;
    const noisyEntropy = noisy.entropy ?? noisy.entropy_bits;
    $("idealEntropy").textContent = Number.isFinite(Number(idealEntropy)) ? t("unit.bit", { v: fmtNum(idealEntropy, 3) }) : "—";
    $("noisyEntropy").textContent = Number.isFinite(Number(noisyEntropy)) ? t("unit.bit", { v: fmtNum(noisyEntropy, 3) }) : "—";
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
    const summary = t("chart.summary", {
      shots, ideal: topIdeal.join(", "), noisy: topNoisy.join(", "),
    });
    clearSvg(svg, t("chart.svg.titleFull", { n: dimension }),
      t("chart.desc.peaks", { summary, peaks: peaks.join(", ") }));

    for (let i = 0; i <= 4; i += 1) {
      const probability = (yMax * i) / 4;
      const yy = y(probability);
      svg.append(svgNode("line", { x1: margin.left, y1: yy, x2: width - margin.right, y2: yy, stroke: "rgba(188,195,225,.12)", "stroke-width": 1 }));
      svg.append(svgNode("text", { x: margin.left - 10, y: yy + 4, fill: "var(--dim)", "font-size": 10, "font-family": "var(--mono)", "text-anchor": "end" }, `${fmtNum(probability * 100, probability < .1 ? 1 : 0)}%`));
    }

    peaks.forEach((peak) => {
      const xx = x(peak);
      svg.append(svgNode("line", { x1: xx, y1: margin.top - 7, x2: xx, y2: margin.top + plotHeight, stroke: "var(--cyan)", "stroke-width": 1.3, "stroke-dasharray": "4 5", opacity: .75 }));
      svg.append(svgNode("text", { x: xx + (peak === 0 ? 4 : 0), y: 17, fill: "var(--cyan)", "font-size": 9, "font-family": "var(--mono)", "text-anchor": peak === 0 ? "start" : "middle" }, t("chart.peakTick", { v: peak })));
    });

    ideal.forEach((bin, index) => {
      if (bin.probability <= 0) return;
      const xx = x(index) - barWidth - .25;
      const yy = y(bin.probability);
      const rect = svgNode("rect", { x: xx, y: yy, width: barWidth, height: margin.top + plotHeight - yy, fill: "var(--violet)", opacity: .76, rx: .7 });
      rect.append(svgNode("title", {}, t("chart.bar.ideal", { v: index, p: percentMetric(bin.probability, 2), c: bin.count })));
      svg.append(rect);
    });
    noisy.forEach((bin, index) => {
      if (bin.probability <= 0) return;
      const xx = x(index) + .25;
      const yy = y(bin.probability);
      const rect = svgNode("rect", { x: xx, y: yy, width: barWidth, height: margin.top + plotHeight - yy, fill: "var(--amber)", opacity: .82, rx: .7 });
      rect.append(svgNode("title", {}, t("chart.bar.noisy", { v: index, p: percentMetric(bin.probability, 2), c: bin.count })));
      svg.append(rect);
    });

    Array.from(new Set(Array.from({ length: 9 }, (_, index) => Math.round(index * maxValue / 8)))).forEach((tick) => {
      const xx = x(tick);
      svg.append(svgNode("line", { x1: xx, y1: margin.top + plotHeight, x2: xx, y2: margin.top + plotHeight + 5, stroke: "var(--dim)" }));
      svg.append(svgNode("text", { x: xx, y: height - 27, fill: "var(--muted)", "font-size": 10, "font-family": "var(--mono)", "text-anchor": tick === 0 ? "start" : tick === maxValue ? "end" : "middle" }, tick));
    });
    svg.append(svgNode("text", { x: margin.left + plotWidth / 2, y: height - 6, fill: "var(--dim)", "font-size": 10, "font-family": "var(--mono)", "text-anchor": "middle" }, t("chart.xAxis", { max: maxValue })));
    $("chartSummary").textContent = summary;
  }

  function renderIterations(iterations) {
    const list = $("iterationList");
    list.replaceChildren();
    const sample = Array.isArray(iterations) ? iterations.slice(0, 24) : [];
    if (!sample.length) {
      const empty = document.createElement("p");
      empty.className = "details-help";
      empty.textContent = t("details.iterations.empty");
      list.append(empty);
      return;
    }
    sample.forEach((iteration, index) => {
      const ok = Boolean(iteration.ok);
      const cell = document.createElement("span");
      cell.className = `iteration${ok ? " is-ok" : ""}`;
      cell.title = t("iteration.title", { i: index + 1, v: iteration.value, esito: t(ok ? "iteration.ok" : "iteration.fail") });
      const value = document.createElement("b");
      value.textContent = String(iteration.value);
      const status = document.createElement("small");
      status.textContent = t(ok ? "iteration.okShort" : "iteration.failShort");
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
    $("stepModeBtn").addEventListener("click", () => {
      if (state.ideal.classical) { runClassicalOutcome(); return; }
      stopPlayback(); loadStage(0);
    });
    $("prevStageBtn").addEventListener("click", () => { stopPlayback(); loadStage(state.ideal.stage - 1); });
    $("nextStageBtn").addEventListener("click", () => { stopPlayback(); loadStage(state.ideal.stage + 1); });
  }

  // Per un N fuori dai tre preset non esiste una riga in INSTANCES: si parte da
  // un segnaposto e currentInstance() lo sovrascrive con cio' che risponde il
  // backend (base scelta, ordine, picchi, resa ideale).
  function freeInstance(N) {
    return { N, a: null, nCount: null, order: null, factors: null, maxShots: 128,
             dimension: null, peaks: [], usefulPeaks: [], idealYield: null, randomFloor: null };
  }

  function selectInstance(N) {
    if (!Number.isInteger(N) || N === state.instance.N) return;
    stopPlayback();
    state.ideal.controller?.abort();
    state.experiment.controller?.abort();
    state.experiment.requestId += 1;
    state.experiment.hasResult = false;
    state.experiment.lastResponse = null;
    state.instance = INSTANCES[N] || freeInstance(N);
    state.ideal.classical = null;
    state.ideal.info = null;
    $("emptyResults").hidden = false;
    $("experimentResults").hidden = true;
    $("chartSummary").textContent = t("chart.noDataInstance");
    updateInstancePresentation();
    if (!INSTANCES[N]) {
      // Il laboratorio del rumore resta sulle tre istanze validate: i circuiti
      // generici stanno sui 26 qubit e il rumore live non li regge.
      $("runExperimentBtn").disabled = true;
      $("emptyRunBtn").disabled = true;
      setStatus("experimentStatus", "status.instanceFree", { N });
    } else {
      $("runExperimentBtn").disabled = false;
      $("emptyRunBtn").disabled = false;
      if (N === 21) applyPreset("readout");
      else refreshNoiseUI();
      setStatus("experimentStatus", "status.instanceSelected", { N });
    }
    initIdeal();
    loadCircuitCost(N);
  }

  function setupInstanceControl() {
    $("instanceSelect").addEventListener("change", (event) => {
      if (event.target.value === "altro") {
        $("customNField").hidden = false;
        $("customNInput").focus();
        return;   // si aspetta il numero: non si cambia istanza a vuoto
      }
      $("customNField").hidden = true;
      $("customNInput").value = "";
      selectInstance(Number(event.target.value));
    });
    const submitCustom = () => {
      const N = Number($("customNInput").value);
      if (!Number.isInteger(N) || N < 4 || N > 47) {
        setStatus("idealStatus", "status.customRange", null, "error");
        return;
      }
      selectInstance(N);
    };
    $("customNInput").addEventListener("change", submitCustom);
    $("customNInput").addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); submitCustom(); }
    });
  }

  /* Le bandiere sono <svg>, e `hidden` e' una proprieta' di HTMLElement: su un
     elemento SVG assegnarla crea una proprieta' JS che NON si riflette
     sull'attributo, quindi la regola CSS [hidden] non scatta e restano visibili
     tutte e due. Va scritto l'attributo. */
  function mostraBandiera(elemento, visibile) {
    if (visibile) elemento.removeAttribute("hidden");
    else elemento.setAttribute("hidden", "");
  }

  // --- Curve validate della tesi -------------------------------------------
  // Non sono ricalcolate qui: arrivano da campagne gia' eseguite e verificate,
  // estratte in precomputed/tesi.json da estrai_dati_tesi.py. La sezione resta
  // nascosta se il file non c'e': meglio assente che con grafici vuoti.
  const LOG10 = (x) => Math.log(x) / Math.LN10;
  const APICE = (n) => String(n).replace(/\d/g, (c) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[+c]);

  async function loadCurveTesi() {
    try {
      const dati = await apiJSON("/api/curve-tesi");
      if (!dati || !dati.qec || !dati.shor_logico) return;
      state.tesi = dati;
      $("thesisPanel").hidden = false;
      renderCurveTesi();
    } catch (error) {
      state.tesi = null;   // sezione assente: non e' un errore da mostrare
    }
  }

  function renderCurveTesi() {
    if (!state.tesi) return;
    renderQecChart(state.tesi.qec);
    renderShorChart(state.tesi.shor_logico);
    renderCosto(state.tesi.qec.surface);
    renderEntropia();
    renderGauge();
  }

  /* Entropia della distribuzione appena misurata: due barre sulla stessa scala,
     0..n_count bit. L'uniforme e' il massimo, cioe' informazione azzerata. */
  function renderEntropia() {
    const host = $("entropyPanel");
    if (!host) return;
    host.replaceChildren();
    const risposta = state.experiment.lastResponse;
    if (!risposta) {
      const vuoto = document.createElement("p");
      vuoto.className = "details-help";
      vuoto.textContent = t("thesis.entropy.empty");
      host.append(vuoto);
      return;
    }
    const bitMax = Number(risposta.config && risposta.config.n_count) || currentInstance().nCount;
    const righe = [
      { chiave: "thesis.entropy.ideal", classe: "is-ideal",
        v: Number(risposta.ideal && (risposta.ideal.entropy_bits ?? risposta.ideal.entropy)) },
      { chiave: "thesis.entropy.noisy", classe: "is-noisy",
        v: Number(risposta.noisy && (risposta.noisy.entropy_bits ?? risposta.noisy.entropy)) },
    ];
    righe.forEach((r) => {
      if (!Number.isFinite(r.v)) return;
      const riga = document.createElement("div");
      riga.className = "entropy-row";
      const et = document.createElement("small");
      et.textContent = t(r.chiave);
      const pista = document.createElement("div");
      pista.className = "entropy-track";
      const riemp = document.createElement("div");
      riemp.className = "entropy-fill " + r.classe;
      riemp.style.width = Math.max(0, Math.min(100, (r.v / bitMax) * 100)).toFixed(1) + "%";
      pista.append(riemp);
      const val = document.createElement("b");
      val.textContent = t("thesis.entropy.unit", { v: fmtNum(r.v, 2), max: bitMax });
      riga.append(et, pista, val);
      host.append(riga);
    });
  }

  /* Errore logico contro errore fisico, log-log. Le curve misurate stanno tutte
     insieme perche' il confronto e' il punto: sotto soglia la distanza compra
     soppressione, sopra soglia la peggiora. */
  function renderQecChart(qec) {
    const svg = $("qecChart");
    if (!svg) return;
    const W = 920, H = 430;
    const m = { top: 22, right: 176, bottom: 54, left: 66 };
    const pw = W - m.left - m.right, ph = H - m.top - m.bottom;
    const xmin = 1e-3, xmax = 0.5, ymin = 1e-6, ymax = 1;
    const X = (p) => m.left + (LOG10(p) - LOG10(xmin)) / (LOG10(xmax) - LOG10(xmin)) * pw;
    const Y = (p) => m.top + ph - (LOG10(p) - LOG10(ymin)) / (LOG10(ymax) - LOG10(ymin)) * ph;

    clearSvg(svg, t("thesis.qec.title"), t("thesis.qec.help"));

    for (let e = -6; e <= 0; e += 1) {
      const y = Y(Math.pow(10, e));
      svg.append(svgNode("line", { x1: m.left, y1: y, x2: m.left + pw, y2: y,
        stroke: "rgba(188,195,225,.10)", "stroke-width": 1 }));
      svg.append(svgNode("text", { x: m.left - 9, y: y + 4, fill: "var(--dim)", "font-size": 10,
        "font-family": "var(--mono)", "text-anchor": "end" },
        e === 0 ? "1" : "10⁻" + APICE(-e)));
    }
    [1e-3, 1e-2, 1e-1, 0.5].forEach((p) => {
      const x = X(p);
      svg.append(svgNode("line", { x1: x, y1: m.top, x2: x, y2: m.top + ph,
        stroke: "rgba(188,195,225,.08)", "stroke-width": 1 }));
      svg.append(svgNode("text", { x, y: H - 30, fill: "var(--muted)", "font-size": 10,
        "font-family": "var(--mono)", "text-anchor": "middle" }, percentMetric(p, p < 0.01 ? 1 : 0)));
    });

    // p_L = p: la retta che la correzione deve battere.
    svg.append(svgNode("line", { x1: X(xmin), y1: Y(xmin), x2: X(xmax), y2: Y(xmax),
      stroke: "var(--dim)", "stroke-width": 1.4, "stroke-dasharray": "5 5" }));

    const serie = [];
    const traccia = (punti, colore, etichetta) => {
      const validi = (punti || []).filter((q) => q.p >= xmin && q.p <= xmax && q.pL > 0);
      if (!validi.length) return;
      const d = validi.map((q, i) => (i ? "L" : "M") + X(q.p).toFixed(1) + "," +
        Y(Math.max(ymin, q.pL)).toFixed(1)).join(" ");
      svg.append(svgNode("path", { d, fill: "none", stroke: colore, "stroke-width": 1.9 }));
      validi.forEach((q) => {
        const c = svgNode("circle", { cx: X(q.p).toFixed(1), cy: Y(Math.max(ymin, q.pL)).toFixed(1),
          r: 2.9, fill: colore });
        c.append(svgNode("title", {}, etichetta + " · p=" + q.p + " → p_L=" + q.pL));
        svg.append(c);
      });
      serie.push({ etichetta, colore });
    };

    traccia(qec.repetition.punti, "var(--violet)", t("thesis.qec.repetition"));
    traccia(qec.steane.punti, "var(--pink)", t("thesis.qec.steane"));
    const coloriD = ["var(--blue)", "var(--cyan)", "var(--green)", "var(--amber)"];
    Object.keys(qec.surface.distanze).forEach((d, i) => {
      traccia(qec.surface.distanze[d], coloriD[i % coloriD.length], t("thesis.qec.surface", { d }));
    });

    // La soglia: a destra di questa linea aumentare la distanza peggiora.
    const xs = X(qec.surface.p_th);
    svg.append(svgNode("line", { x1: xs, y1: m.top, x2: xs, y2: m.top + ph,
      stroke: "var(--red)", "stroke-width": 1.3, "stroke-dasharray": "3 4", opacity: .8 }));
    svg.append(svgNode("text", { x: xs + 5, y: m.top + 12, fill: "var(--red)", "font-size": 9.5,
      "font-family": "var(--mono)" },
      t("thesis.qec.threshold", { v: percentMetric(qec.surface.p_th, 2) })));

    let ly = m.top + 6;
    svg.append(svgNode("text", { x: m.left + pw + 16, y: ly, fill: "var(--dim)", "font-size": 9.5,
      "font-family": "var(--mono)" }, t("thesis.qec.none")));
    svg.append(svgNode("line", { x1: m.left + pw + 16, y1: ly + 6, x2: m.left + pw + 40, y2: ly + 6,
      stroke: "var(--dim)", "stroke-width": 1.4, "stroke-dasharray": "5 5" }));
    ly += 24;
    serie.forEach((s) => {
      svg.append(svgNode("line", { x1: m.left + pw + 16, y1: ly, x2: m.left + pw + 40, y2: ly,
        stroke: s.colore, "stroke-width": 2.4 }));
      svg.append(svgNode("text", { x: m.left + pw + 46, y: ly + 3.5, fill: "var(--muted)",
        "font-size": 10, "font-family": "var(--mono)" }, s.etichetta));
      ly += 19;
    });

    svg.append(svgNode("text", { x: m.left + pw / 2, y: H - 9, fill: "var(--dim)", "font-size": 10,
      "font-family": "var(--mono)", "text-anchor": "middle" }, t("thesis.qec.axisX")));
    svg.append(svgNode("text", { x: 15, y: m.top + ph / 2, fill: "var(--dim)", "font-size": 10,
      "font-family": "var(--mono)", "text-anchor": "middle",
      transform: "rotate(-90 15 " + (m.top + ph / 2) + ")" }, t("thesis.qec.axisY")));

    marcaSogliaQec(svg, { X, xmin, xmax, top: m.top, ph }, qec);

    $("qecSource").textContent = t("thesis.qec.source", {
      shots: fmtNum(qec.steane.shots, 0),
      A: fmtNum(qec.surface.A, 4),
      pth: percentMetric(qec.surface.p_th, 2),
      rms: fmtNum(qec.surface.rms_ln, 3),
    });
  }

  /* Resa di Shor contro errore logico. L'asse x e' logaritmico ma la curva parte
     da p_L=0, che su un log non esiste: il punto ideale sta in una tacca a se',
     all'estrema sinistra, separata da uno stacco visibile. */
  function renderShorChart(shor) {
    const svg = $("shorChart");
    if (!svg) return;
    const W = 920, H = 390;
    const m = { top: 22, right: 150, bottom: 58, left: 62 };
    const pw = W - m.left - m.right, ph = H - m.top - m.bottom;
    const stacco = 44;
    const xmin = 1e-4, xmax = 0.5;
    const X = (pL) => (pL <= 0 ? m.left + 12
      : m.left + stacco + (LOG10(pL) - LOG10(xmin)) / (LOG10(xmax) - LOG10(xmin)) * (pw - stacco));
    const ytop = 0.8;
    const Y = (v) => m.top + ph - (v / ytop) * ph;

    clearSvg(svg, t("thesis.shor.title"), t("thesis.shor.help"));

    for (let g = 0; g <= 8; g += 1) {
      const v = (ytop * g) / 8, y = Y(v);
      svg.append(svgNode("line", { x1: m.left, y1: y, x2: m.left + pw, y2: y,
        stroke: "rgba(188,195,225,.10)", "stroke-width": 1 }));
      svg.append(svgNode("text", { x: m.left - 9, y: y + 4, fill: "var(--dim)", "font-size": 10,
        "font-family": "var(--mono)", "text-anchor": "end" }, percentMetric(v, 0)));
    }
    svg.append(svgNode("line", { x1: m.left + stacco - 14, y1: m.top, x2: m.left + stacco - 14,
      y2: m.top + ph, stroke: "rgba(188,195,225,.22)", "stroke-width": 1, "stroke-dasharray": "2 4" }));
    svg.append(svgNode("text", { x: m.left + 12, y: H - 34, fill: "var(--muted)", "font-size": 10,
      "font-family": "var(--mono)", "text-anchor": "middle" }, "0"));
    [1e-4, 1e-3, 1e-2, 1e-1, 0.5].forEach((p) => {
      const x = X(p);
      svg.append(svgNode("line", { x1: x, y1: m.top, x2: x, y2: m.top + ph,
        stroke: "rgba(188,195,225,.08)", "stroke-width": 1 }));
      svg.append(svgNode("text", { x, y: H - 34, fill: "var(--muted)", "font-size": 10,
        "font-family": "var(--mono)", "text-anchor": "middle" }, String(p)));
    });

    // Il pavimento: sotto non si scende, perche' anche tirando a caso il
    // post-processing estrae i fattori da 63 esiti su 256.
    const yf = Y(shor.pavimento_uniforme);
    svg.append(svgNode("line", { x1: m.left, y1: yf, x2: m.left + pw, y2: yf,
      stroke: "var(--red)", "stroke-width": 1.4, "stroke-dasharray": "6 5", opacity: .85 }));

    const punti = shor.punti || [];
    const d = punti.map((q, i) => (i ? "L" : "M") + X(q.pL).toFixed(1) + "," + Y(q.P).toFixed(1)).join(" ");
    svg.append(svgNode("path", { d, fill: "none", stroke: "var(--amber)", "stroke-width": 2.2 }));
    punti.forEach((q) => {
      const x = X(q.pL);
      svg.append(svgNode("line", { x1: x, y1: Y(q.lo), x2: x, y2: Y(q.hi),
        stroke: "var(--amber)", "stroke-width": 1.2, opacity: .75 }));
      const c = svgNode("circle", { cx: x.toFixed(1), cy: Y(q.P).toFixed(1), r: 3.3,
        fill: q.pL === 0 ? "var(--violet)" : "var(--amber)" });
      c.append(svgNode("title", {}, "p_L=" + q.pL + " → " + percentMetric(q.P, 2) +
        "  IC95 [" + percentMetric(q.lo, 2) + ", " + percentMetric(q.hi, 2) + "]"));
      svg.append(c);
    });

    let ly = m.top + 8;
    [[t("thesis.shor.idealPoint", { v: percentMetric(shor.P_ideale, 1) }), "var(--violet)"],
     [t("thesis.shor.floor", { v: percentMetric(shor.pavimento_uniforme, 1) }), "var(--red)"]]
      .forEach((coppia) => {
        svg.append(svgNode("circle", { cx: m.left + pw + 22, cy: ly, r: 3.4, fill: coppia[1] }));
        svg.append(svgNode("text", { x: m.left + pw + 32, y: ly + 3.5, fill: "var(--muted)",
          "font-size": 10, "font-family": "var(--mono)" }, coppia[0]));
        ly += 20;
      });

    svg.append(svgNode("text", { x: m.left + pw / 2, y: H - 9, fill: "var(--dim)", "font-size": 10,
      "font-family": "var(--mono)", "text-anchor": "middle" }, t("thesis.shor.axisX")));
    svg.append(svgNode("text", { x: 14, y: m.top + ph / 2, fill: "var(--dim)", "font-size": 10,
      "font-family": "var(--mono)", "text-anchor": "middle",
      transform: "rotate(-90 14 " + (m.top + ph / 2) + ")" }, t("thesis.shor.axisY")));

    $("shorSource").textContent = t("thesis.shor.source", {
      punti: punti.length, repliche: shor.repliche, shot: fmtNum(shor.shot_per_replica, 0),
    });
  }

  /* Dove ti collochi rispetto alla soglia misurata.

     L'asse x del pannello QEC e' l'errore fisico per gate, ed e' la stessa
     grandezza che muovi con la depolarizzazione 2Q: marcarci sopra il valore
     scelto e' legittimo e risponde alla domanda che conta -- sono sopra o sotto
     la soglia? Sopra, il surface code peggiora le cose invece di aiutare.

     Il pannello 3 invece NON riceve alcun marcatore: il suo asse e' p_L, un
     proxy fenomenologico logico, e non esiste conversione dai cursori a quella
     grandezza. Disegnarcela sarebbe una equivalenza che i dati non sostengono. */
  function marcaSogliaQec(svg, geom, qec) {
    const n = collectNoise();
    const eps2 = Number(n.eps_2q) || 0;
    const verdetto = $("qecVerdict");
    const soglia = Number(qec.surface.p_th);

    if (!(eps2 > 0)) {
      if (verdetto) {
        verdetto.textContent = t("thesis.qec.off");
        verdetto.className = "thesis-verdict is-off";
      }
      return;
    }

    const dentro = eps2 >= geom.xmin && eps2 <= geom.xmax;
    if (dentro) {
      const x = geom.X(eps2);
      svg.append(svgNode("line", { x1: x, y1: geom.top, x2: x, y2: geom.top + geom.ph,
        stroke: "var(--text)", "stroke-width": 2, opacity: .9 }));
      svg.append(svgNode("circle", { cx: x, cy: geom.top + geom.ph, r: 4, fill: "var(--text)" }));
      svg.append(svgNode("text", { x: x + 6, y: geom.top + geom.ph - 8, fill: "var(--text)",
        "font-size": 10, "font-family": "var(--mono)" },
        t("thesis.qec.yourChannel", { v: percentMetric(eps2, 2) })));
    }

    if (verdetto) {
      const sopra = eps2 > soglia;
      /* I numeri del confronto vengono dai punti MISURATI piu' vicini al valore
         scelto, non dalla legge di scala: quel fit e' stato adattato solo sotto
         soglia, ed estrapolarlo sopra darebbe cifre che nessuno ha misurato. */
      const vicino = puntoSurfaceVicino(qec.surface, eps2);
      // Oltre il doppio del punto piu' alto misurato non si cita piu' un punto
      // "vicino": sarebbe spacciare per confronto un dato preso altrove.
      if (vicino && eps2 > vicino.pMax * 2) {
        verdetto.innerHTML = t("thesis.qec.beyond", {
          v: percentMetric(eps2, 2), th: percentMetric(soglia, 2),
          pmax: percentMetric(vicino.pMax, 2),
        });
        verdetto.className = "thesis-verdict";
        return;
      }
      verdetto.innerHTML = vicino
        ? t(sopra ? "thesis.qec.above" : "thesis.qec.below", {
            v: percentMetric(eps2, 2), th: percentMetric(soglia, 2),
            p: percentMetric(vicino.p, 2),
            d1: vicino.dMin, d2: vicino.dMax,
            pl1: formatProxy(vicino.pLMin), pl2: formatProxy(vicino.pLMax),
          })
        : t(sopra ? "thesis.qec.above" : "thesis.qec.below", {
            v: percentMetric(eps2, 2), th: percentMetric(soglia, 2),
            p: "—", d1: "—", d2: "—", pl1: "—", pl2: "—",
          });
      verdetto.className = `thesis-verdict${sopra ? "" : " is-below"}`;
    }
  }

  /* Il punto misurato piu' vicino al rumore scelto, con l'errore logico alla
     distanza minima e massima disponibili. Serve a dire "a questo livello di
     rumore, spendere qubit rende cosi'" con numeri realmente misurati. */
  function puntoSurfaceVicino(surface, p) {
    const distanze = Object.keys(surface.distanze).sort((a, b) => Number(a) - Number(b));
    if (!distanze.length) return null;
    const griglia = surface.distanze[distanze[0]].map((q) => q.p);
    if (!griglia.length) return null;
    const pVicino = griglia.reduce((best, q) =>
      Math.abs(Math.log(q) - Math.log(p)) < Math.abs(Math.log(best) - Math.log(p)) ? q : best);
    const leggi = (d) => {
      const punto = (surface.distanze[d] || []).find((q) => q.p === pVicino);
      return punto ? punto.pL : null;
    };
    const dMin = distanze[0];
    const dMax = distanze[distanze.length - 1];
    const pLMin = leggi(dMin);
    const pLMax = leggi(dMax);
    if (pLMin == null || pLMax == null) return null;
    return { p: pVicino, pMax: Math.max(...griglia), dMin, dMax, pLMin, pLMax };
  }

  /* La resa misurata collocata fra pavimento casuale e ideale teorico.

     E' la stessa grandezza dell'asse verticale del pannello 3, quindi il
     confronto e' diretto e non richiede alcuna conversione. Sta qui e non
     sovrapposta a quel grafico proprio per non suggerire una posizione lungo
     un asse x che per questo dato non e' definito. */
  function renderGauge() {
    const svg = $("gaugeChart");
    if (!svg || !state.tesi) return;
    const W = 920, H = 150;
    const m = { left: 60, right: 60, top: 46 };
    const pw = W - m.left - m.right;
    const risposta = state.experiment.lastResponse;
    const shor = state.tesi.shor_logico;

    clearSvg(svg, t("thesis.gauge.title"), t("thesis.gauge.help"));
    const X = (v) => m.left + Math.max(0, Math.min(1, v)) * pw;

    svg.append(svgNode("rect", { x: m.left, y: m.top, width: pw, height: 16, rx: 8,
      fill: "rgba(255,255,255,.06)" }));
    for (let g = 0; g <= 10; g += 2) {
      const x = X(g / 10);
      svg.append(svgNode("text", { x, y: m.top + 44, fill: "var(--dim)", "font-size": 9.5,
        "font-family": "var(--mono)", "text-anchor": "middle" }, percentMetric(g / 10, 0)));
    }

    if (!risposta) {
      svg.append(svgNode("text", { x: W / 2, y: m.top - 18, fill: "var(--dim)", "font-size": 11,
        "font-family": "var(--mono)", "text-anchor": "middle" }, t("thesis.gauge.empty")));
      return;
    }

    const idealeMisurato = ratio(risposta.ideal && risposta.ideal.factor_yield);
    const rumorosoMisurato = ratio(risposta.noisy && risposta.noisy.factor_yield);
    const pavimento = Number(risposta.random_factor_floor) || shor.pavimento_uniforme;

    // La banda utile: da dove si arriva tirando a caso, fino all'ideale teorico.
    svg.append(svgNode("rect", { x: X(pavimento), y: m.top, width: X(shor.P_ideale) - X(pavimento),
      height: 16, rx: 8, fill: "rgba(169,146,255,.16)" }));

    const segna = (v, colore, testo, sopra) => {
      if (!Number.isFinite(v)) return;
      const x = X(v);
      svg.append(svgNode("line", { x1: x, y1: m.top - 6, x2: x, y2: m.top + 22,
        stroke: colore, "stroke-width": 2.4 }));
      svg.append(svgNode("text", { x, y: sopra ? m.top - 12 : m.top + 36, fill: colore,
        "font-size": 10, "font-family": "var(--mono)", "text-anchor": "middle" },
        `${testo} ${percentMetric(v, 1)}`));
    };

    segna(pavimento, "var(--red)", t("thesis.gauge.floor"), false);
    segna(shor.P_ideale, "var(--violet)", t("thesis.gauge.theoretical"), false);
    segna(idealeMisurato, "var(--cyan)", t("thesis.gauge.measuredIdeal"), true);
    segna(rumorosoMisurato, "var(--amber)", t("thesis.gauge.measuredNoisy"), true);
  }

  /* La legge di scala tradotta in prezzo: distanza necessaria e qubit fisici. */
  function renderCosto(surface) {
    const host = $("costPanel");
    if (!host) return;
    host.replaceChildren();
    (surface.costo || []).forEach((riga) => {
      const blocco = document.createElement("div");
      blocco.className = "cost-block";
      const titolo = document.createElement("h4");
      titolo.textContent = t("thesis.cost.at", { p: percentMetric(riga.p, 2) });
      const tab = document.createElement("table");
      const intestazione = document.createElement("tr");
      [t("thesis.cost.target"), t("thesis.cost.distance"), t("thesis.cost.qubits")].forEach((x) => {
        const th = document.createElement("th");
        th.textContent = x;
        intestazione.append(th);
      });
      tab.append(intestazione);
      riga.voci.forEach((v) => {
        const tr = document.createElement("tr");
        ["10⁻" + APICE(Math.round(-LOG10(v.bersaglio))), "d = " + v.d, fmtNum(v.qubit, 0)]
          .forEach((x) => {
            const td = document.createElement("td");
            td.textContent = x;
            tr.append(td);
          });
        tab.append(tr);
      });
      blocco.append(titolo, tab);
      host.append(blocco);
    });
  }

  /* Il pulsante mostra la bandiera della lingua ATTIVA: premerlo passa all'altra. */
  function renderLangToggle() {
    const lang = window.I18N.lang();
    mostraBandiera($("flagIt"), lang === "it");
    mostraBandiera($("flagEn"), lang === "en");
    $("langCode").textContent = lang.toUpperCase();
  }

  /* Cambiare lingua non ricarica la pagina e non ripete una sola chiamata all'API:
     il testo statico lo riscrive I18N.applyStatic, qui si riscrive dallo stesso
     stato tutto cio' che ha generato JavaScript. Senza questo passaggio la pagina
     resterebbe mezza italiana finche' non si ripete ogni azione. */
  function relocalize() {
    renderLangToggle();
    const congelato = lastSnapshot;
    statusState.forEach((_, id) => renderStatus(id));
    updateInstancePresentation();          // rifa' anche resetPipeline()
    if (state.experiment.running) updateNoiseAnatomy();
    else refreshNoiseUI();                 // i controlli non vanno riabilitati a meta' run
    if (congelato.snapshot) updateSnapshot(congelato.snapshot, congelato.running);

    if (state.ideal.info && state.ideal.bloch) {
      renderCircuit(state.ideal.info, state.ideal.bloch);
      renderStageExplanation(state.ideal.info.stages, state.ideal.stage);
      if (state.ideal.bloch.kind === "measure" && state.ideal.bloch.measured_shot) {
        renderPipeline(state.ideal.bloch.measured_shot, false);
      }
    }
    if (state.ideal.classical && !$("classicPanel").hidden) renderClassicalPanel(state.ideal.classical);
    if (state.bloch.noisy) renderBlochStage();
    if (state.experiment.lastResponse) {
      renderExperiment(state.experiment.lastResponse, state.experiment.lastRenderSnapshot);
    }
    renderCurveTesi();
    // applyStatic ha appena rimesso l'etichetta di riposo su entrambi i pulsanti.
    $("playStageBtn").textContent = t(state.ideal.playing ? "btn.pause" : "btn.playAuto");
    $("noisePlayBtn").textContent = t(state.bloch.playing ? "btn.pause" : "btn.playAuto");
    updateIdealButtons();
    updateBlochButtons();
  }

  function setupLangToggle() {
    $("langToggle").addEventListener("click", () => window.I18N.toggle());
    window.I18N.onChange(relocalize);
    renderLangToggle();
  }

  function init() {
    window.I18N.applyStatic();
    setupLangToggle();
    setupTabs();
    setupIdealControls();
    setupResultPopup();
    setupBlochView();
    setupStickyTabs();
    loadCircuitCost(state.instance.N);
    loadCurveTesi();
    loadNoisyBloch();
    setupNoiseControls();
    setupInstanceControl();
    resetPipeline();
    updateInstancePresentation();
    initIdeal();
  }

  init();
})();
