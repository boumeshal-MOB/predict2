// Detection runs here, off the main thread, so the UI never freezes even on
// large CSVs. Module worker => it can import the shared registry directly.
import { MODELS } from "./algorithms/registry.js";

self.onmessage = (e) => {
  const { modelId, series, params } = e.data;
  try {
    const model = MODELS[modelId];
    if (!model) throw new Error(`Modèle inconnu : ${modelId}`);
    const t0 = performance.now();
    const out = model.run(series, params);
    const anomalies = [...out.anomalies].sort((a, b) => a - b);
    self.postMessage({
      ok: true,
      anomalies,
      trend: out.trend ?? null,
      warning: out.warning ?? null,
      elapsedMs: Math.round(performance.now() - t0),
    });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message || String(err) });
  }
};
