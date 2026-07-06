// Model registry — the single place that declares which models exist, their
// tunable parameters (with UI bounds and defaults), and how to run them.
// Adding a new model (e.g. a forecast model later) means adding one entry here;
// the UI builds its controls from this metadata automatically.
import { detectZScore } from "./zscore.js";
import { detectIsolationForest } from "./isolationForest.js";
import { detectCusum } from "./cusum.js";
import { forecastKnn, forecastMlp } from "./forecast.js";
import { forecastCanari } from "./canari.js";

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
        default: 3.5,
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
        default: 0.01,
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
  cusum_drift: {
    id: "cusum_drift",
    label: "Détection de dérive (CUSUM)",
    kind: "anomaly",
    description:
      "Somme cumulée des écarts à un niveau de référence robuste. Met en évidence les dérives lentes et persistantes qu'un seuil ponctuel (Z-Score, Isolation Forest) ne voit pas.",
    tips: [
      "Idéal pour repérer un glissement progressif du niveau (encrassement de capteur, dérive de calibration, colmatage…) invisible point par point.",
      "Baissez « Seuil d'alarme h » ou « Sensibilité k » pour détecter des dérives plus faibles, au prix de possibles fausses alertes.",
      "La « Fenêtre de référence » doit couvrir une période que vous jugez normale : c'est le niveau auquel tout le reste est comparé.",
    ],
    params: [
      {
        key: "baseline_window", label: "Fenêtre de référence (points)", type: "int", min: 5, max: 2000, step: 1, default: "auto_day",
        help: "Nombre de premiers points définissant le niveau « normal » de référence (médiane + dispersion robuste). Par défaut : une journée de mesures. Prenez une période stable et représentative.",
      },
      {
        key: "slack_k", label: "Sensibilité k (en σ)", type: "float", min: 0, max: 3, step: 0.1, default: 1,
        help: "Marge ignorée à chaque pas, en écarts-types. Plus bas = détecte des dérives plus fines mais réagit au bruit ; 0,5 détecte une dérive d'environ 1 σ.",
      },
      {
        key: "threshold_h", label: "Seuil d'alarme h (en σ)", type: "float", min: 1, max: 20, step: 0.5, default: 8,
        help: "Niveau que la somme cumulée doit dépasser pour déclencher une alarme. Plus haut = moins de fausses alertes mais détection plus tardive.",
      },
    ],
    run: detectCusum,
  },
  knn_forecast: {
    id: "knn_forecast",
    label: "Prévision k-NN par analogues",
    kind: "forecast",
    description:
      "Cherche dans l'historique les fenêtres les plus similaires à la situation actuelle et moyenne leurs suites futures.",
    tips: [
      "Fonctionne bien sur des signaux à motifs répétitifs (cycles journaliers, hebdomadaires…).",
      "Aucun entraînement : rapide même sur un long historique, essayez d'abord les valeurs par défaut.",
      "Comparez la « Prévision jour J » (magenta) aux vraies valeurs (bleu) sur le graphique du bas avant de faire confiance à la « Prévision J+1 ».",
    ],
    params: [
      {
        key: "horizon", label: "Horizon (points)", type: "int", min: 1, max: 2880, step: 1, default: "auto_day",
        help: "Nombre de points à prévoir dans le futur. Par défaut, calculé automatiquement pour représenter environ une journée de mesures. Un horizon plus long est possible, mais la prévision devient moins fiable à mesure qu'elle s'éloigne du présent.",
      },
      {
        key: "window_size", label: "Fenêtre d'apprentissage", type: "int", min: 2, max: 720, step: 1, default: 120,
        help: "Nombre de points récents utilisés comme « signature » de la situation actuelle, comparée aux motifs passés. Trop petite : comparaisons bruitées. Trop grande : plus lent et risque de lisser des motifs locaux utiles. Conseil : visez au moins un demi-cycle de votre phénomène (ex. une demi-journée).",
      },
      {
        key: "neighbors", label: "Voisins", type: "int", min: 1, max: 50, step: 1, default: 7,
        help: "Nombre de motifs passés les plus ressemblants dont les suites sont moyennées. Une valeur basse colle à un seul cas historique (bruité) ; une valeur haute lisse davantage mais peut diluer les particularités locales.",
      },
    ],
    run: forecastKnn,
  },
  mlp_forecast: {
    id: "mlp_forecast",
    label: "Prévision IA — réseau neuronal MLP",
    kind: "forecast",
    description:
      "Petit réseau neuronal auto-régressif entraîné localement dans le navigateur sur des fenêtres glissantes.",
    tips: [
      "Peut capter des relations plus complexes que le k-NN, au prix d'un court entraînement (quelques centaines de ms).",
      "Si la prévision part n'importe où (oscillations, valeurs aberrantes), réduisez le taux d'apprentissage ou le nombre d'époques.",
      "Comparez la « Prévision jour J » (magenta) aux vraies valeurs (bleu) sur le graphique du bas avant de faire confiance à la « Prévision J+1 ».",
    ],
    params: [
      {
        key: "horizon", label: "Horizon (points)", type: "int", min: 1, max: 2880, step: 1, default: "auto_day",
        help: "Nombre de points à prévoir dans le futur. Par défaut, calculé automatiquement pour représenter environ une journée de mesures. Un horizon plus long est possible, mais la prévision devient moins fiable à mesure qu'elle s'éloigne du présent.",
      },
      {
        key: "window_size", label: "Fenêtre d'apprentissage", type: "int", min: 2, max: 720, step: 1, default: 48,
        help: "Nombre de valeurs passées fournies en entrée au réseau à chaque prédiction. Trop petite : le réseau manque de contexte. Trop grande : plus lent à entraîner. Conseil : visez au moins un demi-cycle de votre phénomène (ex. une demi-journée).",
      },
      {
        key: "hidden_units", label: "Neurones cachés", type: "int", min: 2, max: 64, step: 1, default: 16,
        help: "Capacité du réseau à modéliser des motifs complexes. Trop basse : apprentissage limité. Trop haute : entraînement plus lent et risque d'apprendre le bruit par cœur plutôt que la tendance réelle (sur-apprentissage).",
      },
      {
        key: "epochs", label: "Époques", type: "int", min: 10, max: 1000, step: 10, default: 200,
        help: "Nombre de fois où le réseau relit l'historique pour ajuster ses poids. Plus d'époques améliore l'ajustement jusqu'à un plateau ; au-delà, cela ralentit sans gain réel (voire un sur-apprentissage).",
      },
      {
        key: "learning_rate", label: "Taux d'apprentissage", type: "float", min: 0.0005, max: 0.1, step: 0.0005, default: 0.01,
        help: "Vitesse à laquelle le réseau corrige ses poids à chaque passage. Trop élevé : apprentissage instable (prévision qui oscille n'importe comment). Trop bas : apprentissage lent, risque de ne pas converger dans le nombre d'époques disponible.",
      },
    ],
    run: forecastMlp,
  },
  canari: {
    id: "canari",
    label: "Canari — modèle bayésien (dérive + anomalies + prévision)",
    kind: "forecast",
    description:
      "Modèle espace-d'état bayésien (niveau + tendance, filtre de Kalman) inspiré de Canari. Estime une ligne de fond robuste (la dérive), détecte en ligne les anomalies (erreur de prévision à 1 pas) et le début des dérives, puis prévoit.",
    tips: [
      "Le tout-en-un : ligne de dérive (niveau), anomalies (rouge), débuts de dérive (violet) et prévision, sur un seul modèle.",
      "Baissez « Réactivité tendance » pour une dérive plus lisse ; montez-la pour suivre des changements de pente plus rapides.",
      "Baissez le « Seuil d'anomalie » pour signaler des écarts plus fins (plus d'alertes).",
    ],
    params: [
      {
        key: "horizon", label: "Horizon (points)", type: "int", min: 1, max: 2880, step: 1, default: "auto_day",
        help: "Nombre de points à prévoir. Par défaut, une journée calculée à partir du pas temporel médian.",
      },
      {
        key: "level_reactivity", label: "Réactivité niveau", type: "float", min: 0.001, max: 1, step: 0.001, default: 0.1,
        help: "Vitesse à laquelle la ligne de fond suit le signal. Plus haut = suit de près (moins lisse) ; plus bas = ligne plus lisse.",
      },
      {
        key: "slope_reactivity", label: "Réactivité tendance", type: "float", min: 0.0001, max: 0.5, step: 0.0001, default: 0.005,
        help: "Vitesse à laquelle la pente (dérive) peut changer. Plus haut = détecte des changements de dérive plus rapides mais plus sensible au bruit.",
      },
      {
        key: "anomaly_threshold", label: "Seuil d'anomalie (en σ)", type: "float", min: 1, max: 12, step: 0.1, default: 5,
        help: "Un point est une anomalie si son erreur de prévision à 1 pas dépasse ce nombre d'écarts-types. Plus bas = plus d'anomalies signalées.",
      },
    ],
    run: forecastCanari,
  },
};

export function defaultParams(modelId) {
  const out = {};
  for (const p of MODELS[modelId].params) out[p.key] = p.default;
  return out;
}
