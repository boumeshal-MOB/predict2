// Parity check: run the JS detectors on the exact same input the Python
// detectors saw (tests/fixture.json) and compare.
//   - Z-Score: deterministic math => expect an exact index match with Python.
//   - Isolation Forest: sklearn's RNG can't be reproduced in JS, so we assert
//     behavioural parity (catches every injected anomaly, similar total count)
//     rather than an exact index match.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { detectZScore } from "../src/algorithms/zscore.js";
import { detectIsolationForest } from "../src/algorithms/isolationForest.js";

const here = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(here, "fixture.json"), "utf8"));

// Build the series the way the CSV loader will (hourly index as time in seconds).
const series = fx.values.map((value, index) => ({ index, t: index * 3600, value }));

const sortedNums = (s) => [...s].sort((a, b) => a - b);
let failures = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
};

// --- Z-Score ---
const z = detectZScore(series, fx.zscore.params);
const zIdx = sortedNums(z.anomalies);
const zExpected = fx.zscore.anomaly_indices;
check(
  "zscore exact index match with Python",
  JSON.stringify(zIdx) === JSON.stringify(zExpected),
  `js=${JSON.stringify(zIdx)} py=${JSON.stringify(zExpected)}`
);

// --- Isolation Forest ---
const f = detectIsolationForest(series, fx.isolation_forest.params);
const fIdx = sortedNums(f.anomalies);
const injected = fx.injected_indices;
const recall = injected.filter((i) => f.anomalies.has(i)).length / injected.length;
check(
  "iforest catches every injected anomaly (recall = 1.0)",
  recall === 1,
  `recall=${recall.toFixed(2)} js=${JSON.stringify(fIdx)}`
);
check(
  "iforest total count within ±3 of Python",
  Math.abs(fIdx.length - fx.isolation_forest.anomaly_indices.length) <= 3,
  `js=${fIdx.length} py=${fx.isolation_forest.anomaly_indices.length}`
);

// --- Determinism ---
const f2 = detectIsolationForest(series, fx.isolation_forest.params);
check(
  "iforest is deterministic across runs",
  JSON.stringify(sortedNums(f2.anomalies)) === JSON.stringify(fIdx)
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
