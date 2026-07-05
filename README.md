# Predict 2 — Détection d'anomalies dans le navigateur

Application web **100 % statique** pour détecter des anomalies dans une série
temporelle. L'utilisateur pilote tout depuis l'interface :

1. **Charge un CSV** (glisser-déposer ou sélection).
2. **Choisit un modèle** et **ajuste ses paramètres**.
3. **Lance la détection** — le calcul tourne dans le navigateur (Web Worker),
   pas sur un serveur.
4. **Visualise** la série avec les anomalies mises en évidence, la série
   « nettoyée » (anomalies retirées par interpolation) et le détail des points.

> Seule la colonne **`DFINAL`** est analysée. Les autres colonnes sont ignorées.
> Une colonne temporelle (`timestamp`, `date`, `datetime`, `horodatage`…) est
> utilisée pour l'axe si elle existe, sinon l'index de ligne. Le séparateur
> (`;`, `,`, tabulation) et les décimales à virgule sont détectés automatiquement.

## Pourquoi côté navigateur ?

- **Aucun serveur, aucun coût, aucune donnée envoyée** : le CSV ne quitte jamais
  la machine de l'utilisateur.
- **Hébergement gratuit** sur GitHub Pages (site statique).
- Le calcul ne consomme **aucune ressource externe**.

## Modèles disponibles

| Modèle | Paramètres | Principe |
|--------|-----------|----------|
| **Z-Score robuste** | `degree`, `threshold` | Tendance polynomiale retirée, puis z-score robuste (MAD) sur les résidus. |
| **Isolation Forest** | `contamination`, `n_estimators` | Forêt d'arbres d'isolation ; les points faciles à isoler sont marqués. |
| **Prévision k-NN** | `horizon`, `window_size`, `neighbors` | Recherche les fenêtres historiques similaires et moyenne leurs suites futures. |
| **Prévision IA — MLP** | `horizon`, `window_size`, `hidden_units`, `epochs`, `learning_rate` | Réseau neuronal auto-régressif entraîné localement dans le navigateur. |

Les modèles d'anomalies sont des portages JavaScript des algorithmes Python du projet
`Predic`, avec **parité numérique vérifiée** (voir `tests/`). Les modèles de
prévision sont écrits en JavaScript pur et s'exécutent aussi localement, sans
dépendance externe. Le forecast est entraîné sur une série automatiquement
nettoyée des mesures aberrantes et affiche aussi un backtest sur le dernier jour
mesurable pour comparer prévision et réel. L'architecture reste extensible : ajouter un modèle se fait
en ajoutant une entrée dans `src/algorithms/registry.js` — l'interface construit
automatiquement ses contrôles.

## Structure

```
index.html            page principale
styles.css            thème clair/sombre (palette dataviz validée)
src/
  app.js              orchestration UI
  csv.js              parseur CSV robuste (extrait DFINAL)
  charts.js           graphiques SVG + crosshair/tooltip, nettoyage de série
  worker.js           exécution de la détection hors thread principal
  algorithms/
    registry.js       catalogue des modèles (params + bornes UI)
    zscore.js         Z-Score robuste (MAD)
    isolationForest.js Isolation Forest
    linalg.js         ajustement polynomial (moindres carrés)
tests/
  make_fixture.py     lance les algos Python de référence
  parity.test.mjs     compare JS ↔ Python
  e2e.mjs             test bout-en-bout (Playwright)
```

## Développement local

```bash
python3 -m http.server 8123   # puis ouvrir http://localhost:8123
```

## Tests

```bash
python3 tests/make_fixture.py   # génère la référence Python
node tests/parity.test.mjs      # vérifie la parité JS ↔ Python
```

## Déploiement

Un push sur `main` déclenche le workflow `.github/workflows/deploy.yml` qui
publie le site sur GitHub Pages. Activer une fois : **Settings → Pages →
Source : GitHub Actions**.
