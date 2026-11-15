# Record contract

Validators: `aerol/static/core/schema.js` (browser) and `aerol/schema.py` (API). Both run against
`tests/fixtures/records.json`. Field names, units and baseline conventions are fixed per version.

## Shared fields (every value record)

`schema_version, record_id, astronaut_id, mission_id, study_id, cohort_id, timestamp_utc,
time_window_start, time_window_end, mission_day, return_day, mission_phase, exposure_region,
trajectory_source, value_origin, source_reference, quality_flag` + `aggregate, sample_size`.

- `value_origin`: `observed | digitized_reference | model_prediction | simulation`.
- Unavailable values are `null`, never 0. Records need at least one timing field.
- Timestamps: ISO 8601 with timezone (UTC). `mission_day` is relative to launch; `return_day` to landing.
- `mission_phase`: `preflight | early_flight | mid_flight | late_flight | landing | after_return`.
- `exposure_region`: `ground | inside_magnetosphere | radiation_belt_transit | beyond_magnetosphere | unknown`.
- Cohort aggregates: `aggregate: true`, `astronaut_id: null`, `cohort_id` required, `sample_size` when known.

## `aerol.terra.v1`

`specimen, assay_method, raw_value, raw_unit, normalization_method, baseline_id, baseline_value,
baseline_window, terra_fold_change, terra_percent_change, model_version, input_record_ids,
prediction_generated_at, prediction_target_time, uncertainty_lower, uncertainty_upper, uncertainty_type`

- `terra_fold_change = normalized_value / matched_personal_baseline`; `terra_percent_change = 100 × (fold − 1)`; baseline = 1.0× = 0%.
- Observed fold change requires `baseline_id` and a positive `baseline_value`, and must equal raw ÷ baseline.
- Raw values require `raw_unit` and `assay_method`. Different assay scales are not interchangeable.
- `uncertainty_type`: `scenario_sensitivity_range | prediction_interval | confidence_interval` — simulation records may only use the first.
- Model predictions require `model_version`, `prediction_generated_at`, `prediction_target_time`; batch validation rejects inputs timestamped after generation (future leakage).

## `aerol.wbc.v1`

`specimen, assay_method, wbc_total (10^9/L), wbc_unit, original_value, original_unit, conversion_note,
differential_absolute {neutrophils, lymphocytes, monocytes, eosinophils, basophils} (10^9/L),
differential_percent, lab_reference_low, lab_reference_high, reference_source, baseline_id,
baseline_value, percent_change_from_baseline, relative_change_only, relative_change_percent,
measurement_status (measured | predicted | simulated | reference)` + prediction fields.

If a source reports only a relative change, `relative_change_only: true` and `wbc_total` must be null.

## `aerol.radiation.v1`

`original_value, original_unit, dose_quantity (absorbed_dose | dose_equivalent | nasa_effective_dose |
detector_operational), rate_value, rate_unit, interval_start, interval_end, cumulative_value,
cumulative_unit, detector_id, detector_type (area_monitor | personal_dosimeter | scenario | model |
unspecified), personal_dosimeter, conversion_assumptions, coverage_fraction`

Absorbed dose keeps Gy units; dose equivalent/effective dose keep Sv units. An area monitor cannot be
flagged as a personal dosimeter.

## `aerol.event.v1`

`event_id, event_type, start_time, end_time, phase, region, affected_metrics, related_record_ids,
definition, observed_change, possible_contributors, evidence_status (established | supported |
hypothesis | simulated | observed | unverified), source_references, suggested_action`
