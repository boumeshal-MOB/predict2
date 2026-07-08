// Banc de validation du modèle « Dérive multi-canaux » — 10 contrôles PASS/FAIL.
// Prérequis : tests/real_avril.csv et tests/real_juin.csv (exports capteur
// privés, non versionnés) + `python3 tests/make_synthetics.py`.
// Usage : node tests/eval_drift.mjs   (depuis la racine du repo) — exiger 10/10.
import { parseCsv } from "../src/csv.js";
import { detectMultiChannelDrift } from "../src/algorithms/multichannel.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  ok ? pass++ : fail++;
};

function run(file, params = {}) {
  const parsed = parseCsv(fs.readFileSync(path.join(HERE, file), "utf8"));
  const t0 = performance.now();
  const out = detectMultiChannelDrift(parsed.series, params);
  out._ms = Math.round(performance.now() - t0);
  return out;
}
const byType = (o) => {
  const m = {};
  for (const e of o.episodes || []) m[e.type] = (m[e.type] || 0) + 1;
  return m;
};
const fmt = (o) => JSON.stringify(byType(o)) + ` (${o._ms} ms)`;

// 1. Dérive rampe injectée (+0,4 mm/h dès idx 1440, vélocité intacte).
// Onset attendu à ±48 h : avec σ≈10 mm de bruit, une rampe de 0,4 mm/h n'est
// statistiquement pas détectable plus tôt (le remit métier est 7-14 jours).
{
  const o = run("synth_drift.csv");
  const drifts = (o.episodes || []).filter((e) => e.type === "drift");
  check("S1a dérive détectée", drifts.length >= 1, fmt(o));
  if (drifts.length) {
    const onset = Math.min(...drifts.map((e) => e.startIndex));
    check("S1b onset à ±48 h de idx 1440", Math.abs(onset - 1440) <= 1440, `onset=${onset}`);
  } else {
    check("S1b onset à ±48 h de idx 1440", false, "aucune dérive");
  }
}

// 2. Restriction réaliste : PAS de dérive, restriction signalée.
{
  const o = run("synth_restriction.csv");
  const t = byType(o);
  check("S2a aucune fausse dérive sur restriction", !(t.drift > 0), fmt(o));
  check("S2b restriction suspectée signalée", (t.restriction || 0) >= 1, fmt(o));
}

// 3. Flat-line : panne signalée, sans contaminer la détection de dérive.
{
  const o = run("synth_flatline.csv");
  const t = byType(o);
  check("S3a panne (flat-line) signalée", (t.fault || 0) >= 1, fmt(o));
  check("S3b pas de dérive causée par le flat-line", !(t.drift > 0), fmt(o));
}

// 4. Fichiers réels bruts : zéro fausse dérive malgré les crues.
{
  const oj = run("real_juin.csv");
  const tj = byType(oj);
  check("S4a juin : zéro fausse dérive malgré les crues", !(tj.drift > 0), fmt(oj));
  check("S4b juin : événements hydrauliques identifiés", (tj.hydraulic || 0) + (tj.rain || 0) >= 1, fmt(oj));
  const oa = run("real_avril.csv");
  check("S4c avril : zéro fausse dérive", !(byType(oa).drift > 0), fmt(oa));
  check("S4d perfs < 500 ms", oj._ms < 500 && oa._ms < 500, `${oj._ms}/${oa._ms} ms`);
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
