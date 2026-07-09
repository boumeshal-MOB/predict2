// Gradient-boosted regression trees ("LightGBM-style"), dependency-free.
// Histogram-based splits (32 bins), squared loss, shallow trees. Features are
// calendar (hour sin/cos, day-of-week) + lags + a 1-h rolling mean, so the
// trees learn the diurnal/weekly pattern AND the local dynamics directly from
// the cleaned signal. Forecast is recursive (future lags = own predictions).
import { cleanWithZScore, futureLabels, defaultDayHorizon, medianStep } from "./forecast.js";
import { am } from "../i18n.js";

const num = (v, d) => {
  const x = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(x) ? x : d;
};

const LAGS = [1, 2, 3, 10, 30];
const N_BINS = 32;
const MIN_LEAF = 20;

// Build per-feature bin edges from quantiles of the training matrix.
function buildBins(X, nFeat) {
  const edges = [];
  for (let f = 0; f < nFeat; f++) {
    const col = X.map((r) => r[f]).sort((a, b) => a - b);
    const e = [];
    for (let b = 1; b < N_BINS; b++) e.push(col[Math.floor((b / N_BINS) * (col.length - 1))]);
    edges.push(e);
  }
  return edges;
}
const binOf = (v, e) => {
  let lo = 0, hi = e.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (v <= e[m]) hi = m; else lo = m + 1; }
  return lo; // 0..N_BINS-1
};

// One regression tree on residuals, histogram splits, recursive by node lists.
function buildTree(Xb, grad, idx, depth, nFeat) {
  const sum = idx.reduce((a, i) => a + grad[i], 0);
  const node = { value: sum / (idx.length || 1) };
  if (depth <= 0 || idx.length < 2 * MIN_LEAF) return node;

  let best = null;
  for (let f = 0; f < nFeat; f++) {
    const cnt = new Array(N_BINS).fill(0);
    const s = new Array(N_BINS).fill(0);
    for (const i of idx) { const b = Xb[i][f]; cnt[b]++; s[b] += grad[i]; }
    let cl = 0, sl = 0;
    for (let b = 0; b < N_BINS - 1; b++) {
      cl += cnt[b]; sl += s[b];
      const cr = idx.length - cl, sr = sum - sl;
      if (cl < MIN_LEAF || cr < MIN_LEAF) continue;
      const gain = (sl * sl) / cl + (sr * sr) / cr - (sum * sum) / idx.length;
      if (!best || gain > best.gain) best = { gain, f, b };
    }
  }
  if (!best || best.gain <= 1e-12) return node;

  const li = [], ri = [];
  for (const i of idx) (Xb[i][best.f] <= best.b ? li : ri).push(i);
  node.f = best.f;
  node.b = best.b;
  node.left = buildTree(Xb, grad, li, depth - 1, nFeat);
  node.right = buildTree(Xb, grad, ri, depth - 1, nFeat);
  return node;
}
function predictTree(node, xb) {
  while (node.left) node = xb[node.f] <= node.b ? node.left : node.right;
  return node.value;
}

export function forecastGbdt(series, params) {
  const M = am(params.lang);
  const finite = series.filter((p) => Number.isFinite(p.value));
  const n = finite.length;
  const horizon = Math.max(1, parseInt(params.horizon ?? defaultDayHorizon(finite), 10));
  const nTrees = Math.max(5, num(params.n_trees, 60));
  const depth = Math.max(2, num(params.depth, 5));
  const trainCap = Math.max(1000, num(params.train_cap, 20000));
  const lr = 0.1;

  const maxLag = LAGS[LAGS.length - 1];
  if (n < maxLag + 50) {
    const last = finite[n - 1]?.value ?? 0;
    return {
      forecast: new Array(horizon).fill(last), lower: [], upper: [], fitted: [],
      cleaned: finite.map((p) => p.value), cleanedOutliers: [], backtest: null,
      forecastLabels: futureLabels(finite, horizon),
      metrics: { horizon, rmse: null, backtestRmse: null },
      warning: M.tooShortGbdt(),
    };
  }

  const cleaned = cleanWithZScore(finite);
  const y = cleaned.values;
  const step = medianStep(finite);
  const secPerPt = step > 1 ? step : 120;
  const winH = Math.max(1, Math.round(3600 / secPerPt));

  // Calendar per index (from t seconds; day-of-week from label date when valid).
  const hourOf = (i) => ((finite[i].t % 86400) / 3600);
  const dowOf = (i) => {
    const d = new Date(String(finite[i].label).replace(" ", "T") + "Z");
    return Number.isNaN(d.getTime()) ? 0 : d.getUTCDay();
  };
  const featOf = (i, hist) => {
    const h = hourOf(i);
    let ma = 0;
    for (let k = 1; k <= winH; k++) ma += hist[i - k] ?? hist[hist.length - 1];
    return [
      Math.sin((2 * Math.PI * h) / 24), Math.cos((2 * Math.PI * h) / 24), dowOf(i),
      ...LAGS.map((L) => hist[i - L]),
      ma / winH,
    ];
  };
  const nFeat = 3 + LAGS.length + 1;

  // Training matrix (strided to cap size on long records).
  const stride = Math.max(1, Math.ceil((n - maxLag) / trainCap));
  const rows = [];
  for (let i = maxLag; i < n; i += stride) rows.push(i);
  const X = rows.map((i) => featOf(i, y));
  const target = rows.map((i) => y[i]);
  const edges = buildBins(X, nFeat);
  const Xb = X.map((r) => r.map((v, f) => binOf(v, edges[f])));

  // Boosting.
  const base = target.reduce((a, v) => a + v, 0) / target.length;
  const pred = new Array(rows.length).fill(base);
  const trees = [];
  const allIdx = rows.map((_, k) => k);
  for (let m = 0; m < nTrees; m++) {
    const grad = target.map((v, k) => v - pred[k]);
    const tree = buildTree(Xb, grad, allIdx, depth, nFeat);
    trees.push(tree);
    for (let k = 0; k < rows.length; k++) pred[k] += lr * predictTree(tree, Xb[k]);
  }
  const predictOne = (feat) => {
    const xb = feat.map((v, f) => binOf(v, edges[f]));
    let out = base;
    for (const tr of trees) out += lr * predictTree(tr, xb);
    return out;
  };

  // In-sample fitted (on the strided rows; others null).
  const fitted = new Array(n).fill(null);
  for (let k = 0; k < rows.length; k++) fitted[rows[k]] = pred[k];
  const fitErr = rows.map((i, k) => y[i] - pred[k]);
  const rmseFit = Math.sqrt(fitErr.reduce((a, v) => a + v * v, 0) / fitErr.length);

  // Recursive forecast helper from an extended history (clock keeps running).
  const runForecast = (hist, startIdx, h) => {
    const ext = hist.slice();
    const out = [];
    for (let k = 0; k < h; k++) {
      const i = startIdx + k;
      const hh = ((finite[Math.min(i, n - 1)].t + (i >= n ? (i - n + 1) * secPerPt : 0)) % 86400) / 3600;
      const dref = new Date(String(finite[Math.min(i, n - 1)].label).replace(" ", "T") + "Z");
      const dow = Number.isNaN(dref.getTime()) ? 0 : new Date(dref.getTime() + (i >= n ? (i - n + 1) * secPerPt * 1000 : 0)).getUTCDay();
      let ma = 0;
      for (let j = 1; j <= winH; j++) ma += ext[ext.length - j];
      const feat = [
        Math.sin((2 * Math.PI * hh) / 24), Math.cos((2 * Math.PI * hh) / 24), dow,
        ...LAGS.map((L) => ext[ext.length - L]),
        ma / winH,
      ];
      const v = predictOne(feat);
      out.push(v);
      ext.push(v);
    }
    return out;
  };

  const forecast = runForecast(y, n, horizon);
  const sigma = rmseFit || 1;
  const lower = forecast.map((v) => v - 1.96 * sigma);
  const upper = forecast.map((v) => v + 1.96 * sigma);

  // Last-day backtest: same trees, recursive from the head only (honest lags).
  const btH = Math.min(horizon, Math.max(1, Math.floor(n / 2)));
  let backtest = null;
  if (n > btH + maxLag + 10) {
    const split = n - btH;
    const btForecast = runForecast(y.slice(0, split), split, btH);
    const actual = finite.slice(split).map((p) => p.value);
    const errs = actual.map((v, i) => v - btForecast[i]).filter(Number.isFinite);
    backtest = {
      startIndex: split,
      forecast: btForecast,
      actual,
      labels: finite.slice(split).map((p) => p.label),
      lower: btForecast.map((v) => v - 1.96 * sigma),
      upper: btForecast.map((v) => v + 1.96 * sigma),
      rmse: errs.length ? Math.sqrt(errs.reduce((a, v) => a + v * v, 0) / errs.length) : null,
    };
  }

  return {
    forecast, lower, upper, fitted,
    cleaned: y, cleanedOutliers: cleaned.indices, backtest,
    forecastLabels: futureLabels(finite, horizon),
    metrics: { horizon, rmse: rmseFit, backtestRmse: backtest?.rmse ?? null },
    warning: cleaned.indices.length ? M.cleanedTrain(cleaned.indices.length) : null,
  };
}
