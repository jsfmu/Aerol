# Models, scoring and alert logic

Everything in this file is implemented in `aerol/static/core/` and exercised by `tests/js/core.test.mjs`.

## Modes

| Mode | Status | Output label |
|---|---|---|
| Transparent temporal simulator (`aerol.sim.terra`, `aerol.sim.wbc` v1.0.0) | runnable, **not trained, not validated** | “simulated projection” |
| Learned model (`aerol.learned.terra`) | **unavailable** | — |

Learned mode is disabled because no genuinely matched longitudinal data exist in the bundle: one
astronaut with TERRA (8 in-flight + 3 post-flight samples, no pre-flight personal baseline, station
area dosimetry), and Inspiration4 CBC (n=4) has no TERRA and no in-flight samples. Enabling it needs
multiple astronauts with matched personal dosimetry and assays, pre-flight baselines, held-out
astronaut/study evaluation with normalization fit on training data only, and comparison against a
baseline-only predictor. No error metrics are shown because none were measured. Plug a trained
model into `aerol/model_adapter.py` (see MODEL_HANDOFF.md).

## TERRA simulator

```
F(t) = max(0, 1 + S(t) + R(t) + L(t))          1.0× = 0% change from matched personal baseline
S(t)  pre-mission stress (HYPOTHESIS): A·smoothstep((t−onset)/(launch−onset)) before launch,
      A·exp(−(t−launch)/τs) after launch          defaults A=0.35, onset L−30, τs=12 d
R(t)  radiation history: dR/dt = (k·r(t−lag) − R)/τ, τ = τrise when rising else τrecovery
      defaults k=0.6 fold per mSv/day, lag=7 d, τrise=30 d, τrecovery=45 d
L(t)  optional landing term A_L·exp(−(t−landing)/τL), default A_L=0
```

Residual variation (SD 6% of fold) is added only to simulated lab samples, never to the projection
curve. Cumulative dose never decreases, while R(t) declines once exposure falls. Values below zero
are clamped (count tracked in the model output). Integration step: 6 h, exact exponential update.

Default story: pre-flight rise to ~1.35×; partial decline after launch (stress decays faster than
the inside-magnetosphere term rises); after the magnetosphere exit the response starts after the
assumed lag and rises toward a plateau (~2.1×); it begins to recover after re-entry (separate from
landing) and approaches 1.0× over months after return.

## WBC simulator (modeled separately)

```
W(t) = W0·(1 + s_w·Ŝ(t) + F(t) + k_w·r̄(t) + L_w(t)),  W0 = 6.0 ×10⁹/L
Ŝ     same timing as the stress hypothesis, own amplitude s_w = 0.08
F     in-flight adaptation 0.12·(1−exp(−Δt/10 d)), decays after landing
r̄     dose rate filtered with τ = 10 d; k_w = 0.03 per mSv/day (sign deliberately adjustable)
L_w   landing surge 0.45·exp(−Δt/1.5 d) (stress-hormone neutrophil demargination pattern)
```

Differential: the modeled change is allocated 85% neutrophils, 10% monocytes, 5% lymphocytes
(assumption informed by granulocyte-led in-flight and landing increases; lymphocytes otherwise flat).
Higher WBC is not interpreted as better immunity; TERRA is not assumed to drive WBC.

## Scenario sensitivity range

Shaded bands are the envelope over adjustable assumptions — TERRA: sensitivity ×0.5–1.5, stress
amplitude ×0.5–1.5, inside rate 0.4–1.0 mSv/day; WBC: flight adaptation ×0.5–1.5, landing ×0.5–1.5,
radiation coefficient ×(−1…2). They are **not** confidence or prediction intervals; the schema
rejects `confidence_interval` on simulation records.

## Radiation arithmetic

Dose rate r(t) [mSv/day], accumulated dose D(t) [mSv], and step changes in rate are kept separate.
Segments are piecewise constant and split at every transition (region changes, belt transits, SPE
start/end). D(t) is the exact integral. Worked checks (both test suites):
7 d × 0.7 + 3 d × 1.84 = 10.42 mSv; 340 d × 1.84 = 625.60 mSv (hypothetical arithmetic; the Twins
Study recorded 76.18 mGy physical dosimeter dose and 146.34 mSv effective dose).

Dosimeter ingestion handles irregular timestamps, exact duplicates (dropped), conflicting duplicates
(flagged), counter resets (unrecorded interval reported, not guessed), gaps (never filled with zero),
and prefers a cumulative counter over rate readings to prevent double counting. Gy units are
rejected rather than relabeled as Sv.

## Watch estimates (demo)

- RMSSD = √(Σ(NN[i+1]−NN[i])² / (N−1)) over valid intervals (300–2000 ms; pairs changing >20% excluded). The band is PPG, so the value is pulse-rate variability, not ECG HRV.
- Recovery (0–100) = 0.4·HRV component + 0.3·resting-HR component + 0.3·sleep component, with inputs and coverage shown. Null (“insufficient data”) below 60% daily wear coverage.
- Stress estimate combines HRV and resting-HR deviation. Skin temperature is wrist skin, not core.

## Alert rules (`aerol.rules.v1`)

Each rule has metric, unit, threshold type, severity levels, persistence, clear and cooldown windows,
quality requirement, threshold kind (operational limit / lab range / personal deviation / demo),
recheck, escalation route and action text. The engine sweeps the timeline every 15 minutes:

- an episode opens after the condition persists; identical alerts are not repeated (episode + cooldown);
- a worse level within an episode escalates and re-notifies; a worse level may open during cooldown;
- acknowledgment never resolves; episodes close only when the condition clears for the clear window;
- data-quality rules are separate: poor contact is not a medical alert, and a disconnected band shows “insufficient data”, never all-clear;
- the recovery score is not an input to prioritization;
- TERRA and forecast-WBC rules are “research review” only (no validated clinical cutoff).

Seeded demo crossings: magnetosphere exit (rate jump, rolling 7-day dose, projection), FD45 poor
contact, FD96–101 sustained physiological deviation (RHR advisory → caution, HRV, skin temperature),
FD122 disconnect (advisory → caution), R+0 WBC configured change, optional SPE (urgent).

## Extrema, lag and context

- Peaks/dips on model curves: max/min within ±14 days with prominence ≥0.10 fold (TERRA) or ≥0.5 ×10⁹/L (WBC). Sparse samples only produce “sampled extrema”.
- Lag inspector compares the simulated radiation term with a no-step counterfactual and reports onset and half-response times; timestamps are never shifted.
- `modelContext(t)` uses only information timestamped ≤ t (tested), including result-availability dates.
