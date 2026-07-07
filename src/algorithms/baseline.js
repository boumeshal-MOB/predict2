// Shared diurnal (daily-cycle) baseline used by the drift-oriented models.
// A sensor signal carries a strong daily swing; removing it first lets a slow
// DRIFT surface without the periodic component masking (or faking) it. The
// profile is the per-bucket median across the day (00:00→24:00 split into
// `ptsParJour` slots); empty slots are interpolated from their nearest finite
// neighbours (the cycle wraps around midnight).
import { medianStep } from "./forecast.js";

function median(values) {
  const s = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  const n = s.length;
  if (!n) return NaN;
  const m = n >> 1;
  return n % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Fill NaN slots of a cyclic profile by linear interpolation between the nearest
// finite neighbours on each side (wrapping around the day). All-empty => zeros.
function fillGaps(profile) {
  const n = profile.length;
  if (!profile.some(Number.isFinite)) return profile.map(() => 0);
  const out = profile.slice();
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(out[i])) continue;
    let a = 1;
    while (a < n && !Number.isFinite(profile[(i - a + n) % n])) a++;
    let b = 1;
    while (b < n && !Number.isFinite(profile[(i + b) % n])) b++;
    const va = profile[(i - a + n) % n];
    const vb = profile[(i + b) % n];
    if (Number.isFinite(va) && Number.isFinite(vb)) out[i] = va + ((vb - va) * a) / (a + b);
    else out[i] = Number.isFinite(va) ? va : vb;
  }
  return out;
}

function parseLabelDate(label) {
  if (!label) return null;
  const d = new Date(String(label).replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

// series: [{ t (seconds), label, ... }]; accessor(point) => number | null.
// Returns { baseline: number[] (aligned on series), available, step, ptsParJour,
//   lookup(t, date?) } where lookup samples the profile at an arbitrary time so
// forecasts can re-add the diurnal component in the future.
export function diurnalBaseline(series, accessor) {
  const n = series.length;
  const step = medianStep(series);
  if (!(step > 1)) {
    // No real time axis: no diurnal cycle to remove.
    return { baseline: new Array(n).fill(0), available: false, step, ptsParJour: 0, lookup: () => 0 };
  }
  const ptsParJour = Math.max(4, Math.min(2880, Math.round(86400 / step)));
  const bucketOf = (t) => Math.round((((t % 86400) + 86400) % 86400) / step) % ptsParJour;

  // Split weekday / weekend profiles only when the record spans >= 10 days AND
  // the labels carry a real date (the weekday can't be inferred from t alone).
  const spanDays = (series[n - 1].t - series[0].t) / 86400;
  const firstDate = parseLabelDate(series[0].label);
  const weekSplit = spanDays >= 10 && !!firstDate;
  const isWeekend = (date) => {
    const d = date.getUTCDay();
    return d === 0 || d === 6;
  };

  const bucketsWeek = Array.from({ length: ptsParJour }, () => []);
  const bucketsWeekend = Array.from({ length: ptsParJour }, () => []);
  for (const p of series) {
    const v = accessor(p);
    if (v == null || !Number.isFinite(v)) continue;
    const b = bucketOf(p.t);
    let wknd = false;
    if (weekSplit) {
      const date = parseLabelDate(p.label);
      wknd = date ? isWeekend(date) : false;
    }
    (wknd ? bucketsWeekend : bucketsWeek)[b].push(v);
  }
  const profileWeek = fillGaps(bucketsWeek.map(median));
  const profileWeekend = weekSplit ? fillGaps(bucketsWeekend.map(median)) : profileWeek;

  const lookup = (t, date) => {
    const b = bucketOf(t);
    if (weekSplit && date) return (isWeekend(date) ? profileWeekend : profileWeek)[b];
    return profileWeek[b];
  };

  const baseline = series.map((p) => {
    const b = bucketOf(p.t);
    if (weekSplit) {
      const date = parseLabelDate(p.label);
      if (date && isWeekend(date)) return profileWeekend[b];
    }
    return profileWeek[b];
  });

  return { baseline, available: true, step, ptsParJour, lookup };
}
