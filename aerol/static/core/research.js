// Observed-research adapters. Preserves source units, timing windows and cohort labels.
import { DAY, HOUR, isNum, sampleGrid, fmt, signed, median } from './util.js';
import { RADIATION_SCHEMA, emptyRadiation } from './schema.js';
import { PHASES, PHASE_LABEL, friendlyCode } from './schedule.js';

export function missionTimes(m) {
  return { launch: Date.parse(m.launch_utc), landing: Date.parse(m.landing_utc) };
}

export function twinsPhases(research) {
  const m = research.missions.twins;
  const { launch, landing } = missionTimes(m);
  const third = (landing - launch) / 3;
  return [
    { phase: 'preflight', start: launch - 60 * DAY, end: launch },
    { phase: 'early_flight', start: launch, end: launch + third },
    { phase: 'mid_flight', start: launch + third, end: launch + 2 * third },
    { phase: 'late_flight', start: launch + 2 * third, end: landing },
    { phase: 'landing', start: landing, end: landing + 3 * DAY },
    { phase: 'after_return', start: landing + 3 * DAY, end: landing + 200 * DAY },
  ];
}

const dateMid = rec => Date.parse(rec.time_window_start) + 12 * HOUR;

export function twinsTerra(research) {
  return research.records.filter(r => r.schema_version === 'aerol.terra.v1' && r.mission_id === research.missions.twins.mission_id)
    .map(r => ({ t: dateMid(r), v: r.raw_value * 1000, rec: r, label: r.mission_day !== null ? `FD${r.mission_day}` : `R+${r.return_day}` }));
}

export function dostelRows(research, detector) {
  const F = research.dostel_daily.fields;
  return research.dostel_daily.rows.map(row => Object.fromEntries(F.map((f, i) => [f, row[i]]))).filter(r => r.instrument_id === detector);
}

// Daily step segments (µGy/h). Days without coverage are gaps (null), never zero.
export function dostelSegments(research, detector) {
  return dostelRows(research, detector).map(r => {
    const start = Date.parse(r.date + 'T00:00:00Z');
    return { start, end: start + DAY, v: r.mean_rate_uGy_h, coverage: r.coverage, eligible: r.eligible, date: r.date };
  });
}

// Cumulative station absorbed dose over covered hours only (mGy). Uncovered time adds nothing and is reported.
export function dostelCumulative(research, detector) {
  let D = 0;
  let missingHours = 0;
  const pts = [];
  for (const r of dostelRows(research, detector)) {
    const start = Date.parse(r.date + 'T00:00:00Z');
    D += (r.observed_dose_uGy || 0) / 1000;
    missingHours += 24 - (r.covered_hours || 0);
    pts.push({ t: start + DAY, v: D, missingHours });
  }
  return { points: pts, total_mGy: D, missingHours };
}

export function dostelRecord(r, mission) {
  const start = new Date(Date.parse(r.date + 'T00:00:00Z')).toISOString().replace('.000', '');
  const end = new Date(Date.parse(r.date + 'T00:00:00Z') + DAY).toISOString().replace('.000', '');
  return emptyRadiation({
    schema_version: RADIATION_SCHEMA, record_id: `radlab-${r.instrument_id}-${r.date}`, mission_id: mission.mission_id, study_id: 'NASA-RadLab',
    time_window_start: start, time_window_end: end, mission_day: r.flight_day, exposure_region: 'inside_magnetosphere',
    mission_phase: null, trajectory_source: 'ISS low Earth orbit', value_origin: 'observed',
    source_reference: 'NASA RadLab ISS export (daily time-weighted mean from bundled raw rows)',
    quality_flag: r.eligible ? 'ok' : (r.mean_rate_uGy_h === null ? 'no_coverage' : 'coverage_below_80pct'),
    original_value: r.mean_rate_uGy_h, original_unit: 'µGy/h', dose_quantity: 'absorbed_dose', rate_value: r.mean_rate_uGy_h, rate_unit: 'µGy/h',
    interval_start: start, interval_end: end, detector_id: r.instrument_id, detector_type: 'area_monitor', personal_dosimeter: false,
    conversion_assumptions: 'None. Absorbed dose rate is kept in µGy/h; not converted to Sv.', coverage_fraction: r.coverage,
  });
}

export function i4Wbc(research) {
  const m = research.missions.inspiration4;
  const { launch, landing } = missionTimes(m);
  return research.records.filter(r => r.schema_version === 'aerol.wbc.v1' && r.mission_id === m.mission_id).map(r => ({
    t: r.mission_day !== null ? launch + r.mission_day * DAY : landing + r.return_day * DAY,
    v: r.wbc_total, subject: r.astronaut_id, rec: r,
    label: r.mission_day !== null ? `L${r.mission_day}` : `R+${r.return_day}`,
  }));
}

export function correlationsTable(research) {
  return research.correlations.filter(c => c.cutoff_shift_days === 0).map(c => ({
    detector: c.instrument_id, window_days: c.window_days, n: c.n, r: c.pearson_r, rho: c.spearman_rho, partial: c.partial_r_controlling_linear_flight_day,
  }));
}

// ---- Phase comparison: aligned by phase, each cell keeps its own timing, cohort and units ----
export function phaseComparison(research, model) {
  const rows = [];
  // NASA Twins TERRA (observed, raw units)
  const terra = twinsTerra(research);
  rows.push({
    id: 'twins-terra', dataset: 'TERRA · NASA Twins Study', cohort: 'Flight subject TW, n = 1', origin: 'observed', unit: 'normalized abundance ×10⁻³ (raw)',
    note: 'No pre-flight personal baseline exists in the bundled data, so no fold change is computed.',
    cells: Object.fromEntries(PHASES.map(p => [p, terra.filter(x => x.rec.mission_phase === p).map(x => `${friendlyCode(x.label)}: ${fmt(x.v, 2)}`)])),
    empty: { preflight: 'No flight-subject pre-flight sample in bundle', landing: 'No landing-day sample' },
  });
  // Inspiration4 CBC (observed, absolute)
  const i4 = i4Wbc(research);
  const byLabel = {};
  for (const x of i4) (byLabel[x.label] ||= []).push(x);
  const i4cells = Object.fromEntries(PHASES.map(p => [p, []]));
  for (const [label, xs] of Object.entries(byLabel)) {
    const vals = xs.map(x => x.v);
    i4cells[xs[0].rec.mission_phase].push(`${friendlyCode(label)}: median ${fmt(median(vals), 1)} (${fmt(Math.min(...vals), 1)}–${fmt(Math.max(...vals), 1)}), n=${vals.length}`);
  }
  for (const p of PHASES) i4cells[p].sort((a, b) => order(a) - order(b));
  rows.push({ id: 'i4-wbc', dataset: 'WBC · Inspiration4 (OSD-569)', cohort: '4 crew, 3-day flight at ~585 km', origin: 'observed', unit: '10⁹/L',
    note: 'No in-flight samples. 1 day after landing is the closest sample to landing.', cells: i4cells,
    empty: { early_flight: 'No in-flight sample', mid_flight: 'No in-flight sample', late_flight: 'No in-flight sample' } });
  // Crucian (cohort, qualitative)
  rows.push({ id: 'crucian', dataset: 'WBC · ISS immune study (Crucian 2015)', cohort: '23 ISS crew (cohort means)', origin: 'published finding (qualitative)', unit: 'vs 6-month pre-flight baseline',
    note: 'Values exist only in figures; no absolute counts imported.',
    cells: { preflight: ['6 months before launch (baseline), 45 days before launch'], early_flight: ['About flight day 14: WBC & granulocytes ↑ (significant)'], mid_flight: ['Months 2–4: elevated, not significant'],
      late_flight: ['~6 months: WBC ↑ (significant)'], landing: ['~3 h after landing: WBC surge'], after_return: ['30 days after landing'] }, empty: {} });
  // Report digitized ISS WBC (relative)
  const dig = research.records.filter(r => r.study_id === 'combined_radiation_report');
  rows.push({ id: 'report-iss', dataset: 'WBC · combined report “ISS (original)”', cohort: 'Aggregate; upstream source not stated', origin: 'digitized_reference (±5 pp)', unit: '% vs report baseline',
    note: 'Read by eye from a chart in the team PDF; baseline definition not stated.',
    cells: Object.fromEntries(PHASES.map(p => [p, dig.filter(r => r.mission_phase === p).map(r => `${signed(r.relative_change_percent, 0, '%')} (${friendlyCode(r.mission_day !== null ? 'FD~' + r.mission_day : 'R+' + r.return_day)})`)])), empty: {} });
  const rp = research.report_projection;
  rows.push({ id: 'report-proj', dataset: 'TERRA / WBC · combined report deep-space projection', cohort: 'Illustrative model output', origin: 'digitized_reference of a projection', unit: '% change',
    note: rp.note,
    cells: Object.fromEntries(PHASES.map(p => [p, [`TERRA ${rp.terra_pct[p] === null ? 'no value (not fabricated)' : signed(rp.terra_pct[p], 0, '%')}`, `WBC ${signed(rp.wbc_pct[p], 0, '%')}`]])), empty: {} });
  // Current simulation (synthetic)
  if (model) {
    const cells = Object.fromEntries(PHASES.map(p => [p, []]));
    for (const l of model.labs) {
      const txt = l.kind === 'terra' ? `${friendlyCode(l.label)}: TERRA ${fmt(l.fold, 2)}× (${signed(l.pct, 0, '%')})` : `${friendlyCode(l.label)}: WBC ${fmt(l.value, 1)}`;
      cells[l.phase].push(txt);
    }
    rows.push({ id: 'sim', dataset: 'Simulation · ' + model.scenario.name, cohort: `Synthetic astronaut ${model.scenario.astronaut_id}`, origin: 'simulation', unit: 'fold vs 6-month baseline / 10⁹/L',
      note: 'Simulated lab draws from the hand-set simulator — not data.', cells, empty: { landing: 'R+0 has WBC only (no TERRA sample planned)' } });
  }
  return rows;
}

function order(s) {
  const m = s.match(/^(L|R\+)(-?\d+)/);
  if (!m) return 0;
  return m[1] === 'L' ? Number(m[2]) : 1000 + Number(m[2]);
}

export { PHASE_LABEL };
