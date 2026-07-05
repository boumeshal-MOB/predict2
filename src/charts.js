// Dependency-free SVG time-series chart with crosshair + tooltip.
// Colours come from CSS custom properties on .viz-root, so light/dark theming
// happens in one place (see styles.css). Labels are inserted with textContent
// because they originate from user CSV headers/values.

const SVG = "http://www.w3.org/2000/svg";
const el = (name, attrs = {}) => {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

function niceTicks(min, max, count = 5) {
  if (min === max) {
    return { ticks: [min], lo: min - 1, hi: max + 1 };
  }
  const range = max - min;
  const rawStep = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return { ticks, lo, hi };
}

const fmt = (v) => {
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.01 || a >= 1e5)) return v.toExponential(2);
  return Number(v.toFixed(a < 10 ? 2 : a < 1000 ? 1 : 0)).toLocaleString("fr-FR");
};

// container: element. cfg: { values:[], labels:[], markers:Set|null,
//   markerColor:'--critical', markerLabel:'anomalie' }
export function renderChart(container, cfg) {
  const { values, labels, markers = null } = cfg;
  container.innerHTML = "";
  container.classList.add("chart");

  const W = 960;
  const H = 300;
  const M = { top: 16, right: 18, bottom: 34, left: 56 };
  const pw = W - M.left - M.right;
  const ph = H - M.top - M.bottom;
  const N = values.length;

  const finite = values.filter(Number.isFinite);
  const dataMin = Math.min(...finite);
  const dataMax = Math.max(...finite);
  const { ticks, lo, hi } = niceTicks(dataMin, dataMax);

  const x = (i) => M.left + (N === 1 ? pw / 2 : (i / (N - 1)) * pw);
  const y = (v) => M.top + ph - ((v - lo) / (hi - lo)) * ph;

  const svg = el("svg", {
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
    class: "chart-svg",
  });

  // Y gridlines + labels
  for (const t of ticks) {
    const yy = y(t);
    svg.appendChild(el("line", { x1: M.left, y1: yy, x2: W - M.right, y2: yy, class: "grid" }));
    const lbl = el("text", { x: M.left - 8, y: yy + 4, class: "axis-label", "text-anchor": "end" });
    lbl.textContent = fmt(t);
    svg.appendChild(lbl);
  }

  // X ticks (~6 evenly spaced labels)
  const xTickCount = Math.min(6, N);
  const seen = new Set();
  for (let k = 0; k < xTickCount; k++) {
    const i = Math.round((k / Math.max(1, xTickCount - 1)) * (N - 1));
    if (seen.has(i)) continue; // avoid duplicate ticks on tiny series
    seen.add(i);
    const xx = x(i);
    // Anchor the extremes inward so edge labels are never clipped.
    const anchor = i === 0 ? "start" : i === N - 1 ? "end" : "middle";
    const lbl = el("text", { x: xx, y: H - 12, class: "axis-label", "text-anchor": anchor });
    lbl.textContent = labels[i] ?? String(i + 1);
    svg.appendChild(lbl);
  }

  // Baseline
  svg.appendChild(el("line", { x1: M.left, y1: M.top + ph, x2: W - M.right, y2: M.top + ph, class: "baseline" }));

  // Series line (skip gaps at non-finite values)
  let d = "";
  let pen = false;
  for (let i = 0; i < N; i++) {
    if (!Number.isFinite(values[i])) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(2)},${y(values[i]).toFixed(2)}`;
    pen = true;
  }
  svg.appendChild(el("path", { d, class: "series-line", fill: "none" }));

  // Anomaly markers
  if (markers) {
    for (const i of markers) {
      if (!Number.isFinite(values[i])) continue;
      svg.appendChild(el("circle", { cx: x(i), cy: y(values[i]), r: 5, class: "marker" }));
    }
  }

  // Crosshair + hover hit layer
  const crosshair = el("line", { class: "crosshair", y1: M.top, y2: M.top + ph, x1: -10, x2: -10, opacity: 0 });
  const hoverDot = el("circle", { r: 4, class: "hover-dot", opacity: 0 });
  svg.appendChild(crosshair);
  svg.appendChild(hoverDot);

  const hit = el("rect", { x: M.left, y: M.top, width: pw, height: ph, fill: "transparent", class: "hit" });
  svg.appendChild(hit);
  container.appendChild(svg);

  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.style.opacity = "0";
  container.appendChild(tip);

  const move = (evt) => {
    const rect = svg.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * W;
    let i = Math.round(((px - M.left) / pw) * (N - 1));
    i = Math.max(0, Math.min(N - 1, i));
    if (!Number.isFinite(values[i])) {
      // snap to nearest finite
      let j = i;
      while (j >= 0 && !Number.isFinite(values[j])) j--;
      if (j < 0) { j = i; while (j < N && !Number.isFinite(values[j])) j++; }
      if (j < 0 || j >= N || !Number.isFinite(values[j])) return;
      i = j;
    }
    const xx = x(i);
    const yy = y(values[i]);
    crosshair.setAttribute("x1", xx);
    crosshair.setAttribute("x2", xx);
    crosshair.setAttribute("opacity", 1);
    hoverDot.setAttribute("cx", xx);
    hoverDot.setAttribute("cy", yy);
    hoverDot.setAttribute("opacity", 1);

    const isAnom = markers && markers.has(i);
    tip.innerHTML = "";
    const val = document.createElement("div");
    val.className = "tip-val";
    val.textContent = fmt(values[i]);
    const lab = document.createElement("div");
    lab.className = "tip-lab";
    lab.textContent = labels[i] ?? `#${i + 1}`;
    tip.append(val, lab);
    if (isAnom) {
      const flag = document.createElement("div");
      flag.className = "tip-flag";
      flag.textContent = "● anomalie";
      tip.appendChild(flag);
    }
    const tw = 150;
    let left = (xx / W) * rect.width + 12;
    if (left + tw > rect.width) left = (xx / W) * rect.width - tw - 12;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${(yy / H) * rect.height - 8}px`;
    tip.style.opacity = "1";
  };
  const leave = () => {
    crosshair.setAttribute("opacity", 0);
    hoverDot.setAttribute("opacity", 0);
    tip.style.opacity = "0";
  };
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerleave", leave);
}

// Replace anomaly values with linear interpolation between the nearest clean
// neighbours so the "cleaned" series reads as the underlying signal.
export function cleanSeries(values, markers) {
  const out = values.slice();
  for (let i = 0; i < out.length; i++) {
    if (!markers.has(i)) continue;
    let a = i - 1;
    while (a >= 0 && markers.has(a)) a--;
    let b = i + 1;
    while (b < out.length && markers.has(b)) b++;
    const va = a >= 0 ? values[a] : null;
    const vb = b < out.length ? values[b] : null;
    if (va != null && vb != null) out[i] = va + ((vb - va) * (i - a)) / (b - a);
    else if (va != null) out[i] = va;
    else if (vb != null) out[i] = vb;
  }
  return out;
}
