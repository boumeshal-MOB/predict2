# Métier : détection de dérive capteur (résumé du guide client)

> Condensé du document « Flow & Water-Quality Data Patterns — A Reference
> Guide for the Current Predictors Drift-Detection Project » fourni par
> l'utilisateur, plus ce que les données réelles ont confirmé.

## L'objectif du projet

Détecter **tôt (7 à 14 jours avant l'intervention)** qu'un capteur de pression
dérive hors calibration : la profondeur mesurée s'éloigne lentement de la
réalité physique **alors que l'écoulement n'a pas changé**. Cas canonique du
client : 29 jours de dérive non détectée (« Marsh Street »), le faux niveau
alimentant les calculs de débit jusqu'à des valeurs aberrantes.

## Le problème en une phrase

Une montée lente de profondeur peut être une dérive capteur (CIBLE) **ou** une
vraie cause hydraulique (PIÈGE). La profondeur seule ne permet pas de trancher :
**le discriminateur est toujours la relation entre canaux** (profondeur vs
vélocité vs pluie).

## La table des discriminateurs (le cœur de tout)

| Observation | Dérive (CIBLE) | Piège (CONFOUND) | Discriminateur |
|---|---|---|---|
| Profondeur ↑ | vélocité **PLATE** | restriction aval : vélocité **↓** | signe du co-mouvement profondeur/vélocité |
| Profondeur ↑ | pas de pluie | orage/remplissage : pluie présente, vélocité **↑** | covariable pluie (avec lag de bassin) + co-élévation vitesse |
| Saut dans la série | recalibration/déplacement capteur | changement d'entité (DFINAL bascule PDEPTH↔SDEPTH) | séries par entité, état de référence |
| Profondeur bruitée | capteur qui se dégrade | tuyau rapide/peu profond (**BMR**) | seuils BMR : profondeur < 50 mm, vélocité < 0,2 m/s = bruit normal |
| Ligne plate | — | panne moniteur / capteur retiré | constantes exactes (règle simple, haute précision) |
| Zéros de vélocité | capteur défaillant | capteur au-dessus de l'eau aux minima | régularité (chaque creux = géométrie, pas panne) |

## Contexte à connaître

- **Cycle diurne** : minimum la nuit, pic le matin (6-11 h), pic secondaire le
  soir. Le retirer AVANT de chercher la dérive (« residuals is where drift
  hides »). Semaine ≠ week-end (pic décalé/aplati) ; jours spéciaux (Noël,
  événements) décalent toute la courbe sur TOUS les sites en même temps —
  cohérence spatiale = comportement, pas capteur.
- **Normal par site, jamais global** : 3 m/s plat est sain dans un tuyau et
  aberrant dans un autre. Toujours calibrer sur l'empreinte du site lui-même.
- **Entités** : PDEPTH (pression, sujette à dérive), SDEPTH (ultrason,
  contre-vérification), DFINAL (série dérivée, peut changer de source),
  VFINAL/PEAKVEL (vélocité, LE discriminateur), BTYVOLT (batterie), RAIN.
- **Labels** : les fiches de calibration horodatent les recalibrations (fin
  d'épisode de dérive) — meilleure source de supervision. Fenêtres
  onset→recalibration, pas des points.

## Ce que les données réelles de l'utilisateur ont confirmé (mesuré)

Fichiers : site 2725_225F0096, pas 2 min, profondeur médiane 66-110 mm, crues
jusqu'à 767 mm, vélocité 0,3-2,8 m/s, colonnes pluie **vides**.

1. **Vélocité très variable jour-à-jour** : à heure d'horloge égale, ±20-50 %
   d'un jour à l'autre (p50 de l'écart horaire au profil = 21 %). Conséquence :
   aucun seuil fixe en % ne marche ; les bornes doivent être
   max(plancher %, k·σ du site).
2. **Pendant une crue**, la vélocité passe de ~0,7 à ~2,0 m/s (co-élévation
   +170 %) — le masque « événement hydraulique » fonctionne très bien.
3. **Bruit de profondeur hétéroscédastique** : diffs médians 0,4 mm mais p99
   6-36 mm. Utiliser MAD **et** quantiles hauts selon l'usage.
4. Une **excursion qui revient à la normale n'est pas une dérive** : une vraie
   dérive capteur ne se corrige jamais seule (elle finit par une
   recalibration). Cette règle élimine à elle seule presque tous les faux
   positifs sur les crues.
5. Une **restriction « saute »** (marche co-temporelle : profondeur ↑ ET
   vélocité ↓ dans la même heure) alors qu'une **dérive « rampe »**. La
   signature d'onset est plus fiable que les niveaux moyens.

## Implémentation actuelle (src/algorithms/multichannel.js)

Pipeline : profil diurne retiré (baseline.js) → z robuste profondeur avec
**empreinte de référence = 1re moitié du record, en 2 passes** (points de
confound exclus des stats) → vélocité en **% d'écart à son profil**, moyennée
1 h → masques (pluie laggée, hydraulique, restriction, BMR, flat-line, vélocité
non neutre) → **CUSUM bi-face** sur le score résiduel non masqué → épisodes :

- alarme si S > `drift_h` et durée ≥ `min_duration_hours` ;
- épisode refermé (S revenu à 0) avant `drift_min_days` (5 j) → **excursion**,
  pas dérive ;
- onset avec saut profondeur ≥ 2σ co-temporel à chute de vélocité ≤
  −max(15 %, 0,75σ_site) → **restriction suspectée** ;
- épisode encore ouvert en fin de record → **dérive (en cours)** = le cas
  d'alerte précoce.

Sans colonne vélocité : mode dégradé (warning affiché). Sans pluie : les
événements sont « hydrauliques » faute de confirmation pluie (warning).
