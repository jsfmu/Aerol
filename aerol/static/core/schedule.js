// Mission schedule: canonical phases, independent exposure regions, and timestamp notation.
// Phase = where the astronaut is in the mission timeline.
// Region = trajectory/exposure context from explicit scenario settings (never inferred from biology).
import { DAY, HOUR, isNum } from './util.js';

export const PHASES = ['preflight', 'early_flight', 'mid_flight', 'late_flight', 'landing', 'after_return'];
export const PHASE_LABEL = {
  preflight: 'Pre-flight', early_flight: 'Early flight', mid_flight: 'Mid flight',
  late_flight: 'Late flight', landing: 'Landing', after_return: 'After return',
};
export const REGIONS = ['ground', 'inside_magnetosphere', 'radiation_belt_transit', 'beyond_magnetosphere', 'unknown'];
export const REGION_LABEL = {
  ground: 'Ground', inside_magnetosphere: 'Inside magnetosphere', radiation_belt_transit: 'Radiation-belt transit',
  beyond_magnetosphere: 'Beyond magnetosphere', unknown: 'Unknown',
};

const deepCopy = o => JSON.parse(JSON.stringify(o));

// Default demonstration preset. Every number here is an editable scenario assumption, not a finding.
export const DEFAULT_SCENARIO = Object.freeze({
  scenario_version: 'aerol.scenario.v1',
  id: 'hypothesis-default',
  name: 'Hypothesis-driven mission simulation',
  description: 'Hypothetical 180-day cislunar mission (synthetic astronaut). Demonstration preset, not a learned model outcome and not an actual mission trajectory.',
  seed: 20310303,
  astronaut_id: 'SYN-A01',
  mission_id: 'SIM-CISLUNAR-180',
  launch_utc: '2031-03-03T14:00:00Z',
  mission_days: 180,
  trajectory_source: 'scenario_settings',
  exit_day: 28, // magnetosphere exit (explicit trajectory event)
  reentry_day: 150, // magnetosphere re-entry, separate from landing
  belt_transit_hours: 6,
  dose: {
    // Mission-attributable dose-equivalent RATE references, mSv/day.
    inside: 0.7, // illustrative midpoint of the 0.4–1.0 mSv/day reference range supplied with the project
    belt: 1.84, // placeholder: no source-backed belt-transit rate in this prototype
    beyond: 1.84, // historical deep-space cruise reference (MSL RAD, 2011–12); not universal, not a safety threshold
  },
  spe: { enabled: false, day: 96, duration_h: 12, dose_mSv: 40 },
  baseline_window_days: [-180, -60],
  stress: { onset_days_before_launch: 30, amplitude: 0.35, decay_days: 12 },
  terra: { sensitivity: 0.6, lag_days: 7, rise_days: 30, recovery_days: 45, landing_amplitude: 0, landing_decay_days: 5, residual_sd: 0.06 },
  wbc: {
    baseline: 6.0, stress_share: 0.08, flight_adaptation: 0.12, adaptation_days: 10,
    radiation_per_mSv_day: 0.03, landing_amplitude: 0.45, landing_decay_days: 1.5, residual_sd: 0.04,
    lab_range: [3.8, 10.8],
  },
  phases: { early_end_day: 60, mid_end_day: 120, landing_window_days: 3 },
  view_days: [-200, 362],
  samples: [
    { label: 'L-180', anchor: 'launch', day: -180, specimens: ['wbc', 'terra'], purpose: 'Personal baseline (before modeled pre-mission stress window)' },
    { label: 'L-45', anchor: 'launch', day: -45, specimens: ['wbc', 'terra'], purpose: 'Pre-flight' },
    { label: 'L-10', anchor: 'launch', day: -10, specimens: ['wbc', 'terra'], purpose: 'Pre-flight (inside modeled stress window)' },
    { label: 'FD14', anchor: 'launch', day: 14, specimens: ['wbc', 'terra'], purpose: 'Early flight' },
    { label: 'FD60', anchor: 'launch', day: 60, specimens: ['wbc', 'terra'], purpose: 'Mid flight' },
    { label: 'FD120', anchor: 'launch', day: 120, specimens: ['wbc', 'terra'], purpose: 'Mid/late flight' },
    { label: 'FD170', anchor: 'launch', day: 170, specimens: ['wbc', 'terra'], purpose: 'Late flight' },
    { label: 'R+0', anchor: 'landing', day: 0.125, specimens: ['wbc'], purpose: 'About 3 h after landing (no TERRA sample planned)' },
    { label: 'R+30', anchor: 'landing', day: 30, specimens: ['wbc', 'terra'], purpose: 'Recovery follow-up' },
    { label: 'R+90', anchor: 'landing', day: 90, specimens: ['wbc', 'terra'], purpose: 'Recovery follow-up' },
    { label: 'R+180', anchor: 'landing', day: 180, specimens: ['wbc', 'terra'], purpose: 'Recovery follow-up' },
  ],
  lab: {
    wbc_inflight_result_delay_days: 0.25, // proposed onboard hematology analyzer (simulated)
    wbc_ground_result_delay_days: 1,
    terra_ground_result_delay_days: 14,
    terra_inflight_assay_after_return_days: 30, // in-flight RNA stored frozen; assayed on Earth after return
  },
  link: {
    light_time_s: 1.3, ground_processing_min: 20, leo_contact_hours_per_day: 22,
    deep_contact_hours_per_day: 16,
    outages: [{ start_day: 96.4, end_day: 98.2, label: 'Simulated communication outage' }],
  },
  vitals: {
    episodes: [
      { kind: 'illness', start_day: 96, end_day: 101.5, label: 'Demo: sustained physiological deviation' },
      { kind: 'sensor_fit', start_day: 45.5, end_day: 45.53, label: 'Demo: poor sensor contact' },
      { kind: 'disconnect', start_day: 122, end_day: 122.5, label: 'Demo: wristband disconnected' },
    ],
  },
});

export const PRESETS = {
  'hypothesis-default': () => deepCopy(DEFAULT_SCENARIO),
  'leo-only': () => ({ ...deepCopy(DEFAULT_SCENARIO), id: 'leo-only', name: 'Comparison: stays inside the magnetosphere',
    description: 'Same schedule and biology assumptions; trajectory never leaves the magnetosphere.', exit_day: null, reentry_day: null }),
  'deep-whole': () => ({ ...deepCopy(DEFAULT_SCENARIO), id: 'deep-whole', name: 'Comparison: beyond the magnetosphere for the whole flight',
    description: 'Hypothetical: departs the magnetosphere on flight day 0.25 and re-enters 1 day before landing.', exit_day: 0, reentry_day: 179 }),
  'spe-event': () => { const s = deepCopy(DEFAULT_SCENARIO); s.id = 'spe-event'; s.name = 'Default + labeled solar-particle-event scenario';
    s.description = 'Adds a separately labeled, assumed solar particle event on top of steady background exposure.'; s.spe.enabled = true; return s; },
};

export function scenarioFromPreset(id) {
  return (PRESETS[id] || PRESETS['hypothesis-default'])();
}

// Build the time-resolved schedule from scenario settings.
export function buildSchedule(sc) {
  const launch = Date.parse(sc.launch_utc);
  const landing = launch + sc.mission_days * DAY;
  const at = d => launch + d * DAY;
  const beltMs = (sc.belt_transit_hours || 0) * HOUR;
  const regionChanges = [{ t: -Infinity, region: 'ground', label: 'Pre-launch (ground)' },
    { t: launch, region: 'inside_magnetosphere', label: 'Launch' }];
  const hasExit = isNum(sc.exit_day) && isNum(sc.reentry_day);
  if (hasExit) {
    const exit = at(sc.exit_day);
    const reentry = at(sc.reentry_day);
    if (beltMs > 0) regionChanges.push({ t: exit, region: 'radiation_belt_transit', label: 'Outbound radiation-belt transit' });
    regionChanges.push({ t: exit + beltMs, region: 'beyond_magnetosphere', label: 'Magnetosphere exit', key: 'magnetosphere_exit' });
    if (beltMs > 0) regionChanges.push({ t: reentry - beltMs, region: 'radiation_belt_transit', label: 'Inbound radiation-belt transit' });
    regionChanges.push({ t: reentry, region: 'inside_magnetosphere', label: 'Magnetosphere re-entry', key: 'magnetosphere_reentry' });
  }
  regionChanges.push({ t: landing, region: 'ground', label: 'Landing' });
  regionChanges.sort((a, b) => a.t - b.t);
  const p = sc.phases;
  const phases = [
    { phase: 'preflight', start: at(sc.view_days[0]), end: launch },
    { phase: 'early_flight', start: launch, end: at(p.early_end_day) },
    { phase: 'mid_flight', start: at(p.early_end_day), end: at(p.mid_end_day) },
    { phase: 'late_flight', start: at(p.mid_end_day), end: landing },
    { phase: 'landing', start: landing, end: landing + p.landing_window_days * DAY },
    { phase: 'after_return', start: landing + p.landing_window_days * DAY, end: at(sc.view_days[1]) },
  ];
  const samples = (sc.samples || []).map(s => {
    const t = (s.anchor === 'landing' ? landing : launch) + s.day * DAY;
    return { ...s, t };
  });
  return {
    launch, landing, start: at(sc.view_days[0]), end: at(sc.view_days[1]),
    baselineWindow: [at(sc.baseline_window_days[0]), at(sc.baseline_window_days[1])],
    stressOnset: launch - sc.stress.onset_days_before_launch * DAY,
    regionChanges, phases, samples, hasExit,
    exit: hasExit ? at(sc.exit_day) + beltMs : null,
    reentry: hasExit ? at(sc.reentry_day) : null,
  };
}

export function phaseAt(schedule, t) {
  if (t < schedule.launch) return 'preflight';
  for (const p of schedule.phases) if (t >= p.start && t < p.end) return p.phase;
  return 'after_return';
}

export function regionAt(schedule, t) {
  let region = 'unknown';
  for (const c of schedule.regionChanges) {
    if (c.t <= t) region = c.region;
    else break;
  }
  return region;
}

export const missionDay = (schedule, t) => (t - schedule.launch) / DAY;
export const returnDay = (schedule, t) => (t >= schedule.landing ? (t - schedule.landing) / DAY : null);

// L−/FD/R+ notation. L−n counts whole days before launch; FD counts elapsed flight days; R+ elapsed days after landing.
export function missionLabel(schedule, t, precise = false) {
  if (t < schedule.launch) {
    const d = (schedule.launch - t) / DAY;
    return precise && d < 2 ? `L−${(d * 24).toFixed(0)} h` : `L−${Math.ceil(d - 1e-9)}`;
  }
  if (t < schedule.landing) {
    const d = (t - schedule.launch) / DAY;
    return precise ? `FD ${d.toFixed(1)}` : `FD${Math.floor(d)}`;
  }
  const r = (t - schedule.landing) / DAY;
  if (r < 1) return `R+0 (${(r * 24).toFixed(0)} h)`;
  return precise ? `R+${r.toFixed(1)}` : `R+${Math.floor(r)}`;
}

// Validate an edited scenario's schedule. Returns a list of human-readable problems.
export function validateScenario(sc) {
  const errors = [];
  if (!Number.isFinite(Date.parse(sc.launch_utc))) errors.push('Launch timestamp must be ISO 8601 UTC.');
  if (!(sc.mission_days > 1)) errors.push('Mission duration must exceed 1 day.');
  const p = sc.phases || {};
  if (!(p.early_end_day > 0 && p.early_end_day < p.mid_end_day && p.mid_end_day < sc.mission_days)) errors.push('Phase boundaries must satisfy 0 < early end < mid end < landing.');
  if (isNum(sc.exit_day) !== isNum(sc.reentry_day)) errors.push('Set both magnetosphere exit and re-entry, or neither.');
  if (isNum(sc.exit_day)) {
    const belt = (sc.belt_transit_hours || 0) / 24;
    if (!(sc.exit_day >= 0 && sc.exit_day + belt < sc.reentry_day - belt && sc.reentry_day <= sc.mission_days)) {
      errors.push('Exit must follow launch, re-entry must follow exit (including belt transits), and re-entry must not follow landing.');
    }
  }
  const [b0, b1] = sc.baseline_window_days || [];
  if (!(b0 < b1 && b1 <= -(sc.stress?.onset_days_before_launch ?? 0))) errors.push('Baseline window must end before the modeled pre-mission stress onset.');
  for (const [k, v] of Object.entries(sc.dose || {})) if (!(isNum(v) && v >= 0)) errors.push(`Dose rate “${k}” must be a non-negative number.`);
  return errors;
}
