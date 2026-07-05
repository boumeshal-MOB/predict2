import { parseCsv } from "./csv.js";
import { MODELS, defaultParams } from "./algorithms/registry.js";
import { createChart, cleanSeries } from "./charts.js";
import { defaultDayHorizon } from "./algorithms/forecast.js";

const $ = (sel) => document.querySelector(sel);
const state = { data: null, modelId: "zscore", params: {}, result: null, visible: {} };

// Chart controllers (created lazily, reused across renders).
let chartMain = null;
let chartClean = null;

function ensureCharts() {
  if (chartMain) return;
  // Zooming/panning either chart mirrors the X window onto the other so the
  // original and cleaned series always line up.
  chartMain = createChart($("#chart-main"), {
    onViewChange: (dom) => {
      if (chartClean && chartClean.hasData && chartClean.N === chartMain.N) chartClean.setXDomain(dom, true);
    },
  });
  chartClean = createChart($("#chart-clean"), {
    onViewChange: (dom) => {
      if (chartMain && chartMain.hasData && chartMain.N === chartClean.N) chartMain.setXDomain(dom, true);
    },
  });
}

// ---- Y-scale controls ------------------------------------------------------
function applyYScale() {
  const auto = $("#yauto").checked;
  $("#ymin").disabled = auto;
  $("#ymax").disabled = auto;
  let override = null;
  if (!auto) {
    const min = parseFloat($("#ymin").value);
    const max = parseFloat($("#ymax").value);
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) override = { min, max };
  }
  chartMain?.setYDomain(override);
  chartClean?.setYDomain(override);
}

// Prefill the manual min/max with the current data range when switching to it.
function prefillScale() {
  if (!state.data) return;
  const vals = state.data.series.map((p) => p.value).filter(Number.isFinite);
  if (!vals.length) return;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pad = (max - min) * 0.05 || 1;
  if ($("#ymin").value === "") $("#ymin").value = Number((min - pad).toFixed(3));
  if ($("#ymax").value === "") $("#ymax").value = Number((max + pad).toFixed(3));
}

// ---- Reset -----------------------------------------------------------------
function resetAll() {
  state.data = null;
  state.result = null;
  $("#file").value = "";
  $("#file-meta").textContent = "";
  $("#file-meta").classList.remove("error");
  $("#run").disabled = true;
  $("#results").hidden = true;
  chartMain?.clear();
  chartClean?.clear();
  $("#yauto").checked = true;
  $("#ymin").value = "";
  $("#ymax").value = "";
  $("#ymin").disabled = true;
  $("#ymax").disabled = true;
}

// ---- Model selector + parameter controls ----------------------------------
function buildModelSelector() {
  const sel = $("#model");
  for (const m of Object.values(MODELS)) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.label;
    sel.appendChild(opt);
  }
  sel.value = state.modelId;
  sel.addEventListener("change", () => {
    state.modelId = sel.value;
    buildParamControls();
  });
}

function buildParamControls() {
  const model = MODELS[state.modelId];
  state.params = defaultParams(state.modelId);
  $("#model-desc").textContent = model.description;
  const wrap = $("#params");
  wrap.innerHTML = "";
  for (const p of model.params) {
    const field = document.createElement("div");
    field.className = "field";

    const label = document.createElement("label");
    label.textContent = p.label;
    label.htmlFor = `p-${p.key}`;

    const row = document.createElement("div");
    row.className = "field-row";
    const range = document.createElement("input");
    range.type = "range";
    range.id = `p-${p.key}`;
    const def = p.default === "auto_day" && state.data ? defaultDayHorizon(state.data.series) : p.default;
    range.min = p.min;
    range.max = p.max;
    range.step = p.step;
    range.value = def;
    const num = document.createElement("input");
    num.type = "number";
    num.className = "num";
    num.min = p.min;
    num.max = p.max;
    num.step = p.step;
    num.value = def;

    const sync = (v) => {
      let val = p.type === "int" ? parseInt(v, 10) : parseFloat(v);
      if (Number.isNaN(val)) return;
      val = Math.min(p.max, Math.max(p.min, val));
      state.params[p.key] = val;
      range.value = val;
      num.value = val;
    };
    state.params[p.key] = def;
    range.addEventListener("input", () => sync(range.value));
    num.addEventListener("input", () => sync(num.value));

    const help = document.createElement("p");
    help.className = "help";
    help.textContent = p.help;

    row.append(range, num);
    field.append(label, row, help);
    wrap.appendChild(field);
  }
}

// ---- CSV loading -----------------------------------------------------------
function handleFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = parseCsv(String(reader.result));
      state.data = parsed;
      state.result = null;
      buildParamControls();
      const meta = [
        `${parsed.series.length} points`,
        `colonne « ${parsed.valueColumn} »`,
        parsed.timeColumn ? `temps « ${parsed.timeColumn} »` : "axe = index",
        parsed.skipped ? `${parsed.skipped} ligne(s) ignorée(s)` : null,
      ].filter(Boolean).join(" · ");
      $("#file-meta").textContent = `${file.name} — ${meta}`;
      $("#file-meta").classList.remove("error");
      $("#run").disabled = false;
      $("#results").hidden = true;
      renderPreview();
    } catch (err) {
      $("#file-meta").textContent = err.message;
      $("#file-meta").classList.add("error");
      $("#run").disabled = true;
      state.data = null;
    }
  };
  reader.readAsText(file);
}

function renderPreview() {
  ensureCharts();
  $("#results").hidden = false;
  $("#stats").innerHTML = "";
  $("#anomaly-table").innerHTML = "";
  const toggles = $("#series-toggles");
  if (toggles) toggles.innerHTML = "";
  const values = state.data.series.map((p) => p.value);
  const labels = state.data.series.map((p) => p.label);
  $("#chart-title").textContent = "Série DFINAL (aperçu — lancez la détection)";
  chartMain.setData({ series: [{ values, name: "DFINAL" }], labels, markers: null });
  applyYScale();
  $("#chart-clean-block").hidden = true;
}

// ---- Detection -------------------------------------------------------------
let worker = null;
function getWorker() {
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  } catch {
    worker = null; // fallback to main thread
  }
  return worker;
}

function runDetection() {
  if (!state.data) return;
  $("#run").disabled = true;
  $("#run").textContent = "Analyse…";
  const series = state.data.series.map((p) => ({ index: p.index, t: p.t, value: p.value, label: p.label }));
  const payload = { modelId: state.modelId, series, params: state.params };

  const done = (msg) => {
    $("#run").disabled = false;
    $("#run").textContent = "Lancer l’analyse";
    if (!msg.ok) {
      $("#file-meta").textContent = `Erreur : ${msg.error}`;
      $("#file-meta").classList.add("error");
      return;
    }
    state.result = msg;
    state.visible = {};
    renderResults(msg);
  };

  const w = getWorker();
  if (w) {
    w.onmessage = (e) => done(e.data);
    w.onerror = () => runMainThread(payload, done);
    w.postMessage(payload);
  } else {
    runMainThread(payload, done);
  }
}

async function runMainThread(payload, done) {
  try {
    const model = MODELS[payload.modelId];
    const out = model.run(payload.series, payload.params);
    if (model.kind === "forecast") {
      done({ ok: true, kind: "forecast", ...out, elapsedMs: 0 });
      return;
    }
    done({
      ok: true,
      kind: "anomaly",
      anomalies: [...out.anomalies].sort((a, b) => a - b),
      trend: out.trend ?? null,
      warning: out.warning ?? null,
      elapsedMs: 0,
    });
  } catch (err) {
    done({ ok: false, error: err.message });
  }
}

// ---- Results rendering -----------------------------------------------------
function renderResults(msg) {
  ensureCharts();
  if ((msg.kind || MODELS[state.modelId].kind) === "forecast") {
    renderForecastResults(msg);
    return;
  }
  const series = state.data.series;
  const values = series.map((p) => p.value);
  const labels = series.map((p) => p.label);
  const markers = new Set(msg.anomalies);
  markers.visible = state.visible.anomalies !== false;
  const model = MODELS[state.modelId];

  $("#results").hidden = false;
  $("#chart-title").textContent = "Série DFINAL + anomalies détectées";
  chartMain.setData({ series: [{ id: "original", values, name: "DFINAL", visible: state.visible.original !== false }], labels, markers });
  renderSeriesToggles([
    { id: "original", label: "DFINAL", kind: "line" },
    { id: "anomalies", label: "Anomalies", kind: "dot" },
    { id: "clean-original", label: "Origine nettoyée", kind: "line" },
    { id: "cleaned", label: "Nettoyée", kind: "line" },
  ]);

  $("#chart-clean-block").hidden = false;
  $("#chart-clean-title").textContent = "Origine vs série nettoyée";
  const cleaned = cleanSeries(values, markers);
  chartClean.setData({
    series: [
      { id: "clean-original", values, name: "Origine", className: "series-line series-ghost", dashed: true, visible: state.visible["clean-original"] !== false },
      { id: "cleaned", values: cleaned, name: "Nettoyée", className: "series-line", visible: state.visible.cleaned !== false },
    ],
    labels,
    markers: null,
  });
  applyYScale();

  // Stats
  const pct = ((markers.size / values.length) * 100).toFixed(1);
  const stats = [
    { label: "Points analysés", value: values.length.toLocaleString("fr-FR") },
    { label: "Anomalies détectées", value: markers.size, accent: true },
    { label: "Taux d'anomalies", value: `${pct} %` },
    { label: "Temps de calcul", value: `${msg.elapsedMs} ms` },
  ];
  const wrap = $("#stats");
  wrap.innerHTML = "";
  for (const s of stats) {
    const tile = document.createElement("div");
    tile.className = "stat" + (s.accent ? " accent" : "");
    const v = document.createElement("div");
    v.className = "stat-val";
    v.textContent = s.value;
    const l = document.createElement("div");
    l.className = "stat-lab";
    l.textContent = s.label;
    tile.append(v, l);
    wrap.appendChild(tile);
  }

  if (msg.warning) {
    const warn = document.createElement("div");
    warn.className = "stat warn-tile";
    warn.textContent = msg.warning;
    wrap.appendChild(warn);
  }

  // Table
  const table = $("#anomaly-table");
  table.innerHTML = "";
  if (markers.size) {
    const caption = document.createElement("summary");
    caption.textContent = `Détail des ${markers.size} anomalie(s) — modèle ${model.label}`;
    const details = document.createElement("details");
    details.appendChild(caption);
    const t = document.createElement("table");
    const head = document.createElement("tr");
    for (const h of ["#", "Repère temporel", "Valeur DFINAL"]) {
      const th = document.createElement("th");
      th.textContent = h;
      head.appendChild(th);
    }
    t.appendChild(head);
    for (const i of msg.anomalies) {
      const tr = document.createElement("tr");
      const cells = [String(i + 1), series[i].label, fmtVal(values[i])];
      for (const c of cells) {
        const td = document.createElement("td");
        td.textContent = c;
        tr.appendChild(td);
      }
      t.appendChild(tr);
    }
    details.appendChild(t);
    table.appendChild(details);
  }
}
function renderSeriesToggles(items, rerender = null) {
  const wrap = document.querySelector("#series-toggles");
  if (!wrap) return;
  wrap.innerHTML = "";
  for (const item of items) {
    if (!(item.id in state.visible)) state.visible[item.id] = true;
    const label = document.createElement("label");
    label.className = "series-toggle";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = state.visible[item.id] !== false;
    input.addEventListener("change", () => {
      state.visible[item.id] = input.checked;
      if (rerender) rerender();
      else if (state.result) renderResults(state.result);
    });
    const swatch = document.createElement("span");
    swatch.className = `swatch ${item.kind || "line"}`;
    if (item.color) swatch.style.setProperty("--swatch", item.color);
    label.append(input, swatch, document.createTextNode(item.label));
    wrap.appendChild(label);
  }
}

function renderForecastResults(msg) {
  const series = state.data.series;
  const values = series.map((p) => p.value);
  const labels = series.map((p) => p.label).concat(msg.forecastLabels || msg.forecast.map((_, i) => `+${i + 1}`));
  const pad = new Array(values.length).fill(null);
  const future = pad.concat(msg.forecast);
  const lower = pad.concat(msg.lower || []);
  const upper = pad.concat(msg.upper || []);
  const hist = values.concat(new Array(msg.forecast.length).fill(null));
  const fitted = (msg.fitted || []).concat(new Array(msg.forecast.length).fill(null));
  const render = (resetView = true) => {
    chartMain.setData({
      series: [
        { id: "original", values: hist, name: "Originale", visible: state.visible.original !== false },
        { id: "fitted", values: fitted, name: "Ajustement", className: "series-line series-ghost", dashed: true, visible: state.visible.fitted !== false },
        { id: "forecast", values: future, name: "Forecast", className: "series-line series-forecast", dashed: true, visible: state.visible.forecast !== false },
        { id: "upper", values: upper, name: "Borne haute", className: "series-line series-band", visible: state.visible.band !== false },
        { id: "lower", values: lower, name: "Borne basse", className: "series-line series-band", visible: state.visible.band !== false },
      ],
      labels,
      markers: null,
      resetView,
    });
  };
  $("#results").hidden = false;
  $("#chart-title").textContent = "Série DFINAL + forecast";
  $("#chart-clean-block").hidden = true;
  renderSeriesToggles([
    { id: "original", label: "Originale", kind: "line" },
    { id: "fitted", label: "Ajustement", kind: "line" },
    { id: "forecast", label: "Forecast", kind: "line" },
    { id: "band", label: "Bande 95 %", kind: "line" },
  ], () => { render(false); applyYScale(); });
  render();
  applyYScale();

  const rmse = msg.metrics?.rmse;
  renderStats([
    { label: "Points historiques", value: values.length.toLocaleString("fr-FR") },
    { label: "Horizon", value: `${msg.forecast.length.toLocaleString("fr-FR")} pts`, accent: true },
    { label: "RMSE ajustement", value: Number.isFinite(rmse) ? fmtVal(rmse) : "—" },
    { label: "Temps de calcul", value: `${msg.elapsedMs} ms` },
  ], msg.warning);
  renderForecastTable(labels, msg);
}

function renderStats(stats, warning = null) {
  const wrap = $("#stats");
  wrap.innerHTML = "";
  for (const s of stats) {
    const tile = document.createElement("div");
    tile.className = "stat" + (s.accent ? " accent" : "");
    const v = document.createElement("div");
    v.className = "stat-val";
    v.textContent = s.value;
    const l = document.createElement("div");
    l.className = "stat-lab";
    l.textContent = s.label;
    tile.append(v, l);
    wrap.appendChild(tile);
  }
  if (warning) {
    const warn = document.createElement("div");
    warn.className = "stat warn-tile";
    warn.textContent = warning;
    wrap.appendChild(warn);
  }
}

function renderForecastTable(labels, msg) {
  const table = $("#anomaly-table");
  table.innerHTML = "";
  const details = document.createElement("details");
  details.open = true;
  const caption = document.createElement("summary");
  caption.textContent = `Détail des ${msg.forecast.length} point(s) prévus`;
  details.appendChild(caption);
  const t = document.createElement("table");
  const head = document.createElement("tr");
  for (const h of ["#", "Repère temporel", "Prévision", "Borne basse", "Borne haute"]) {
    const th = document.createElement("th");
    th.textContent = h;
    head.appendChild(th);
  }
  t.appendChild(head);
  const offset = state.data.series.length;
  msg.forecast.forEach((v, i) => {
    const tr = document.createElement("tr");
    const cells = [String(offset + i + 1), labels[offset + i], fmtVal(v), msg.lower ? fmtVal(msg.lower[i]) : "—", msg.upper ? fmtVal(msg.upper[i]) : "—"];
    for (const c of cells) {
      const td = document.createElement("td");
      td.textContent = c;
      tr.appendChild(td);
    }
    t.appendChild(tr);
  });
  details.appendChild(t);
  table.appendChild(details);
}

const fmtVal = (v) => Number(v.toFixed(3)).toLocaleString("fr-FR");

// ---- Wiring ----------------------------------------------------------------
function initDropzone() {
  const dz = $("#dropzone");
  const input = $("#file");
  dz.addEventListener("click", () => input.click());
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  input.addEventListener("change", () => input.files[0] && handleFile(input.files[0]));
  ["dragover", "dragenter"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); })
  );
  dz.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
}

function initTheme() {
  const btn = $("#theme");
  const apply = (mode) => {
    document.documentElement.dataset.theme = mode;
    btn.textContent = mode === "dark" ? "☀︎" : "☾";
  };
  const stored = localStorage.getItem("predict2-theme");
  const prefers = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  apply(stored || prefers);
  btn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("predict2-theme", next);
    apply(next);
  });
}

function initControls() {
  $("#reset-data").addEventListener("click", resetAll);
  $("#reset-zoom").addEventListener("click", () => {
    chartMain?.resetZoom();
    chartClean?.resetZoom();
  });
  $("#yauto").addEventListener("change", () => {
    if (!$("#yauto").checked) prefillScale();
    applyYScale();
  });
  $("#ymin").addEventListener("input", applyYScale);
  $("#ymax").addEventListener("input", applyYScale);
}

buildModelSelector();
buildParamControls();
initDropzone();
initTheme();
initControls();
$("#run").addEventListener("click", runDetection);
