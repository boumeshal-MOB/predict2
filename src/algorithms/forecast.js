// Dependency-free forecasting models that run fully in the browser.
// Forecasting is trained on an automatically cleaned series so short spikes /
// aberrant measurements do not dominate the prediction.
import { detectZScore } from "./zscore.js";

function finiteSeries(series) {
  return series.map((p, i) => ({ ...p, i })).filter((p) => Number.isFinite(p.value));
}

export function medianStep(series) {
  const steps = [];
  for (let i = 1; i < series.length; i++) {
    const d = series[i].t - series[i - 1].t;
    if (Number.isFinite(d) && d > 0) steps.push(d);
  }
  if (!steps.length) return 1;
  steps.sort((a, b) => a - b);
  const mid = Math.floor(steps.length / 2);
  return steps.length % 2 ? steps[mid] : (steps[mid - 1] + steps[mid]) / 2;
}

export function defaultDayHorizon(series) {
  const step = medianStep(series);
  if (step > 1 && step <= 86400) return Math.max(1, Math.min(2880, Math.round(86400 / step)));
  return Math.max(1, Math.min(96, Math.round(series.length * 0.2) || 24));
}

function mean(values) {
  return values.reduce((a, v) => a + v, 0) / Math.max(1, values.length);
}

function median(values) {
  if (!values.length) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function std(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) * (v - m), 0) / (values.length - 1));
}

function rmse(errors) {
  if (!errors.length) return null;
  return Math.sqrt(errors.reduce((a, v) => a + v * v, 0) / errors.length);
}

function normalise(values) {
  const mu = mean(values);
  const sigma = std(values) || 1;
  return {
    mu,
    sigma,
    encode: (v) => (v - mu) / sigma,
    decode: (v) => v * sigma + mu,
  };
}

function interpolateRemoved(values, removed) {
  const out = values.slice();
  for (let i = 0; i < out.length; i++) {
    if (!removed.has(i)) continue;
    let a = i - 1;
    while (a >= 0 && removed.has(a)) a--;
    let b = i + 1;
    while (b < out.length && removed.has(b)) b++;
    const va = a >= 0 ? values[a] : null;
    const vb = b < out.length ? values[b] : null;
    if (va != null && vb != null) out[i] = va + ((vb - va) * (i - a)) / (b - a);
    else if (va != null) out[i] = va;
    else if (vb != null) out[i] = vb;
  }
  return out;
}

// Clean the series with the robust Z-Score model (polynomial trend + MAD) then
// interpolate the flagged points. MAD is not inflated by the very spikes we want
// to remove, so this neutralises aberrant peaks that a std-based rule misses —
// giving the forecast a faithful baseline to learn from.
function cleanWithZScore(points) {
  const values = points.map((p) => p.value);
  const local = points.map((p, i) => ({ index: i, t: Number.isFinite(p.t) ? p.t : i, value: p.value }));
  const removed = detectZScore(local, { degree: 2, threshold: 3 }).anomalies;
  return { values: interpolateRemoved(values, removed), indices: [...removed].sort((a, b) => a - b) };
}

function fitBand(values, fitted) {
  const residuals = [];
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(fitted[i])) residuals.push(values[i] - fitted[i]);
  }
  return std(residuals) || std(values) || 0;
}

function futureLabels(series, horizon) {
  const step = medianStep(series);
  const last = series[series.length - 1];
  const lastDate = last.label ? new Date(String(last.label).replace(" ", "T") + "Z") : null;
  const isTimed = step > 1 && lastDate && !Number.isNaN(lastDate.getTime());
  const labels = [];
  for (let h = 1; h <= horizon; h++) {
    if (isTimed) {
      const d = new Date(lastDate.getTime() + step * h * 1000);
      labels.push(d.toISOString().replace("T", " ").replace(".000Z", ""));
    } else labels.push(`#${last.index + h + 1}`);
  }
  return labels;
}

function windowDistance(a, b) {
  let acc = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    acc += d * d;
  }
  return Math.sqrt(acc / a.length);
}

function knnValues(values, { horizon, windowSize, k }) {
  if (values.length < windowSize + 2) {
    return { forecast: new Array(horizon).fill(values[values.length - 1]), fitted: [], warning: "Série trop courte : prévision naïve avec la dernière valeur." };
  }
  const norm = normalise(values);
  const y = values.map(norm.encode);
  const fitted = new Array(values.length).fill(null);
  for (let i = windowSize; i < values.length; i++) {
    const target = y.slice(i - windowSize, i);
    const candidates = [];
    for (let j = windowSize; j < i; j++) candidates.push({ d: windowDistance(target, y.slice(j - windowSize, j)), next: y[j] });
    candidates.sort((a, b) => a.d - b.d);
    const pick = candidates.slice(0, Math.min(k, candidates.length));
    if (pick.length) fitted[i] = norm.decode(mean(pick.map((c) => c.next)));
  }

  const history = y.slice();
  const forecastNorm = [];
  for (let h = 0; h < horizon; h++) {
    const target = history.slice(-windowSize);
    const candidates = [];
    for (let j = windowSize; j < y.length; j++) {
      candidates.push({ d: windowDistance(target, y.slice(j - windowSize, j)), next: y[j] });
    }
    candidates.sort((a, b) => a.d - b.d);
    const pick = candidates.slice(0, Math.min(k, candidates.length));
    const pred = pick.length ? mean(pick.map((c) => c.next)) : history[history.length - 1];
    forecastNorm.push(pred);
    history.push(pred);
  }
  return { forecast: forecastNorm.map(norm.decode), fitted };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mlpValues(values, { horizon, windowSize, hidden, epochs, lr }) {
  if (values.length < windowSize + 2) {
    return { forecast: new Array(horizon).fill(values[values.length - 1]), fitted: [], warning: "Série trop courte : prévision naïve avec la dernière valeur." };
  }
  const norm = normalise(values);
  const y = values.map(norm.encode);
  const rand = mulberry32(123456);
  const w1 = Array.from({ length: hidden }, () => Array.from({ length: windowSize }, () => (rand() - 0.5) * 0.2));
  const b1 = new Array(hidden).fill(0);
  const w2 = Array.from({ length: hidden }, () => (rand() - 0.5) * 0.2);
  let b2 = 0;
  const samples = [];
  for (let i = windowSize; i < y.length; i++) samples.push({ x: y.slice(i - windowSize, i), target: y[i], i });
  const predictNorm = (x) => {
    const h = new Array(hidden);
    for (let j = 0; j < hidden; j++) {
      let z = b1[j];
      for (let i = 0; i < windowSize; i++) z += w1[j][i] * x[i];
      h[j] = Math.tanh(z);
    }
    let out = b2;
    for (let j = 0; j < hidden; j++) out += w2[j] * h[j];
    return { out, h };
  };
  for (let epoch = 0; epoch < epochs; epoch++) {
    for (const s of samples) {
      const { out, h } = predictNorm(s.x);
      const err = out - s.target;
      for (let j = 0; j < hidden; j++) {
        const oldW2 = w2[j];
        w2[j] -= lr * err * h[j];
        const dz = err * oldW2 * (1 - h[j] * h[j]);
        b1[j] -= lr * dz;
        for (let i = 0; i < windowSize; i++) w1[j][i] -= lr * dz * s.x[i];
      }
      b2 -= lr * err;
    }
  }
  const fitted = new Array(values.length).fill(null);
  for (const s of samples) fitted[s.i] = norm.decode(predictNorm(s.x).out);
  const history = y.slice();
  const forecast = [];
  for (let h = 0; h < horizon; h++) {
    const pred = predictNorm(history.slice(-windowSize)).out;
    history.push(pred);
    forecast.push(norm.decode(pred));
  }
  return { forecast, fitted };
}

function buildResult(series, cleaned, modelRun, horizon) {
  const future = modelRun(cleaned.values, horizon);
  const sigma = fitBand(cleaned.values, future.fitted);
  const lower = future.forecast.map((v) => v - 1.96 * sigma);
  const upper = future.forecast.map((v) => v + 1.96 * sigma);
  const backtestHorizon = Math.min(horizon, Math.max(1, Math.floor(series.length / 2)));
  let backtest = null;
  if (cleaned.values.length > backtestHorizon + 2) {
    const split = cleaned.values.length - backtestHorizon;
    const trainCleaned = cleanWithZScore(series.slice(0, split));
    const bt = modelRun(trainCleaned.values, backtestHorizon);
    const actual = series.slice(split).map((p) => p.value);
    const errors = actual.map((v, i) => v - bt.forecast[i]).filter(Number.isFinite);
    backtest = {
      startIndex: split,
      forecast: bt.forecast,
      actual,
      labels: series.slice(split).map((p) => p.label),
      rmse: rmse(errors),
      lower: bt.forecast.map((v) => v - 1.96 * sigma),
      upper: bt.forecast.map((v) => v + 1.96 * sigma),
    };
  }
  const fitErrors = [];
  for (let i = 0; i < cleaned.values.length; i++) if (Number.isFinite(future.fitted[i])) fitErrors.push(cleaned.values[i] - future.fitted[i]);
  return {
    forecast: future.forecast,
    lower,
    upper,
    fitted: future.fitted,
    cleaned: cleaned.values,
    cleanedOutliers: cleaned.indices,
    backtest,
    forecastLabels: futureLabels(series, future.forecast.length),
    metrics: { horizon: future.forecast.length, rmse: rmse(fitErrors), backtestRmse: backtest?.rmse ?? null },
    warning: future.warning ?? (cleaned.indices.length ? `${cleaned.indices.length} mesure(s) aberrante(s) nettoyée(s) avant forecast.` : null),
  };
}

export function forecastKnn(series, params) {
  const cleanSeries = finiteSeries(series);
  const horizon = Math.max(1, parseInt(params.horizon ?? defaultDayHorizon(cleanSeries), 10));
  const windowSize = Math.max(2, parseInt(params.window_size ?? 24, 10));
  const k = Math.max(1, parseInt(params.neighbors ?? 5, 10));
  const cleaned = cleanWithZScore(cleanSeries);
  return buildResult(cleanSeries, cleaned, (values, h) => knnValues(values, { horizon: h, windowSize, k }), horizon);
}

export function forecastMlp(series, params) {
  const cleanSeries = finiteSeries(series);
  const horizon = Math.max(1, parseInt(params.horizon ?? defaultDayHorizon(cleanSeries), 10));
  const windowSize = Math.max(2, parseInt(params.window_size ?? 24, 10));
  const hidden = Math.max(2, parseInt(params.hidden_units ?? 12, 10));
  const epochs = Math.max(1, parseInt(params.epochs ?? 200, 10));
  const lr = Math.max(0.0001, parseFloat(params.learning_rate ?? 0.01));
  const cleaned = cleanWithZScore(cleanSeries);
  return buildResult(cleanSeries, cleaned, (values, h) => mlpValues(values, { horizon: h, windowSize, hidden, epochs, lr }), horizon);
}
