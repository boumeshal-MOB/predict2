// SKF Canari — Switching Kalman Filter anomaly / drift probability.
//
// Browser port of the canari example `anomaly_detection.py`: two competing
// linear-Gaussian regimes (NORMAL vs ABNORMAL) run in parallel and an IMM
// (Interacting Multiple Model) filter blends them each step, returning the
// posterior probability of the ABNORMAL regime — Pr(anormal) ∈ [0,1].
//
// The original couples the SKF with an LSTM; here the diurnal cycle is removed
// with the shared baseline (baseline.js) instead, so the SKF works on the
// residual of a signal that is first cleaned (quality tags + robust Z-Score),
// deseasonalised and standardised (robust z on the first-half fingerprint).
//
// State (shared by both regimes) is 3-D: [level L, trend T, acceleration A].
//   NORMAL  : F_N forces A→0, trend noise ~0 (a stable, non-accelerating signal).
//   ABNORMAL: F_A lets acceleration drive trend and level (a local acceleration,
//             i.e. an emerging drift), with process noise on A.
// Scope = DRIFT (probability of anomaly). Point anomaly detection stays with the
// Z-Score / Isolation-Forest models.
import { defaultDayHorizon, medianStep, cleanWithZScore } from "./forecast.js";
import { diurnalBaseline } from "./baseline.js";
import { qualityMask } from "./quality.js";

const num = (v, d) => {
  const x = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(x) ? x : d;
};

function median(a) {
  const s = a.filter(Number.isFinite).slice().sort((x, y) => x - y);
  const n = s.length;
  if (!n) return NaN;
  const m = n >> 1;
  return n % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---- 3×3 linear-algebra helpers (small fixed size, kept flat & fast) --------
function mul(A, B) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let s = 0;
    for (let k = 0; k < 3; k++) s += A[i][k] * B[k][j];
    C[i][j] = s;
  }
  return C;
}
function transpose(A) {
  return [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]];
}
function matvec(A, x) {
  return [
    A[0][0] * x[0] + A[0][1] * x[1] + A[0][2] * x[2],
    A[1][0] * x[0] + A[1][1] * x[1] + A[1][2] * x[2],
    A[2][0] * x[0] + A[2][1] * x[1] + A[2][2] * x[2],
  ];
}
function addDiag(P, q) {
  return [
    [P[0][0] + q[0], P[0][1], P[0][2]],
    [P[1][0], P[1][1] + q[1], P[1][2]],
    [P[2][0], P[2][1], P[2][2] + q[2]],
  ];
}

// One IMM step. prior = { x:[x_N,x_A], P:[P_N,P_A], mu:[muN,muA] }. F/Q are the
// two regimes' transition matrices / process-noise diagonals; Z is the 2×2
// regime-transition matrix; y the scalar observation; R the observation noise.
function immStep(prior, F, Q, Z, y, R) {
  const { x, P, mu } = prior;
  // 1. Predicted regime weights + mixing weights ω_{i|j}.
  const c = [0, 0];
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) c[j] += Z[i][j] * mu[i];
  const x0 = [null, null];
  const P0 = [null, null];
  for (let j = 0; j < 2; j++) {
    const cj = c[j] || 1e-300;
    const w = [Z[0][j] * mu[0] / cj, Z[1][j] * mu[1] / cj];
    const xm = [0, 0, 0];
    for (let i = 0; i < 2; i++) for (let k = 0; k < 3; k++) xm[k] += w[i] * x[i][k];
    const Pm = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 2; i++) {
      const d = [x[i][0] - xm[0], x[i][1] - xm[1], x[i][2] - xm[2]];
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) Pm[a][b] += w[i] * (P[i][a][b] + d[a] * d[b]);
    }
    x0[j] = xm;
    P0[j] = Pm;
  }
  // 2. Kalman predict + update per regime; collect Gaussian likelihoods.
  const xn = [null, null];
  const Pn = [null, null];
  const lk = [0, 0];
  for (let j = 0; j < 2; j++) {
    const xp = matvec(F[j], x0[j]);
    const Pp = addDiag(mul(mul(F[j], P0[j]), transpose(F[j])), Q[j]);
    const e = y - xp[0];
    const S = Pp[0][0] + R;
    const K = [Pp[0][0] / S, Pp[1][0] / S, Pp[2][0] / S];
    xn[j] = [xp[0] + K[0] * e, xp[1] + K[1] * e, xp[2] + K[2] * e];
    const Pu = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) Pu[a][b] = Pp[a][b] - K[a] * Pp[0][b];
    Pn[j] = Pu;
    lk[j] = Math.exp(-0.5 * e * e / S) / Math.sqrt(2 * Math.PI * S) + 1e-300;
  }
  // 3. Posterior regime probabilities + collapsed state for display.
  const wnum = [c[0] * lk[0], c[1] * lk[1]];
  const tot = wnum[0] + wnum[1] || 1;
  const muNew = [wnum[0] / tot, wnum[1] / tot];
  const combined = [0, 0, 0];
  for (let j = 0; j < 2; j++) for (let k = 0; k < 3; k++) combined[k] += muNew[j] * xn[j][k];
  return { x: xn, P: Pn, mu: muNew, combined, prA: muNew[1] };
}

// Centered rolling mean (window ~1 h in points) via a sliding sum — O(n).
function rollingMean(arr, win) {
  const n = arr.length;
  const out = new Array(n).fill(0);
  const half = Math.floor(win / 2);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let cnt = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      if (Number.isFinite(arr[j])) { s += arr[j]; cnt++; }
    }
    out[i] = cnt ? s / cnt : 0;
  }
  return out;
}

const fmtPct = (p) => `${Math.round(p * 100)} %`;
const fmtDur = (h) => (h >= 48 ? `${Math.round(h / 24)} j` : h >= 10 ? `${Math.round(h)} h` : `${h.toFixed(1).replace(".", ",")} h`);
const fmtTrend = (v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1).replace(".", ",");

export function detectSkfCanari(series, params) {
  const finite = series.filter((p) => Number.isFinite(p.value));
  const n = finite.length;
  const p = Math.max(1e-9, num(params.norm_to_abnorm_prob, 1e-5)); // NORMAL→ABNORMAL per step
  const q = Math.max(1e-6, num(params.abnorm_to_norm_prob, 0.002)); // ABNORMAL→NORMAL per step
  const ste = Math.max(1e-9, num(params.std_transition_error, 1.6e-3)); // accel process noise (z)
  const prThresh = Math.min(0.99, Math.max(0.05, num(params.pr_threshold, 0.5)));
  const minDurH = Math.max(0.5, num(params.min_duration_hours, 1));

  if (n < 10) {
    return { fitted: finite.map((pt) => pt.value), prAbnormal: new Array(n).fill(0), trend: new Array(n).fill(0), episodes: [], driftStarts: [], velocityNorm: null, metrics: { drifts: 0, prMaxPct: 0, tagged: 0 }, warning: "Série trop courte pour le SKF." };
  }

  // 1. Clean (quality tags + robust Z-Score) then deseasonalise.
  const cleaned = cleanWithZScore(finite);
  const values = cleaned.values;
  const cleanedPoints = finite.map((pt, i) => ({ t: pt.t, label: pt.label, value: values[i] }));
  const base = diurnalBaseline(cleanedPoints, (pt) => pt.value);
  const deseason = base.available ? values.map((v, i) => v - base.baseline[i]) : values.slice();

  // 2. Standardise on the FIRST-HALF fingerprint (robust median / MAD), so a long
  // late drift cannot dilute its own scale.
  const refEnd = Math.max(10, Math.min(n, n >> 1));
  const refSeg = deseason.slice(0, refEnd);
  const med = median(refSeg);
  const mad = median(refSeg.map((v) => Math.abs(v - med)));
  const sc = (mad > 0 ? mad / 0.6745 : (Math.sqrt(refSeg.reduce((a, v) => a + (v - med) * (v - med), 0) / refSeg.length) || 1)) || 1;
  const zRaw = deseason.map((v) => (v - med) / sc);
  // Smooth to the hourly component first: the SKF must judge slow transitions,
  // not the 2-minute noise. Re-standardise the smoothed signal on the fingerprint.
  const stepSec0 = medianStep(finite);
  const winSm = Math.max(1, Math.round(3600 / (stepSec0 > 1 ? stepSec0 : 120)));
  const zSm = rollingMean(zRaw, winSm);
  const refSm = zSm.slice(0, refEnd);
  const medSm = median(refSm);
  const madSm = median(refSm.map((v) => Math.abs(v - medSm))) || 0.1;
  const z = zSm.map((v) => (v - medSm) / (madSm / 0.6745));

  // Observation noise σ_v from successive differences of the standardised
  // residual (high-frequency component), robust (MAD).
  const diffs = [];
  for (let i = 1; i < n; i++) diffs.push(z[i] - z[i - 1]);
  const mdiff = median(diffs);
  const sigV = (1.4826 * median(diffs.map((d) => Math.abs(d - mdiff)))) / Math.SQRT2 || 0.5;
  const rFloor = Math.max(0.01, num(params.r_floor, 4));
  const R = Math.max(rFloor, sigV * sigV);

  // 3. Regime models.
  // NORMAL = pure level (no trend): ANY sustained slope is abnormal evidence.
  // ABNORMAL = local trend + acceleration (an evolving signal).
  const F = [
    [[1, 0, 0], [0, 0, 0], [0, 0, 0]],        // NORMAL: static level only
    [[1, 1, 0.5], [0, 1, 1], [0, 0, 1]],      // ABNORMAL: local acceleration
  ];
  const qlN = Math.max(1e-9, num(params.level_noise, 1e-7)) * R; // normal level wander (quasi nul : R absorbe)
  const Q = [
    [qlN, 1e-8, 0],                           // NORMAL: level wanders, no acceleration
    [qlN, 1e-6, ste * ste],                   // ABNORMAL: + acceleration process noise
  ];
  const Z = [[1 - p, p], [q, 1 - q]];

  // 4. IMM forward pass.
  const P0 = () => [[1, 0, 0], [0, 0.25, 0], [0, 0, 1e-4]];
  const P0N = () => [[1, 0, 0], [0, 1e-6, 0], [0, 0, 1e-8]];
  let prior = { x: [[z[0], 0, 0], [z[0], 0, 0]], P: [P0N(), P0()], mu: [0.98, 0.02] };
  const prAbnormal = new Array(n).fill(0);
  const levelZ = new Array(n).fill(0);
  const trendZ = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const out = immStep(prior, F, Q, Z, z[i], R);
    prAbnormal[i] = out.prA;
    levelZ[i] = out.combined[0];
    trendZ[i] = out.combined[1];
    prior = { x: out.x, P: out.P, mu: out.mu };
  }

  // 5. Re-scale to the original series (superimposable, like canari.js).
  const fitted = levelZ.map((L, i) => L * sc + med + (base.available ? base.baseline[i] : 0));
  const step = base.step > 1 ? base.step : medianStep(finite);
  const perDay = step > 1 ? 86400 / step : 1;
  // Trend in ORIGINAL depth units per day (level slope, cycle-free).
  const trend = trendZ.map((T) => T * sc * perDay);

  // 6. Episodes: 1 h rolling mean of Pr above threshold for >= min duration.
  const winPts = Math.max(1, Math.round(3600 / (step > 1 ? step : 120)));
  const prRoll = rollingMean(prAbnormal, winPts);
  const t = finite.map((pt, i) => (Number.isFinite(pt.t) ? pt.t : i));
  const minDurSec = minDurH * 3600;
  const episodes = [];
  const driftStarts = [];
  let s = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && prRoll[i] > prThresh;
    if (on && s === -1) s = i;
    else if (!on && s !== -1) {
      const e = i - 1;
      if (t[e] - t[s] >= minDurSec) {
        let prMax = 0;
        let tsum = 0;
        for (let k = s; k <= e; k++) { if (prAbnormal[k] > prMax) prMax = prAbnormal[k]; tsum += trend[k]; }
        const trAvg = tsum / (e - s + 1);
        const durH = (t[e] - t[s]) / 3600;
        episodes.push({
          startIndex: finite[s].index,
          endIndex: finite[e].index,
          type: "transition",
          reason: `Pr(anormal) max ${fmtPct(prMax)} pendant ${fmtDur(durH)}, tendance ${fmtTrend(trAvg)}/j.`,
        });
        driftStarts.push(finite[s].index);
      }
      s = -1;
    }
  }

  const prMax = prAbnormal.reduce((a, v) => Math.max(a, v), 0);
  const tagged = qualityMask(finite).filter(Boolean).length;
  const warns = [];
  if (!base.available) warns.push("Pas d'horodatage régulier : le cycle diurne n'a pas pu être retiré.");
  if (tagged) warns.push(`${tagged} point(s) tagué(s) qualité interpolé(s) avant analyse.`);

  return {
    fitted,
    prAbnormal,
    trend,
    episodes,
    driftStarts: [...new Set(driftStarts)].sort((a, b) => a - b),
    velocityNorm: null,
    cleanedOutliers: cleaned.indices,
    metrics: { transitions: episodes.length, prMaxPct: Math.round(prMax * 100), tagged },
    warning: warns.length ? warns.join(" ") : null,
  };
}
