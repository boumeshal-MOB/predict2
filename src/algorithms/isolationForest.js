// Isolation Forest for a 1-D signal.
// Faithful re-implementation of the scikit-learn behaviour used in
// python_functions/algorithms/isolation_forest.py. Exact byte parity with
// sklearn is not attainable in JS (different RNG internals), so we reproduce the
// algorithm and its contamination-based thresholding, with a seeded PRNG so
// results are deterministic across runs.

const EULER_GAMMA = 0.5772156649015329;

// Deterministic PRNG (mulberry32) so a given dataset + params always yields the
// same anomalies — important for a tool users re-run while tuning.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Average path length of an unsuccessful search in a BST of n nodes — the
// normalisation term c(n), matching sklearn's _average_path_length.
function avgPathLength(n) {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return 2 * (Math.log(n - 1) + EULER_GAMMA) - (2 * (n - 1)) / n;
}

function buildTree(values, indices, depth, maxDepth, rng) {
  const n = indices.length;
  if (depth >= maxDepth || n <= 1) return { leaf: true, size: n, depth };

  let min = Infinity;
  let max = -Infinity;
  for (const idx of indices) {
    const v = values[idx];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) return { leaf: true, size: n, depth };

  const split = min + rng() * (max - min);
  const left = [];
  const right = [];
  for (const idx of indices) (values[idx] < split ? left : right).push(idx);

  return {
    leaf: false,
    split,
    left: buildTree(values, left, depth + 1, maxDepth, rng),
    right: buildTree(values, right, depth + 1, maxDepth, rng),
  };
}

function pathLength(node, value) {
  let depthAcc = 0;
  let cur = node;
  while (!cur.leaf) {
    cur = value < cur.split ? cur.left : cur.right;
  }
  return cur.depth + avgPathLength(cur.size);
}

// series: [{ index, value }]. params: { contamination, n_estimators }
export function detectIsolationForest(series, params) {
  const contamination = parseFloat(params.contamination ?? 0.01);
  const nEstimators = Math.max(1, parseInt(params.n_estimators ?? 100, 10));

  const valid = series.filter((p) => Number.isFinite(p.value));
  const result = { anomalies: new Set(), scores: new Map() };
  if (valid.length < 2) return { ...result, warning: "Not enough valid samples." };

  const values = valid.map((p) => p.value);
  const n = values.length;
  const psi = Math.min(256, n); // sklearn max_samples='auto'
  const maxDepth = Math.ceil(Math.log2(Math.max(2, psi)));
  const rng = mulberry32(42);
  const allIdx = values.map((_, i) => i);

  const forest = [];
  for (let t = 0; t < nEstimators; t++) {
    // Subsample of size psi without replacement (partial Fisher–Yates).
    const pool = allIdx.slice();
    const sample = [];
    for (let k = 0; k < psi; k++) {
      const j = k + Math.floor(rng() * (pool.length - k));
      [pool[k], pool[j]] = [pool[j], pool[k]];
      sample.push(pool[k]);
    }
    forest.push(buildTree(values, sample, 0, maxDepth, rng));
  }

  const norm = avgPathLength(psi);
  const scores = new Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (const tree of forest) sum += pathLength(tree, values[i]);
    const meanH = sum / forest.length;
    // Anomaly score in (0,1); higher = more anomalous.
    scores[i] = Math.pow(2, -meanH / norm);
    result.scores.set(valid[i].index, scores[i]);
  }

  // Contamination-based threshold: flag the top `contamination` fraction, as
  // sklearn does via its offset_ percentile on the score distribution.
  const k = Math.round(contamination * n);
  if (k > 0) {
    const ranked = scores
      .map((s, i) => [s, i])
      .sort((a, b) => b[0] - a[0]);
    const threshold = ranked[Math.min(k - 1, ranked.length - 1)][0];
    for (let i = 0; i < n; i++) {
      if (scores[i] >= threshold) result.anomalies.add(valid[i].index);
    }
  }

  return result;
}
