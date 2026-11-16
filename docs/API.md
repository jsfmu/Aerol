# API reference

All JSON endpoints are same-origin. POST requires `Content-Type: application/json`.
If `AEROL_API_TOKEN` is configured, add `Authorization: Bearer YOUR_TOKEN`.
Dates are ISO 8601. A collection timestamp includes `Z` or a UTC offset.

| Method | Path | Behavior |
|---|---|---|
| GET | /api/bootstrap | Public reference snapshot, metric registry, local readings, model status |
| GET | /api/readings | Latest and last 500 local records, ordered by collection time |
| POST | /api/readings | Persist one wearable, external-device or lab reading |
| POST | /api/hrv | Calculate RMSSD from corrected NN intervals; no stress score |
| POST | /api/motion | Three-axis acceleration / gyroscope magnitude, without persistence |
| GET/POST | /api/tasks | Read/log follow-up tasks locally |
| GET | /api/model | Adapter identity and availability |
| POST | /api/features | Radiation feature payload without inference |
| POST | /api/predict | Invoke the installed team model |
| GET | /api/health | Readiness check |
| GET | /api/schema | Record contract versions and field lists (`aerol.terra.v1`, `aerol.wbc.v1`, `aerol.radiation.v1`, `aerol.event.v1`) |
| POST | /api/records/validate | Validate `{"records":[...]}` (same rules as the browser; detects future leakage) |
| POST / GET | /api/records | Store validated records in SQLite (422 if any record is invalid) / list stored records |
| POST | /api/radiation/integrate | Integrate dosimeter readings `{"readings":[{t, device_id, kind, value, unit}], "transitions":[t...]}` → total, increments, gaps, resets, duplicates, worked checks |

Static routes: `/` (watch), `/dashboard/` (dashboard; `/earth/` still works), `/mobile/` (watch only), `/data/research.json`.

Example reading:

```json
{"metric":"hr","value":64,"baseline":60,"timestamp":"2026-11-15T10:00:00Z","source":"device","device":"YOUR_SENSOR_ID","note":"Seated, good signal"}
```

This is a request example, not a bundled astronaut observation. Available metric
IDs and exact units come from `/api/bootstrap` → `metrics`. `source` is `manual`,
`device`, or `laboratory`. Baseline is optional; it is not inferred from one reading.

Wearable IDs: `hr`, `rhr`, `hrv`, `respiration`, `spo2`, `skin_temperature`,
`movement`, `gyroscope`. External IDs: `clinical_spo2`, `systolic`, `diastolic`,
`blood_flow`, `wbc`, `neutrophils`, `lymphocytes`, `monocytes`, `eosinophils`,
`basophils`, `crp`, `personal_dose_rate`, `personal_total_dose`, `terra`.

CBC differential values are absolute counts, not percentages. Blood flow is a
velocity (cm/s); record the vessel and acquisition protocol in `note`. No generic
conversion to volume flow is supplied. Personal dosimetry uses absorbed-dose
units; a dose-equivalent reading in Sv cannot be entered as Gy without a defined
conversion. Skin temperature is a wrist measurement, not core temperature.

RMSSD input: `{"nn_intervals_ms":[800,810,790]}`. The caller must correct ectopy,
artifacts and detection errors first. RMSSD = sqrt(mean(diff(NN)^2)). PPG pulse-rate
variability may differ from ECG HRV. The endpoint does not validate a stress model.

Motion input:

```json
{"timestamp":"2026-11-15T10:00:00Z","accelerometer":{"x":0.1,"y":0.2,"z":0.3},"gyroscope":{"x":0,"y":0,"z":1.2}}
```

Acceleration axes use m/s²; gyroscope axes use °/s. This only calculates vector
magnitudes. It does not estimate energy expenditure, Earth steps or sleep.

Task input: `{"kind":"terra_research","status":"planned","note":"Protocol-defined follow-up"}`.
Kinds: `exposure_review`, `shelter_checkin`, `cbc_followup`, `terra_research`.
Statuses: `planned`, `logged`, `complete`. Logs are appended, not sent externally.

SQLite data are stored in `local-data/aerol.sqlite3` unless `AEROL_DB` is set.
This is a single-workspace starter, not a multi-tenant clinical record system.

Dosimeter units accepted by `/api/radiation/integrate`: rates in `mSv/day` or `µSv/h`, cumulative
counters in `mSv` or `µSv` (dose equivalent). Gy-based readings are rejected, not relabeled.
