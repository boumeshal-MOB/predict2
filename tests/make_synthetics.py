#!/usr/bin/env python3
"""Génère les fixtures synthétiques du banc de validation dérive.

Part d'un export capteur réel (tests/real_avril.csv, privé, non versionné :
7 jours au pas de 2 min = 5 040 points) et injecte trois scénarios calibrés :
  - synth_drift.csv       : dérive rampe +0,4 mm/h sur les 5 derniers jours
                            (onset idx 1440), vélocité INTACTE -> doit être
                            détectée comme dérive.
  - synth_restriction.csv : blocage aval réaliste jours 3-4 (idx 1440-2880),
                            profondeur +40 %, vélocité -60 % -> doit être
                            classée restriction, PAS dérive.
  - synth_flatline.csv    : 12 h à zéro (idx 2000-2360) -> panne (flat-line).

Usage : python3 tests/make_synthetics.py   (depuis la racine du repo)
"""
import copy
import csv
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "real_avril.csv")
if not os.path.exists(SRC):
    sys.exit("tests/real_avril.csv manquant (fichier capteur privé, à redemander à l'utilisateur).")

rows = list(csv.reader(open(SRC)))
hdr, data = rows[:3], rows[3:]
n = len(data)


def write(name, d):
    with open(os.path.join(HERE, name), "w", newline="") as f:
        w = csv.writer(f)
        w.writerows(hdr)
        w.writerows(d)
    print(f"{name}: ok ({len(d)} pts)")


# 1) Dérive vraie : rampe +0,4 mm/h, vélocité intacte.
d = copy.deepcopy(data)
onset = n - 5 * 720
for i in range(onset, n):
    hours = (i - onset) * 2 / 60
    d[i][1] = f"{float(d[i][1]) + 0.4 * hours:.3f}"
write("synth_drift.csv", d)

# 2) Restriction réaliste : un blocage conserve à peu près le débit ->
#    profondeur +40 %, vélocité -60 % (chute franche, cf. guide métier).
d = copy.deepcopy(data)
for i in range(1440, 2880):
    d[i][1] = f"{float(d[i][1]) * 1.40:.3f}"
    d[i][3] = f"{float(d[i][3]) * 0.40:.5f}"
write("synth_restriction.csv", d)

# 3) Flat-line : 12 h de zéros exacts (profondeur et vélocité).
d = copy.deepcopy(data)
for i in range(2000, 2360):
    d[i][1] = "0"
    d[i][3] = "0"
write("synth_flatline.csv", d)
