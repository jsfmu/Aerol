"""Server-side validator for the AEROL record contract.

Mirrors aerol/static/core/schema.js. Both are exercised against tests/fixtures/records.json.
"""
import math
import re
from datetime import datetime

TERRA_SCHEMA = 'aerol.terra.v1'
WBC_SCHEMA = 'aerol.wbc.v1'
RADIATION_SCHEMA = 'aerol.radiation.v1'
EVENT_SCHEMA = 'aerol.event.v1'

PHASES = ['preflight', 'early_flight', 'mid_flight', 'late_flight', 'landing', 'after_return']
REGIONS = ['ground', 'inside_magnetosphere', 'radiation_belt_transit', 'beyond_magnetosphere', 'unknown']
VALUE_ORIGINS = ['observed', 'digitized_reference', 'model_prediction', 'simulation']
UNCERTAINTY_TYPES = ['scenario_sensitivity_range', 'prediction_interval', 'confidence_interval']
DOSE_QUANTITIES = ['absorbed_dose', 'dose_equivalent', 'nasa_effective_dose', 'detector_operational']
DIFFERENTIAL = ['neutrophils', 'lymphocytes', 'monocytes', 'eosinophils', 'basophils']

SHARED_FIELDS = ['schema_version', 'record_id', 'astronaut_id', 'mission_id', 'study_id', 'cohort_id',
                 'timestamp_utc', 'time_window_start', 'time_window_end', 'mission_day', 'return_day',
                 'mission_phase', 'exposure_region', 'trajectory_source', 'value_origin', 'source_reference',
                 'quality_flag', 'aggregate', 'sample_size']
TERRA_FIELDS = ['specimen', 'assay_method', 'raw_value', 'raw_unit', 'normalization_method',
                'baseline_id', 'baseline_value', 'baseline_window', 'terra_fold_change', 'terra_percent_change',
                'model_version', 'input_record_ids', 'prediction_generated_at', 'prediction_target_time',
                'uncertainty_lower', 'uncertainty_upper', 'uncertainty_type']
WBC_FIELDS = ['specimen', 'assay_method', 'wbc_total', 'wbc_unit', 'original_value', 'original_unit', 'conversion_note',
              'differential_absolute', 'differential_percent', 'lab_reference_low', 'lab_reference_high', 'reference_source',
              'baseline_id', 'baseline_value', 'percent_change_from_baseline', 'relative_change_only', 'relative_change_percent',
              'measurement_status', 'model_version', 'input_record_ids', 'prediction_generated_at', 'prediction_target_time',
              'uncertainty_lower', 'uncertainty_upper', 'uncertainty_type']
RADIATION_FIELDS = ['original_value', 'original_unit', 'dose_quantity', 'rate_value', 'rate_unit',
                    'interval_start', 'interval_end', 'cumulative_value', 'cumulative_unit', 'detector_id', 'detector_type',
                    'personal_dosimeter', 'conversion_assumptions', 'coverage_fraction']
EVENT_FIELDS = ['event_id', 'event_type', 'start_time', 'end_time', 'phase', 'region', 'affected_metrics',
                'related_record_ids', 'definition', 'observed_change', 'possible_contributors', 'evidence_status',
                'source_references', 'suggested_action']

_ISO = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$')


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _iso(v):
    if not isinstance(v, str) or not _ISO.match(v):
        return False
    try:
        datetime.fromisoformat(v.replace('Z', '+00:00'))
        return True
    except ValueError:
        return False


def _ts(v):
    return datetime.fromisoformat(v.replace('Z', '+00:00')).timestamp()


def _null_or(errors, r, key, check, msg):
    if r.get(key) is None:
        return
    if not check(r[key]):
        errors.append(f'{key}: {msg}')


def _require(errors, r, keys):
    for k in keys:
        if k not in r:
            errors.append(f'{k}: required field missing (use null when unavailable)')


def _shared(errors, r):
    _require(errors, r, [k for k in SHARED_FIELDS if k not in ('aggregate', 'sample_size')])
    if not isinstance(r.get('record_id'), str) or not r.get('record_id'):
        errors.append('record_id: required non-empty string')
    if r.get('value_origin') not in VALUE_ORIGINS:
        errors.append('value_origin: must be one of ' + ' | '.join(VALUE_ORIGINS))
    for k in ('timestamp_utc', 'time_window_start', 'time_window_end'):
        _null_or(errors, r, k, _iso, 'must be ISO 8601 with timezone, or null')
    if _iso(r.get('time_window_start')) and _iso(r.get('time_window_end')) and _ts(r['time_window_start']) > _ts(r['time_window_end']):
        errors.append('time_window_start must not follow time_window_end')
    _null_or(errors, r, 'mission_phase', lambda v: v in PHASES, 'must be one of ' + ' | '.join(PHASES))
    _null_or(errors, r, 'exposure_region', lambda v: v in REGIONS, 'must be one of ' + ' | '.join(REGIONS))
    _null_or(errors, r, 'mission_day', _num, 'must be a number or null')
    _null_or(errors, r, 'return_day', lambda v: _num(v) and v >= 0, 'must be ≥ 0 or null')
    if all(r.get(k) is None for k in ('timestamp_utc', 'time_window_start', 'mission_day', 'return_day')):
        errors.append('timing: provide timestamp_utc, a time window, mission_day or return_day')
    if r.get('aggregate') is True:
        if r.get('astronaut_id') is not None:
            errors.append('astronaut_id: cohort aggregates must not carry an individual identity (use null)')
        if not isinstance(r.get('cohort_id'), str) or not r.get('cohort_id'):
            errors.append('cohort_id: required for aggregates')
        _null_or(errors, r, 'sample_size', lambda v: isinstance(v, int) and not isinstance(v, bool) and v >= 1,
                 'must be a positive integer or null when unknown')


def _prediction(errors, r):
    origin = r.get('value_origin')
    if origin == 'model_prediction':
        if not isinstance(r.get('model_version'), str):
            errors.append('model_version: required for model predictions')
        if not _iso(r.get('prediction_generated_at')):
            errors.append('prediction_generated_at: required ISO timestamp for model predictions')
        if not _iso(r.get('prediction_target_time')):
            errors.append('prediction_target_time: required ISO timestamp for model predictions')
    _null_or(errors, r, 'input_record_ids', lambda v: isinstance(v, list) and all(isinstance(x, str) for x in v),
             'must be an array of record ids')
    _null_or(errors, r, 'uncertainty_type', lambda v: v in UNCERTAINTY_TYPES, 'must be one of ' + ' | '.join(UNCERTAINTY_TYPES))
    if origin == 'simulation' and r.get('uncertainty_type') in ('prediction_interval', 'confidence_interval'):
        errors.append('uncertainty_type: bands from adjustable simulation assumptions are scenario_sensitivity_range, not statistical intervals')
    lo, hi = r.get('uncertainty_lower'), r.get('uncertainty_upper')
    if _num(lo) and _num(hi) and lo > hi:
        errors.append('uncertainty_lower must not exceed uncertainty_upper')
    if origin not in ('model_prediction', 'simulation') and (r.get('model_version') or r.get('prediction_generated_at')):
        errors.append('model fields: only model predictions or simulations may carry model metadata')


def validate_terra(r):
    errors = []
    if r.get('schema_version') != TERRA_SCHEMA:
        errors.append(f'schema_version: must be "{TERRA_SCHEMA}"')
    _shared(errors, r)
    _require(errors, r, TERRA_FIELDS)
    _prediction(errors, r)
    _null_or(errors, r, 'raw_value', lambda v: _num(v) and v >= 0, 'must be a non-negative number or null')
    if _num(r.get('raw_value')) and not isinstance(r.get('raw_unit'), str):
        errors.append('raw_unit: required when raw_value is present')
    if _num(r.get('raw_value')) and not isinstance(r.get('assay_method'), str):
        errors.append('assay_method: required when raw_value is present')
    if r.get('quality_flag') == 'missing' and (r.get('raw_value') is not None or r.get('terra_fold_change') is not None):
        errors.append('missing records must use null values, never zero')
    fold, pct = r.get('terra_fold_change'), r.get('terra_percent_change')
    if fold is not None:
        if not _num(fold) or fold < 0:
            errors.append('terra_fold_change: must be a non-negative number')
        if r.get('value_origin') in ('observed', 'digitized_reference'):
            base = r.get('baseline_value')
            if not isinstance(r.get('baseline_id'), str):
                errors.append('baseline_id: fold change requires a matched personal baseline')
            if not (_num(base) and base > 0):
                errors.append('baseline_value: fold change requires a positive matched baseline value')
            raw = r.get('raw_value')
            if _num(raw) and _num(base) and base > 0 and _num(fold):
                expect = raw / base
                if abs(expect - fold) > 1e-6 * max(1, expect):
                    errors.append('terra_fold_change must equal raw_value / baseline_value')
        if _num(pct) and _num(fold) and abs(pct - 100 * (fold - 1)) > 1e-6:
            errors.append('terra_percent_change must equal 100 × (terra_fold_change − 1)')
    elif pct is not None:
        errors.append('terra_percent_change requires terra_fold_change')
    return errors


def validate_wbc(r):
    errors = []
    if r.get('schema_version') != WBC_SCHEMA:
        errors.append(f'schema_version: must be "{WBC_SCHEMA}"')
    _shared(errors, r)
    _require(errors, r, WBC_FIELDS)
    _prediction(errors, r)
    _null_or(errors, r, 'wbc_total', lambda v: _num(v) and v >= 0, 'must be a non-negative number or null')
    if _num(r.get('wbc_total')) and r.get('wbc_unit') != '10^9/L':
        errors.append('wbc_unit: total WBC is stored in 10^9/L')
    if r.get('relative_change_only') is True and r.get('wbc_total') is not None:
        errors.append('wbc_total: must be null when the source reports only a relative change (do not invent absolute counts)')
    if r.get('relative_change_only') is True and not _num(r.get('relative_change_percent')):
        errors.append('relative_change_percent: required when relative_change_only is true')
    if r.get('measurement_status') not in ('measured', 'predicted', 'simulated', 'reference'):
        errors.append('measurement_status: must be measured | predicted | simulated | reference')
    if r.get('value_origin') == 'observed' and r.get('measurement_status') != 'measured':
        errors.append('measurement_status: observed records must be "measured"')
    diff = r.get('differential_absolute')
    if diff is not None:
        for k, v in diff.items():
            if k not in DIFFERENTIAL:
                errors.append(f'differential_absolute.{k}: unknown population')
            elif v is not None and not (_num(v) and v >= 0):
                errors.append(f'differential_absolute.{k}: non-negative 10^9/L or null')
    lo, hi = r.get('lab_reference_low'), r.get('lab_reference_high')
    if _num(lo) and _num(hi) and lo > hi:
        errors.append('lab reference range is inverted')
    if _num(r.get('percent_change_from_baseline')) and not (_num(r.get('baseline_value')) and isinstance(r.get('baseline_id'), str)):
        errors.append('percent_change_from_baseline requires baseline_id and baseline_value')
    return errors


def validate_radiation(r):
    errors = []
    if r.get('schema_version') != RADIATION_SCHEMA:
        errors.append(f'schema_version: must be "{RADIATION_SCHEMA}"')
    _shared(errors, r)
    _require(errors, r, RADIATION_FIELDS)
    q = r.get('dose_quantity')
    if q not in DOSE_QUANTITIES:
        errors.append('dose_quantity: must be one of ' + ' | '.join(DOSE_QUANTITIES))
    units = [u for u in (r.get('original_unit'), r.get('rate_unit'), r.get('cumulative_unit')) if isinstance(u, str)]
    if q == 'absorbed_dose' and any('Sv' in u for u in units):
        errors.append('absorbed dose must keep Gy-based units; relabeling as Sv needs a documented conversion and a different dose_quantity')
    if q in ('dose_equivalent', 'nasa_effective_dose') and any('Gy' in u for u in units):
        errors.append('dose equivalent / effective dose must use Sv-based units')
    if _iso(r.get('interval_start')) and _iso(r.get('interval_end')) and _ts(r['interval_start']) > _ts(r['interval_end']):
        errors.append('interval_start must not follow interval_end')
    _null_or(errors, r, 'rate_value', lambda v: _num(v) and v >= 0, 'must be non-negative or null')
    _null_or(errors, r, 'cumulative_value', lambda v: _num(v) and v >= 0, 'must be non-negative or null')
    if r.get('detector_type') not in ('area_monitor', 'personal_dosimeter', 'scenario', 'model', 'unspecified'):
        errors.append('detector_type: area_monitor | personal_dosimeter | scenario | model | unspecified')
    if r.get('detector_type') == 'area_monitor' and r.get('personal_dosimeter') is True:
        errors.append('personal_dosimeter: an area monitor is not a personal dosimeter')
    return errors


def validate_event(r):
    errors = []
    if r.get('schema_version') != EVENT_SCHEMA:
        errors.append(f'schema_version: must be "{EVENT_SCHEMA}"')
    _require(errors, r, EVENT_FIELDS)
    if not isinstance(r.get('event_id'), str):
        errors.append('event_id: required')
    if not isinstance(r.get('event_type'), str):
        errors.append('event_type: required')
    _null_or(errors, r, 'start_time', _iso, 'must be ISO 8601 with timezone')
    _null_or(errors, r, 'end_time', _iso, 'must be ISO 8601 with timezone')
    _null_or(errors, r, 'phase', lambda v: v in PHASES, 'unknown phase')
    _null_or(errors, r, 'region', lambda v: v in REGIONS, 'unknown region')
    if r.get('evidence_status') not in ('established', 'supported', 'hypothesis', 'simulated', 'observed', 'unverified'):
        errors.append('evidence_status: established | supported | hypothesis | simulated | observed | unverified')
    for k in ('affected_metrics', 'related_record_ids', 'possible_contributors', 'source_references'):
        if not isinstance(r.get(k), list):
            errors.append(f'{k}: must be an array')
    return errors


VALIDATORS = {TERRA_SCHEMA: validate_terra, WBC_SCHEMA: validate_wbc,
              RADIATION_SCHEMA: validate_radiation, EVENT_SCHEMA: validate_event}


def validate_record(r):
    if not isinstance(r, dict):
        return ['record must be an object']
    v = VALIDATORS.get(r.get('schema_version'))
    if v is None:
        return [f"schema_version: unknown ({r.get('schema_version')}); expected one of {', '.join(VALIDATORS)}"]
    return v(r)


def validate_batch(records):
    def rid_of(r):
        return (r.get('record_id') or r.get('event_id')) if isinstance(r, dict) else None
    by_id = {rid_of(r): r for r in records if isinstance(r, dict)}
    results = [{'record_id': rid_of(r), 'errors': validate_record(r)} for r in records]
    for i, r in enumerate(records):
        if not isinstance(r, dict) or r.get('value_origin') != 'model_prediction':
            continue
        if not isinstance(r.get('input_record_ids'), list) or not _iso(r.get('prediction_generated_at')):
            continue
        gen = _ts(r['prediction_generated_at'])
        for rid in r['input_record_ids']:
            inp = by_id.get(rid)
            stamp = inp and (inp.get('timestamp_utc') or inp.get('time_window_end'))
            if stamp and _iso(stamp) and _ts(stamp) > gen:
                results[i]['errors'].append(f'input_record_ids: {rid} is timestamped after prediction_generated_at (future leakage)')
    seen = set()
    for i, r in enumerate(records):
        rid = rid_of(r)
        if rid in seen:
            results[i]['errors'].append('record_id: duplicate')
        seen.add(rid)
    return {'valid': all(not x['errors'] for x in results), 'results': results}
