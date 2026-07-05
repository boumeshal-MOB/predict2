// Robust CSV loader. Auto-detects the delimiter, tolerates French decimals
// (comma), extracts ONLY the DFINAL column for analysis, and uses a time/date
// column for the x-axis when one is present (otherwise the row index).
//
// Returns { series, columns, valueColumn, timeColumn, skipped, total }.
//   series: [{ index, t, value, label }]  (index = position in kept series)

const TIME_NAMES = [
  "timestamp", "datetime", "date", "time", "horodatage", "heure", "temps",
];
const VALUE_NAME = "dfinal";

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

function parseDate(raw) {
  if (!raw) return null;
  const s = raw.trim();
  // ISO or anything Date understands.
  let d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;
  // DD/MM/YYYY [HH:MM[:SS]]
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [, dd, mm, yy, hh = "0", mi = "0", ss = "0"] = m;
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    d = new Date(Date.UTC(year, Number(mm) - 1, Number(dd), +hh, +mi, +ss));
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

export function parseCsv(text) {
  const clean = text.replace(/^﻿/, ""); // strip BOM
  const delim = detectDelimiter(clean);
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) throw new Error("Le fichier ne contient pas assez de lignes.");

  const header = splitLine(lines[0], delim);
  const lower = header.map((h) => h.toLowerCase());

  const valueCol = lower.indexOf(VALUE_NAME);
  if (valueCol === -1) {
    throw new Error(
      `Colonne « DFINAL » introuvable. Colonnes détectées : ${header.join(", ")}`
    );
  }
  let timeCol = -1;
  for (const name of TIME_NAMES) {
    const idx = lower.indexOf(name);
    if (idx !== -1) {
      timeCol = idx;
      break;
    }
  }

  const raw = [];
  let firstDate = null;
  for (let r = 1; r < lines.length; r++) {
    const cells = splitLine(lines[r], delim);
    const value = toNumber(cells[valueCol], delim);
    let date = null;
    let rawLabel = null;
    if (timeCol !== -1) {
      rawLabel = cells[timeCol];
      date = parseDate(rawLabel);
      if (date && !firstDate) firstDate = date;
    }
    raw.push({ value, date, rawLabel });
  }

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
    series.push({ index, t, value: row.value, label });
  });

  if (series.length < 2) {
    throw new Error("Pas assez de valeurs numériques valides dans DFINAL.");
  }

  return {
    series,
    columns: header,
    valueColumn: header[valueCol],
    timeColumn: timeCol !== -1 ? header[timeCol] : null,
    skipped,
    total: raw.length,
    delimiter: delim,
  };
}
