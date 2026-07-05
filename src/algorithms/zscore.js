// Polynomial trend + robust Z-Score (MAD).
// JS port of python_functions/algorithms/zscore.py — same workflow:
//   1. Fit a polynomial trend.
//   2. Compute residuals.
//   3. Compute robust z-score using the Median Absolute Deviation.
//   4. Flag points whose |z| exceeds the threshold.
import { polyfitEvaluator } from "./linalg.js";

function median(sorted) {
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function medianOf(arr) {
  const s = arr.filter(Number.isFinite).slice().sort((a, b) => a - b);
  return median(s);
}

// series: [{ index, t (seconds), value }] already time-ordered.
// params: { degree, threshold }
// Returns Set of anomalous indices plus the fitted trend for display.
export function detectZScore(series, params) {
  const degree = Math.max(0, parseInt(params.degree ?? 5, 10));
  const threshold = parseFloat(params.threshold ?? 2);

  const valid = series.filter((p) => Number.isFinite(p.value) && Number.isFinite(p.t));
  const result = { anomalies: new Set(), trend: new Array(series.length).fill(null) };

  if (valid.length <= degree) {
    return { ...result, warning: `Not enough points (${valid.length}) for degree ${degree}.` };
  }

  const xs = valid.map((p) => p.t);
  const ys = valid.map((p) => p.value);
  const evaluator = polyfitEvaluator(xs, ys, degree);
  if (!evaluator) return { ...result, warning: "Polynomial fit failed." };

  const residuals = valid.map((p) => p.value - evaluator(p.t));

  const med = medianOf(residuals);
  let mad = medianOf(residuals.map((r) => Math.abs(r - med)));
  if (!Number.isFinite(mad) || mad <= 0) {
    // Fall back to standard deviation, then to 1, exactly like the Python.
    const m = residuals.reduce((a, v) => a + v, 0) / residuals.length;
    mad = Math.sqrt(residuals.reduce((a, v) => a + (v - m) * (v - m), 0) / residuals.length);
    if (mad === 0) mad = 1;
  }

  valid.forEach((p, i) => {
    const z = (0.6745 * (residuals[i] - med)) / mad;
    result.trend[p.index] = evaluator(p.t);
    if (Math.abs(z) > threshold) result.anomalies.add(p.index);
  });

  return result;
}
