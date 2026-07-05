"""Generate a fixed dataset, run the ORIGINAL Python detectors on it, and dump
both the input and the reference anomaly indices. The JS parity test reads the
exact same input values, so no cross-language RNG parity is needed on the input.
"""
from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

PY_PROJECT = Path("/home/user/Predic/CurrentPredictor-carlo-db_interaction")
sys.path.insert(0, str(PY_PROJECT))

from python_functions.algorithms.zscore import ZScoreDetector
from python_functions.algorithms.isolation_forest import IsolationForestDetector

N = 24 * 14
start = datetime(2026, 6, 1, tzinfo=timezone.utc)

# Deterministic signal + deterministic pseudo-noise (no RNG => identical in JS).
values = []
for i in range(N):
    trend = 0.01 * i
    daily = 3 * math.sin(2 * math.pi * i / 24)
    noise = 0.6 * math.sin(i * 12.9898) * math.cos(i * 78.233)  # deterministic
    values.append(20 + trend + daily + noise)

injected = [40, 41, 120, 121, 200, 250, 251, 252, 300]
for k, idx in enumerate(injected):
    values[idx] += (14 if k % 2 == 0 else -12)

timestamps = [start + timedelta(hours=i) for i in range(N)]
raw = pd.DataFrame({"timestamp": timestamps, "value": values, "variable_id": 1})

z = ZScoreDetector().detect(raw.copy(), {"degree": 2, "threshold": 1.7})
iforest = IsolationForestDetector().detect(
    raw.copy(), {"contamination": 0.03, "n_estimators": 100}
)

ts_to_idx = {t.isoformat(): i for i, t in enumerate(timestamps)}
z_idx = sorted(ts_to_idx[t.isoformat()] for t in z["timestamp"])
if_idx = sorted(ts_to_idx[t.isoformat()] for t in iforest["timestamp"])

out = {
    "values": values,
    "injected_indices": injected,
    "zscore": {"params": {"degree": 2, "threshold": 1.7}, "anomaly_indices": z_idx},
    "isolation_forest": {
        "params": {"contamination": 0.03, "n_estimators": 100},
        "anomaly_indices": if_idx,
    },
}
Path(__file__).with_name("fixture.json").write_text(json.dumps(out))
print(f"zscore  py: {z_idx}")
print(f"iforest py: {if_idx}")
print(f"injected  : {injected}")
