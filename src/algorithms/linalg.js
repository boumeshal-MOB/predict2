// Minimal linear-algebra helpers for least-squares polynomial fitting.
// Kept dependency-free so it runs identically in the browser and in Node tests.

// Solve A x = b for a square matrix A (n x n) via Gaussian elimination with
// partial pivoting. Returns the solution vector, or null if the system is
// singular / ill-conditioned.
export function solveLinearSystem(A, b) {
  const n = A.length;
  // Work on copies so callers keep their inputs.
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivot: pick the row with the largest magnitude in this column.
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null; // singular

    [M[col], M[pivot]] = [M[pivot], M[col]];

    // Eliminate below.
    for (let r = col + 1; r < n; r++) {
      const factor = M[r][col] / M[col][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }

  // Back-substitution.
  const x = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = M[row][n];
    for (let c = row + 1; c < n; c++) sum -= M[row][c] * x[c];
    x[row] = sum / M[row][row];
  }
  return x;
}

// Least-squares polynomial fit of `degree` to (x, y).
//
// numpy.polyfit is basis-independent for the *fitted values*, so we standardise
// x first (zero mean / unit scale) to keep the normal equations well
// conditioned, fit in that space, and return an evaluator that works on the
// original x. This matches numpy's trend values to floating-point precision.
export function polyfitEvaluator(x, y, degree) {
  const n = x.length;
  const mean = x.reduce((a, v) => a + v, 0) / n;
  let scale = Math.sqrt(x.reduce((a, v) => a + (v - mean) * (v - mean), 0) / n);
  if (!(scale > 0)) scale = 1;

  const xs = x.map((v) => (v - mean) / scale);

  // Build the normal-equations matrix using power sums of xs.
  const p = degree + 1;
  const powerSums = new Array(2 * degree + 1).fill(0);
  for (let i = 0; i < n; i++) {
    let acc = 1;
    for (let k = 0; k < powerSums.length; k++) {
      powerSums[k] += acc;
      acc *= xs[i];
    }
  }
  const rhs = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    let acc = 1;
    for (let k = 0; k < p; k++) {
      rhs[k] += acc * y[i];
      acc *= xs[i];
    }
  }
  const A = [];
  for (let r = 0; r < p; r++) {
    const row = new Array(p);
    for (let c = 0; c < p; c++) row[c] = powerSums[r + c];
    A.push(row);
  }

  const coeffs = solveLinearSystem(A, rhs); // ascending powers in standardised x
  if (!coeffs) return null;

  return (xv) => {
    const t = (xv - mean) / scale;
    let acc = 1;
    let val = 0;
    for (let k = 0; k < p; k++) {
      val += coeffs[k] * acc;
      acc *= t;
    }
    return val;
  };
}
