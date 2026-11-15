> The browser runs a transparent simulator (see MODEL.md); this adapter is the slot for a future
> **learned** model. It stays disabled until matched longitudinal data exist (requirements in MODEL.md).

# Model integration handoff

The team owns model training, model artifacts and validation. The app provides a
stable Python boundary. There is no trained model in the package.

## Input

POST `/api/predict`:

```json
{"detector":"DosTel1","as_of":"2015-09-24","window_days":7,"horizon_days":7}
```

`as_of` means midnight UTC at the start of the date. Only preceding radiation
enters the feature window. Available windows: 1, 7, 30 days; horizon: 1–30 days.
The horizon is a team-model parameter, not an established TERRA kinetic rule.

The adapter receives:

```text
detector                         string
as_of                            YYYY-MM-DD
window_days                      integer
horizon_days                     integer
mean_station_dose_rate_uGy_h      time-weighted mean
coverage_fraction                observed time / requested time
observed_station_dose_uGy         integral over observed short intervals only
flight_day                       elapsed days from March 27, 2015
personal_dosimetry                false
source, cutoff, note              provenance strings
wearable_data                     null (different subject/context)
```

Missing coverage is not filled or scaled to a complete-window dose. The API
returns 422 below 80% time coverage and never substitutes zero for missing data.
Station detector features are not organ dose estimates. A radiation-to-CBC model
requiring blood-forming-organ dose needs an additional validated transport layer.

## Adapter

Implement `is_ready()` and `predict(features, horizon_days)` in
`aerol/model_adapter.py`, or set `AEROL_MODEL_MODULE` to an importable module with
the same interface. Load your trained artifact once when that module imports.

Required return keys:

```python
{"value": predicted_raw_normalized_abundance, "explanation": "Model-specific summary"}
```

Optional `lower` and `upper` must bracket `value` and use the same units. The app
does not invent a confidence interval or its confidence level. Supply that level
in your explanation if an interval is calibrated. Values must be finite, 0–1.
The UI multiplies by 1,000 for display only.

Update `MODEL_INFO` with name, version, target, units, and validation status. The
status is declared by the model author; the application does not certify it.

The UI receives `kind=model_prediction`, model metadata, input provenance,
forecast date and output. Measured TERRA points remain a separate dataset.

## Adding wearable inference

Stress, sleep and recovery need distinct target definitions and model outputs.
Extend the adapter/response schema deliberately. Do not treat an HRV deviation
as a diagnosis or invent a recovery score. Do not combine local crew readings
with Scott's reference series as if they came from the same person or mission.
Preserve collection time, device, signal quality, baseline and source fields.

Eight TERRA flight samples from one astronaut are insufficient to validate a
general individual or solar-storm predictor. Use a subject-separated evaluation
design when additional matched missions become available. Avoid time leakage.
