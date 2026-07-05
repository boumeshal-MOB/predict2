// Model registry — the single place that declares which models exist, their
// tunable parameters (with UI bounds and defaults), and how to run them.
// Adding a new model (e.g. a forecast model later) means adding one entry here;
// the UI builds its controls from this metadata automatically.
import { detectZScore } from "./zscore.js";
import { detectIsolationForest } from "./isolationForest.js";

export const MODELS = {
  zscore: {
    id: "zscore",
    label: "Z-Score robuste (tendance polynomiale + MAD)",
    kind: "anomaly",
    description:
      "Ajuste une tendance polynomiale, mesure l'écart robuste (MAD) de chaque point et signale ceux dont le z-score dépasse le seuil.",
    params: [
      {
        key: "degree",
        label: "Degré du polynôme",
        type: "int",
        min: 0,
        max: 8,
        step: 1,
        default: 2,
        help: "Complexité de la tendance retirée avant analyse.",
      },
      {
        key: "threshold",
        label: "Seuil |z|",
        type: "float",
        min: 0.5,
        max: 6,
        step: 0.1,
        default: 1.7,
        help: "Plus bas = plus sensible (davantage d'anomalies).",
      },
    ],
    run: detectZScore,
  },
  isolation_forest: {
    id: "isolation_forest",
    label: "Isolation Forest",
    kind: "anomaly",
    description:
      "Forêt d'arbres d'isolation : les points faciles à isoler obtiennent un score élevé et sont marqués comme anomalies.",
    params: [
      {
        key: "contamination",
        label: "Contamination",
        type: "float",
        min: 0.001,
        max: 0.3,
        step: 0.001,
        default: 0.03,
        help: "Fraction attendue d'anomalies dans les données.",
      },
      {
        key: "n_estimators",
        label: "Nombre d'arbres",
        type: "int",
        min: 10,
        max: 500,
        step: 10,
        default: 100,
        help: "Plus d'arbres = résultat plus stable, calcul plus long.",
      },
    ],
    run: detectIsolationForest,
  },
};

export function defaultParams(modelId) {
  const out = {};
  for (const p of MODELS[modelId].params) out[p.key] = p.default;
  return out;
}
