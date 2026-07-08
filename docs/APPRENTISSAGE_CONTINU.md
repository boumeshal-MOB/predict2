# Apprentissage continu — Predict 2

> Journal vivant à **mettre à jour à la fin de chaque session de travail
> substantielle**, par n'importe quel assistant (tout compte, tout modèle).
> C'est la mémoire longue du projet : ce qui marche, ce qui a raté, ce qui
> reste à faire. Le lire au démarrage, l'enrichir à la sortie.

## Protocole de mise à jour (à respecter)

1. **À la fin d'une session** ayant changé le code ou la compréhension :
   ajouter une entrée datée en haut du **Journal** (plus récent en premier).
2. **Écraser** la section « État vivant » avec les chiffres/décisions courants
   (perfs, calibrations, dettes). Elle doit toujours refléter `main`.
3. Déplacer du **Backlog** vers le Journal ce qui a été fait ; ajouter les
   idées nouvelles ; re-prioriser.
4. Format d'entrée : **Contexte / Changé / Appris / Décidé / À suivre**.
   Court, concret, chiffré.
5. **Rester honnête** : consigner régressions, faux positifs, impasses. Un
   échec documenté vaut mieux qu'un succès vague.
6. Ne jamais mettre de données capteur réelles ici (privées).

---

## État vivant (refléter `main` — écraser à chaque MàJ)

### Perfs de référence (mesurées sur exports réels, pas 2 min, ~5 040 pts)
- **Dérive multi-canaux** : banc `tests/eval_drift.mjs` = **10/10**, < 30 ms.
  Zéro fausse dérive sur juin/avril (crues jusqu'à 767 mm). Dérive injectée
  +0,4 mm/h détectée à +39 h de l'onset.
- **Canari** — RMSE backtest jour J : juin ≈ **15,8 mm** (était 8,2 avant
  désaisonnalisation → **régression à investiguer**), RMSE ajustement ≈ 1,5.
- **MLP / k-NN** — RMSE backtest : juin ≈ 21 / 13, avril ≈ 15 / 10 (après
  désaisonnalisation ; la prévision suit désormais le cycle journalier).
- Anomalies (défauts) : Z-Score ≈ 2,9 % / IF ≈ 1 % sur juin.

### Calibrations en vigueur (défauts registry)
- Z-Score seuil |z| = 3,5 · Isolation Forest contamination = 0,01.
- CUSUM : fenêtre réf = 1 jour (auto), k = 1 σ, h = 8 σ, alarme au début
  d'excursion seulement.
- Multi-canaux : `drift_k` 0,75 · `drift_h` 120 · `min_duration_hours` 6 ·
  `drift_min_days` 5 · `vel_neutral_pct` 15 · `event_vel_pct` 35 ·
  BMR 50 mm / 0,2 m/s · `rain_lag_min` 120. Bornes vélocité élargies à
  max(plancher, k·σ du site).
- Nettoyage amont commun : Z-Score degré 2 / seuil 3 (`cleanWithZScore`).
- Désaisonnalisation (profil diurne médian) avant : multichannel, Canari,
  CUSUM, k-NN, MLP.

### Limites connues / dettes
- **Colonnes pluie vides** dans les exports actuels → événements classés
  « hydrauliques » faute de confirmation pluie (warning affiché).
- **Un seul canal profondeur** (DFINAL) : pas de croisement PDEPTH/SDEPTH, qui
  est pourtant LE signal d'alerte précoce du guide.
- **Régression RMSE Canari** après désaisonnalisation (voir Backlog).
- **Latence d'onset** ~2 j sur rampe faible (0,4 mm/h dans σ≈10 mm) — normal
  statistiquement, mais à documenter côté utilisateur.
- Pas de gestion : bascule d'entité (DFINAL PDEPTH↔SDEPTH), flux inverse
  (vélocité négative), sites wet-well/storm-tank, calendrier (semaine/férié).

---

## Backlog priorisé (idées d'amélioration)

1. **Investiguer la régression RMSE Canari** liée à la désaisonnalisation
   (profil trop lissé ? ré-ajout futur mal aligné ?). Comparer avec/sans.
2. **Croisement PDEPTH − SDEPTH** (divergence inter-entités) : early-warning
   n°1 du guide. Nécessite des exports avec ces colonnes → demander à l'user.
3. **Exploiter la pluie** réellement (résidus conditionnés à la pluie laggée)
   dès qu'un export avec pluie non vide est fourni.
4. **Continuité QFinal** (débit ≈ constant sur une restriction) comme 2ᵉ
   discriminateur restriction/dérive, si le débit est disponible.
5. **Features calendaires** (jour de semaine, fériés) : le profil diurne
   actuel sépare déjà semaine/week-end si ≥ 10 jours, mais pas les fériés.
6. **Sous-modèles par type de site** (wet-well, storm-tank) ou conditionnement
   fort — amplitudes normales très différentes.
7. **Flux inverse** : préserver le signe de la vélocité (négatif = réel).
8. **LSTM / deep learning** (TensorFlow.js) — reporté : casse le zéro-dépendance
   et lourd en navigateur. À reconsidérer seulement si demande explicite.
9. **Labels supervisés** : si des fiches de calibration (dates de recalibration)
   sont fournies, évaluer précision/rappel réels au lieu du banc synthétique.

---

## Questions ouvertes (à confirmer avec l'utilisateur)

- Quels sites disposent de **plusieurs entités de profondeur** (PDEPTH + SDEPTH)
  et/ou d'une **pluie renseignée** ? (débloque backlog 2 et 3).
- Existe-t-il des **fiches de calibration horodatées** utilisables comme labels ?
- Le débit **QFinal** est-il exportable par site ? (backlog 4).

---

## Journal (append-only — plus récent en haut)

### 2026-07-08 — Prévision désaisonnalisée + docs de handoff + banc versionné
- **Contexte** : sur ~3 mois réels, la prévision MLP/k-NN zigzaguait et le
  backtest était plat (fenêtre ≪ 24 h → cycle diurne invisible).
- **Changé** : k-NN et MLP apprennent les résidus désaisonnalisés (profil diurne
  retiré puis ré-ajouté), comme Canari. Ajout de `docs/` (contexte, métier,
  leçons, déploiement) et du banc versionné `tests/make_synthetics.py` +
  `tests/eval_drift.mjs`. README remis à jour. Création de ce journal.
- **Appris** : désaisonnaliser est non négociable pour tout modèle à fenêtre
  courte. Un banc reproductible dérivé des données réelles vaut de l'or.
- **Décidé** : le modèle multi-canaux est la référence dérive ; Canari/CUSUM
  restent complémentaires.
- **À suivre** : régression RMSE Canari (backlog 1) ; obtenir un export avec
  pluie et/ou PDEPTH+SDEPTH.

### 2026-07-07 — Dérive multi-canaux (modèle métier) + calibration réelle
- **Contexte** : intégration du guide client (discriminateur profondeur/
  vélocité/pluie) ; premiers vrais fichiers capteur reçus.
- **Changé** : parseur multi-canaux, `baseline.js` (profil diurne),
  `multichannel.js` (CUSUM + masques + épisodes), fenêtres ombrées + table de
  diagnostic. Recalage CUSUM/Canari sur résidus. Banc 10/10.
- **Appris** : empreinte de référence en 2 passes (exclure les confounds) ;
  règle de réversion (une dérive ne se corrige pas seule) ; restriction = saut
  co-temporel, dérive = rampe ; bornes vélocité adaptatives au site (±30 %
  jour-à-jour). Corrigé un O(n²) caché (6,8 s → 12 ms).
- **Décidé** : anomalies / dérive / prévision restent des responsabilités
  séparées.
- **À suivre** : pluie vide → distinction pluie/hydraulique en attente.

_(Sessions antérieures : anomalies v1 → graphiques interactifs → prévision
k-NN/MLP → Canari → séparation dérive/anomalies. Détail dans `git log` et
`docs/DEPLOIEMENT_TESTS.md`.)_
