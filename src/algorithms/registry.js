// Model registry — the single place that declares which models exist, their
// tunable parameters (with UI bounds and defaults), and how to run them.
// Adding a new model (e.g. a forecast model later) means adding one entry here;
// the UI builds its controls from this metadata automatically.
import { detectZScore } from "./zscore.js";
import { detectIsolationForest } from "./isolationForest.js";
import { forecastKnn, forecastMlp } from "./forecast.js";

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
  knn_forecast: {
    id: "knn_forecast",
    label: "Prévision k-NN par analogues",
    kind: "forecast",
    description:
      "Cherche dans l'historique les fenêtres les plus similaires à la situation actuelle et moyenne leurs suites futures.",
    params: [
      { key: "horizon", label: "Horizon (points)", type: "int", min: 1, max: 2880, step: 1, default: "auto_day", help: "Par défaut : une journée calculée à partir du pas temporel médian." },
      { key: "window_size", label: "Fenêtre d'apprentissage", type: "int", min: 2, max: 336, step: 1, default: 24, help: "Nombre de points récents comparés aux motifs passés." },
      { key: "neighbors", label: "Voisins", type: "int", min: 1, max: 50, step: 1, default: 5, help: "Nombre de motifs similaires moyennés." },
    ],
    run: forecastKnn,
  },
  mlp_forecast: {
    id: "mlp_forecast",
    label: "Prévision IA — réseau neuronal MLP",
    kind: "forecast",
    description:
      "Petit réseau neuronal auto-régressif entraîné localement dans le navigateur sur des fenêtres glissantes.",
    params: [
      { key: "horizon", label: "Horizon (points)", type: "int", min: 1, max: 2880, step: 1, default: "auto_day", help: "Par défaut : une journée calculée à partir du pas temporel médian." },
      { key: "window_size", label: "Fenêtre d'apprentissage", type: "int", min: 2, max: 336, step: 1, default: 24, help: "Nombre de valeurs passées fournies au réseau." },
      { key: "hidden_units", label: "Neurones cachés", type: "int", min: 2, max: 64, step: 1, default: 12, help: "Capacité du réseau : plus haut = plus souple mais plus lent." },
      { key: "epochs", label: "Époques", type: "int", min: 10, max: 1000, step: 10, default: 200, help: "Nombre de passes d'entraînement local." },
      { key: "learning_rate", label: "Taux d'apprentissage", type: "float", min: 0.0005, max: 0.1, step: 0.0005, default: 0.01, help: "Vitesse d'ajustement des poids du réseau." },
    ],
    run: forecastMlp,
  },
};

export function defaultParams(modelId) {
  const out = {};
  for (const p of MODELS[modelId].params) out[p.key] = p.default;
  return out;
}
