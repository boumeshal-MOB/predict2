// Model registry — the single place that declares which models exist, their
// tunable parameters (with UI bounds and defaults), and how to run them.
// Adding a new model (e.g. a forecast model later) means adding one entry here;
// the UI builds its controls from this metadata automatically.
import { detectZScore } from "./zscore.js";
import { detectIsolationForest } from "./isolationForest.js";
import { detectCusum } from "./cusum.js";
import { forecastKnn, forecastMlp } from "./forecast.js";
import { forecastCanari } from "./canari.js";
import { detectMultiChannelDrift } from "./multichannel.js";

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
  multichannel_drift: {
    id: "multichannel_drift",
    label: "Dérive multi-canaux (profondeur + vélocité + pluie)",
    kind: "drift",
    description:
      "Détecte la dérive lente d'un capteur de pression (profondeur qui monte alors que la vélocité reste plate et sans pluie). Retire le cycle diurne, puis distingue la vraie dérive des confusions physiques : restriction aval (profondeur ↑, vélocité ↓), événement pluvieux/hydraulique (profondeur ↑ ET vélocité ↑, pluie), bruit BMR (valeurs trop faibles) et panne (flat-line).",
    tips: [
      "Le discriminateur clé est croisé : une dérive capteur fait monter la profondeur SANS que la vélocité bouge et SANS pluie. Si la vélocité monte avec, c'est un événement hydraulique ; si elle baisse, une restriction aval.",
      "Baissez « Sensibilité k » ou « Seuil d'alarme h » pour détecter des dérives plus fines, au prix de possibles fausses alertes.",
      "Sans colonne de vélocité, le modèle passe en mode dégradé (il ne peut plus écarter restrictions et événements hydrauliques) : un avertissement le signale.",
    ],
    params: [
      {
        key: "drift_k", label: "Sensibilité k (en σ)", type: "float", min: 0, max: 3, step: 0.05, default: 0.75,
        help: "Marge ignorée à chaque pas de la somme cumulée, en écarts-types robustes. Plus bas = détecte des dérives plus faibles mais réagit davantage au bruit.",
      },
      {
        key: "drift_h", label: "Seuil d'alarme h", type: "float", min: 10, max: 600, step: 5, default: 120,
        help: "Niveau que la somme cumulée doit dépasser pour confirmer une dérive. Plus haut = moins de fausses alertes mais détection plus tardive.",
      },
      {
        key: "min_duration_hours", label: "Durée minimale (h)", type: "float", min: 1, max: 72, step: 1, default: 6,
        help: "Durée d'accumulation minimale avant de confirmer une dérive. Évite d'alarmer sur des sursauts courts.",
      },
      {
        key: "rain_lag_min", label: "Fenêtre pluie (min)", type: "int", min: 0, max: 1440, step: 10, default: 120,
        help: "Durée après une pluie pendant laquelle la montée de profondeur est attribuée à l'événement pluvieux et non à une dérive.",
      },
      {
        key: "bmr_depth", label: "Seuil BMR profondeur (mm)", type: "float", min: 0, max: 500, step: 5, default: 50,
        help: "En dessous de cette profondeur, le signal est jugé trop faible (bruit BMR) et exclu de la détection de dérive.",
      },
      {
        key: "bmr_velocity", label: "Seuil BMR vélocité (m/s)", type: "float", min: 0, max: 2, step: 0.05, default: 0.2,
        help: "En dessous de cette vélocité, le point est jugé en régime bruité (BMR) et exclu de la détection.",
      },
      {
        key: "vel_neutral_pct", label: "Neutralité vélocité (%)", type: "float", min: 5, max: 50, step: 1, default: 15,
        help: "La dérive n'est comptée que si la vélocité reste à ± ce pourcentage de son profil journalier normal : c'est le discriminateur clé — profondeur qui monte AVEC vélocité plate. Une vélocité qui s'écarte davantage (hausse = événement hydraulique, baisse = restriction) exonère le point.",
      },
      {
        key: "event_vel_pct", label: "Seuil événement vélocité (%)", type: "float", min: 15, max: 150, step: 5, default: 35,
        help: "Hausse de vélocité (en % de son profil normal, moyennée sur 1 h) au-delà de laquelle un événement hydraulique est déclaré (profondeur et vélocité co-élevées).",
      },
      {
        key: "drift_min_days", label: "Durée mini d'une dérive (j)", type: "float", min: 0.5, max: 20, step: 0.5, default: 5,
        help: "Une accumulation qui revient à la normale d'elle-même avant cette durée est classée « excursion de niveau », pas dérive : une vraie dérive capteur ne se corrige pas seule (elle se termine par une recalibration).",
      },
    ],
    run: detectMultiChannelDrift,
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
    label: "Canari — dérive et prévision (bayésien)",
    kind: "forecast",
    description:
      "Modèle espace-d'état bayésien (niveau + tendance, filtre de Kalman) inspiré de Canari. Analyse la série une fois nettoyée des anomalies (Z-Score) : estime le niveau de fond, marque le début des dérives d'une ligne verticale, et prévoit. La détection d'anomalies reste séparée (modèles Z-Score / Isolation Forest).",
    tips: [
      "Spécialisé dérive + prévision : il travaille sur le signal débruité, sans se mêler de la détection d'anomalies (faite à part).",
      "Baissez la « Sensibilité de dérive » pour marquer des glissements plus fins ; montez-la pour ne garder que les dérives franches.",
      "Baissez « Réactivité niveau » pour une ligne de fond plus lisse ; montez-la pour qu'elle colle davantage au signal.",
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
        key: "drift_sensitivity", label: "Sensibilité de dérive (en σ)", type: "float", min: 0.5, max: 6, step: 0.1, default: 2,
        help: "Écart (en σ) que la moyenne journalière du niveau doit dépasser pour tracer une ligne de dérive. Plus bas = détecte des dérives plus fines mais risque plus de fausses lignes ; plus haut = seules les dérives franches sont marquées.",
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
