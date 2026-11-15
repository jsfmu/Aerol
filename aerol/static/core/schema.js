// Versioned JSON contract. Field names, units and baseline conventions are fixed per version.
// Mirrors aerol/schema.py — both validators are tested against tests/fixtures/records.json.
import { PHASES, REGIONS } from './schedule.js';

export const TERRA_SCHEMA = 'aerol.terra.v1';
export const WBC_SCHEMA = 'aerol.wbc.v1';
export const RADIATION_SCHEMA = 'aerol.radiation.v1';
export const EVENT_SCHEMA = 'aerol.event.v1';

export const VALUE_ORIGINS = ['observed', 'digitized_reference', 'model_prediction', 'simulation'];
export const UNCERTAINTY_TYPES = ['scenario_sensitivity_range', 'prediction_interval', 'confidence_interval'];
export const DOSE_QUANTITIES = ['absorbed_dose', 'dose_equivalent', 'nasa_effective_dose', 'detector_operational'];

export const SHARED_FIELDS = ['schema_version', 'record_id', 'astronaut_id', 'mission_id', 'study_id', 'cohort_id',
  'timestamp_utc', 'time_window_start', 'time_window_end', 'mission_day', 'return_day',
  'mission_phase', 'exposure_region', 'trajectory_source', 'value_origin', 'source_reference', 'quality_flag',
  'aggregate', 'sample_size'];

export const TERRA_FIELDS = ['specimen', 'assay_method', 'raw_value', 'raw_unit', 'normalization_method',
  'baseline_id', 'baseline_value', 'baseline_window', 'terra_fold_change', 'terra_percent_change',
  'model_version', 'input_record_ids', 'prediction_generated_at', 'prediction_target_time',
  'uncertainty_lower', 'uncertainty_upper', 'uncertainty_type'];

export const WBC_FIELDS = ['specimen', 'assay_method', 'wbc_total', 'wbc_unit', 'original_value', 'original_unit', 'conversion_note',
  'differential_absolute', 'differential_percent', 'lab_reference_low', 'lab_reference_high', 'reference_source',
  'baseline_id', 'baseline_value', 'percent_change_from_baseline', 'relative_change_only', 'relative_change_percent',
  'measurement_status', 'model_version', 'input_record_ids', 'prediction_generated_at', 'prediction_target_time',
  'uncertainty_lower', 'uncertainty_upper', 'uncertainty_type'];

export const RADIATION_FIELDS = ['original_value', 'original_unit', 'dose_quantity', 'rate_value', 'rate_unit',
  'interval_start', 'interval_end', 'cumulative_value', 'cumulative_unit', 'detector_id', 'detector_type',
  'personal_dosimeter', 'conversion_assumptions', 'coverage_fraction'];

export const EVENT_FIELDS = ['event_id', 'event_type', 'start_time', 'end_time', 'phase', 'region', 'affected_metrics',
  'related_record_ids', 'definition', 'observed_change', 'possible_contributors', 'evidence_status',
  'source_references', 'suggested_action'];

export const WBC_DIFFERENTIAL_KEYS = ['neutrophils', 'lymphocytes', 'monocytes', 'eosinophils', 'basophils'];

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isStr = v => typeof v === 'string';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const isIso = v => isStr(v) && ISO.test(v) && Number.isFinite(Date.parse(v));

function nullOr(errors, rec, key, check, msg) {
  if (rec[key] === null || rec[key] === undefined) return;
  if (!check(rec[key])) errors.push(`${key}: ${msg}`);
}

function requireKeys(errors, rec, keys) {
  for (const k of keys) if (!(k in rec)) errors.push(`${k}: required field missing (use null when unavailable)`);
}

function sharedChecks(errors, r) {
  requireKeys(errors, r, SHARED_FIELDS.filter(k => k !== 'aggregate' && k !== 'sample_size'));
  if (!isStr(r.record_id) || !r.record_id) errors.push('record_id: required non-empty string');
  if (!VALUE_ORIGINS.includes(r.value_origin)) errors.push(`value_origin: must be one of ${VALUE_ORIGINS.join(' | ')}`);
  for (const k of ['timestamp_utc', 'time_window_start', 'time_window_end']) nullOr(errors, r, k, isIso, 'must be ISO 8601 with timezone, or null');
  if (isIso(r.time_window_start) && isIso(r.time_window_end) && Date.parse(r.time_window_start) > Date.parse(r.time_window_end)) errors.push('time_window_start must not follow time_window_end');
  nullOr(errors, r, 'mission_phase', v => PHASES.includes(v), `must be one of ${PHASES.join(' | ')}`);
  nullOr(errors, r, 'exposure_region', v => REGIONS.includes(v), `must be one of ${REGIONS.join(' | ')}`);
  nullOr(errors, r, 'mission_day', isNum, 'must be a number or null');
  nullOr(errors, r, 'return_day', v => isNum(v) && v >= 0, 'must be ≥ 0 or null');
  if (r.timestamp_utc == null && r.time_window_start == null && r.mission_day == null && r.return_day == null) errors.push('timing: provide timestamp_utc, a time window, mission_day or return_day');
  if (r.aggregate === true) {
    if (r.astronaut_id !== null && r.astronaut_id !== undefined) errors.push('astronaut_id: cohort aggregates must not carry an individual identity (use null)');
    if (!isStr(r.cohort_id) || !r.cohort_id) errors.push('cohort_id: required for aggregates');
    nullOr(errors, r, 'sample_size', v => Number.isInteger(v) && v >= 1, 'must be a positive integer or null when unknown');
  }
}

function predictionChecks(errors, r, versionKey = 'model_version') {
  const isPred = r.value_origin === 'model_prediction' || r.value_origin === 'simulation';
  if (r.value_origin === 'model_prediction') {
    if (!isStr(r[versionKey])) errors.push(`${versionKey}: required for model predictions`);
    if (!isIso(r.prediction_generated_at)) errors.push('prediction_generated_at: required ISO timestamp for model predictions');
    if (!isIso(r.prediction_target_time)) errors.push('prediction_target_time: required ISO timestamp for model predictions');
  }
  nullOr(errors, r, 'input_record_ids', v => Array.isArray(v) && v.every(isStr), 'must be an array of record ids');
  nullOr(errors, r, 'uncertainty_type', v => UNCERTAINTY_TYPES.includes(v), `must be one of ${UNCERTAINTY_TYPES.join(' | ')}`);
  if (r.value_origin === 'simulation' && ['prediction_interval', 'confidence_interval'].includes(r.uncertainty_type)) {
    errors.push('uncertainty_type: bands from adjustable simulation assumptions are scenario_sensitivity_range, not statistical intervals');
  }
  if (isNum(r.uncertainty_lower) && isNum(r.uncertainty_upper) && r.uncertainty_lower > r.uncertainty_upper) errors.push('uncertainty_lower must not exceed uncertainty_upper');
  if (!isPred && (r.model_version || r.prediction_generated_at)) errors.push('model fields: only model predictions or simulations may carry model metadata');
}

export function validateTerra(r) {
  const errors = [];
  if (r.schema_version !== TERRA_SCHEMA) errors.push(`schema_version: must be "${TERRA_SCHEMA}"`);
  sharedChecks(errors, r);
  requireKeys(errors, r, TERRA_FIELDS);
  predictionChecks(errors, r);
  nullOr(errors, r, 'raw_value', v => isNum(v) && v >= 0, 'must be a non-negative number or null');
  if (isNum(r.raw_value) && !isStr(r.raw_unit)) errors.push('raw_unit: required when raw_value is present');
  if (isNum(r.raw_value) && !isStr(r.assay_method)) errors.push('assay_method: required when raw_value is present');
  if (r.quality_flag === 'missing' && (r.raw_value !== null || r.terra_fold_change !== null)) errors.push('missing records must use null values, never zero');
  if (r.terra_fold_change !== null && r.terra_fold_change !== undefined) {
    if (!isNum(r.terra_fold_change) || r.terra_fold_change < 0) errors.push('terra_fold_change: must be a non-negative number');
    if (r.value_origin === 'observed' || r.value_origin === 'digitized_reference') {
      if (!isStr(r.baseline_id)) errors.push('baseline_id: fold change requires a matched personal baseline');
      if (!(isNum(r.baseline_value) && r.baseline_value > 0)) errors.push('baseline_value: fold change requires a positive matched baseline value');
      if (isNum(r.raw_value) && isNum(r.baseline_value) && r.baseline_value > 0 && isNum(r.terra_fold_change)) {
        const expect = r.raw_value / r.baseline_value;
        if (Math.abs(expect - r.terra_fold_change) > 1e-6 * Math.max(1, expect)) errors.push('terra_fold_change must equal raw_value / baseline_value');
      }
    }
    if (isNum(r.terra_percent_change) && isNum(r.terra_fold_change) && Math.abs(r.terra_percent_change - 100 * (r.terra_fold_change - 1)) > 1e-6) {
      errors.push('terra_percent_change must equal 100 × (terra_fold_change − 1)');
    }
  } else if (r.terra_percent_change !== null && r.terra_percent_change !== undefined) {
    errors.push('terra_percent_change requires terra_fold_change');
  }
  return errors;
}

export function validateWbc(r) {
  const errors = [];
  if (r.schema_version !== WBC_SCHEMA) errors.push(`schema_version: must be "${WBC_SCHEMA}"`);
  sharedChecks(errors, r);
  requireKeys(errors, r, WBC_FIELDS);
  predictionChecks(errors, r);
  nullOr(errors, r, 'wbc_total', v => isNum(v) && v >= 0, 'must be a non-negative number or null');
  if (isNum(r.wbc_total) && r.wbc_unit !== '10^9/L') errors.push('wbc_unit: total WBC is stored in 10^9/L');
  if (r.relative_change_only === true && r.wbc_total !== null) errors.push('wbc_total: must be null when the source reports only a relative change (do not invent absolute counts)');
  if (r.relative_change_only === true && !isNum(r.relative_change_percent)) errors.push('relative_change_percent: required when relative_change_only is true');
  if (!['measured', 'predicted', 'simulated', 'reference'].includes(r.measurement_status)) errors.push('measurement_status: must be measured | predicted | simulated | reference');
  if (r.value_origin === 'observed' && r.measurement_status !== 'measured') errors.push('measurement_status: observed records must be "measured"');
  if (r.differential_absolute !== null && r.differential_absolute !== undefined) {
    for (const [k, v] of Object.entries(r.differential_absolute)) {
      if (!WBC_DIFFERENTIAL_KEYS.includes(k)) errors.push(`differential_absolute.${k}: unknown population`);
      else if (v !== null && !(isNum(v) && v >= 0)) errors.push(`differential_absolute.${k}: non-negative 10^9/L or null`);
    }
  }
  if (isNum(r.lab_reference_low) && isNum(r.lab_reference_high) && r.lab_reference_low > r.lab_reference_high) errors.push('lab reference range is inverted');
  if (isNum(r.percent_change_from_baseline) && !(isNum(r.baseline_value) && isStr(r.baseline_id))) errors.push('percent_change_from_baseline requires baseline_id and baseline_value');
  return errors;
}

const GRAY = /Gy/;
const SIEVERT = /Sv/;
export function validateRadiation(r) {
  const errors = [];
  if (r.schema_version !== RADIATION_SCHEMA) errors.push(`schema_version: must be "${RADIATION_SCHEMA}"`);
  sharedChecks(errors, r);
  requireKeys(errors, r, RADIATION_FIELDS);
  if (!DOSE_QUANTITIES.includes(r.dose_quantity)) errors.push(`dose_quantity: must be one of ${DOSE_QUANTITIES.join(' | ')}`);
  const units = [r.original_unit, r.rate_unit, r.cumulative_unit].filter(isStr);
  if (r.dose_quantity === 'absorbed_dose' && units.some(u => SIEVERT.test(u))) errors.push('absorbed dose must keep Gy-based units; relabeling as Sv needs a documented conversion and a different dose_quantity');
  if ((r.dose_quantity === 'dose_equivalent' || r.dose_quantity === 'nasa_effective_dose') && units.some(u => GRAY.test(u))) errors.push('dose equivalent / effective dose must use Sv-based units');
  if (isIso(r.interval_start) && isIso(r.interval_end) && Date.parse(r.interval_start) > Date.parse(r.interval_end)) errors.push('interval_start must not follow interval_end');
  nullOr(errors, r, 'rate_value', v => isNum(v) && v >= 0, 'must be non-negative or null');
  nullOr(errors, r, 'cumulative_value', v => isNum(v) && v >= 0, 'must be non-negative or null');
  if (!['area_monitor', 'personal_dosimeter', 'scenario', 'model', 'unspecified'].includes(r.detector_type)) errors.push('detector_type: area_monitor | personal_dosimeter | scenario | model | unspecified');
  if (r.detector_type === 'area_monitor' && r.personal_dosimeter === true) errors.push('personal_dosimeter: an area monitor is not a personal dosimeter');
  return errors;
}

export function validateEvent(r) {
  const errors = [];
  if (r.schema_version !== EVENT_SCHEMA) errors.push(`schema_version: must be "${EVENT_SCHEMA}"`);
  requireKeys(errors, r, EVENT_FIELDS);
  if (!isStr(r.event_id)) errors.push('event_id: required');
  if (!isStr(r.event_type)) errors.push('event_type: required');
  nullOr(errors, r, 'start_time', isIso, 'must be ISO 8601 with timezone');
  nullOr(errors, r, 'end_time', isIso, 'must be ISO 8601 with timezone');
  nullOr(errors, r, 'phase', v => PHASES.includes(v), 'unknown phase');
  nullOr(errors, r, 'region', v => REGIONS.includes(v), 'unknown region');
  if (!['established', 'supported', 'hypothesis', 'simulated', 'observed', 'unverified'].includes(r.evidence_status)) {
    errors.push('evidence_status: established | supported | hypothesis | simulated | observed | unverified');
  }
  for (const k of ['affected_metrics', 'related_record_ids', 'possible_contributors', 'source_references']) {
    if (!Array.isArray(r[k])) errors.push(`${k}: must be an array`);
  }
  return errors;
}

export const VALIDATORS = { [TERRA_SCHEMA]: validateTerra, [WBC_SCHEMA]: validateWbc, [RADIATION_SCHEMA]: validateRadiation, [EVENT_SCHEMA]: validateEvent };

export function validateRecord(r) {
  if (!r || typeof r !== 'object') return ['record must be an object'];
  const v = VALIDATORS[r.schema_version];
  if (!v) return [`schema_version: unknown (${r.schema_version}); expected one of ${Object.keys(VALIDATORS).join(', ')}`];
  return v(r);
}

// Batch check: predictions must not use observations timestamped after generation.
export function validateBatch(records) {
  const idOf = r => (r && (r.record_id || r.event_id)) || null;
  const byId = new Map(records.map(r => [idOf(r), r]));
  const results = records.map(r => ({ record_id: idOf(r), errors: validateRecord(r) }));
  records.forEach((r, i) => {
    if (r.value_origin !== 'model_prediction' || !Array.isArray(r.input_record_ids) || !isIso(r.prediction_generated_at)) return;
    const gen = Date.parse(r.prediction_generated_at);
    for (const id of r.input_record_ids) {
      const inp = byId.get(id);
      const ts = inp && (inp.timestamp_utc || inp.time_window_end);
      if (ts && Date.parse(ts) > gen) results[i].errors.push(`input_record_ids: ${id} is timestamped after prediction_generated_at (future leakage)`);
    }
  });
  const ids = new Set();
  results.forEach((res, i) => { const id = idOf(records[i]); if (ids.has(id)) res.errors.push('record_id: duplicate'); ids.add(id); });
  return { valid: results.every(r => r.errors.length === 0), results };
}

export function emptyShared(overrides = {}) {
  const base = Object.fromEntries(SHARED_FIELDS.map(k => [k, null]));
  base.aggregate = false;
  return { ...base, ...overrides };
}

export function emptyTerra(overrides = {}) {
  return { ...emptyShared(), ...Object.fromEntries(TERRA_FIELDS.map(k => [k, null])), schema_version: TERRA_SCHEMA, ...overrides };
}
export function emptyWbc(overrides = {}) {
  return { ...emptyShared(), ...Object.fromEntries(WBC_FIELDS.map(k => [k, null])), schema_version: WBC_SCHEMA, wbc_unit: '10^9/L', relative_change_only: false, ...overrides };
}
export function emptyRadiation(overrides = {}) {
  return { ...emptyShared(), ...Object.fromEntries(RADIATION_FIELDS.map(k => [k, null])), schema_version: RADIATION_SCHEMA, ...overrides };
}
export function emptyEvent(overrides = {}) {
  return { schema_version: EVENT_SCHEMA, ...Object.fromEntries(EVENT_FIELDS.map(k => [k, null])),
    affected_metrics: [], related_record_ids: [], possible_contributors: [], source_references: [], ...overrides };
}
