// Shared helpers for the analyst quality-tag columns (DepthQualityCode /
// VelocityQualityCode). The parser stores a per-point lowercase letter on
// `p.dq` (depth) and `p.vq` (velocity) or null when absent. Convention:
//   a = good, b = doubtful, c = silting / rags, n = sensor failure.
// "b", "c" and "n" all mark a point that should not feed the healthy
// fingerprint nor the drift score; "n" additionally means a declared fault.
const BAD = new Set(["b", "c", "n"]);

function codeOf(p) {
  // Worst of the two channel codes wins (n > c > b > a). Empty / a => null.
  const codes = [p.dq, p.vq].filter((c) => typeof c === "string" && c.length);
  if (!codes.length) return null;
  if (codes.includes("n")) return "n";
  if (codes.includes("c")) return "c";
  if (codes.includes("b")) return "b";
  return null; // "a" or anything else => not flagged
}

// True on every point an analyst flagged as not trustworthy (b/c/n).
export function qualityMask(series) {
  return series.map((p) => BAD.has(codeOf(p) ?? ""));
}

// True only where a declared sensor failure (code n) is tagged.
export function faultCodeMask(series) {
  return series.map((p) => codeOf(p) === "n");
}

// True where a point is tagged doubtful / silting (b or c) but not a failure.
export function taggedCodeMask(series) {
  return series.map((p) => {
    const c = codeOf(p);
    return c === "b" || c === "c";
  });
}

// Convenience: does this single point carry a bad quality tag?
export function isBadQuality(p) {
  return BAD.has(codeOf(p) ?? "");
}

export function hasQualityTags(series) {
  return series.some((p) => codeOf(p) != null);
}
