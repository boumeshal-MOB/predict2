// Robust CSV loader. Auto-detects the delimiter, tolerates French decimals
// (comma), extracts ONLY the DFINAL column for analysis, and uses a time/date
// column for the x-axis when one is present (otherwise the row index).
//
// It also detects the physical UNITS (mm / metres / feet) and normalises every
// value INTERNALLY to millimetres (depth) and m/s (velocity) before filling the
// series, so all models and thresholds (BMR 50 mm / 0,2 m/s) work unchanged
// whatever the export's units. Optional analyst quality-tag columns
// (DepthQualityCode / VelocityQualityCode) are stored per point as p.dq / p.vq.
//
// Returns { series, columns, valueColumn, timeColumn, units, unitsRaw, ... }.
//   series: [{ index, t, value, label, velocity, rain, dq, vq }]

const TIME_NAMES = [
  "datetime", "timestamp", "horodatage", "date", "heure", "temps", "time",
];
// The target column is matched by substring so real headers like "MP1\DFINAL"
// (with a device prefix) are found without an exact-name requirement.
const VALUE_NAME = "dfinal";
// Optional companion channels for multi-channel drift analysis. Matched by
// substring, first name that hits wins (order = priority).
const VELOCITY_NAMES = ["vfinal", "peakvel", "vel"];
const RAIN_NAMES = ["raini_uk", "rain"];

// Unit conversion factors to the internal representation (mm for depth,
// m/s for velocity).
const DEPTH_TO_MM = { mm: 1, m: 1000, ft: 304.8 };
const VEL_TO_MS = { "m/s": 1, "ft/s": 0.3048 };
const UNIT_LABELS_FR = { mm: "millimètres", m: "mètres", ft: "pieds" };

function medianOf(values) {
  const s = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  const n = s.length;
  if (!n) return null;
  const m = n >> 1;
  return n % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Heuristic on the RAW medians: a depth median >= 20 reads as millimetres; a
// small depth with a velocity median above ~1.5 reads as US feet (ft / ft·s⁻¹);
// otherwise metres. Depth is normalised to mm and velocity to m/s downstream.
function detectUnits(depthMed, velMed) {
  if (depthMed != null && depthMed >= 20) return { depth: "mm", velocity: "m/s" };
  if (velMed != null && velMed > 1.5) return { depth: "ft", velocity: "ft/s" };
  return { depth: "m", velocity: "m/s" };
}

// forceUnits ∈ "auto" | "mm" | "m" | "ft" (velocity unit follows depth).
function unitsFromForce(force) {
  if (force === "mm") return { depth: "mm", velocity: "m/s" };
  if (force === "m") return { depth: "m", velocity: "m/s" };
  if (force === "ft") return { depth: "ft", velocity: "ft/s" };
  return null;
}

export function unitLabelFr(units) {
  if (!units) return "";
  const base = UNIT_LABELS_FR[units.depth] || units.depth;
  return units.autoDetected ? `${base} (auto)` : base;
}

function findColumn(lower, names) {
  for (const name of names) {
    const idx = lower.findIndex((h) => h.includes(name));
    if (idx !== -1) return idx;
  }
  return -1;
}

function detectDelimiter(sample) {
  const candidates = [";", ",", "\t", "|"];
  const line = sample.split(/\r?\n/).find((l) => l.trim().length) ?? "";
  let best = ",";
  let bestCount = -1;
  for (const d of candidates) {
    const count = line.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

function splitLine(line, delim) {
  // Minimal quoted-field support.
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === delim && !inQuotes) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function toNumber(raw, delim) {
  if (raw == null) return NaN;
  let s = raw.trim().replace(/"/g, "");
  if (!s) return NaN;
  // If the delimiter isn't a comma, a comma is a decimal separator.
  if (delim !== ",") s = s.replace(/\s/g, "").replace(",", ".");
  else s = s.replace(/\s/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// Companion-channel cells are frequently empty; empty / non-numeric => null
// (not NaN) so downstream models can test `!= null` cleanly.
function toNumberOrNull(raw, delim) {
  const n = toNumber(raw, delim);
  return Number.isFinite(n) ? n : null;
}

function parseDate(raw) {
  if (!raw) return null;
  const s = raw.trim().replace(/^"|"$/g, "");
  // DD/MM/YYYY [HH:MM[:SS]] — European, slash-separated. Checked BEFORE native
  // Date because Date() would misread "10/04/2026" as US MM/DD.
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [, dd, mm, yy, hh = "0", mi = "0", ss = "0"] = m;
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    const d = new Date(Date.UTC(year, Number(mm) - 1, Number(dd), +hh, +mi, +ss));
    if (!Number.isNaN(d.getTime())) return d;
  }
  // ISO (YYYY-MM-DD…) and anything else the engine understands.
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseCsv(text, { forceUnits = "auto" } = {}) {
  const clean = text.replace(/^﻿/, ""); // strip BOM
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) throw new Error("Le fichier ne contient pas assez de lignes.");

  // The header isn't always line 1: exported CSVs often start with metadata
  // rows. The header is the first line that actually names the DFINAL column.
  let headerIdx = lines.findIndex((l) => /dfinal/i.test(l));
  if (headerIdx === -1) headerIdx = 0;

  const delim = detectDelimiter(lines[headerIdx]);
  const header = splitLine(lines[headerIdx], delim);
  const lower = header.map((h) => h.toLowerCase());

  // Substring match so "MP1\DFINAL" (device-prefixed) is found.
  const valueCol = lower.findIndex((h) => h.includes(VALUE_NAME));
  if (valueCol === -1) {
    throw new Error(
      `Colonne « DFINAL » introuvable. Colonnes détectées : ${header.join(", ")}`
    );
  }
  let timeCol = -1;
  for (const name of TIME_NAMES) {
    const idx = lower.findIndex((h) => h.includes(name));
    if (idx !== -1) {
      timeCol = idx;
      break;
    }
  }
  // Optional velocity / rain channels (absent in single-channel CSVs).
  const velCol = findColumn(lower, VELOCITY_NAMES);
  const rainCol = findColumn(lower, RAIN_NAMES);
  // Optional analyst quality-tag columns (format 2). Codes are stored per point;
  // free-text "…Comment" columns are only COUNTED (too heavy to keep per point).
  const dqCol = findColumn(lower, ["depthqualitycode"]);
  const vqCol = findColumn(lower, ["velocityqualitycode"]);
  const dcCol = findColumn(lower, ["depthqualitycomment"]);
  const vcCol = findColumn(lower, ["velocityqualitycomment"]);

  const normCode = (cell) => {
    if (cell == null) return null;
    const s = String(cell).trim().replace(/^"|"$/g, "").toLowerCase();
    return s.length ? s : null;
  };

  const raw = [];
  let firstDate = null;
  let depthCommentCount = 0;
  let velocityCommentCount = 0;
  // Rows after the header. A units/format row (e.g. "mm") right below the header
  // is skipped automatically because its DFINAL cell isn't numeric.
  for (let r = headerIdx + 1; r < lines.length; r++) {
    const cells = splitLine(lines[r], delim);
    const value = toNumber(cells[valueCol], delim);
    let date = null;
    let rawLabel = null;
    if (timeCol !== -1) {
      rawLabel = cells[timeCol];
      date = parseDate(rawLabel);
      if (date && !firstDate) firstDate = date;
    }
    const velocity = velCol !== -1 ? toNumberOrNull(cells[velCol], delim) : null;
    const rain = rainCol !== -1 ? toNumberOrNull(cells[rainCol], delim) : null;
    const dq = dqCol !== -1 ? normCode(cells[dqCol]) : null;
    const vq = vqCol !== -1 ? normCode(cells[vqCol]) : null;
    if (dcCol !== -1 && normCode(cells[dcCol])) depthCommentCount++;
    if (vcCol !== -1 && normCode(cells[vcCol])) velocityCommentCount++;
    raw.push({ value, date, rawLabel, velocity, rain, dq, vq });
  }

  // Units: detect from the RAW medians (before any normalisation), unless the
  // caller forces a choice. Then normalise depth → mm and velocity → m/s.
  const depthMedRaw = medianOf(raw.map((r) => r.value));
  const velMedRaw = medianOf(raw.map((r) => r.velocity));
  const detected = detectUnits(depthMedRaw, velMedRaw);
  const forced = unitsFromForce(forceUnits);
  const effective = forced || detected;
  const units = { depth: effective.depth, velocity: effective.velocity, autoDetected: !forced };
  const unitsRaw = { depth: detected.depth, velocity: detected.velocity };
  const depthFactor = DEPTH_TO_MM[units.depth] ?? 1;
  const velFactor = VEL_TO_MS[units.velocity] ?? 1;

  const series = [];
  let skipped = 0;
  raw.forEach((row, i) => {
    if (!Number.isFinite(row.value)) {
      skipped++;
      return;
    }
    const index = series.length;
    // t drives the polynomial trend; it is scale-invariant so index spacing is
    // fine when there are no real timestamps.
    const t = row.date && firstDate ? (row.date - firstDate) / 1000 : index;
    const label = row.date
      ? row.date.toISOString().replace("T", " ").replace(".000Z", "")
      : row.rawLabel ?? `#${i + 1}`;
    series.push({
      index,
      t,
      value: row.value * depthFactor,
      label,
      velocity: row.velocity != null ? row.velocity * velFactor : null,
      rain: row.rain ?? null,
      dq: row.dq,
      vq: row.vq,
    });
  });

  if (series.length < 2) {
    throw new Error("Pas assez de valeurs numériques valides dans DFINAL.");
  }

  const taggedCount = series.reduce((a, p) => a + ((p.dq && p.dq !== "a") || (p.vq && p.vq !== "a") ? 1 : 0), 0);

  return {
    series,
    columns: header,
    valueColumn: header[valueCol],
    timeColumn: timeCol !== -1 ? header[timeCol] : null,
    velocityColumn: velCol !== -1 ? header[velCol] : null,
    rainColumn: rainCol !== -1 ? header[rainCol] : null,
    depthQualityColumn: dqCol !== -1 ? header[dqCol] : null,
    velocityQualityColumn: vqCol !== -1 ? header[vqCol] : null,
    units,
    unitsRaw,
    tagged: taggedCount,
    depthComments: depthCommentCount,
    velocityComments: velocityCommentCount,
    skipped,
    total: raw.length,
    delimiter: delim,
  };
}
