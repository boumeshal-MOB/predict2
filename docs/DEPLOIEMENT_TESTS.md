# Déploiement & tests — mode d'emploi

## Lancer l'app en local

```bash
cd predict2
python3 -m http.server 8123     # servir la racine (modules ES → pas de file://)
# → http://localhost:8123/index.html
```

## Déploiement

### GitHub Pages (production)
- `git push origin main` → `.github/workflows/deploy.yml` déploie
  automatiquement → https://boumeshal-mob.github.io/predict2/
- Vérifier le run :
  `GET /repos/boumeshal-MOB/predict2/actions/workflows/deploy.yml/runs?branch=main&per_page=1`
  (token `GITHUB_TOKEN` dispo dans l'env des sessions).
- Échec « Deployment failed, try again later » = transitoire côté GitHub :
  re-déclencher (`workflow_dispatch`), éventuellement après 15-20 min.
- Première activation de Pages : manuelle (Settings → Pages → Source :
  GitHub Actions) — déjà faite sur ce repo.

### Vercel (en pause)
- Projet `predict2` (team « Mouaad's projects »), domaine `predict2-tau.vercel.app`,
  connecté au repo. **Auto-deploy désactivé** par `vercel.json` :
  ```json
  { "git": { "deploymentEnabled": { "main": false } } }
  ```
  Réactiver = passer à `true` (ou supprimer le fichier) et pousser.

## Tests

### 1. Banc de validation dérive (le plus important)
Nécessite un CSV réel dans `tests/real_avril.csv` (privé, non versionné —
le demander à l'utilisateur ; n'importe quel export 7 j au pas 2 min convient).

```bash
python3 tests/make_synthetics.py     # génère tests/synth_{drift,restriction,flatline}.csv
node tests/eval_drift.mjs            # 10 contrôles PASS/FAIL — exiger 10/10
```

Scénarios : dérive rampe +0,4 mm/h (doit être détectée, onset ±48 h),
restriction profondeur +40 %/vélocité −60 % (classée restriction, pas dérive),
flat-line 12 h (panne), fichiers réels (zéro fausse dérive), perfs < 500 ms.

### 2. Parité Python (modèles historiques zscore/isolation forest)
```bash
python3 tests/make_fixture.py && node tests/parity.test.mjs   # nécessite le repo `predic` à côté
```
Déjà validée ; non bloquant si `predic` absent.

### 3. E2E navigateur
```bash
python3 -m http.server 8123 &
node tests/e2e.mjs sample.csv
```
Playwright global : `/opt/node22/lib/node_modules/playwright`, Chromium dans
`/opt/pw-browsers` (ne pas lancer `playwright install`).

Pour un test ad hoc d'un modèle dans le navigateur, s'inspirer de
`tests/e2e.mjs` : `setInputFiles("#file", …)`, `selectOption("#model", id)`,
`click("#run")`, attendre que le bouton redevienne « Lancer l'analyse », lire
`#stats .stat`, `#anomaly-table tr`, les `rect.win` / `circle.marker` /
`line.drift-line` du SVG. Toujours écouter `pageerror` et exiger zéro erreur.

### Checklist avant push
1. `node --check` sur chaque fichier JS touché.
2. Banc dérive 10/10 (si les CSV réels sont disponibles).
3. E2E rapide : les 3 kinds de rendu (anomaly, forecast, drift) + bascules
   entre modèles sans fuite d'état, zéro erreur console.
4. Commit en français décrivant le POURQUOI, push sur `main`, vérifier la
   conclusion du run Pages via l'API.

## Historique des jalons (git log les détaille)

1. v1 : détection d'anomalies (Z-Score + Isolation Forest), parité Python.
2. Graphiques interactifs (zoom/pan/reset, échelle Y, reset données).
3. Prévision k-NN + MLP (+ backtest jour J), fusion PR #2 avec conflits.
4. Canari (Kalman niveau+tendance) : dérive + prévision.
5. Calibration sur données réelles 2 min (CUSUM onset-only, stride k-NN/MLP…).
6. Séparation dérive/anomalies, dérives en lignes verticales.
7. **Dérive multi-canaux** (guide métier) + fenêtres ombrées + diagnostic +
   banc de validation 10/10.
8. Prévision sur résidus désaisonnalisés (backtest suit le cycle).
