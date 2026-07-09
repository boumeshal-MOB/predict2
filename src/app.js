import { parseCsv, unitLabelFr } from "./csv.js";
import { MODELS, defaultParams } from "./algorithms/registry.js";
import { createChart, cleanSeries } from "./charts.js";
import { defaultDayHorizon } from "./algorithms/forecast.js";

const $ = (sel) => document.querySelector(sel);
const state = { data: null, modelId: "zscore", params: {}, result: null, visible: {}, rawCsv: null, fileName: null };

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
  state.rawCsv = null;
  state.fileName = null;
  $("#file").value = "";
  $("#file-meta").textContent = "";
  $("#file-meta").classList.remove("error");
  $("#units-row").hidden = true;
  $("#units").value = "auto";
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
  renderModelTips(model.tips);
  const wrap = $("#params");
  wrap.innerHTML = "";

  const advInputs = {}; // key -> { range, num } (to sync when a preset is picked)
  const choiceSelects = []; // [{ p, select }] (to flip to « Personnalisé »)
  let advDetails = null;
  let advGrid = null;
  const ensureAdvanced = () => {
    if (advGrid) return advGrid;
    advDetails = document.createElement("details");
    advDetails.className = "advanced";
    const sum = document.createElement("summary");
    sum.textContent = "Réglages avancés";
    advGrid = document.createElement("div");
    advGrid.className = "params-grid adv-grid";
    advDetails.append(sum, advGrid);
    return advGrid;
  };

  // Editing an advanced value detaches the preset: the matching select shows
  // « Personnalisé » so the UI never lies about which values are active.
  const markCustom = (key) => {
    for (const { p, select } of choiceSelects) {
      if (!(p.options || []).some((o) => o.map && key in o.map)) continue;
      if (![...select.options].some((o) => o.value === "personnalise")) {
        const opt = document.createElement("option");
        opt.value = "personnalise";
        opt.textContent = "Personnalisé";
        select.appendChild(opt);
      }
      select.value = "personnalise";
      state.params[p.key] = "personnalise";
    }
  };

  for (const p of model.params) {
    const field = document.createElement("div");
    field.className = "field";

    const label = document.createElement("label");
    label.textContent = p.label;
    label.htmlFor = `p-${p.key}`;

    const help = document.createElement("p");
    help.className = "help";
    help.textContent = p.help;

    if (p.type === "choice") {
      const select = document.createElement("select");
      select.id = `p-${p.key}`;
      for (const o of p.options || []) {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        select.appendChild(opt);
      }
      select.value = p.default;
      select.addEventListener("change", () => {
        const o = (p.options || []).find((x) => x.value === select.value);
        if (!o) return;
        state.params[p.key] = o.value;
        if (o.map) {
          Object.assign(state.params, o.map);
          for (const [k, v] of Object.entries(o.map)) {
            const inp = advInputs[k];
            if (inp) { inp.range.value = v; inp.num.value = v; }
          }
        }
        const custom = [...select.options].find((x) => x.value === "personnalise");
        if (custom) custom.remove();
      });
      field.append(label, select, help);
      wrap.appendChild(field);
      choiceSelects.push({ p, select });
      continue;
    }

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
      if (p.advanced) markCustom(p.key);
    };
    state.params[p.key] = def;
    range.addEventListener("input", () => sync(range.value));
    num.addEventListener("input", () => sync(num.value));
    advInputs[p.key] = { range, num };

    row.append(range, num);
    field.append(label, row, help);
    (p.advanced ? ensureAdvanced() : wrap).appendChild(field);
  }
  if (advDetails) wrap.appendChild(advDetails);
}

function renderModelTips(tips) {
  const box = $("#model-tips");
  if (!tips || !tips.length) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.innerHTML = "";
  const title = document.createElement("span");
  title.className = "tips-title";
  title.textContent = "💡 Conseils";
  const ul = document.createElement("ul");
  for (const tip of tips) {
    const li = document.createElement("li");
    li.textContent = tip;
    ul.appendChild(li);
  }
  box.append(title, ul);
  box.hidden = false;
}

// ---- CSV loading -----------------------------------------------------------
// The raw text is kept so the units selector can re-parse without re-uploading.
function loadCsv(text, name, force = "auto") {
  try {
    const parsed = parseCsv(text, { forceUnits: force });
    state.rawCsv = text;
    state.fileName = name;
    state.data = parsed;
    state.result = null;
    buildParamControls();
    const meta = [
      `${parsed.series.length} points`,
      `colonne « ${parsed.valueColumn} »`,
      `unités : ${unitLabelFr(parsed.units)}`,
      parsed.timeColumn ? `temps « ${parsed.timeColumn} »` : "axe = index",
      parsed.velocityColumn ? `vélocité « ${parsed.velocityColumn} »` : null,
      parsed.rainColumn ? `pluie « ${parsed.rainColumn} »` : null,
      parsed.tagged ? `${parsed.tagged} point(s) tagué(s) qualité` : null,
      parsed.skipped ? `${parsed.skipped} ligne(s) ignorée(s)` : null,
    ].filter(Boolean).join(" · ");
    $("#file-meta").textContent = `${name} — ${meta}`;
    $("#file-meta").classList.remove("error");
    $("#units-row").hidden = false;
    $("#run").disabled = false;
    $("#results").hidden = true;
    renderPreview();
  } catch (err) {
    $("#file-meta").textContent = err.message;
    $("#file-meta").classList.add("error");
    $("#run").disabled = true;
    state.data = null;
  }
}

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    $("#units").value = "auto";
    loadCsv(String(reader.result), file.name);
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
  const series = state.data.series.map((p) => ({ index: p.index, t: p.t, value: p.value, label: p.label, velocity: p.velocity ?? null, rain: p.rain ?? null }));
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
    if (model.kind === "drift") {
      done({ ok: true, kind: "drift", ...out, elapsedMs: 0 });
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
  const kind = msg.kind || MODELS[state.modelId].kind;
  if (kind === "forecast") {
    renderForecastResults(msg);
    return;
  }
  if (kind === "drift") {
    renderDriftResults(msg);
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
  $("#chart-clean-legend").hidden = false;
  $("#chart-clean-legend").innerHTML =
    '<span class="lg"><span class="lg-line ghost"></span>Origine (avec anomalies)</span>' +
    '<span class="lg"><span class="lg-line"></span>Nettoyée</span>';
  $("#chart-clean-help").textContent =
    "Les points signalés sont remplacés par interpolation linéaire entre leurs voisins sains.";
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
  const futureLabels = msg.forecastLabels || msg.forecast.map((_, i) => `+${i + 1}`);
  const labels = series.map((p) => p.label).concat(futureLabels);
  const n = values.length;
  const h = msg.forecast.length;
  const padHist = new Array(n).fill(null);
  const padFuture = new Array(h).fill(null);
  const hist = values.concat(padFuture);
  const fitted = (msg.fitted || []).concat(padFuture);
  const future = padHist.concat(msg.forecast);
  const backtestForecast = new Array(n + h).fill(null);
  if (msg.backtest) {
    for (let i = 0; i < msg.backtest.forecast.length; i++) {
      backtestForecast[msg.backtest.startIndex + i] = msg.backtest.forecast[i];
    }
  }

  // Canari runs on the Z-Score-cleaned signal: no red anomaly dots (that's a
  // separate concern), just the level line + drift onsets as vertical lines.
  const isCanari = Array.isArray(msg.driftStarts);
  const markers = !isCanari && Array.isArray(msg.anomalies) ? new Set(msg.anomalies) : null;
  const driftMarkers = isCanari ? new Set(msg.driftStarts) : null;
  const fittedName = isCanari ? "Niveau estimé" : "Ajustée";

  const render = (resetView = true) => {
    chartClean.setData({
      series: [
        { id: "original", values: hist, name: "Origine", visible: state.visible.original !== false },
        { id: "fitted", values: fitted, name: fittedName, color: isCanari ? "#16a34a" : "var(--muted)", width: isCanari ? 2.2 : undefined, visible: state.visible.fitted !== false },
        { id: "forecast", values: future, name: "Prévision J+1", color: "#eab308", dashed: true, width: 2.4, visible: state.visible.forecast !== false },
        { id: "backtestForecast", values: backtestForecast, name: "Prévision jour J", color: "#c026d3", dashed: true, width: 2.4, visible: state.visible.backtestForecast !== false },
      ],
      labels,
      markers,
      driftMarkers,
      resetView,
    });
  };

  $("#results").hidden = false;
  $("#chart-title").textContent = "Série DFINAL (historique)";
  chartMain.setData({ series: [{ id: "original-top", values, name: "Origine" }], labels: series.map((p) => p.label), markers });

  $("#chart-clean-block").hidden = false;
  $("#chart-clean-title").textContent = isCanari
    ? "Niveau estimé, départs de dérive (lignes violettes) et prévision"
    : "Ajustement, prévision J+1 et prévision du jour J (backtest)";
  $("#chart-clean-legend").hidden = true;
  $("#chart-clean-help").textContent = isCanari
    ? "Analyse faite sur la série nettoyée des anomalies (Z-Score). Ligne verte = niveau de fond estimé. Ligne verticale violette = début d'une dérive confirmée. Jaune = prévision J+1, magenta = prévision du jour J (backtest sur données réelles)."
    : "Comparez la « Prévision jour J » (magenta) aux vraies valeurs (« Origine », bleu) pour juger de la fiabilité du modèle avant de vous fier à la « Prévision J+1 » (jaune).";
  renderSeriesToggles([
    { id: "original", label: "Origine", kind: "line" },
    { id: "fitted", label: fittedName, kind: "line", color: isCanari ? "#16a34a" : "var(--muted)" },
    { id: "forecast", label: "Prévision J+1", kind: "line", color: "#eab308" },
    { id: "backtestForecast", label: "Prévision jour J", kind: "line", color: "#c026d3" },
  ], () => { render(false); applyYScale(); });
  render();
  applyYScale();

  const rmse = msg.metrics?.rmse;
  const backtestRmse = msg.metrics?.backtestRmse;
  const stats = [
    { label: "Points historiques", value: values.length.toLocaleString("fr-FR") },
    { label: "Horizon", value: `${h.toLocaleString("fr-FR")} pts`, accent: true },
    { label: "RMSE jour J", value: Number.isFinite(backtestRmse) ? fmtVal(backtestRmse) : "—" },
    { label: "RMSE ajustement", value: Number.isFinite(rmse) ? fmtVal(rmse) : "—" },
  ];
  if (isCanari) {
    stats.push({ label: "Départs de dérive", value: msg.driftStarts.length.toLocaleString("fr-FR"), accent: msg.driftStarts.length > 0 });
  }
  stats.push({ label: "Mesures nettoyées", value: (msg.cleanedOutliers?.length || 0).toLocaleString("fr-FR") });
  stats.push({ label: "Temps de calcul", value: `${msg.elapsedMs} ms` });
  renderStats(stats, msg.warning);
  $("#anomaly-table").innerHTML = "";
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

const DRIFT_TYPE_LABELS = {
  drift: "Dérive",
  restriction: "Restriction suspectée",
  rain: "Événement pluvieux",
  hydraulic: "Événement hydraulique",
  excursion: "Excursion de niveau",
  transition: "Transition détectée",
  fault: "Panne (flat-line)",
};

function fmtDurationFr(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const h = sec / 3600;
  if (h >= 48) return `${Math.round(h / 24)} j`;
  if (h >= 1) return `${(Math.round(h * 10) / 10).toLocaleString("fr-FR")} h`;
  return `${Math.round(sec / 60)} min`;
}

// Multi-channel drift: raw depth on top, then depth + diurnal profile + rescaled
// velocity with shaded confound/drift windows and violet drift-onset lines.
function renderDriftResults(msg) {
  const series = state.data.series;
  const depth = series.map((p) => p.value);
  const labels = series.map((p) => p.label);
  const hasVel = Array.isArray(msg.velocityNorm) && msg.velocityNorm.some((v) => v != null);
  const hasPr = Array.isArray(msg.prAbnormal) && msg.prAbnormal.length > 0;
  const windows = (msg.episodes || []).map((e) => ({ start: e.startIndex, end: e.endIndex, type: e.type }));
  const driftMarkers = new Set(msg.driftStarts || []);

  // Pr(anormal) ∈ [0,1] rescaled onto the depth axis (bottom = 0 %, top = 100 %).
  let prScaled = null;
  if (hasPr) {
    let dmin = Infinity, dmax = -Infinity;
    for (const v of depth) if (Number.isFinite(v)) { if (v < dmin) dmin = v; if (v > dmax) dmax = v; }
    const span = dmax - dmin || 1;
    prScaled = msg.prAbnormal.map((p) => dmin + p * span);
  }

  $("#results").hidden = false;
  $("#chart-title").textContent = "Série DFINAL (profondeur brute)";
  chartMain.setData({ series: [{ id: "depth-top", values: depth, name: "Profondeur" }], labels });

  $("#chart-clean-block").hidden = false;
  $("#chart-clean-title").textContent = hasPr
    ? "Niveau estimé, Pr(anormal) et transitions détectées"
    : "Profondeur désaisonnalisée, profil diurne et épisodes détectés";
  $("#chart-clean-legend").hidden = true;
  $("#chart-clean-help").textContent = hasPr
    ? "Analyse faite sur la série nettoyée (tags qualité + Z-Score). Ligne verte = niveau de fond estimé par le filtre. Ligne rouge pointillée = probabilité d'anomalie Pr(anormal), remise à l'échelle du graphique (bas = 0 %, haut = 100 %). Zone jaune = transition détectée, ligne verticale violette = son début. Pour attribuer une cause (dérive capteur, restriction, pluie), lancez ensuite « Dérive multi-canaux »."
    : "Zones colorées : rouge = dérive capteur, orange = restriction aval suspectée, bleu = événement pluvieux ou hydraulique, violet clair = excursion de niveau revenue à la normale, gris = panne (flat-line). Ligne verticale violette = début d'une dérive. Ligne verte = profil diurne (cycle journalier), ligne orange = vélocité remise à l'échelle de la profondeur.";

  const baselineName = hasPr ? "Niveau estimé" : "Profil diurne";
  const render = (resetView = true) => {
    const s = [
      { id: "depth", values: depth, name: "Profondeur", visible: state.visible.depth !== false },
      { id: "baseline", values: msg.fitted, name: baselineName, color: "#16a34a", width: 2, visible: state.visible.baseline !== false },
    ];
    if (hasVel) s.push({ id: "velocity", values: msg.velocityNorm, name: "Vélocité (normalisée)", color: "#f97316", width: 1.8, visible: state.visible.velocity !== false });
    if (prScaled) s.push({ id: "prob", values: prScaled, name: "Pr(anormal)", color: "#dc2626", dashed: true, width: 1.6, visible: state.visible.prob !== false });
    chartClean.setData({ series: s, labels, windows, driftMarkers, resetView });
  };

  const toggles = [
    { id: "depth", label: "Profondeur", kind: "line" },
    { id: "baseline", label: baselineName, kind: "line", color: "#16a34a" },
  ];
  if (hasVel) toggles.push({ id: "velocity", label: "Vélocité (normalisée)", kind: "line", color: "#f97316" });
  if (prScaled) toggles.push({ id: "prob", label: "Pr(anormal)", kind: "line", color: "#dc2626" });
  renderSeriesToggles(toggles, () => { render(false); applyYScale(); });
  render();
  applyYScale();

  const m = msg.metrics || {};
  const stats = m.transitions != null
    ? [
        { label: "Transitions détectées", value: (m.transitions ?? 0).toLocaleString("fr-FR"), accent: (m.transitions ?? 0) > 0 },
        { label: "Pr(anormal) max", value: `${m.prMaxPct ?? 0} %` },
        { label: "Points tagués interpolés", value: (m.tagged ?? 0).toLocaleString("fr-FR") },
        { label: "Temps de calcul", value: `${msg.elapsedMs} ms` },
      ]
    : [
        { label: "Dérives détectées", value: (m.drifts ?? 0).toLocaleString("fr-FR"), accent: (m.drifts ?? 0) > 0 },
        { label: "Confounds filtrés", value: (m.confoundsFiltres ?? 0).toLocaleString("fr-FR") },
        { label: "Points BMR", value: (m.pointsBmr ?? 0).toLocaleString("fr-FR") },
        { label: "Temps de calcul", value: `${msg.elapsedMs} ms` },
      ];
  renderStats(stats, msg.warning);

  const table = $("#anomaly-table");
  table.innerHTML = "";
  const episodes = msg.episodes || [];
  if (episodes.length) {
    const details = document.createElement("details");
    details.open = true;
    const cap = document.createElement("summary");
    cap.textContent = `Détail des ${episodes.length} épisode(s) détecté(s)`;
    details.appendChild(cap);
    const t = document.createElement("table");
    const head = document.createElement("tr");
    for (const h of ["Type", "Début", "Fin", "Durée", "Explication"]) {
      const th = document.createElement("th");
      th.textContent = h;
      head.appendChild(th);
    }
    t.appendChild(head);
    for (const e of episodes) {
      const tr = document.createElement("tr");
      const badge = document.createElement("span");
      badge.className = `badge badge-${e.type}`;
      badge.textContent = DRIFT_TYPE_LABELS[e.type] || e.type;
      const tdType = document.createElement("td");
      tdType.appendChild(badge);
      const tdStart = document.createElement("td");
      tdStart.textContent = labels[e.startIndex] ?? `#${e.startIndex + 1}`;
      const tdEnd = document.createElement("td");
      tdEnd.textContent = e.ongoing ? "en cours" : (labels[e.endIndex] ?? `#${e.endIndex + 1}`);
      const tdDur = document.createElement("td");
      tdDur.textContent = fmtDurationFr(series[e.endIndex].t - series[e.startIndex].t);
      const tdReason = document.createElement("td");
      tdReason.textContent = e.reason || "";
      tr.append(tdType, tdStart, tdEnd, tdDur, tdReason);
      t.appendChild(tr);
    }
    details.appendChild(t);
    table.appendChild(details);
  }
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
  $("#units").addEventListener("change", () => {
    if (state.rawCsv) loadCsv(state.rawCsv, state.fileName, $("#units").value);
  });
}

buildModelSelector();
buildParamControls();
initDropzone();
initTheme();
initControls();
$("#run").addEventListener("click", runDetection);
