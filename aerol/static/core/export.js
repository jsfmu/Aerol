// Convert the current simulation into aerol.* schema records (value_origin = 'simulation').
import { DAY, iso, sampleGrid } from './util.js';
import { phaseAt, regionAt } from './schedule.js';
import { emptyTerra, emptyWbc, emptyRadiation } from './schema.js';
import { MODEL_REGISTRY, SYN_TERRA_BASELINE_RAW } from './models.js';
import { toEventRecords } from './events.js';

function timing(model, t) {
  const S = model.schedule;
  return {
    timestamp_utc: iso(t).replace('.000', ''), mission_day: +((t - S.launch) / DAY).toFixed(4),
    return_day: t >= S.landing ? +((t - S.landing) / DAY).toFixed(4) : null,
    mission_phase: phaseAt(S, t), exposure_region: regionAt(S, t), trajectory_source: model.scenario.trajectory_source,
  };
}

export function simulationRecords(model, { projectionStepDays = 7 } = {}) {
  const sc = model.scenario;
  const ids = { astronaut_id: sc.astronaut_id, mission_id: sc.mission_id, study_id: 'AEROL-simulation', cohort_id: null };
  const terraModel = `${MODEL_REGISTRY.terra.model_id}@${MODEL_REGISTRY.terra.model_version}`;
  const wbcModel = `${MODEL_REGISTRY.wbc.model_id}@${MODEL_REGISTRY.wbc.model_version}`;
  const out = [];
  const base = model.labs.find(l => l.kind === 'terra' && l.label === 'L-180');
  for (const l of model.labs) {
    const common = { ...ids, ...timing(model, l.t), value_origin: 'simulation', source_reference: `AEROL simulated lab draw (${sc.name}); result available ${iso(l.available)}`, quality_flag: 'simulated' };
    if (l.kind === 'terra') {
      out.push(emptyTerra({ ...common, record_id: `sim-terra-${l.label}`, specimen: 'whole blood (simulated)', assay_method: 'Simulated RNA assay', raw_value: l.raw, raw_unit: 'normalized_abundance (synthetic scale)',
        normalization_method: 'synthetic', baseline_id: base ? 'sim-terra-L-180' : null, baseline_value: base ? base.raw : null, baseline_window: 'L-180 sample',
        terra_fold_change: l.fold, terra_percent_change: l.pct, model_version: terraModel }));
    } else {
      out.push(emptyWbc({ ...common, record_id: `sim-wbc-${l.label}`, specimen: 'whole blood (simulated)', assay_method: l.method, wbc_total: l.value, wbc_unit: '10^9/L',
        differential_absolute: l.diff, lab_reference_low: sc.wbc.lab_range[0], lab_reference_high: sc.wbc.lab_range[1], reference_source: 'OSD-569 lab range (used as configured range)',
        baseline_id: 'sim-wbc-L-180', baseline_value: l.baseline, percent_change_from_baseline: l.pct_from_baseline, measurement_status: 'simulated', model_version: wbcModel }));
    }
  }
  const S = model.schedule;
  for (let t = S.launch - 60 * DAY; t <= S.end; t += projectionStepDays * DAY) {
    const f = sampleGrid(model.terra.fold, t);
    const lo = sampleGrid(model.terraEnv.lo, t);
    const hi = sampleGrid(model.terraEnv.hi, t);
    out.push(emptyTerra({ ...ids, ...timing(model, t), record_id: `sim-terra-proj-${iso(t).slice(0, 10)}`, value_origin: 'simulation',
      source_reference: 'AEROL simulated projection', quality_flag: 'projection', baseline_id: null, baseline_value: SYN_TERRA_BASELINE_RAW,
      terra_fold_change: f, terra_percent_change: 100 * (f - 1), model_version: terraModel, uncertainty_lower: lo, uncertainty_upper: hi, uncertainty_type: 'scenario_sensitivity_range',
      prediction_target_time: iso(t).replace('.000', '') }));
  }
  for (const seg of model.segments) {
    if (seg.end <= S.launch - DAY || seg.start >= S.landing + DAY) continue;
    out.push(emptyRadiation({ ...ids, ...timing(model, seg.start), timestamp_utc: null, time_window_start: iso(seg.start).replace('.000', ''), time_window_end: iso(seg.end).replace('.000', ''),
      record_id: `sim-rate-${iso(seg.start)}`, value_origin: 'simulation', source_reference: 'Scenario dose-rate segment', quality_flag: seg.components.spe ? 'includes_assumed_spe' : 'ok',
      original_value: seg.rate, original_unit: 'mSv/day', dose_quantity: 'dose_equivalent', rate_value: seg.rate, rate_unit: 'mSv/day', interval_start: iso(seg.start).replace('.000', ''), interval_end: iso(seg.end).replace('.000', ''),
      cumulative_value: seg.D0 + seg.rate * (seg.end - seg.start) / DAY, cumulative_unit: 'mSv', detector_type: 'scenario', personal_dosimeter: false,
      conversion_assumptions: 'Scenario reference rate; mission-attributable only (Earth background excluded after landing).' }));
  }
  return [...out, ...toEventRecords(model, model.events)];
}
