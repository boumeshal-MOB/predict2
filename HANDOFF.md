# Contexte de reprise — Projet « Predict 2 »

> **À lire par l'assistant de la nouvelle session.** Ce fichier résume un travail
> déjà réalisé dans une session précédente. Le code complet est fourni à part
> dans **`predict2.tar.gz`** (repo git avec historique, branche `main`).

---

## 1. Objectif du projet

Créer une **app web simple** de **détection d'anomalies** (puis, plus tard, de
**prédiction**) sur des séries temporelles. Comportement validé avec
l'utilisateur :

1. L'utilisateur **upload un CSV** depuis l'app.
2. Il **choisit un modèle** parmi plusieurs (on démarre avec 2 modèles).
3. Il **ajuste les paramètres** du modèle choisi.
4. Il **lance la détection** lui-même (bouton).
5. L'app **affiche** : la série + les anomalies détectées **et** une version
   « nettoyée » (anomalies retirées par interpolation).
6. Le traitement porte **uniquement sur la colonne `DFINAL`** (les autres
   colonnes sont ignorées).

### Décision d'architecture (validée)
**App 100 % côté navigateur, hébergée sur GitHub Pages.** L'algorithme tourne
dans le navigateur de l'utilisateur (Web Worker) → **aucun serveur, aucun coût,
aucun token consommé, aucune donnée envoyée**. Les 2 algos Python du projet
précédent (repo `predic`) ont été **portés en JavaScript**.

### Périmètre v1 (validé)
- **v1 = détection d'anomalies** (les 2 modèles ci-dessous) + série nettoyée.
- **Prédiction/forecast = plus tard**, comme modèle supplémentaire (l'archi est
  déjà prête, voir le registry).

---

## 2. État actuel : TERMINÉ et TESTÉ

Tout est fait, testé, et commité dans `predict2.tar.gz`. Il **ne reste qu'à
pousser** vers le repo `predict2` et activer GitHub Pages.

**Pourquoi une nouvelle session ?** La session précédente était scopée au repo
`predic` uniquement ; son proxy git renvoyait **403** sur `predict2` et ne se
met pas à jour à chaud. L'app Claude a désormais accès à `predict2`, donc **cette
nouvelle session (scopée `predict2`) doit pouvoir pousser**.

### ⚡ Première action à faire dans cette session
```bash
tar xzf predict2.tar.gz && cd predict2
git remote add origin https://github.com/boumeshal-MOB/predict2.git
git push -u origin main
```
Si le push réussit : indiquer à l'utilisateur d'activer **Settings → Pages →
Source : GitHub Actions** (le workflow `.github/workflows/deploy.yml` déploie
alors automatiquement). URL attendue : **https://boumeshal-mob.github.io/predict2/**
Si le push renvoie encore 403 : le périmètre de la session n'inclut pas
`predict2` → le signaler à l'utilisateur (il faut recréer la session avec
`predict2` dans le scope).

---

## 3. Format exact du CSV cible (important)

Fichier exporté réel de l'utilisateur (validé avec le parseur) :

```
"2725_225F0096","Average=None","QualityFlag=FALSE","QualityValue=FALSE"   <- métadonnées (ligne 1)
"DateTime","MP1\DFINAL","MP1\RAIN","MP1\VFINAL","MP1\RAINI_UK"            <- EN-TÊTE (ligne 2)
"dd/MM/yyyy HH:mm:ss","mm","mm","m/s","mm/hr"                             <- ligne d'unités (ligne 3)
04/04/2026 00:00:00,57.326,,0.5743459,                                   <- données (ligne 4+)
...
```

Particularités gérées par `src/csv.js` :
- **En-tête PAS en ligne 1** : détecté comme la 1ʳᵉ ligne contenant « dfinal ».
- **Colonne cible = `MP1\DFINAL`** : matchée par **sous-chaîne** « dfinal »
  (préfixe appareil toléré).
- **Ligne d'unités** juste après l'en-tête : ignorée automatiquement (valeur
  non numérique).
- **Séparateur** `,` et **dates européennes `dd/MM/yyyy`** (parsées avant
  `new Date()` pour éviter l'interprétation US MM/DD).
- Colonne temps `DateTime` utilisée pour l'axe X ; sinon index de ligne.

⚠️ **Le vrai fichier capteur de l'utilisateur n'est PAS dans le paquet**
(exclu volontairement — ses données restent privées).

---

## 4. Les 2 modèles (portés du Python, parité vérifiée)

| Modèle | Paramètres (défaut) | Parité vs Python |
|--------|--------------------|------------------|
| **Z-Score robuste** (tendance polynomiale + MAD) | `degree`=2, `threshold`=1.7 | **Exacte** (mêmes 9/9 anomalies sur le jeu de test) |
| **Isolation Forest** | `contamination`=0.03, `n_estimators`=100 | Behaviorale (attrape toutes les anomalies injectées ; RNG sklearn non reproductible en JS → seuil par fraction de contamination) |

Détails d'implémentation clés :
- Z-Score : `polyfit` maison (moindres carrés, x standardisé pour la stabilité
  numérique — résultats identiques à `numpy.polyfit` sur les valeurs ajustées).
- Isolation Forest : sous-échantillon 256, `c(n)` comme sklearn, PRNG déterministe
  (mulberry32) pour des résultats reproductibles ; seuil = top `contamination`.

---

## 5. Structure du projet

```
index.html            page principale
styles.css            thème clair/sombre (palette dataviz validée : bleu #2a78d6, rouge critique #d03b3b)
src/
  app.js              orchestration UI (upload, params, run, rendu)
  csv.js              parseur CSV robuste (voir §3) — extrait DFINAL
  charts.js           graphiques SVG + crosshair/tooltip ; cleanSeries() = interpolation
  worker.js           exécution de la détection hors thread principal (module worker)
  algorithms/
    registry.js       CATALOGUE des modèles (params + bornes UI) — POINT D'EXTENSION
    zscore.js         Z-Score robuste (MAD)
    isolationForest.js Isolation Forest
    linalg.js         polyfit moindres carrés
tests/
  make_fixture.py     lance les algos Python de référence (repo predic) -> fixture.json
  parity.test.mjs     compare JS <-> Python (node tests/parity.test.mjs)
  e2e.mjs             test navigateur Playwright (upload CSV, run, screenshot)
.github/workflows/deploy.yml   déploiement GitHub Pages (déclenché sur push main)
```

### Tests
```bash
# Parité JS <-> Python (nécessite numpy/pandas/sklearn + le repo predic à côté) :
python3 tests/make_fixture.py && node tests/parity.test.mjs   # -> ALL PASS

# E2E navigateur (Playwright global installé dans /opt/node22) :
python3 -m http.server 8123 &   # servir la racine
node tests/e2e.mjs sample.csv   # ou un autre CSV
```
> Note : `parity.test.mjs` charge `tests/fixture.json` généré par `make_fixture.py`,
> qui importe les algos Python depuis le repo `predic`. Si `predic` n'est pas
> disponible dans la nouvelle session, la parité a déjà été validée — ce n'est
> pas bloquant pour publier.

---

## 6. Prochaine étape prévue (après mise en ligne) : la PRÉDICTION

L'utilisateur veut ensuite ajouter des **modèles de prédiction/forecast**.
L'architecture est prête : **ajouter un modèle = ajouter une entrée dans
`src/algorithms/registry.js`** (déclarer `id`, `label`, `kind`, `params` avec
bornes UI, et une fonction `run`). L'UI construit automatiquement les contrôles.
Pour un forecast, prévoir aussi l'affichage de la projection future sur le
graphique (à discuter avec l'utilisateur : type de modèle, horizon N points).

---

## 7. Ton / langue
L'utilisateur communique en **français**. Rester concret et efficace : il veut
« lancer l'application via une URL » avec un minimum d'actions de sa part.

---

## Résumé en une phrase
**App de détection d'anomalies 100 % navigateur, terminée et testée (dans
`predict2.tar.gz`), à pousser sur le repo `predict2` puis publier via GitHub
Pages ; prochaine évolution = ajouter un modèle de prédiction via le registry.**
