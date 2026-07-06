// Canari-style Bayesian state-space baseline (local level + trend) run with a
// Kalman filter — a lightweight browser port of the SSM core of
// Bayes-Works/canari (the heavy Bayesian-LSTM part is intentionally omitted).
// It produces, in one online pass:
//   - a smooth baseline "drift line" (hidden level), robust to spikes,
//   - anomalies from the standardized 1-step-ahead innovation,
//   - drift-onset points (where the trend/slope becomes significant),
//   - a level+slope forecast, plus a last-day backtest.
import { defaultDayHorizon, futureLabels } from "./forecast.js";

function median(a) {
  const s = a.filter(Number.isFinite).slice().sort((x, y) => x - y);
  const n = s.length;
  if (!n) return NaN;
  const m = n >> 1;
  return n % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// One forward Kalman pass of the local-linear-trend model.
// State [L, T]; L_t = L + T, T_t = T; observation y = L + noise.
function kalman(values, cfg) {
  const { qL, qT, r, thr } = cfg;
  const n = values.length;
  const level = new Array(n);
  const slope = new Array(n);
  const anomalies = [];
  let L = values[0];
  let T = 0;
  let P00 = r * 100;
  let P01 = 0;
  let P11 = r; // slope prior
  for (let t = 0; t < n; t++) {
    // predict: x = F x, P = F P F^T + Q
    const Lp = L + T;
    const a00 = P00 + 2 * P01 + P11 + qL;
    const a01 = P01 + P11;
    const a11 = P11 + qT;
    // 1-step innovation
    const S = a00 + r;
    const e = values[t] - Lp;
    const z = e / Math.sqrt(S);
    if (Math.abs(z) > thr) {
      // treat as missing: keep the prediction, don't let a spike bend the level
      L = Lp; P00 = a00; P01 = a01; P11 = a11;
      anomalies.push(t);
    } else {
      const k0 = a00 / S;
      const k1 = a01 / S;
      L = Lp + k0 * e;
      T = T + k1 * e;
      P00 = (1 - k0) * a00;
      P01 = (1 - k0) * a01;
      P11 = a11 - k1 * a01;
    }
    level[t] = L;
    slope[t] = T;
  }
  return { level, slope, anomalies, state: { L, T, P00, P11 } };
}

export function forecastCanari(series, params) {
  const finite = series.filter((p) => Number.isFinite(p.value));
  const values = finite.map((p) => p.value);
  const n = values.length;
  const horizon = Math.max(1, parseInt(params.horizon ?? defaultDayHorizon(finite), 10));
  const thr = Math.max(1, parseFloat(params.anomaly_threshold ?? 3.5));

  // Robust observation-noise scale from successive differences.
  const diffs = [];
  for (let i = 1; i < n; i++) diffs.push(values[i] - values[i - 1]);
  const sig = (1.4826 * median(diffs.map((d) => Math.abs(d - median(diffs))))) / Math.SQRT2 || 1;
  const r = sig * sig || 1;
  const cfg = {
    r,
    qL: Math.max(1e-9, parseFloat(params.level_reactivity ?? 0.1)) * r,
    qT: Math.max(1e-12, parseFloat(params.slope_reactivity ?? 0.005)) * r,
    thr,
  };

  const run = kalman(values, cfg);

  // Drift onset from the DAY-AVERAGED level: over a full day a periodic swing
  // averages out (the daily mean stays flat) while a genuine drift makes it
  // ramp. We flag the rising edge where the daily mean leaves its initial value.
  const dayH = defaultDayHorizon(finite);
  const w = Math.max(3, Math.min(n, dayH));
  const avg = new Array(n);
  let sum = 0;
  for (let t = 0; t < n; t++) {
    sum += run.level[t];
    if (t >= w) sum -= run.level[t - w];
    avg[t] = sum / Math.min(t + 1, w);
  }
  const a0 = avg[w - 1]; // reference daily mean, once the first window is full
  const driftThresh = 2 * sig;
  const driftStarts = [];
  let prevOver = false;
  for (let t = w - 1; t < n; t++) {
    const over = Math.abs(avg[t] - a0) > driftThresh;
    if (over && !prevOver) driftStarts.push(finite[Math.max(0, t - (w >> 1))].index);
    prevOver = over;
  }

  // Forecast with the DRIFT slope (day-averaged, cycle-free) rather than the
  // instantaneous slope, so a cyclic down-swing at the edge doesn't send the
  // projection diving. Falls back to the Kalman slope on short series.
  const driftSlope = (levels, span) =>
    levels.length > span ? (levels[levels.length - 1] - levels[levels.length - 1 - span]) / span : null;

  const project = (levels, state, h) => {
    const { L, T, P00, P11 } = state;
    const slope = driftSlope(levels, w) ?? T;
    const forecast = [], lower = [], upper = [];
    for (let k = 1; k <= h; k++) {
      const f = L + k * slope;
      const band = 1.96 * Math.sqrt(r + P00 + k * cfg.qL + k * k * P11);
      forecast.push(f); lower.push(f - band); upper.push(f + band);
    }
    return { forecast, lower, upper };
  };

  const fut = project(run.level, run.state, horizon);

  // Last-day backtest: fit on the head, project the held-out tail, compare.
  const btH = Math.min(horizon, Math.max(1, Math.floor(n / 2)));
  let backtest = null;
  if (n > btH + 3) {
    const split = n - btH;
    const headRun = kalman(values.slice(0, split), cfg);
    const bt = project(headRun.level, headRun.state, btH);
    const actual = values.slice(split);
    const errs = actual.map((v, i) => v - bt.forecast[i]).filter(Number.isFinite);
    backtest = {
      startIndex: split,
      forecast: bt.forecast,
      actual,
      labels: finite.slice(split).map((p) => p.label),
      lower: bt.lower,
      upper: bt.upper,
      rmse: errs.length ? Math.sqrt(errs.reduce((a, v) => a + v * v, 0) / errs.length) : null,
    };
  }

  const fitErr = [];
  const anomSet = new Set(run.anomalies);
  for (let t = 0; t < n; t++) if (!anomSet.has(t)) fitErr.push(values[t] - run.level[t]);
  const rmse = fitErr.length ? Math.sqrt(fitErr.reduce((a, v) => a + v * v, 0) / fitErr.length) : null;

  return {
    forecast: fut.forecast,
    lower: fut.lower,
    upper: fut.upper,
    fitted: run.level,
    anomalies: run.anomalies.map((t) => finite[t].index),
    driftStarts,
    backtest,
    forecastLabels: futureLabels(finite, horizon),
    metrics: { horizon, rmse, backtestRmse: backtest?.rmse ?? null },
    warning: `${run.anomalies.length} anomalie(s) et ${driftStarts.length} départ(s) de dérive détecté(s).`,
  };
}
