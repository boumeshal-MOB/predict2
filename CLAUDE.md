# CLAUDE.md — consignes pour l'assistant

> Les règles complètes (conventions, tests, déploiement, journal) sont dans
> **`AGENTS.md`** (source unique, partagée avec Codex). Ce fichier n'en garde
> que l'essentiel pour Claude Code — en cas de doute, `AGENTS.md` fait foi.

App statique d'analyse de séries capteur (anomalies, dérive, prévision), JS pur,
zéro dépendance, UI en français. Prod : GitHub Pages (push `main` → déploie).

## Au démarrage
Lire `docs/CONTEXTE_PROJET.md` (architecture, modèles, format CSV), puis
`docs/APPRENTISSAGE_CONTINU.md` (état courant, dettes, backlog, questions
ouvertes). Pour le métier dérive : `docs/METIER_DERIVE.md`. Pièges connus :
`docs/LECONS_TECHNIQUES.md`. Déploiement/tests : `docs/DEPLOIEMENT_TESTS.md`.

## En travaillant
- Un modèle = une entrée dans `src/algorithms/registry.js` (l'UI se construit
  seule). Chaque paramètre exposé doit avoir un `help` + un conseil d'usage.
- Ne pas mélanger les responsabilités : anomalies (Z-Score/IF) ≠ dérive
  (multichannel, Canari, CUSUM) ≠ prévision (forecast).
- `node --check` sur chaque fichier JS touché ; tester en navigateur (Playwright)
  et via `node tests/eval_drift.mjs` (exiger 10/10) avant de pousser.
- Données capteur réelles = privées, jamais commitées (`.gitignore`).

## À la fin d'une session substantielle (obligatoire)
Mettre à jour `docs/APPRENTISSAGE_CONTINU.md` : nouvelle entrée datée dans le
Journal + rafraîchir « État vivant » + backlog. Consigner aussi les régressions.
Puis commit (message en français, le POURQUOI) et push sur `main`.
