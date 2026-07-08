# AGENTS.md — consignes pour agent (Codex & autres)

Ce fichier est lu **automatiquement** par Codex (et les agents compatibles
`AGENTS.md`) à l'ouverture du dépôt. Il n'y a **rien à faire côté utilisateur** :
donne simplement à l'agent l'accès en écriture au repo `boumeshal-MOB/predict2`,
il applique ce qui suit. Le jumeau pour Claude Code est `CLAUDE.md` (mêmes règles).

Predict 2 = app web **100 % statique** (JS pur, **zéro dépendance**, zéro
serveur) d'analyse de séries de capteurs de débit : anomalies, **dérive
capteur** (objectif métier), prévision. UI et textes en **français**,
commentaires de code en anglais sobre.

## 1. Au démarrage — lire les docs (obligatoire)
1. `docs/CONTEXTE_PROJET.md` — architecture, modèles, format CSV, attentes.
2. `docs/APPRENTISSAGE_CONTINU.md` — **état courant, dettes, backlog, questions
   ouvertes** : c'est la mémoire longue, la lire avant de décider quoi faire.
3. `docs/METIER_DERIVE.md` — le métier (discriminateur profondeur/vélocité/pluie).
4. `docs/LECONS_TECHNIQUES.md` — pièges déjà rencontrés (ne pas les refaire).
5. `docs/DEPLOIEMENT_TESTS.md` — procédure détaillée.

## 2. Conventions de code
- Un modèle = une entrée dans `src/algorithms/registry.js` ; l'UI construit ses
  contrôles automatiquement. Chaque paramètre exposé DOIT avoir un `help` clair
  + un conseil d'usage.
- **Ne jamais mélanger les responsabilités** : anomalies (`zscore`,
  `isolation_forest`) ≠ dérive (`multichannel`, `canari`, `cusum`) ≠ prévision
  (`knn_forecast`, `mlp_forecast`).
- Aucune dépendance externe, aucun CDN, aucun build. Tout tourne dans le
  navigateur / en Node pur.
- Le cycle diurne se retire avant toute détection/prévision (`baseline.js`) puis
  se ré-ajoute — respecter ce schéma pour tout nouveau modèle temporel.
- **Données capteur réelles = privées** : jamais commitées (`.gitignore` couvre
  `tests/real*.csv`, `tests/synth_*.csv`). Les redemander à l'utilisateur si
  absentes.

## 3. Tester avant de pousser (obligatoire)
```bash
# 1. Syntaxe : sur chaque fichier JS modifié/créé
node --check src/....js

# 2. Banc de validation dérive — exiger 10/10
#    (nécessite un export réel dans tests/real_avril.csv + tests/real_juin.csv)
python3 tests/make_synthetics.py && node tests/eval_drift.mjs

# 3. Navigateur (si Playwright dispo dans l'environnement) :
python3 -m http.server 8123 &
node tests/e2e.mjs sample.csv
```
Node ≥ 22 exécute l'ESM du repo sans `package.json` (scripts `.mjs` ou
`--input-type=module`). Si un outil (Playwright, http.server) manque dans le
sandbox Codex, faire au minimum `node --check` + `node tests/eval_drift.mjs`, et
le signaler dans le message de commit / le journal.

## 4. Déployer — 100 % automatique
- **Le seul geste de déploiement = pousser sur `main`.** Le workflow
  `.github/workflows/deploy.yml` publie alors sur GitHub Pages tout seul →
  https://boumeshal-mob.github.io/predict2/. Pages est **déjà activé** : aucune
  action manuelle, ni de l'agent ni de l'utilisateur.
- Vérifier le déploiement si l'outillage GitHub est dispo (ex. `gh run list
  --workflow=deploy.yml -b main`, ou l'API Actions). Sinon, se fier au push.
- **Panne connue** : l'étape `deploy-pages` échoue parfois avec « Deployment
  failed, try again later » — c'est un incident transitoire côté GitHub, PAS le
  code. Remède : relancer le workflow (`gh workflow run deploy.yml --ref main`
  ou re-push) ; parfois attendre 15-20 min. Ne pas modifier le code pour ça.
- Vercel : auto-deploy désactivé volontairement (`vercel.json`). Ne pas le
  réactiver sans demande explicite.
- Ne jamais chaîner `pkill` avec un `git commit`/`push` (le signal tue le groupe
  et le commit n'a pas lieu).

## 5. En fin de session substantielle (obligatoire)
1. Mettre à jour `docs/APPRENTISSAGE_CONTINU.md` : nouvelle entrée datée en haut
   du Journal (Contexte / Changé / Appris / Décidé / À suivre), rafraîchir
   « État vivant », re-prioriser le Backlog. Consigner aussi les régressions.
2. `git commit` avec un message **en français expliquant le POURQUOI**.
3. `git push origin main` → le déploiement se déclenche automatiquement.

## 6. Résumé du flux de travail attendu
lire docs → comprendre le besoin → coder (registry + modèle + rendu si besoin)
→ `node --check` → banc `eval_drift` 10/10 → test navigateur si possible →
journal à jour → commit (FR, le pourquoi) → push `main` → (vérifier le run Pages
si possible). L'utilisateur ne doit rien avoir à faire manuellement.
