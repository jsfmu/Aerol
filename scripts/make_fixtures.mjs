// Generates tests/fixtures/records.json (valid + invalid cases) used by BOTH the JS and Python validators.
import { writeFileSync } from 'node:fs';
import { emptyTerra, emptyWbc, emptyRadiation, emptyEvent } from '../aerol/static/core/schema.js';
const base = { astronaut_id: 'SYN-A01', mission_id: 'SIM-1', study_id: 'SIM', cohort_id: null, mission_day: 10, mission_phase: 'early_flight', exposure_region: 'inside_magnetosphere', trajectory_source: 'scenario_settings', source_reference: 'fixture', quality_flag: 'ok' };
const terraOk = emptyTerra({ ...base, record_id: 'terra-ok', value_origin: 'observed', specimen: 'whole blood', assay_method: 'ddPCR (fixture)', raw_value: 1.5e-3, raw_unit: 'normalized_abundance', normalization_method: 'fixture', baseline_id: 'terra-base', baseline_value: 1.0e-3, baseline_window: 'L-180', terra_fold_change: 1.5, terra_percent_change: 50 });
const cases = {
  valid: [
    terraOk,
    emptyTerra({ ...base, record_id: 'terra-sim', value_origin: 'simulation', terra_fold_change: 1.8, terra_percent_change: 80, model_version: 'aerol.sim.terra@1.0.0', uncertainty_lower: 1.4, uncertainty_upper: 2.2, uncertainty_type: 'scenario_sensitivity_range' }),
    emptyTerra({ ...base, record_id: 'terra-missing', value_origin: 'observed', quality_flag: 'missing' }),
    emptyTerra({ ...base, record_id: 'terra-pred', value_origin: 'model_prediction', terra_fold_change: 1.2, terra_percent_change: 20, model_version: 'team-model@0.1', prediction_generated_at: '2031-04-01T00:00:00Z', prediction_target_time: '2031-04-08T00:00:00Z', input_record_ids: ['terra-ok'], timestamp_utc: null }),
    emptyWbc({ ...base, record_id: 'wbc-ok', value_origin: 'observed', measurement_status: 'measured', wbc_total: 6.2, original_value: 6.2, original_unit: 'Thousand/uL', differential_absolute: { neutrophils: 3.6, lymphocytes: 1.9 }, lab_reference_low: 3.8, lab_reference_high: 10.8 }),
    emptyWbc({ ...base, astronaut_id: null, cohort_id: 'ISS crew', aggregate: true, sample_size: 23, record_id: 'wbc-agg-rel', value_origin: 'digitized_reference', measurement_status: 'reference', relative_change_only: true, relative_change_percent: 15 }),
    emptyRadiation({ ...base, record_id: 'rad-area', value_origin: 'observed', original_value: 8.2, original_unit: 'µGy/h', dose_quantity: 'absorbed_dose', rate_value: 8.2, rate_unit: 'µGy/h', detector_id: 'DosTel1', detector_type: 'area_monitor', personal_dosimeter: false }),
    emptyRadiation({ ...base, record_id: 'rad-scn', value_origin: 'simulation', original_value: 1.84, original_unit: 'mSv/day', dose_quantity: 'dose_equivalent', rate_value: 1.84, rate_unit: 'mSv/day', detector_type: 'scenario', personal_dosimeter: false }),
    emptyEvent({ event_id: 'ev-ok', event_type: 'landing', start_time: '2031-08-30T14:00:00Z', phase: 'landing', region: 'ground', evidence_status: 'supported' }),
  ],
  invalid: [
    { why: 'fold change without matched baseline', record: { ...terraOk, record_id: 'bad-1', baseline_id: null, baseline_value: null } },
    { why: 'fold change does not equal raw/baseline', record: { ...terraOk, record_id: 'bad-2', terra_fold_change: 2.0, terra_percent_change: 100 } },
    { why: 'percent change inconsistent with fold', record: { ...terraOk, record_id: 'bad-3', terra_percent_change: 40 } },
    { why: 'zero used for missing', record: { ...terraOk, record_id: 'bad-4', quality_flag: 'missing', raw_value: 0 } },
    { why: 'unknown value_origin', record: { ...terraOk, record_id: 'bad-5', value_origin: 'guess' } },
    { why: 'wrong schema version', record: { ...terraOk, record_id: 'bad-6', schema_version: 'aerol.terra.v2' } },
    { why: 'unknown phase', record: { ...terraOk, record_id: 'bad-7', mission_phase: 'cruise' } },
    { why: 'simulation band labeled as confidence interval', record: emptyTerra({ ...base, record_id: 'bad-8', value_origin: 'simulation', terra_fold_change: 1.1, terra_percent_change: 10, uncertainty_type: 'confidence_interval' }) },
    { why: 'aggregate with individual identity', record: emptyWbc({ ...base, record_id: 'bad-9', aggregate: true, sample_size: 23, cohort_id: 'ISS', value_origin: 'digitized_reference', measurement_status: 'reference', relative_change_only: true, relative_change_percent: 10 }) },
    { why: 'absolute WBC invented for relative-only source', record: emptyWbc({ ...base, astronaut_id: null, cohort_id: 'ISS', aggregate: true, record_id: 'bad-10', value_origin: 'digitized_reference', measurement_status: 'reference', relative_change_only: true, relative_change_percent: 10, wbc_total: 6.6 }) },
    { why: 'absorbed dose relabeled as Sv', record: emptyRadiation({ ...base, record_id: 'bad-11', value_origin: 'observed', original_value: 8.2, original_unit: 'µGy/h', dose_quantity: 'absorbed_dose', rate_value: 8.2, rate_unit: 'mSv/day', detector_type: 'area_monitor', personal_dosimeter: false }) },
    { why: 'area monitor claimed as personal dosimeter', record: emptyRadiation({ ...base, record_id: 'bad-12', value_origin: 'observed', original_value: 8.2, original_unit: 'µGy/h', dose_quantity: 'absorbed_dose', rate_value: 8.2, rate_unit: 'µGy/h', detector_type: 'area_monitor', personal_dosimeter: true }) },
    { why: 'model prediction missing generation time', record: emptyTerra({ ...base, record_id: 'bad-13', value_origin: 'model_prediction', terra_fold_change: 1.2, terra_percent_change: 20, model_version: 'm' }) },
    { why: 'no timing information', record: { ...terraOk, record_id: 'bad-14', mission_day: null } },
  ],
  leakage_batch: [
    emptyTerra({ ...base, record_id: 'obs-late', value_origin: 'observed', timestamp_utc: '2031-05-01T00:00:00Z', raw_value: 1e-3, raw_unit: 'normalized_abundance', assay_method: 'fixture' }),
    emptyTerra({ ...base, record_id: 'pred-early', value_origin: 'model_prediction', terra_fold_change: 1.1, terra_percent_change: 10.000000000000009, model_version: 'm', prediction_generated_at: '2031-04-01T00:00:00Z', prediction_target_time: '2031-04-08T00:00:00Z', input_record_ids: ['obs-late'] }),
  ],
};
writeFileSync(new URL('../tests/fixtures/records.json', import.meta.url), JSON.stringify(cases, null, 1));
console.log(`fixtures: ${cases.valid.length} valid, ${cases.invalid.length} invalid, leakage batch ${cases.leakage_batch.length}`);
