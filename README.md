# Predict 2 — Anomalies, dérive capteur et prévision, dans le navigateur

Application web **100 % statique** d'analyse de séries temporelles de capteurs
de débit (réseau d'assainissement) : détection d'anomalies, **détection de
dérive capteur** (l'objectif métier principal) et prévision. Tout tourne dans
le navigateur — aucun serveur, aucune donnée envoyée.

1. **Charge un CSV** (glisser-déposer ou sélection).
2. **Choisit un modèle** et **ajuste ses paramètres** (chaque paramètre a une aide).
3. **Lance l'analyse** — le calcul tourne dans un Web Worker.
4. **Visualise** : anomalies, ligne de dérive, fenêtres d'épisodes diagnostiqués,
   prévision + backtest, selon le modèle choisi.

> La colonne **`DFINAL`** (profondeur) est analysée. Les colonnes de **vélocité**
> (`VFINAL`/`PEAKVEL`) et de **pluie** (`RAINI_UK`/`RAIN`) sont détectées
> automatiquement et exploitées par le modèle multi-canaux. Une colonne
> temporelle (`DateTime`, `timestamp`, `date`…) sert d'axe si présente. Dates
> européennes `dd/MM/yyyy`, séparateur et décimales détectés automatiquement.

## Pourquoi côté navigateur ?

- **Aucun serveur, aucun coût, aucune donnée envoyée** : le CSV ne quitte jamais
  la machine de l'utilisateur.
- **Hébergement gratuit** sur GitHub Pages ; calcul sans ressource externe.

## Modèles disponibles

| Modèle | Type | Principe |
|--------|------|----------|
| **Z-Score robuste** | anomalie | Tendance polynomiale retirée, z-score robuste (MAD) sur les résidus. |
| **Isolation Forest** | anomalie | Forêt d'arbres d'isolation ; les points faciles à isoler sont marqués. |
| **Détection de dérive (CUSUM)** | dérive mono-canal | Somme cumulée sur résidus désaisonnalisés ; signale le début de chaque glissement de niveau. |
| **Canari (bayésien)** | dérive + prévision | Filtre de Kalman (niveau + tendance) inspiré de [Bayes-Works/canari](https://github.com/Bayes-Works/canari). Ligne de niveau robuste, départs de dérive (lignes verticales), prévision. |
| **Prévision k-NN** | prévision | Fenêtres historiques similaires moyennées ; apprentissage sur résidus désaisonnalisés. |
| **Prévision IA — MLP** | prévision | Petit réseau neuronal auto-régressif entraîné localement sur les résidus désaisonnalisés. |
| **Dérive multi-canaux** ⭐ | dérive | Le modèle métier : profondeur qui monte **avec vélocité plate et sans pluie** = dérive capteur ; distingue restriction aval, événement pluvieux/hydraulique, bruit BMR et panne. |

Les modèles d'anomalies sont des portages JavaScript des algorithmes Python du
projet `Predic` (**parité numérique vérifiée**, voir `tests/`). Prévisions et
dérives sont en JavaScript pur, sans dépendance. Le cycle journalier est retiré
avant toute détection/prévision puis ré-ajouté. Architecture extensible :
ajouter un modèle = ajouter une entrée dans `src/algorithms/registry.js`,
l'interface construit ses contrôles automatiquement.

## Détection de dérive multi-canaux

Modèle vedette, calibré et validé sur données capteur réelles. Il applique le
discriminateur croisé du guide métier client :

- profondeur ↑ + **vélocité plate** + pas de pluie → **dérive capteur** (cible) ;
- profondeur ↑ + **vélocité ↓** → restriction aval ;
- profondeur ↑ + **vélocité ↑** (+ pluie) → événement pluvieux / hydraulique ;
- profondeur/vélocité trop faibles (< 50 mm / < 0,2 m/s) → bruit BMR ignoré ;
- valeurs constantes → panne (flat-line).

Affichage : fenêtres d'épisodes colorées par type, vélocité superposée, lignes
d'onset, et une table de diagnostic expliquant chaque épisode en clair. Voir
`docs/METIER_DERIVE.md`.

## Structure

```
index.html, styles.css       page + thème clair/sombre
src/
  app.js       orchestration UI (rendus anomaly / forecast / drift)
  csv.js       parseur multi-canaux (DFINAL + vélocité + pluie)
  charts.js    graphiques SVG interactifs (zoom/pan, fenêtres ombrées, marqueurs)
  worker.js    exécution hors thread principal
  algorithms/
    registry.js       catalogue des modèles (point d'extension)
    zscore.js, isolationForest.js, linalg.js
    cusum.js          dérive CUSUM
    baseline.js       profil diurne partagé (désaisonnalisation)
    forecast.js       k-NN + MLP + backtest
    canari.js         Kalman niveau/tendance
    multichannel.js   dérive profondeur + vélocité + pluie
tests/         parité Python, e2e Playwright, banc de validation dérive
docs/          contexte projet, métier, leçons, déploiement (handoff)
```

## Développement local

```bash
python3 -m http.server 8123   # puis http://localhost:8123
```

## Tests

```bash
# Banc de validation dérive (nécessite un export CSV réel dans tests/, privé) :
python3 tests/make_synthetics.py && node tests/eval_drift.mjs   # 10/10 attendu

# Parité JS ↔ Python (modèles d'anomalies) :
python3 tests/make_fixture.py && node tests/parity.test.mjs

# Bout-en-bout navigateur :
python3 -m http.server 8123 & node tests/e2e.mjs sample.csv
```

## Déploiement

Un push sur `main` déclenche `.github/workflows/deploy.yml` qui publie sur
GitHub Pages → https://boumeshal-mob.github.io/predict2/. Le déploiement
automatique Vercel est désactivé (`vercel.json`). Détails et checklist :
`docs/DEPLOIEMENT_TESTS.md`.

## Documentation

Le dossier `docs/` contient le contexte complet du projet (reprise de session) :
`CONTEXTE_PROJET.md`, `METIER_DERIVE.md`, `LECONS_TECHNIQUES.md`,
`DEPLOIEMENT_TESTS.md`.
