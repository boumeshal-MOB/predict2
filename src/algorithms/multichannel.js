// Multi-channel drift detector (depth + velocity + rain).
//
// Business goal: catch a slow PRESSURE-SENSOR drift — depth rising while the
// flow VELOCITY stays flat and it isn't raining — without firing on the
// physical confounds that also raise depth:
//   - downstream restriction : depth up, velocity DOWN,
//   - rain / hydraulic event : depth AND velocity up together, rain present,
//   - BMR noise              : tiny depth (< bmr_depth) or velocity (< bmr_velocity),
//   - flat-lined sensor      : constant values (fault).
// The daily cycle is removed first (baseline.js); a two-sided CUSUM then
// accumulates the depth residual, but only on points that no confound mask
// suppresses. Genuine drift episodes get vertical onset markers; the confounds
// are surfaced as their own diagnostic episodes.
import { diurnalBaseline } from "./baseline.js";
import { medianStep } from "./forecast.js";
import { am } from "../i18n.js";

const num = (v, d) => {
  const x = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(x) ? x : d;
};

function median(values) {
  const s = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  const n = s.length;
  if (!n) return NaN;
  const m = n >> 1;
  return n % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function meanOf(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

// Robust z-score (median + MAD-derived scale) with std fallback. Null entries
// stay null in the output.
// The centre/scale come from `refSample` (the site's healthy fingerprint, per
// the client guide) — standardising over the whole record would let a long
// drift inflate the median/MAD and dilute itself.
function robustZ(residuals, refSample) {
  const ref = (refSample || residuals).filter((v) => Number.isFinite(v));
  const finite = ref.length ? ref : residuals.filter((v) => Number.isFinite(v));
  const med = median(finite);
  const mad = median(finite.map((v) => Math.abs(v - med)));
  let scale = mad > 0 ? mad / 0.6745 : 0;
  if (!(scale > 0)) {
    const m = finite.reduce((a, v) => a + v, 0) / Math.max(1, finite.length);
    scale = Math.sqrt(finite.reduce((a, v) => a + (v - m) * (v - m), 0) / Math.max(1, finite.length)) || 1;
  }
  return residuals.map((v) => (Number.isFinite(v) ? (v - med) / scale : null));
}

// Centered rolling mean ignoring nulls; window is small (~1 h in points).
function rollingMean(arr, win) {
  const n = arr.length;
  const out = new Array(n).fill(null);
  const half = Math.floor(win / 2);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let cnt = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      if (Number.isFinite(arr[j])) { sum += arr[j]; cnt++; }
    }
    out[i] = cnt ? sum / cnt : null;
  }
  return out;
}

// Maximal contiguous runs [start, end] where mask[i] is truthy.
function contiguousRuns(mask) {
  const out = [];
  let s = -1;
  const n = mask.length;
  for (let i = 0; i <= n; i++) {
    const on = i < n && mask[i];
    if (on && s === -1) s = i;
    else if (!on && s !== -1) { out.push([s, i - 1]); s = -1; }
  }
  return out;
}


// series: [{ index, t, value (depth), velocity|null, rain|null, label }]
export function detectMultiChannelDrift(series, params) {
  const M = am(params.lang);
  const driftK = num(params.drift_k, 0.75);
  const driftH = num(params.drift_h, 120);
  const minDurH = num(params.min_duration_hours, 6);
  const rainLagMin = num(params.rain_lag_min, 120);
  const bmrDepth = num(params.bmr_depth, 50);
  const bmrVel = num(params.bmr_velocity, 0.2);
  const velNeutralPct = num(params.vel_neutral_pct, 15) / 100;
  const eventVelPct = num(params.event_vel_pct, 35) / 100;
  const driftMinDays = num(params.drift_min_days, 5);

  const n = series.length;
  const depth = series.map((p) => p.value);
  const vel = series.map((p) => (Number.isFinite(p.velocity) ? p.velocity : null));
  const rain = series.map((p) => (Number.isFinite(p.rain) ? p.rain : null));
  const t = series.map((p, i) => (Number.isFinite(p.t) ? p.t : i));

  const hasVelocity = vel.some((v) => v != null);
  const hasRain = rain.some((v) => v != null);
  const step = medianStep(series);
  const secPerPt = step > 1 ? step : 1;

  // 2. Remove the diurnal baseline from depth and velocity, then robust z-scores.
  const baseDepth = diurnalBaseline(series, (p) => p.value);
  const baseVel = hasVelocity ? diurnalBaseline(series, (p) => (Number.isFinite(p.velocity) ? p.velocity : null)) : null;
  const resD = depth.map((v, i) => v - baseDepth.baseline[i]);
  // Velocity is judged in PHYSICAL relative units — % departure from its own
  // diurnal norm ("velocity FALLS / FLAT / RISES" in the client guide) — because
  // a statistical σ on velocity is inflated by legitimate hydraulic bursts.
  const velRel = vel.map((v, i) => {
    if (v == null || !baseVel) return null;
    const b = baseVel.baseline[i];
    return b > Math.max(bmrVel, 0.05) ? v / b - 1 : null;
  });
  // 3a. Flat-line = >= 30 consecutive strictly identical depth values (fault).
  const flat = new Array(n).fill(false);
  let runStart = 0;
  for (let i = 1; i <= n; i++) {
    const brk = i === n || depth[i] !== depth[i - 1];
    if (!brk) continue;
    if (i - runStart >= 30) for (let j = runStart; j < i; j++) flat[j] = true;
    runStart = i;
  }

  // 3b. Rain within the last `rain_lag_min` minutes (if the channel exists).
  const rainMask = new Array(n).fill(false);
  if (hasRain) {
    const lagSec = rainLagMin * 60;
    let lastRain = null;
    for (let i = 0; i < n; i++) {
      if (rain[i] != null && rain[i] > 0) lastRain = t[i];
      rainMask[i] = lastRain != null && t[i] - lastRain <= lagSec;
    }
  }

  // Healthy-fingerprint reference = first half of the record (min 1 day):
  // standardising on the full record would let a long drift dilute itself.
  // TWO passes: confound points (rain, flat, BMR, abnormal velocity — all
  // independent of the depth centre) are excluded from the reference stats,
  // otherwise an anomaly inside the reference window corrupts the fingerprint
  // and makes the healthy remainder of the record look drifted.
  const refEnd = Math.min(n, Math.max(Math.round(86400 / secPerPt), n >> 1));
  const winPts = Math.max(1, Math.round(3600 / secPerPt));
  const velRoll = rollingMean(velRel, winPts);

  const sigOf = (arr) => {
    const m = median(arr);
    return 1.4826 * median(arr.map((v) => Math.abs(v - m))) || 0;
  };
  // Pass 1: provisional velocity bound from the raw reference.
  const refRel1 = velRoll.slice(0, refEnd).filter((v) => v != null);
  const nb1 = Math.max(velNeutralPct, 1.5 * sigOf(refRel1));
  // Exclusion mask for reference stats.
  const refExcl = (i) =>
    flat[i] || rainMask[i] || depth[i] < bmrDepth ||
    (vel[i] != null && vel[i] < bmrVel) ||
    (velRoll[i] != null && Math.abs(velRoll[i]) >= nb1);
  // Pass 2: clean fingerprint.
  const refIdx = [];
  for (let i = 0; i < refEnd; i++) if (!refExcl(i)) refIdx.push(i);
  const refRel2 = refIdx.map((i) => velRoll[i]).filter((v) => v != null);
  const sigmaRel = sigOf(refRel2.length ? refRel2 : refRel1);
  const neutralBound = Math.max(velNeutralPct, 1.5 * sigmaRel);
  const eventBound = Math.max(eventVelPct, 2.5 * sigmaRel);
  // Restriction is a JOINT test (doc feature: signed depth–velocity co-movement):
  // with depth already clearly elevated, a weaker velocity deficit suffices.
  const restrVelBound = Math.max(velNeutralPct, 0.75 * sigmaRel);
  const refResD = refIdx.map((i) => resD[i]).filter(Number.isFinite);
  const zD = robustZ(resD, refResD.length >= 30 ? refResD : null);
  const zDroll = rollingMean(zD, winPts);

  // 3c..5. Per-point confound masks + drift score.
  const bmrMask = new Array(n).fill(false);
  const hydraulicMask = new Array(n).fill(false);
  const restrictionMask = new Array(n).fill(false);
  const sT = new Array(n).fill(0);
  let pointsBmr = 0;
  let confounds = 0;
  for (let i = 0; i < n; i++) {
    if (flat[i]) { confounds++; continue; } // fault episodes are excluded from everything else
    const bmr = depth[i] < bmrDepth || (vel[i] != null && vel[i] < bmrVel);
    const hyd = velRoll[i] != null && velRoll[i] > eventBound;
    // Restriction: depth clearly elevated while velocity clearly BELOW its norm.
    const restr = zDroll[i] != null && velRoll[i] != null && zDroll[i] > 1.5 && velRoll[i] < -restrVelBound;
    bmrMask[i] = bmr;
    hydraulicMask[i] = hyd;
    restrictionMask[i] = restr;
    if (bmr) pointsBmr++;
    // The doc's discriminator verbatim: drift = depth moving while velocity FLAT.
    // Any significant velocity excursion (up OR down) exonerates the point.
    const velNotNeutral = velRoll[i] != null && Math.abs(velRoll[i]) >= neutralBound;
    const masked = bmr || rainMask[i] || hyd || restr || velNotNeutral;
    if (masked) confounds++;
    sT[i] = masked ? 0 : (Number.isFinite(zD[i]) ? zD[i] : 0);
  }

  // 6. Diagnostic reason for a drift episode.
  const driftReason = (start, end, dir) => {
    const zdSeg = [];
    const vrSeg = [];
    let rainy = false;
    for (let i = start; i <= end; i++) {
      if (Number.isFinite(zD[i])) zdSeg.push(zD[i]);
      if (velRel[i] != null) vrSeg.push(velRel[i]);
      if (rainMask[i]) rainy = true;
    }
    const mzD = dir > 0 ? Math.abs(meanOf(zdSeg)) : -Math.abs(meanOf(zdSeg));
    const mVr = vrSeg.length ? meanOf(vrSeg) * 100 : null;
    const durH = (t[end] - t[start]) / 3600;
    const velPart = mVr == null
      ? M.velNA()
      : (Math.abs(mVr) < velNeutralPct * 100 ? M.velStable(mVr) : M.velVal(mVr));
    const rainPart = hasRain ? (rainy ? M.rainPresent() : M.rainAbsent()) : M.rainNA();
    return M.driftReason(mzD, durH * 3600, velPart, rainPart);
  };

  // 5. Two-sided CUSUM on the drift score. Onset = where the running sum leaves
  // zero; alarm when it exceeds drift_h AND the accumulation has lasted at least
  // min_duration_hours; the episode runs to the return to zero (or end = ongoing).
  //
  // Reversion rule: a genuine sensor drift does not fix itself — it ends with a
  // recalibration (per the client guide, episodes run onset → calibration). So an
  // episode whose sum RETURNS to zero on its own before `drift_min_days` is a
  // level EXCURSION (hydraulics we could not otherwise explain), not a drift.
  const episodes = [];
  const driftStarts = [];
  const minDurSec = minDurH * 3600;
  const driftMinSec = driftMinDays * 86400;
  for (const dir of [1, -1]) {
    let S = 0;
    let onset = -1;
    let alarmed = false;
    const close = (end, ongoing) => {
      if (!alarmed) return;
      const durSec = t[end] - t[onset];
      // Restriction signature = CO-TIMED opposite steps at the episode onset:
      // depth jumps UP while velocity drops DOWN within the same few hours (the
      // doc's discriminator). A drift CREEPS (no step); natural events co-elevate
      // both channels. Mean levels are useless here — this site's velocity wanders
      // ±30 % over days — but the co-timed opposition is unambiguous.
      if (dir > 0) {
        const pre = Math.max(0, onset - winPts);
        const lim = Math.min(end, onset + 3 * winPts);
        let dMax = -Infinity;
        let vMin = Infinity;
        for (let j = onset; j <= lim; j++) {
          if (zDroll[j] != null && zDroll[j] > dMax) dMax = zDroll[j];
          if (velRoll[j] != null && velRoll[j] < vMin) vMin = velRoll[j];
        }
        const dStep = dMax - (zDroll[pre] ?? 0);
        const vStep = vMin - (velRoll[pre] ?? 0);
        if (dStep >= 2 && vStep <= -restrVelBound) {
          episodes.push({
            startIndex: onset, endIndex: end, type: "restriction",
            reason: M.restriction(dStep, vStep * 100, durSec),
          });
          return;
        }
      }
      const isDrift = ongoing || durSec >= driftMinSec;
      if (isDrift) {
        driftStarts.push(onset);
        episodes.push({ startIndex: onset, endIndex: end, type: "drift", reason: driftReason(onset, end, dir), ongoing });
      } else {
        episodes.push({
          startIndex: onset, endIndex: end, type: "excursion",
          reason: M.excursion(durSec, driftReason(onset, end, dir)),
        });
      }
    };
    for (let i = 0; i < n; i++) {
      const prev = S;
      S = Math.max(0, S + dir * sT[i] - driftK);
      if (prev === 0 && S > 0) { onset = i; alarmed = false; }
      if (S > 0 && !alarmed && onset >= 0 && S > driftH && t[i] - t[onset] >= minDurSec) alarmed = true;
      if (prev > 0 && S === 0) {
        close(i - 1, false);
        onset = -1;
        alarmed = false;
      }
    }
    close(n - 1, true);
  }

  // 6. Annex confound episodes (contiguous runs >= 1 h; faults from flat runs).
  const hydRain = new Array(n);
  const hydOnly = new Array(n);
  for (let i = 0; i < n; i++) {
    hydRain[i] = hydraulicMask[i] && rainMask[i];
    hydOnly[i] = hydraulicMask[i] && !rainMask[i];
  }
  const addRuns = (mask, type, reasonFn) => {
    for (const [s, e] of contiguousRuns(mask)) {
      if (t[e] - t[s] < 3600) continue;
      episodes.push({ startIndex: s, endIndex: e, type, reason: reasonFn(s, e) });
    }
  };
  addRuns(hydRain, "rain", (s, e) => M.rainEvent(t[e] - t[s]));
  addRuns(hydOnly, "hydraulic", (s, e) => M.hydraulicEvent(t[e] - t[s]));
  for (const [s, e] of contiguousRuns(flat)) {
    episodes.push({ startIndex: s, endIndex: e, type: "fault", reason: M.fault(e - s + 1) });
  }

  episodes.sort((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex);

  // 7. Velocity rescaled onto the depth range for display.
  let velocityNorm = null;
  if (hasVelocity) {
    const medDepth = median(depth.filter(Number.isFinite));
    const medVel = median(vel.filter((v) => v != null));
    const scale = medVel ? medDepth / medVel : 1;
    velocityNorm = vel.map((v) => (v == null ? null : v * scale));
  }

  const drifts = episodes.filter((e) => e.type === "drift").length;
  const warns = [];
  if (!hasVelocity) warns.push(M.warnVelAbsent());
  if (!hasRain) warns.push(M.warnRainNA());
  if (!baseDepth.available) warns.push(M.warnNoTimestamp());

  return {
    fitted: baseDepth.baseline,
    velocityNorm,
    episodes,
    driftStarts: [...new Set(driftStarts)].sort((a, b) => a - b),
    metrics: { drifts, confoundsFiltres: confounds, pointsBmr },
    warning: warns.length ? warns.join(" ") : null,
  };
}
