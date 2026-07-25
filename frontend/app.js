"use strict";
const NS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);
const svgEl = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };

const state = {
  N: 15, a: null, n_count: 0, num_qubits: 0, stages: [], stage: 0, n_stages: 0,
  blochOk: true, mode: "explore", statNoise: "uc1", shots: 100, playing: null,
};

async function api(path) {
  const r = await fetch(path);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || ("errore " + r.status));
  return data;
}

// N troppo grande da simulare dal vivo: disabilita i comandi di esecuzione (resta il circuito).
function setBigN(on) {
  ["resetBtn", "nextBtn", "runBtn"].forEach((id) => { $(id).disabled = on; });
}

// Mostra/nasconde il banner centrale (N risolto classicamente) al posto del circuito.
function showClassical(on) {
  $("classicalBanner").style.display = on ? "block" : "none";
  $("stageSvg").style.display = on ? "none" : "block";
  $("stageBar").style.display = on ? "none" : "";
  $("legend").style.display = on ? "none" : "flex";
  if (on) closeMeasureModal();
}

// --------------------------------------------------------------------------
// Fattorizzazione (Avvia)
// --------------------------------------------------------------------------
async function loadFactor(N) {
  stopPlay();
  $("factorMsg").innerHTML = `<div class="msg"><span class="spinner"></span>Preparo il circuito per N=${N}…</div>`;
  let info;
  try { info = await api(`/api/factor?N=${N}`); }
  catch (e) { $("factorMsg").innerHTML = `<div class="msg bad">${e.message}</div>`; return false; }

  if (info.done) {
    const isPrime = !info.p;
    $("classicalBanner").className = "classban " + (isPrime ? "prime" : "ok");
    $("classicalBanner").innerHTML = isPrime
      ? `<div class="ic">◆</div><h3>${N} è un numero primo</h3><p>Non è fattorizzabile: non serve — né è possibile — l'algoritmo di Shor.</p>`
      : `<div class="ic">✓</div><h3>Risolto classicamente</h3><div class="big">${N} = ${info.p} × ${info.q}</div><p>${info.reason}. Per questo N non serve il computer quantistico.</p>`;
    showClassical(true);
    $("factorMsg").innerHTML = "";
    $("params").innerHTML = `<span class="param">N <b>${N}</b></span>`;
    $("psval").textContent = "—"; state.n_stages = 0;
    return false;
  }
  showClassical(false);
  Object.assign(state, {
    N, a: info.a, n_count: info.n_count, num_qubits: info.num_qubits,
    stages: info.stages, n_stages: info.n_stages, stage: 0, blochOk: info.bloch_ok,
  });
  setBigN(!info.bloch_ok);
  $("params").innerHTML = [["N", N], ["base a", info.a], ["qubit", info.num_qubits], ["stadi", info.n_stages]]
    .map(([k, v]) => `<span class="param">${k} <b>${v}</b></span>`).join("");
  $("psval").textContent = "—";

  if (info.bloch_ok) {
    $("factorMsg").innerHTML = info.validated ? ""
      : `<div class="msg">Base scelta automaticamente (a=${info.a}) — circuito reale, non tra i tre validati in tesi.</div>`;
    $("resultBody").innerHTML = `<div class="msg">Premi <b>Esegui</b> per calcolare la distribuzione delle misure.</div>`;
    await loadStage(0);
  } else {
    // N grande: solo circuito statico (dimostrativo), niente autoplay né misura finta.
    $("factorMsg").innerHTML = `<div class="msg warn">N=${N} · <b>${info.num_qubits} qubit</b>: troppo grande da simulare qui — né lo stato-per-stato né la statistica sono praticabili in tempo reale (servirebbero <b>minuti</b> per singola iterazione). È <b>esattamente</b> il motivo per cui l'algoritmo di Shor è difficile da simulare su un computer classico. <b>Prova N=15</b> per l'esperienza completa.</div>`;
    $("stageLabel").textContent = `circuito completo · ${info.num_qubits} qubit (vista dimostrativa, non eseguibile qui)`;
    closeMeasureModal();
    renderCircuit(0, null);
  }
  return true;
}

// --------------------------------------------------------------------------
// Stadio
// --------------------------------------------------------------------------
async function loadStage(k) {
  if (state.n_stages === 0) return;
  state.stage = Math.max(0, Math.min(k, state.n_stages - 1));
  let b = null;
  if (state.blochOk) {
    try { b = await api(`/api/bloch?N=${state.N}&a=${state.a}&n_count=${state.n_count}&stage=${state.stage}`); }
    catch (e) { $("stageLabel").textContent = e.message; b = null; }
  }
  renderCircuit(state.stage, b);
  const label = b ? b.label : (state.stages[state.stage] || {}).label || "";
  $("stageLabel").textContent = `stadio ${state.stage} / ${state.n_stages - 1} — ${label}`;
  $("stageNum").textContent = `stadio ${state.stage} / ${state.n_stages - 1}`;
  $("nextBtn").disabled = state.stage >= state.n_stages - 1;
  renderMeasureModal(b);
}

// Messaggio dell'esito della SINGOLA misura (passo-passo): se non porta ai fattori, spiega
// che è normale (Shor è probabilistico) e invita a ripetere / vedere molte iterazioni.
function closeMeasureModal() { $("measureModal").style.display = "none"; }

function renderMeasureModal(b) {
  if (!b || b.kind !== "measure" || !b.measured_shot) { closeMeasureModal(); return; }
  const s = b.measured_shot, card = $("measureCard");
  card.className = "modal-card " + (s.ok ? "ok" : "no");
  card.innerHTML = s.ok
    ? `<button class="modal-close" id="modalClose" aria-label="Chiudi">×</button>
       <div class="ic">✓</div><h3>Misura riuscita</h3>
       <div class="big">${state.N} = ${s.p} × ${s.q}</div>
       <p>Esito misurato <b>${s.value}</b>. Shor trova ${s.p}, l'altro per divisione classica.</p>
       <div class="modal-run"><button class="btn" id="modalOk">Ottimo</button></div>`
    : `<button class="modal-close" id="modalClose" aria-label="Chiudi">×</button>
       <div class="ic">✗</div><h3>Questa misura non porta ai fattori</h3>
       <p>Esito misurato <b>${s.value}</b>. Capita: Shor è <strong>probabilistico</strong> (succede anche senza rumore, per la degenerazione del periodo). Serve <strong>ripetere</strong> — quante iterazioni vuoi eseguire?</p>
       <div class="modal-run">
         <span class="pill" data-q="10">10</span><span class="pill" data-q="100">100</span><span class="pill" data-q="1000">1000</span>
         <span class="clab" style="color:var(--muted);font-weight:400">oppure</span>
         <input class="num sm inline" id="iterInline" type="number" min="1" max="8192" value="${state.shots}" aria-label="Numero di iterazioni">
         <button class="btn ok" id="runInlineBtn">▶ Esegui le iterazioni</button>
       </div>`;
  $("measureModal").style.display = "flex";
  $("modalClose").addEventListener("click", closeMeasureModal);
  if ($("modalOk")) $("modalOk").addEventListener("click", closeMeasureModal);
  if ($("runInlineBtn")) {
    card.querySelectorAll(".modal-run .pill").forEach((p) => p.addEventListener("click", () => {
      $("iterInline").value = p.dataset.q;
      card.querySelectorAll(".modal-run .pill").forEach((q) => q.classList.toggle("on", q === p));
    }));
    $("runInlineBtn").addEventListener("click", () => {
      const n = Math.max(1, Math.min(8192, parseInt($("iterInline").value, 10) || 100));
      state.shots = n;
      document.querySelectorAll("#shotPills .pill").forEach((q) => q.classList.toggle("on", parseInt(q.dataset.shots, 10) === n));
      closeMeasureModal();
      runStats();
      $("resultPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

// --------------------------------------------------------------------------
// Disegno SVG
// --------------------------------------------------------------------------
function phaseColor(x, y) {
  const h = ((Math.atan2(y, x) / (2 * Math.PI)) + 1) % 1;
  return `hsl(${Math.round(h * 360)} 82% 66%)`;
}
const OPCOL = { H: "var(--violet)", "●": "var(--amber)", QFT: "var(--orchid)", "∿": "var(--cyan)", "⊕": "var(--muted)", "·": "var(--muted-2)", M: "var(--good)" };

function renderCircuit(stageIdx, b) {
  const svg = $("stageSvg");
  svg.innerHTML = "";
  const nc = state.n_count, nq = state.num_qubits;
  const nWorkAll = nq - nc, nWork = Math.min(nWorkAll, 3), extraWork = nWorkAll - nWork;
  const nWires = nc + nWork;
  const rowH = 64, top = 44, botPad = 18;
  const H = top + nWires * rowH + botPad;
  svg.setAttribute("viewBox", `0 0 1020 ${H}`);
  const cy = (i) => top + i * rowH + rowH / 2;
  const X0 = 64, XcircEnd = 700, SPH = 912, R = 16, xL = 122, xR = 656;

  const drawable = state.stages.map((s, idx) => ({ ...s, idx })).filter((s) => s.kind !== "init0");
  const xOf = (j) => (drawable.length <= 1 ? xL : xL + j * (xR - xL) / (drawable.length - 1));
  const curCol = drawable.findIndex((o) => o.idx === stageIdx);
  const add = (t, a, txt) => { const e = svgEl(t, a); if (txt != null) e.textContent = txt; svg.appendChild(e); return e; };

  add("text", { x: SPH, y: 22, fill: "var(--muted)", "font-size": 10, "text-anchor": "middle", "font-family": "var(--mono)", "letter-spacing": ".1em" }, "STATO");

  for (let i = 0; i < nc; i++) {
    const y = cy(i);
    add("text", { class: "wlab", x: 22, y: y + 4 }, "c" + i);
    add("line", { class: "wire", x1: X0, y1: y, x2: XcircEnd, y2: y });
    add("line", { class: "connector", x1: XcircEnd, y1: y, x2: SPH - R, y2: y });
  }
  for (let w = 0; w < nWork; w++) {
    const y = cy(nc + w);
    add("text", { class: "wlab", x: 22, y: y + 4 }, (w === nWork - 1 && extraWork > 0) ? `+${extraWork + 1} lav.` : "w" + w);
    add("line", { class: "wire work", x1: X0, y1: y, x2: XcircEnd, y2: y });
  }
  const workY = cy(nc);

  drawable.forEach((col, j) => {
    const x = xOf(j), active = col.idx === stageIdx;
    if (col.kind === "init") {
      for (let i = 0; i < nc; i++) { add("rect", { class: "gbox", x: x - 13, y: cy(i) - 13, width: 26, height: 26, rx: 6, stroke: "var(--violet)" }); add("text", { class: "gtx", x: x, y: cy(i) + 5 }, "H"); }
      add("rect", { class: "gbox", x: x - 13, y: workY - 13, width: 26, height: 26, rx: 6 });
      add("text", { class: "gtx", x: x, y: workY + 5, "font-size": 11, fill: "var(--muted)" }, "|1⟩");
    } else if (col.kind === "u") {
      const cyc = cy(col.control ?? 0), colr = active ? "var(--amber)" : "var(--muted-2)";
      add("circle", { cx: x, cy: cyc, r: active ? 6 : 5, fill: colr });
      add("line", { x1: x, y1: cyc, x2: x, y2: workY, stroke: colr, "stroke-width": active ? 2 : 1.5 });
      add("rect", { class: "gbox", x: x - 20, y: workY - 15, width: 40, height: 44, rx: 7, stroke: colr, "stroke-width": active ? 2 : 1.4 });
      add("text", { class: "gtx", x: x, y: workY + 11, "font-size": 12, fill: colr }, "U");
    } else if (col.kind === "qft") {
      const colr = active ? "var(--amber)" : "var(--line-2)";
      add("rect", { class: "gbox", x: x - 30, y: cy(0) - 15, width: 60, height: cy(nc - 1) - cy(0) + 30, rx: 9, stroke: colr, "stroke-width": active ? 2 : 1.4 });
      add("text", { class: "gtx", x: x, y: cy(Math.floor((nc - 1) / 2)) + 5, "font-size": 12 }, "QFT⁻¹");
    } else if (col.kind === "measure") {
      const colr = active ? "var(--amber)" : "var(--good)";
      for (let i = 0; i < nc; i++) { add("rect", { class: "gbox", x: x - 13, y: cy(i) - 13, width: 26, height: 26, rx: 6, stroke: colr }); add("text", { class: "gtx", x: x, y: cy(i) + 5, fill: "var(--good)" }, "M"); }
    }
  });

  const px = curCol >= 0 ? xOf(curCol) : xL - 26;
  add("line", { class: "playhead", id: "playhead", x1: px, y1: 26, x2: px, y2: H - 8 });
  add("text", { id: "playheadLbl", x: px, y: 18, fill: "var(--amber)", "font-size": 10, "text-anchor": "middle", "font-family": "var(--mono)" }, "▶ ora");
  state._sweep = { start: X0 + 4, end: xOf(drawable.length - 1) };  // per l'animazione multi-run

  for (let i = 0; i < nc; i++) {
    const y = cy(i), q = b ? b.qubits[i] : null;
    const g = svgEl("g", { opacity: (q && q.name === "a riposo") ? 0.62 : 1 });
    if (!q) {  // sfera placeholder (N grande, stato non simulato)
      g.appendChild(svgEl("circle", { cx: SPH, cy: y, r: R, fill: "rgba(20,14,28,.6)", stroke: "var(--line)", "stroke-dasharray": "2 3" }));
      const nd = svgEl("text", { class: "kettx", x: SPH, y: y + 4, fill: "var(--muted-2)" }); nd.textContent = "n/d"; g.appendChild(nd);
      svg.appendChild(g); continue;
    }
    let col = q.collapsed ? (q.ok ? "var(--good)" : "var(--bad)") : (q.name === "a riposo" ? "var(--muted-2)" : phaseColor(q.x, q.y));
    const bcol = q.collapsed ? (q.ok ? "var(--good)" : "var(--bad)") : (OPCOL[q.op] || "var(--muted)");
    g.appendChild(svgEl("rect", { x: SPH - 32, y: y - R - 19, width: 64, height: 14, rx: 7, fill: "rgba(255,255,255,.05)", stroke: q.active ? "var(--amber)" : "none" }));
    const tag = svgEl("text", { class: "optag", x: SPH, y: y - R - 9, fill: bcol }); tag.textContent = `${q.op} ${q.name}`; g.appendChild(tag);
    g.appendChild(svgEl("circle", { cx: SPH, cy: y, r: R, fill: "rgba(20,14,28,.85)", stroke: q.active ? "var(--amber)" : "var(--line-2)", "stroke-width": q.active ? 2 : 1 }));
    g.appendChild(svgEl("ellipse", { cx: SPH, cy: y, rx: R, ry: R * 0.32, fill: "none", stroke: "rgba(178,146,220,.28)" }));
    const vx = SPH + q.x * R * 0.92, vy = y - q.z * R * 0.9 + q.y * R * 0.26;
    g.appendChild(svgEl("line", { x1: SPH, y1: y, x2: vx.toFixed(1), y2: vy.toFixed(1), stroke: col, "stroke-width": 2.5 }));
    g.appendChild(svgEl("circle", { cx: vx.toFixed(1), cy: vy.toFixed(1), r: 3.3, fill: col }));
    const ket = svgEl("text", { class: "kettx", x: SPH, y: y + R + 15 }); ket.textContent = q.ket; g.appendChild(ket);
    svg.appendChild(g);
  }
}

// --------------------------------------------------------------------------
// Statistica
// --------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Anima il playhead (tratteggio) da inizio a fine del circuito in `ms` millisecondi.
function sweepPlayhead(ms) {
  return new Promise((resolve) => {
    const ph = $("playhead"), lbl = $("playheadLbl");
    if (!ph || !state._sweep || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { resolve(); return; }
    const { start, end } = state._sweep, t0 = performance.now();
    (function frame(t) {
      const p = Math.min(1, (t - t0) / ms), x = start + (end - start) * p;
      ph.setAttribute("x1", x); ph.setAttribute("x2", x);
      if (lbl) lbl.setAttribute("x", x);
      if (p < 1) requestAnimationFrame(frame); else resolve();
    })(t0);
  });
}

// Esegue le iterazioni e le MOSTRA una per una: per ogni iterazione il playhead attraversa il
// circuito (inizio → fine) e la relativa cella appare nella griglia dal vivo.
async function runStats() {
  stopPlay(); closeMeasureModal();
  $("psval").textContent = "…";
  $("resultBody").innerHTML = `<div class="msg"><span class="spinner"></span>Eseguo ${state.shots} iterazioni${state.statNoise !== "none" ? " con rumore " + state.statNoise.toUpperCase() : ""}…</div>
    <div class="lab" style="margin:14px 0 8px">Le iterazioni, una per una — <span style="color:var(--good)">verde</span> = trova i fattori, <span style="color:var(--bad)">rosso</span> = no · il numero è l'esito misurato</div>
    <div class="itergrid" id="liveGrid"></div>`;
  let res;
  try { res = await api(`/api/run?N=${state.N}&a=${state.a}&n_count=${state.n_count}&noise=${state.statNoise}&shots=${state.shots}`); }
  catch (e) { $("resultBody").innerHTML = `<div class="msg bad">${e.message}</div>`; $("psval").textContent = "—"; return; }

  if (state.blochOk) $("stageSvg").scrollIntoView({ behavior: "smooth", block: "center" });
  const iters = res.iterations, shown = iters.length, grid = $("liveGrid");
  const per = Math.max(80, 7000 / Math.max(1, shown));  // budget ~7s totali, min 80ms/iterazione
  for (let k = 0; k < shown; k++) {
    const ph = $("playhead");
    if (ph && state._sweep) { ph.setAttribute("x1", state._sweep.start); ph.setAttribute("x2", state._sweep.start); }
    await sweepPlayhead(per * 0.7);                       // il tratteggio attraversa il circuito
    const it = iters[k];
    const cell = document.createElement("div");
    cell.className = `itercell ${it.ok ? "ok" : "no"} ${res.found_at === k + 1 ? "first" : ""}`;
    cell.textContent = it.value;
    cell.title = `tentativo ${k + 1}: esito ${it.value}${it.ok ? " ✓ trova i fattori" : ""}`;
    grid.appendChild(cell);
    await sleep(per * 0.3);
  }
  renderStatsSummary(res);
  $("resultPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

// Riepilogo finale (dopo l'animazione): banner, "trovato al tentativo k", griglia completa,
// distribuzione, probabilità.
function renderStatsSummary(res) {
  const pcol = res.p_success >= 60 ? "var(--good)" : res.p_success >= 30 ? "var(--amber)" : "var(--warn)";
  $("psval").textContent = res.p_success + "%"; $("psval").style.color = pcol;
  const f = res.top_factors;
  const banner = f
    ? `<div class="banner ok"><div><h3>Fattori trovati</h3><div class="sub">Ripetendo le iterazioni, l'esito risolutivo emerge: Shor trova ${f[0]}, l'altro è ${state.N}/${f[0]} = ${f[1]}.</div></div><div class="big">${state.N} = ${f[0]} × ${f[1]}</div></div>`
    : `<div class="banner no"><div><h3>Nessun esito risolutivo</h3><div class="sub">In queste ${res.shots} iterazioni nessuna ha dato i fattori: aumenta le iterazioni o riduci il rumore.</div></div><div class="big">P ${res.p_success}%</div></div>`;
  const foundHtml = res.found_at
    ? `<div class="foundmsg ok">✓ Fattori trovati al <b>tentativo ${res.found_at}</b> su ${res.shots}. Una singola misura spesso fallisce, ma bastano poche ripetizioni.</div>`
    : `<div class="foundmsg no">Nessuna delle ${res.shots} iterazioni ha dato i fattori con questo rumore.</div>`;
  const cells = res.iterations.map((it, idx) =>
    `<div class="itercell ${it.ok ? "ok" : "no"} ${res.found_at === idx + 1 ? "first" : ""}" title="tentativo ${idx + 1}: esito ${it.value}${it.ok ? " ✓ trova i fattori" : ""}">${it.value}</div>`).join("");
  const shownNote = res.iterations_shown < res.shots ? ` (prime ${res.iterations_shown} di ${res.shots})` : "";
  const maxc = Math.max(1, ...res.distribution.map((d) => d.count));
  const bars = res.distribution.map((d) => `<div class="bar ${d.ok ? "hot" : ""}" style="height:${Math.round(100 * d.count / maxc)}%" title="esito ${d.value}: ${d.count}${d.ok ? " ✓" : ""}"></div>`).join("");
  const barx = res.distribution.map((d) => `<span>${d.value}</span>`).join("");
  $("resultBody").innerHTML = banner + foundHtml + `
    <div class="lab" style="margin:16px 0 8px">Le iterazioni, una per una${shownNote} · <span style="color:var(--good)">verde</span> = trova i fattori, <span style="color:var(--bad)">rosso</span> = no · il numero è l'esito misurato</div>
    <div class="itergrid">${cells}</div>
    <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:16px;margin-top:18px">
      <div><div class="lab" style="margin-bottom:7px">Distribuzione degli esiti · ${res.shots} iterazioni</div>
        <div class="bars">${bars}</div><div class="barx">${barx}</div></div>
      <div><div class="lab" style="margin-bottom:7px">Riepilogo</div>
        <div class="reliab">
          <div class="rrow"><span>probabilità di successo</span><b style="color:${pcol}">${res.p_success}%</b></div>
          <div class="rrow"><span>successi</span><b>${res.n_ok} / ${res.total}</b></div>
          <div class="rrow"><span>rumore</span><b>${state.statNoise === "none" ? "assente" : state.statNoise.toUpperCase()}</b></div>
        </div></div>
    </div>`;
}

// --------------------------------------------------------------------------
// Play / Avvia
// --------------------------------------------------------------------------
function stopPlay() { if (state.playing) { clearInterval(state.playing); state.playing = null; } $("startBtn").textContent = "▶ Avvia"; }
function startPlay() {
  if (state.n_stages <= 1) return;
  if (state.stage >= state.n_stages - 1) state.stage = -1;
  $("startBtn").textContent = "⏸ Pausa";
  state.playing = setInterval(async () => {
    if (state.stage >= state.n_stages - 1) { stopPlay(); return; }
    await loadStage(state.stage + 1);
  }, 1200);
}
async function onAvvia() {
  if (state.playing) { stopPlay(); return; }        // in play -> pausa
  const N = parseInt($("Ninput").value, 10) || 15;
  if (N !== state.N || state.n_stages === 0) {
    const ok = await loadFactor(N);
    if (!ok) return;                                 // classico o errore: niente play
  }
  if (!state.blochOk) return;                        // N grande: solo circuito statico, niente autoplay
  startPlay();
}

// --------------------------------------------------------------------------
// Modalità (Senza / Con rumore)
// --------------------------------------------------------------------------
function setMode(m) {
  state.mode = m;
  document.querySelectorAll("#modeToggle button").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
  const on = m === "noise";
  $("noiseGroup").style.display = on ? "inline-flex" : "none";  // i preset UC1/UC2 solo qui
  state.statNoise = on ? "uc1" : "none";
  document.querySelectorAll("#noisePills .pill").forEach((p) => p.classList.toggle("on", p.dataset.noise === state.statNoise));
}

// --------------------------------------------------------------------------
// Eventi
// --------------------------------------------------------------------------
$("startBtn").addEventListener("click", onAvvia);
$("Ninput").addEventListener("keydown", (e) => { if (e.key === "Enter") onAvvia(); });
$("resetBtn").addEventListener("click", () => { stopPlay(); loadStage(0); });
$("nextBtn").addEventListener("click", () => { stopPlay(); loadStage(state.stage + 1); });
$("runBtn").addEventListener("click", runStats);
document.querySelectorAll("#modeToggle button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
document.querySelectorAll("#noisePills .pill").forEach((p) => p.addEventListener("click", () => {
  state.statNoise = p.dataset.noise;
  document.querySelectorAll("#noisePills .pill").forEach((q) => q.classList.toggle("on", q === p));
}));
document.querySelectorAll("#shotPills .pill").forEach((p) => p.addEventListener("click", () => {
  state.shots = parseInt(p.dataset.shots, 10);
  document.querySelectorAll("#shotPills .pill").forEach((q) => q.classList.toggle("on", q === p));
}));

$("measureModal").addEventListener("click", (e) => { if (e.target.id === "measureModal") closeMeasureModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMeasureModal(); });

setMode("explore");
loadFactor(15);
