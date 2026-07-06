// Canari-style Bayesian state-space baseline (local level + trend) via a Kalman
// filter — a lightweight browser port of the SSM core of Bayes-Works/canari
// (the heavy Bayesian-LSTM part is omitted).
//
// Scope here = DRIFT + FORECAST only. Anomaly detection is a separate concern:
// the series is first cleaned with the robust Z-Score model, so Canari sees a
// spike-free signal and never has to flag points itself. It produces:
//   - a smooth baseline level line (the estimated true signal),
//   - drift onsets (where the day-averaged level starts ramping) as markers,
//   - a level+slope forecast, plus a last-day backtest.
import { defaultDayHorizon, futureLabels, cleanWithZScore } from "./forecast.js";

function median(a) {
  const s = a.filter(Number.isFinite).slice().sort((x, y) => x - y);
  const n = s.length;
  if (!n) return NaN;
  const m = n >> 1;
  return n % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// One forward Kalman pass of the local-linear-trend model on a clean signal.
// State [L, T]; L_t = L + T, T_t = T; observation y = L + noise.
function kalman(values, cfg) {
  const { qL, qT, r } = cfg;
  const n = values.length;
  const level = new Array(n);
  let L = values[0];
  let T = 0;
  let P00 = r * 100;
  let P01 = 0;
  let P11 = r;
  for (let t = 0; t < n; t++) {
    const Lp = L + T;
    const a00 = P00 + 2 * P01 + P11 + qL;
    const a01 = P01 + P11;
    const a11 = P11 + qT;
    const S = a00 + r;
    const e = values[t] - Lp;
    const k0 = a00 / S;
    const k1 = a01 / S;
    L = Lp + k0 * e;
    T = T + k1 * e;
    P00 = (1 - k0) * a00;
    P01 = (1 - k0) * a01;
    P11 = a11 - k1 * a01;
    level[t] = L;
  }
  return { level, state: { L, T, P00, P11 } };
}

export function forecastCanari(series, params) {
  const finite = series.filter((p) => Number.isFinite(p.value));
  const horizon = Math.max(1, parseInt(params.horizon ?? defaultDayHorizon(finite), 10));
  const sensitivity = Math.max(0.5, parseFloat(params.drift_sensitivity ?? 2));

  // Canari runs on the Z-Score-cleaned signal: aberrant measurements are removed
  // (interpolated) up front so the level line and drifts are not disturbed.
  const cleaned = cleanWithZScore(finite);
  const values = cleaned.values;
  const n = values.length;

  // Robust observation-noise scale from successive differences of the clean signal.
  const diffs = [];
  for (let i = 1; i < n; i++) diffs.push(values[i] - values[i - 1]);
  const medDiff = median(diffs);
  const sig = (1.4826 * median(diffs.map((d) => Math.abs(d - medDiff)))) / Math.SQRT2 || 1;
  const r = sig * sig || 1;
  const cfg = {
    r,
    qL: Math.max(1e-9, parseFloat(params.level_reactivity ?? 0.1)) * r,
    qT: Math.max(1e-12, parseFloat(params.slope_reactivity ?? 0.005)) * r,
  };

  const run = kalman(values, cfg);

  // Drift onset from the DAY-AVERAGED level: over a full day a periodic swing
  // averages out (the daily mean stays flat) while a genuine drift makes it ramp.
  // We flag the rising edge where the daily mean leaves its reference value.
  const dayH = defaultDayHorizon(finite);
  const w = Math.max(3, Math.min(n, dayH));
  const avg = new Array(n);
  let sum = 0;
  for (let t = 0; t < n; t++) {
    sum += run.level[t];
    if (t >= w) sum -= run.level[t - w];
    avg[t] = sum / Math.min(t + 1, w);
  }
  const a0 = avg[w - 1];
  const driftThresh = sensitivity * sig;
  const driftStarts = [];
  let prevOver = false;
  for (let t = w - 1; t < n; t++) {
    const over = Math.abs(avg[t] - a0) > driftThresh;
    if (over && !prevOver) driftStarts.push(finite[Math.max(0, t - (w >> 1))].index);
    prevOver = over;
  }

  // Forecast with the DRIFT slope (day-averaged, cycle-free) so a cyclic edge
  // swing doesn't send the projection diving.
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

  const btH = Math.min(horizon, Math.max(1, Math.floor(n / 2)));
  let backtest = null;
  if (n > btH + 3) {
    const split = n - btH;
    const head = kalman(values.slice(0, split), cfg);
    const bt = project(head.level, head.state, btH);
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

  const fitErr = values.map((v, t) => v - run.level[t]);
  const rmse = Math.sqrt(fitErr.reduce((a, v) => a + v * v, 0) / n);

  return {
    forecast: fut.forecast,
    lower: fut.lower,
    upper: fut.upper,
    fitted: run.level,
    driftStarts,
    cleanedOutliers: cleaned.indices,
    backtest,
    forecastLabels: futureLabels(finite, horizon),
    metrics: { horizon, rmse, backtestRmse: backtest?.rmse ?? null },
    warning: driftStarts.length
      ? `${driftStarts.length} départ(s) de dérive détecté(s). ${cleaned.indices.length} mesure(s) aberrante(s) retirée(s) (Z-Score) avant analyse.`
      : `Aucune dérive détectée. ${cleaned.indices.length} mesure(s) aberrante(s) retirée(s) (Z-Score) avant analyse.`,
  };
}
