// Dependency-free interactive SVG time-series chart.
// Colours come from CSS custom properties on .viz-root, so light/dark theming
// happens in one place (see styles.css). Labels are inserted with textContent
// because they originate from user CSV headers/values.
//
// createChart() returns a controller supporting:
//   - multiple overlaid series
//   - manual or automatic Y scale
//   - interactive X zoom (wheel), pan (drag) and reset (double-click)
//   - an onViewChange callback so two charts can share the same X/Y window.
// Drag pans X and Y; wheel zooms X; Shift+wheel zooms Y.

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

const W = 960;
const H = 300;
const M = { top: 16, right: 18, bottom: 34, left: 56 };
const PW = W - M.left - M.right;
const PH = H - M.top - M.bottom;
const ZOOM = 1.2;

// container: element. options: { onViewChange(xDomain) }
// setData cfg: { series:[{ values:[], name, className?, color?, dashed?, width? }],
//   labels:[], markers:Set|null }
export function createChart(container, { onViewChange = null } = {}) {
  container.classList.add("chart");
  const st = {
    seriesList: null,
    labels: [],
    markers: null,
    N: 0,
    xDomain: [0, 0],
    yDomain: null, // null => auto from visible data
    yOverride: null, // explicit manual min/max from controls
  };
  let drag = null;

  function setData({ series, labels = [], markers = null, driftMarkers = null, resetView = true }) {
    st.seriesList = series;
    st.labels = labels;
    st.markers = markers;
    st.driftMarkers = driftMarkers;
    st.N = series[0] ? series[0].values.length : 0;
    if (resetView) {
      st.xDomain = [0, Math.max(0, st.N - 1)];
      st.yDomain = st.yOverride ? [st.yOverride.min, st.yOverride.max] : null;
    }
    render();
  }

  function setXDomain(dom, silent = false) {
    st.xDomain = dom;
    render();
    if (!silent && onViewChange) onViewChange(st.xDomain.slice());
  }

  function setYDomain(override) {
    st.yOverride = override;
    st.yDomain = override ? [override.min, override.max] : null;
    render();
  }

  function resetZoom() {
    st.yDomain = st.yOverride ? [st.yOverride.min, st.yOverride.max] : null;
    setXDomain([0, Math.max(0, st.N - 1)]);
  }

  function clear() {
    st.seriesList = null;
    st.N = 0;
    container.innerHTML = "";
  }

  function render() {
    if (!st.seriesList || st.N === 0) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML = "";
    const N = st.N;

    // Clamp / sanitise the X window.
    let [i0, i1] = st.xDomain;
    i0 = Math.max(0, Math.min(i0, N - 1));
    i1 = Math.max(0, Math.min(i1, N - 1));
    if (i1 <= i0) i1 = Math.min(N - 1, i0 + 1);
    if (i1 <= i0) { i0 = 0; i1 = Math.max(1, N - 1); } // single point safety
    const span = (i1 - i0) || 1;
    const lo = Math.max(0, Math.floor(i0));
    const hi = Math.min(N - 1, Math.ceil(i1));

    const x = (i) => M.left + ((i - i0) / span) * PW;

    // Y domain: manual/interactive domain or auto from the visible window.
    let yMin, yMax;
    if (st.yDomain) {
      [yMin, yMax] = st.yDomain;
    } else {
      yMin = Infinity;
      yMax = -Infinity;
      for (const s of st.seriesList) {
        if (s.visible === false) continue;
        for (let i = lo; i <= hi; i++) {
          const v = s.values[i];
          if (Number.isFinite(v)) {
            if (v < yMin) yMin = v;
            if (v > yMax) yMax = v;
          }
        }
      }
      if (!Number.isFinite(yMin)) { yMin = 0; yMax = 1; }
    }
    const { ticks, lo: ylo, hi: yhi } = niceTicks(yMin, yMax);
    const yspan = (yhi - ylo) || 1;
    const y = (v) => M.top + PH - ((v - ylo) / yspan) * PH;

    const svg = el("svg", {
      viewBox: `0 0 ${W} ${H}`,
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
      class: "chart-svg",
    });

    // Clip so panned/zoomed lines never spill past the plot area.
    const clipId = `clip-${Math.random().toString(36).slice(2)}`;
    const defs = el("defs");
    const clip = el("clipPath", { id: clipId });
    clip.appendChild(el("rect", { x: M.left, y: M.top, width: PW, height: PH }));
    defs.appendChild(clip);
    svg.appendChild(defs);

    // Y gridlines + labels
    for (const t of ticks) {
      const yy = y(t);
      svg.appendChild(el("line", { x1: M.left, y1: yy, x2: W - M.right, y2: yy, class: "grid" }));
      const lbl = el("text", { x: M.left - 8, y: yy + 4, class: "axis-label", "text-anchor": "end" });
      lbl.textContent = fmt(t);
      svg.appendChild(lbl);
    }

    // X ticks (~6 evenly spaced integer indices across the visible window)
    const xTickCount = Math.min(6, hi - lo + 1);
    const seen = new Set();
    for (let k = 0; k < xTickCount; k++) {
      const i = Math.round(lo + (k / Math.max(1, xTickCount - 1)) * (hi - lo));
      if (seen.has(i)) continue;
      seen.add(i);
      const xx = x(i);
      const anchor = i === lo ? "start" : i === hi ? "end" : "middle";
      const lbl = el("text", { x: xx, y: H - 12, class: "axis-label", "text-anchor": anchor });
      lbl.textContent = st.labels[i] ?? String(i + 1);
      svg.appendChild(lbl);
    }

    // Baseline
    svg.appendChild(el("line", { x1: M.left, y1: M.top + PH, x2: W - M.right, y2: M.top + PH, class: "baseline" }));

    // Plotted content (clipped)
    const plot = el("g", { "clip-path": `url(#${clipId})` });

    for (const s of st.seriesList) {
      if (s.visible === false) continue;
      let d = "";
      let pen = false;
      for (let i = lo; i <= hi; i++) {
        const v = s.values[i];
        if (!Number.isFinite(v)) { pen = false; continue; }
        d += `${pen ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`;
        pen = true;
      }
      const path = el("path", { d, fill: "none", class: s.className || "series-line" });
      if (s.color) path.style.stroke = s.color;
      if (s.dashed) path.setAttribute("stroke-dasharray", "5 4");
      if (s.width) path.setAttribute("stroke-width", s.width);
      plot.appendChild(path);
    }

    // Anomaly markers on the primary (first) series
    if (st.markers && st.markers.visible !== false) {
      const s0 = st.seriesList.find((s) => s.visible !== false) || st.seriesList[0];
      for (const i of st.markers) {
        if (i < lo || i > hi) continue;
        const v = s0.values[i];
        if (!Number.isFinite(v)) continue;
        plot.appendChild(el("circle", { cx: x(i), cy: y(v), r: 5, class: "marker" }));
      }
    }

    // Drift-onset markers = full-height vertical lines
    if (st.driftMarkers) {
      for (const i of st.driftMarkers) {
        if (i < lo || i > hi) continue;
        const xx = x(i);
        plot.appendChild(el("line", { x1: xx, y1: M.top, x2: xx, y2: M.top + PH, class: "drift-line" }));
      }
    }
    svg.appendChild(plot);

    // Crosshair + per-series hover dots
    const crosshair = el("line", { class: "crosshair", y1: M.top, y2: M.top + PH, x1: -10, x2: -10, opacity: 0 });
    svg.appendChild(crosshair);
    const hoverDots = st.seriesList.map(() => {
      const dot = el("circle", { r: 4, class: "hover-dot", opacity: 0 });
      svg.appendChild(dot);
      return dot;
    });

    const hit = el("rect", { x: M.left, y: M.top, width: PW, height: PH, fill: "transparent", class: "hit" });
    svg.appendChild(hit);
    container.appendChild(svg);

    const tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.style.opacity = "0";
    container.appendChild(tip);

    // ---- Interaction --------------------------------------------------------
    const pxToIndex = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const px = ((clientX - rect.left) / rect.width) * W;
      return i0 + ((px - M.left) / PW) * span;
    };

    const move = (evt) => {
      let i = Math.round(pxToIndex(evt.clientX));
      i = Math.max(lo, Math.min(hi, i));
      const xx = x(i);
      const rect = svg.getBoundingClientRect();
      crosshair.setAttribute("x1", xx);
      crosshair.setAttribute("x2", xx);
      crosshair.setAttribute("opacity", 1);

      tip.innerHTML = "";
      const lab = document.createElement("div");
      lab.className = "tip-lab";
      lab.textContent = st.labels[i] ?? `#${i + 1}`;
      tip.appendChild(lab);

      let anchorY = M.top;
      let shown = false;
      st.seriesList.forEach((s, si) => {
        if (s.visible === false) { hoverDots[si].setAttribute("opacity", 0); return; }
        const v = s.values[i];
        if (!Number.isFinite(v)) { hoverDots[si].setAttribute("opacity", 0); return; }
        const yy = y(v);
        hoverDots[si].setAttribute("cx", xx);
        hoverDots[si].setAttribute("cy", yy);
        hoverDots[si].setAttribute("opacity", 1);
        if (!shown) { anchorY = yy; shown = true; }
        const row = document.createElement("div");
        row.className = "tip-val";
        row.textContent = st.seriesList.length > 1 ? `${s.name} : ${fmt(v)}` : fmt(v);
        tip.appendChild(row);
      });

      if (st.markers && st.markers.visible !== false && st.markers.has(i)) {
        const flag = document.createElement("div");
        flag.className = "tip-flag";
        flag.textContent = "● anomalie";
        tip.appendChild(flag);
      }

      const tw = 170;
      let left = (xx / W) * rect.width + 12;
      if (left + tw > rect.width) left = (xx / W) * rect.width - tw - 12;
      tip.style.left = `${Math.max(4, left)}px`;
      tip.style.top = `${(anchorY / H) * rect.height - 8}px`;
      tip.style.opacity = "1";
    };
    const leave = () => {
      crosshair.setAttribute("opacity", 0);
      hoverDots.forEach((d) => d.setAttribute("opacity", 0));
      tip.style.opacity = "0";
    };

    const pan = (evt) => {
      const rect = svg.getBoundingClientRect();
      const dpx = ((evt.clientX - drag.x) / rect.width) * W;
      const dpy = ((evt.clientY - drag.y) / rect.height) * H;
      const [d0, d1] = drag.dom;
      const sp = d1 - d0;
      const didx = (dpx / PW) * sp;
      let n0 = d0 - didx;
      let n1 = d1 - didx;
      if (n0 < 0) { n1 -= n0; n0 = 0; }
      if (n1 > N - 1) { n0 -= n1 - (N - 1); n1 = N - 1; if (n0 < 0) n0 = 0; }
      if (drag.ydom) {
        const [y0, y1] = drag.ydom;
        const ysp = y1 - y0 || 1;
        const dy = (dpy / PH) * ysp;
        st.yDomain = [y0 + dy, y1 + dy];
      }
      setXDomain([n0, n1]);
    };

    if (N > 1) {
      hit.addEventListener("pointerdown", (e) => {
        drag = { x: e.clientX, y: e.clientY, dom: st.xDomain.slice(), ydom: [ylo, yhi] };
        hit.classList.add("grabbing");
        try { hit.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      });
      hit.addEventListener("pointermove", (e) => (drag ? pan(e) : move(e)));
      const endDrag = (e) => {
        drag = null;
        hit.classList.remove("grabbing");
        try { hit.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      };
      hit.addEventListener("pointerup", endDrag);
      hit.addEventListener("pointercancel", endDrag);
      hit.addEventListener("pointerleave", () => { if (!drag) leave(); });

      svg.addEventListener("wheel", (e) => {
        e.preventDefault();
        if (e.shiftKey) {
          const rect = svg.getBoundingClientRect();
          const py = ((e.clientY - rect.top) / rect.height) * H;
          const cursorVal = yhi - ((py - M.top) / PH) * yspan;
          const [d0, d1] = st.yDomain || [ylo, yhi];
          const sp = d1 - d0 || 1;
          const nsp = e.deltaY < 0 ? sp / ZOOM : sp * ZOOM;
          const frac = (cursorVal - d0) / sp;
          st.yDomain = [cursorVal - frac * nsp, cursorVal + (1 - frac) * nsp];
          render();
          return;
        }
        const cursorIdx = pxToIndex(e.clientX);
        const [d0, d1] = st.xDomain;
        const sp = d1 - d0;
        let nsp = e.deltaY < 0 ? sp / ZOOM : sp * ZOOM;
        nsp = Math.max(2, Math.min(N - 1, nsp));
        const frac = (cursorIdx - d0) / sp;
        let n0 = cursorIdx - frac * nsp;
        let n1 = n0 + nsp;
        if (n0 < 0) { n1 -= n0; n0 = 0; }
        if (n1 > N - 1) { n0 -= n1 - (N - 1); n1 = N - 1; if (n0 < 0) n0 = 0; }
        setXDomain([n0, n1]);
      }, { passive: false });

      svg.addEventListener("dblclick", () => resetZoom());
    } else {
      hit.addEventListener("pointermove", move);
      hit.addEventListener("pointerleave", leave);
    }
  }

  return { setData, setXDomain, setYDomain, resetZoom, clear, get hasData() { return !!st.seriesList; }, get N() { return st.N; } };
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
