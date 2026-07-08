# Leçons techniques apprises (à ne pas réapprendre à ses dépens)

> Chaque leçon ci-dessous a coûté une itération de debug sur données réelles.

## Algorithmique / data science

1. **Désaisonnaliser avant tout.** Cycle diurne retiré (profil médian par heure
   d'horloge, `baseline.js`) avant : détection de dérive (multichannel, Canari,
   CUSUM) **et** prévision (k-NN, MLP). Un modèle auto-régressif avec une
   fenêtre ≪ 24 h ne peut pas voir le cycle → backtest plat + prévision en
   zigzag. On ré-ajoute le profil à la sortie (`base.lookup(t, date)` pour le
   futur).

2. **L'empreinte de référence ne doit jamais inclure ce qu'on cherche.**
   Standardiser (médiane/MAD) sur tout le record dilue une longue dérive
   (elle tire la médiane vers elle) ; référence = 1re moitié du record. Mais
   une anomalie DANS la référence corrompt l'empreinte et fait paraître le
   reste dérivé → **2 passes** : calculer des bornes provisoires, exclure les
   points de confound (critères indépendants du centre profondeur : pluie,
   flat, BMR, vélocité anormale), recalculer.

3. **Règle de réversion** : épisode CUSUM refermé de lui-même avant N jours =
   « excursion », pas dérive. Une dérive capteur ne se corrige pas seule.
   C'est LA règle qui tue les faux positifs sur les crues.

4. **Signature d'onset > niveaux moyens.** Pour distinguer restriction et
   dérive : la restriction montre un saut de profondeur co-temporel (± 3 h) à
   une chute de vélocité ; la dérive rampe sans saut. Les moyennes d'épisode
   sont polluées par la variabilité multi-jours du site.

5. **Échelles par canal** : profondeur en z robuste (MAD), vélocité en **% de
   son profil diurne** avec bornes = max(plancher %, k·σ_site du roulé 1 h).
   Un σ statistique brut sur la vélocité est gonflé par les rafales légitimes.

6. **MAD vs quantiles** sur bruit hétéroscédastique : diffs médians 0,4 mm,
   p99 = 36 mm sur le même fichier. `max(σ_MAD, p90/1.645)` quand il faut une
   échelle qui tolère les rafales (utilisé un temps dans Canari).

7. **CUSUM : n'alarmer qu'au début d'excursion** (désarmer jusqu'au retour
   près de la référence) sinon une marche persistante ré-alarme tous les
   h/écart points (3 516 alarmes → 20 sur le même fichier).

8. **Winsoriser/nettoyer avant les tendances** : `cleanWithZScore` (tendance
   polynomiale + MAD, seuil 3) interpole les pics avant Canari/forecasts. Un
   filtre à base d'écart-type ne retire jamais les pics (ils gonflent l'écart-
   type qui doit les juger) — MAD obligatoire.

9. **Sous-échantillonner les O(n²)** : k-NN (librairie de fenêtres stride →
   ≤ 600 candidates) et MLP (échantillons stride → ≤ 1 500) : 7,3 s → 0,4 s
   sur 5 040 points sans perte visible. Piège vu en vrai : `median(diffs)`
   appelé DANS un `.map()` → O(n²) silencieux (6,8 s → 12 ms).

10. **Filtre de Kalman + événements longs** : rejeter les outliers au-delà de
    N rejets consécutifs bloque le filtre pendant une crue entière. Soit reset
    de régime (ré-ancrer le niveau), soit — mieux ici — nettoyer en amont et
    garder le filtre simple.

## Validation

11. **Banc reproductible avec injections synthétiques dérivées des données
    réelles** (`tests/make_synthetics.py` + `tests/eval_drift.mjs`) : dérive
    rampe (+0,4 mm/h, vélocité intacte), restriction réaliste (profondeur
    +40 %, vélocité −60 % — une restriction physique conserve à peu près le
    débit, ne pas injecter n'importe quoi), flat-line. Critères PASS/FAIL
    chiffrés. **10/10 requis avant push.**
12. Critère d'onset réaliste : ±48 h pour une rampe de 0,4 mm/h dans un bruit
    σ≈10 mm (±12 h est physiquement impossible ; le remit métier est 7-14 j).
13. Toujours tester en **navigateur** (Playwright, `/opt/node22/lib/node_modules/playwright`)
    en plus de node : erreurs console, rendu, bascules de modèles (fuites
    d'état entre kinds), et vérifier les régressions des AUTRES modèles.

## Infra / environnement (sessions Claude Code distantes)

14. **GitHub Pages `deploy-pages` échoue par vagues** avec « Deployment
    failed, try again later » (backend GitHub). Ce n'est PAS le code :
    re-déclencher le workflow (workflow_dispatch) ; parfois attendre 15-20 min.
    L'activation initiale de Pages est manuelle (Settings → Pages → GitHub
    Actions) — le token Actions ne peut pas créer le site (`enablement: true`
    aide ensuite).
15. Le proxy des sessions bloque `github.io`, `api.vercel.com`, la page de
    statut GitHub… → vérifier le déploiement via l'API Actions (token env
    `GITHUB_TOKEN`), pas en ouvrant le site. Certains chemins de l'API GitHub
    sont aussi bloqués par le proxy (ex. activer Pages).
16. Node ≥ 22 auto-détecte l'ESM sans package.json — les imports des modules
    du repo marchent dans des scripts `.mjs` ou `--input-type=module`.
17. Ne jamais mettre `pkill` dans la même commande qu'un commit/push (le
    signal tue tout le groupe → exit 144 et le commit n'a pas lieu).
18. Les CSV réels de l'utilisateur restent privés (`.gitignore`), les
    fixtures synthétiques aussi — le banc les régénère localement.
