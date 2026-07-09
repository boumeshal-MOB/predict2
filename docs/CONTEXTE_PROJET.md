# Predict 2 — Contexte projet (handoff)

> Document de reprise pour une nouvelle session d'assistant IA (tout compte,
> tout modèle). Lire ce fichier en premier, puis `METIER_DERIVE.md`,
> `LECONS_TECHNIQUES.md` et `DEPLOIEMENT_TESTS.md`.

## Ce qu'est l'application

App web **100 % navigateur** (JS pur, zéro dépendance, zéro serveur) d'analyse
de séries temporelles de capteurs de débit en réseau d'assainissement :
détection d'anomalies, **détection de dérive capteur** (l'objectif principal du
client) et prévision. L'utilisateur uploade un CSV exporté de son système de
télémétrie, choisit un modèle, ajuste les paramètres, lance l'analyse.

- **Repo** : `boumeshal-MOB/predict2`, branche `main` uniquement.
- **Prod** : https://boumeshal-mob.github.io/predict2/ (GitHub Pages, déploiement
  auto à chaque push via `.github/workflows/deploy.yml`).
- **Vercel** : projet existant (`predict2-tau.vercel.app`) mais **auto-deploy
  désactivé** via `vercel.json` (`git.deploymentEnabled.main=false`) à la
  demande de l'utilisateur. Réactivable en repassant à `true`.
- **Langue** : utilisateur francophone. UI et textes d'aide en français,
  commentaires code en anglais sobre.

## Format des CSV de l'utilisateur

```
"2725_225F0096","Average=None","QualityFlag=FALSE","QualityValue=FALSE"   <- métadonnées
"DateTime","MP1\DFINAL","MP1\RAIN","MP1\VFINAL","MP1\RAINI_UK"            <- EN-TÊTE (ligne 2)
"dd/MM/yyyy HH:mm:ss","mm","mm","m/s","mm/hr"                             <- unités (ignorée)
04/04/2026 00:00:00,57.326,,0.5743459,                                    <- données
```

- Pas de mesure : **2 minutes** (720 points/jour). Fichiers typiques : 7 jours
  = 5 040 points, mais aussi ~3 mois.
- `DFINAL` = profondeur (mm), `VFINAL` = vélocité (m/s), `RAIN`/`RAINI_UK` =
  pluie — **souvent vides** dans les exports actuels.
- Dates **européennes** dd/MM/yyyy (parser avant `new Date()` !).
- Le parseur (`src/csv.js`) détecte l'en-tête par sous-chaîne « dfinal »,
  détecte vélocité (« vfinal »→« peakvel »→« vel ») et pluie
  (« raini_uk »→« rain ») automatiquement ; rétro-compatible mono-canal.
- Les vrais fichiers capteur sont **privés** : jamais commités
  (`.gitignore` : `tests/real*.csv`). Les redemander à l'utilisateur.

## Les modèles (src/algorithms/registry.js = point d'extension unique)

| id | kind | Rôle |
|---|---|---|
| `zscore` | anomaly | Pics/aberrations ponctuelles (tendance polynomiale + MAD). Parité vérifiée avec le Python du repo `predic` d'origine. Sert aussi de nettoyeur pour les autres modèles (`cleanWithZScore`). |
| `isolation_forest` | anomaly | Alternative pics (portage sklearn, PRNG déterministe). |
| `cusum_drift` | anomaly | Glissement de niveau mono-canal (somme cumulée sur résidus désaisonnalisés, alarme au début d'excursion seulement). |
| `canari` | forecast | Espace d'état bayésien (niveau+tendance, Kalman) inspiré de Bayes-Works/canari (partie LSTM/TAGI omise). Ligne de niveau + départs de dérive (lignes verticales) + prévision. Tourne sur série nettoyée Z-Score et désaisonnalisée. |
| `knn_forecast` / `mlp_forecast` | forecast | Prévision par analogues / petit réseau de neurones. Apprennent sur **résidus désaisonnalisés** (profil diurne retiré puis ré-ajouté) — indispensable, voir leçons. |
| `gbdt_forecast` | forecast | Arbres boostés histogramme (façon LightGBM, maison). Features calendrier + lags + MA 1 h ; **meilleure RMSE backtest mesurée** (8,2 vs 21 MLP / 13 k-NN sur juin). |
| `skf_canari` | drift | Switching Kalman Filter (port de l'exemple `anomaly_detection` officiel de Canari) : courbe **Pr(anormal)** + fenêtres de transition jaunes. Mono-canal : détecte les **transitions**, pas la dérive soutenue (le mélange IMM « surfe » les rampes) — renvoie vers le multi-canaux pour l'attribution. |
| `multichannel_drift` | drift | **LE modèle vedette** — discriminateur croisé profondeur/vélocité/pluie du guide métier. Voir `METIER_DERIVE.md`. |

Ajouter un modèle = ajouter une entrée dans le registry (`id`, `label`, `kind`,
`description`, `tips[]`, `params[]` avec bornes/défauts/help, `run(series,
params)`). L'UI construit tout automatiquement. `default: "auto_day"` sur un
param int = résolu à « une journée de points » au chargement du fichier.
Types de paramètres UI : numériques (slider + champ), et `type: "choice"`
(présélection simple dont `options[].map` fixe plusieurs paramètres numériques
d'un coup). `advanced: true` = replié sous « Réglages avancés » ; toute édition
avancée bascule la présélection sur « Personnalisé ».

Le parseur (`src/csv.js`) **auto-détecte les unités** (mm / mètres / pieds via
les médianes brutes) et normalise tout en interne (mm, m/s) — piège classique :
un export en pieds aurait sinon tout masqué en BMR (< 50 mm). Forçable par
`parseCsv(text, { forceUnits })` (sélecteur UI sous le méta fichier). Les codes
qualité analyste (`DepthQualityCode`/`VelocityQualityCode` — a=bon, b=médiocre,
c=ensablement/ragging, n=panne) sont portés par point (`p.dq`/`p.vq`) et les
points b/c/n interpolés par `cleanWithZScore`.

## Structure

```
index.html, styles.css          page + thème clair/sombre (tokens CSS)
src/
  app.js         orchestration UI : upload, params, run, 3 rendus (anomaly/forecast/drift)
  csv.js         parseur multi-canaux robuste
  charts.js      graphiques SVG maison interactifs : zoom X (molette), zoom Y (Maj+molette),
                 pan (glisser), reset (double-clic), fenêtres ombrées, marqueurs, toggles
  worker.js      exécution hors thread (module worker), fallback main-thread
  algorithms/    registry.js + un fichier par modèle + baseline.js (profil diurne partagé)
tests/           make_fixture.py + parity.test.mjs (parité Python), e2e.mjs (Playwright),
                 make_synthetics.py + eval_drift.mjs (banc de validation dérive)
docs/            ces fichiers de handoff
.github/workflows/deploy.yml    GitHub Pages (enablement: true)
vercel.json      auto-deploy Vercel désactivé
```

## Kinds de rendu (app.js)

- `anomaly` : graphe principal + points rouges + graphe « origine vs nettoyée » + table des anomalies.
- `forecast` : graphe historique + graphe bas (origine, ajustée/niveau, prévision J+1 jaune #eab308, backtest jour J magenta #c026d3, dérive Canari = lignes verticales violettes), toggles par série, pas de table.
- `drift` : graphe historique + graphe bas avec **fenêtres ombrées par type**
  (drift rouge, restriction orange, hydraulic/rain bleu, excursion violet clair,
  transition jaune, fault gris), vélocité normalisée orange #f97316, profil
  diurne vert, lignes d'onset violettes, **table de diagnostic** (badge type,
  début, fin, durée, explication en français). Si le résultat porte
  `prAbnormal[]` (SKF), une courbe rouge pointillée #dc2626 est superposée,
  remise à l'échelle de la profondeur (bas = 0 %, haut = 100 %), et les stats
  affichent transitions / Pr max / points tagués.

## Multilingue (src/i18n.js)

Interface FR/EN/IT/ES, sélecteur en haut à droite (mémorisé `localStorage`).
`src/i18n.js` est **sans DOM** (le Web Worker l'importe aussi) : dictionnaires
UI (`t(key, vars)`), `unitLabel`, `localizeModel(model, lang)` (surcouche des
`label`/`description`/`tips`/`params` du registry — le **français reste la
source**, EN/IT/ES sont des surcouches), et `am(lang)` qui produit les messages
d'algorithme (raisons d'épisodes, warnings) avec formatage nombre/durée localisé.
Les modèles reçoivent la langue via `params.lang` (ajouté au payload worker) ;
c'est pourquoi changer de langue avec un résultat affiché **relance l'analyse**
(les raisons sont générées côté worker). Chrome statique = attributs
`data-i18n` / `data-i18n-html` / `data-i18n-title` dans `index.html`, appliqués
par `applyStaticUi()`. Ajouter une chaîne = l'ajouter aux 4 langues du bon
dictionnaire (UI, `MODEL_I18N`, ou `ALGO`).

## Attentes de l'utilisateur (récurrentes)

- Tester soi-même avant de publier (Playwright + banc `eval_drift`), publier
  sur GitHub Pages après chaque évolution validée, être économe en tokens.
- Séparation des responsabilités voulue : anomalies = Z-Score/IF ; dérive =
  multichannel (et Canari) ; prévision = forecast. Ne pas re-mélanger.
- Chaque paramètre exposé doit avoir une explication + conseil d'usage.
