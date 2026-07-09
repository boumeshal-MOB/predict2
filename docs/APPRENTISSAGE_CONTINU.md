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
  +0,4 mm/h détectée à +39 h de l'onset. Sur ~3 mois réels 68 400 pts
  (site à restriction confirmée analyste) : restriction détectée, ≤ 2 dérives,
  ~600 ms.
- **GBDT (arbres boostés)** — RMSE backtest jour J : juin ≈ **8,2 mm** (meilleur
  de la liste ; MLP 21, k-NN 13). 68 400 pts en ~0,9 s. Sur le site 3 mois,
  RMSE ≈ 220 : dernier jour à +43 % du niveau médian historique (sans pluie
  mesurée), la prévision récursive revient vers la climatologie apprise —
  limite honnête, pas un bug.
- **SKF Canari** — mono-canal : détecte les **transitions** de régime (bosses
  Pr(anormal)), pas la dérive soutenue (la rampe = tendance constante que le
  mélange IMM absorbe). Rampe forte +2 mm/h : transition à +8 h de l'onset,
  Pr max 98 %. Rampe faible +0,4 mm/h : indétectable mono-canal (= errance
  naturelle) — c'est le rôle du multi-canaux. ~7-10 transitions/mois sur données
  réelles (orages inclus, assumé et documenté dans l'UI).
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
- SKF : `r_floor` 4 · `pr_threshold` 0,5 · `min_duration_hours` 1 ·
  `std_transition_error` 0,0016 · `norm_to_abnorm_prob` 1e-5 ·
  `abnorm_to_norm_prob` 0,002. Entrée lissée 1 h puis re-standardisée sur
  l'empreinte 1ʳᵉ moitié ; régime NORMAL = niveau statique pur.
- GBDT : 60 arbres · profondeur 5 · cap 20 000 pts · lr 0,1 · features
  sin/cos heure + jour semaine + lags [1,2,3,10,30] + MA 1 h.
- Nettoyage amont commun : Z-Score degré 2 / seuil 3 + interpolation des
  points tagués qualité b/c/n (`cleanWithZScore`).
- **Unités** : auto-détection mm / mètres / pieds dans le parseur (médiane
  brute), normalisation interne mm + m/s, forçable via le sélecteur UI.
- **Présélections UI** : chaque modèle expose un choix simple (Sensibilité
  faible/normale/élevée ou Calcul rapide/équilibré/rigoureux) qui mappe les
  paramètres numériques ; le détail vit dans « Réglages avancés » (replié) et
  toute édition avancée bascule le choix sur « Personnalisé ».
- **Multilingue** : FR (source) + EN/IT/ES via `src/i18n.js` (sans DOM,
  importable worker). Sélecteur `#lang` mémorisé. Tout traduit (chrome, modèles,
  params, stats, diagnostics). Langue passée aux algos via `params.lang` ;
  changer de langue avec résultat affiché relance l'analyse.

### Limites connues / dettes
- **Colonnes pluie vides** dans les exports actuels → événements classés
  « hydrauliques » faute de confirmation pluie (warning affiché).
- **Un seul canal profondeur** (DFINAL) : pas de croisement PDEPTH/SDEPTH, qui
  est pourtant LE signal d'alerte précoce du guide.
- **Régression RMSE Canari** après désaisonnalisation (voir Backlog).
- **SKF mono-canal ne voit pas la dérive soutenue** (mélange IMM « surfe » la
  rampe) : positionné honnêtement comme écran de transitions + courbe
  Pr(anormal) ; l'attribution reste au multi-canaux.
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

### 2026-07-09 (bis) — Multilingue FR/EN/IT/ES + sélecteur de langue
- **Contexte** : l'app était figée en français ; demande d'une version anglais,
  italien et espagnol avec un sélecteur de langue visible.
- **Changé** : nouveau `src/i18n.js` **sans DOM** (importable par le worker) —
  dictionnaires UI (`t`), `unitLabel`, `localizeModel` (surcouche EN/IT/ES du
  registry, FR = source), `am(lang)` pour les messages d'algorithme (raisons
  d'épisodes + warnings) avec formatage nombre/durée/pourcent localisé (`Intl`).
  Les 6 algorithmes à texte (multichannel, canari, cusum, forecast, gbdt, skf)
  reçoivent `params.lang` et émettent leurs diagnostics via `am()`. `index.html`
  balisé `data-i18n`/`data-i18n-html`/`data-i18n-title` + sélecteur `#lang` dans
  la topbar ; `app.js` applique `applyStaticUi()`, relocalise modèles/params/
  résultats à la volée et **relance l'analyse** si un résultat est affiché (les
  raisons sont générées côté worker, donc non re-traduisibles sans recalcul).
- **Appris** : garder i18n sans DOM/localStorage au top-level est obligatoire —
  le worker importe registry→algos→i18n et n'a pas de `localStorage` (lecture
  paresseuse + `try/catch`). Piège CSS : `.step span` stylait tout `<span>` en
  pastille ronde → mon `<span data-i18n>` de libellé devenait un rond illisible,
  corrigé en `.step > span:first-child`.
- **Décidé** : le français reste la source unique (registry + HTML) ; toute
  nouvelle chaîne doit être ajoutée aux 4 langues du bon dictionnaire. Un
  changement de langue avec résultat affiché recalcule (rapide, ~50 ms).
- **À suivre** : préserver les paramètres réglés lors d'un changement de langue
  (aujourd'hui `buildParamControls` réinitialise aux défauts) ; ajouter d'autres
  langues = un bloc par dictionnaire. Bancs : v1 10/10, v2 13/13, UI i18n 18/18,
  UI présélections 16/16.

### 2026-07-09 — SKF Canari + GBDT + présélections simples + unités + tags qualité
- **Contexte** : demande d'implémenter l'exemple `anomaly_detection` de Canari
  (SKF, courbe Pr(anormal)), un modèle « façon LightGBM », des paramètres
  simplifiés pour non-expert, et l'exploitation des colonnes qualité
  (légende Halifax : a=bon, b=médiocre, c=ensablement, n=panne capteur) sur un
  export réel 3 mois en **pieds** (piège d'unités : BMR 50 mm aurait masqué
  tout le site).
- **Changé** : `skf.js` (IMM 2 régimes, Pr(anormal), épisodes « transition »),
  `gbdt.js` (gradient boosting histogramme maison, zéro dépendance),
  `csv.js` (auto-détection d'unités + normalisation mm/m·s⁻¹ + codes qualité
  par point + `forceUnits`), `quality.js`, interpolation des points tagués dans
  `cleanWithZScore`. UI : présélections `type:"choice"` sur les 9 modèles,
  « Réglages avancés » repliés avec bascule « Personnalisé », sélecteur
  d'unités (re-parse sans re-upload), courbe Pr(anormal) rouge remise à
  l'échelle + stats dédiées (transitions, Pr max, points tagués).
- **Appris** : le mélange IMM fait « surfer » le régime normal sur une rampe →
  seule la TRANSITION est détectable mono-canal, pas la dérive soutenue ; il a
  fallu un régime NORMAL à niveau statique pur + lissage 1 h de l'entrée pour
  des bosses de Pr propres. Le GBDT bat nettement MLP/k-NN (8,2 vs 21/13 de
  RMSE backtest) en apprenant calendrier + dynamique ensemble. RMSE 220 sur le
  site 3 mois expliqué : dernier jour à +43 % du médian historique, la
  prévision récursive revient à la climatologie — documenté, pas corrigé.
- **Décidé** : SKF assumé comme écran de transitions (fenêtres jaunes) qui
  renvoie vers le multi-canaux pour l'attribution ; l'agent Opus ayant été
  coupé en cours de route (limite de session API), la calibration et l'UI ont
  été terminées en solo. Bancs : v1 10/10, v2 (unités/site réel/SKF/GBDT)
  13/13, Playwright 16/16.
- **À suivre** : appliquer les présélections « Personnalisé » aussi au chemin
  inverse (pré-sélectionner le preset correspondant si les valeurs avancées
  matchent) ; envisager d'afficher la courbe Pr sur son propre axe 0-100 %.

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
