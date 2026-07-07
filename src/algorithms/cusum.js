// CUSUM drift detector.
// A cumulative-sum control chart on the deviation from a robust baseline level.
// Unlike point-wise rules (Z-Score, Isolation Forest), CUSUM ACCUMULATES small
// deviations, so it surfaces slow, persistent DRIFTS that never produce a single
// obviously-anomalous point. Each alarm marks the onset of a drift; the running
// sums reset after an alarm so a long drift is flagged as it progresses.
// The daily cycle is removed first (diurnal baseline) so the accumulation tracks
// the true drift rather than the periodic swing; the reference level is then the
// median of the DESEASONALISED residuals over the reference window.
import { diurnalBaseline } from "./baseline.js";

function median(values) {
  const s = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  const n = s.length;
  if (!n) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// series: [{ index, value }]. params: { baseline_window, slack_k, threshold_h }
export function detectCusum(series, params) {
  const kSlack = Math.max(0, parseFloat(params.slack_k ?? 0.5));
  const hThresh = Math.max(0.5, parseFloat(params.threshold_h ?? 5));

  const valid = series.filter((p) => Number.isFinite(p.value));
  const result = { anomalies: new Set(), trend: new Array(series.length).fill(null) };

  const auto = Math.min(200, Math.max(20, Math.round(valid.length * 0.15)));
  const requested = parseInt(params.baseline_window, 10);
  const baselineWin = Math.max(5, Math.min(valid.length - 1, Number.isFinite(requested) ? requested : auto));
  if (valid.length < baselineWin + 2) {
    return { ...result, warning: "Série trop courte pour la détection de dérive." };
  }

  // Remove the diurnal cycle first; the CUSUM then works on the residual.
  const base = diurnalBaseline(valid, (p) => p.value);
  const des = valid.map((p, i) => (base.available ? p.value - base.baseline[i] : p.value));

  // Robust reference level (median + MAD) taken from the DESEASONALISED
  // residuals of the baseline window.
  const ref = des.slice(0, baselineWin);
  const mu0 = median(ref);
  let sigma = 1.4826 * median(ref.map((v) => Math.abs(v - mu0)));
  if (!(sigma > 0)) {
    const m = ref.reduce((a, v) => a + v, 0) / ref.length;
    sigma = Math.sqrt(ref.reduce((a, v) => a + (v - m) * (v - m), 0) / ref.length) || 1;
  }

  const k = kSlack * sigma; // allowance: ignore deviations smaller than k
  const h = hThresh * sigma; // decision interval: alarm when the sum exceeds h
  // Report only the ONSET of each excursion: after an alarm, stay silent until
  // the signal returns near the reference level, then re-arm. Without this a
  // persistent shift re-alarms every h/dev points and floods the chart.
  let sPlus = 0;
  let sMinus = 0;
  let armed = true;
  for (let i = 0; i < valid.length; i++) {
    const p = valid[i];
    const dev = des[i] - mu0;
    sPlus = Math.max(0, sPlus + dev - k);
    sMinus = Math.max(0, sMinus - dev - k);
    result.trend[p.index] = base.available ? mu0 + base.baseline[i] : mu0;
    if (sPlus > h || sMinus > h) {
      if (armed) {
        result.anomalies.add(p.index);
        armed = false;
      }
      sPlus = 0;
      sMinus = 0;
    }
    if (!armed && Math.abs(dev) <= k) armed = true;
  }

  // Display reference level = residual reference + mean diurnal profile so the
  // reported figure stays on the original scale.
  const refLevel = base.available ? mu0 + median(base.baseline.slice(0, baselineWin)) : mu0;
  const warning = result.anomalies.size
    ? `${result.anomalies.size} départ(s) de dérive détecté(s) par rapport au niveau de référence (${refLevel.toFixed(2)}).`
    : "Aucune dérive significative détectée par rapport au niveau de référence.";
  return { ...result, warning };
}
