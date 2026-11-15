// Transparent temporal simulators for TERRA and WBC. Outputs are "simulated projections":
// hand-set, inspectable assumptions — NOT trained, NOT validated, NOT measured biology.
//
// TERRA fold change (1.0× = 0% change from matched personal baseline):
//   F(t) = max(0, 1 + S(t) + R(t) + L(t))            residual variation is added only to simulated samples
//   S(t) stress (hypothesis):  0 before onset; A·smoothstep((t−onset)/(launch−onset)) until launch; A·exp(−(t−launch)/τs) after
//   R(t) radiation history:    dR/dt = (k·r(t−lag) − R)/τ, τ = τrise if target > R else τrecovery
//                              (k: fold-change per mSv/day at steady state; r: scenario dose rate)
//   L(t) optional landing:     A_L·exp(−(t−landing)/τL) for t ≥ landing
// Cumulative recorded dose never decreases; R(t) can decline once exposure falls.
//
// WBC total (10⁹/L): W(t) = W0·(1 + s_w·Ŝ(t) + F(t) + k_w·r̄(t) + L_w(t)), clamped ≥ 0, modeled separately from TERRA.
import { DAY, rng, gaussian, smoothstep, isNum, sampleGrid, round } from './util.js';
import { rateAt, doseAt } from './radiation.js';
import { missionLabel, phaseAt, regionAt } from './schedule.js';

export const GRID_STEP = DAY / 4;

export const MODEL_REGISTRY = {
  terra: {
    model_id: 'aerol.sim.terra', model_version: '1.0.0', mode: 'simulated_projection', trained: false,
    training_status: 'not trained — transparent hand-set simulator',
    validation_status: 'not validated; no error metrics exist',
    target: 'TERRA fold change vs matched personal baseline (1.0× = 0%)',
    coverage_note: 'No human TERRA data exist beyond the magnetosphere; every beyond-magnetosphere value is an extrapolation of assumptions.',
  },
  wbc: {
    model_id: 'aerol.sim.wbc', model_version: '1.0.0', mode: 'simulated_projection', trained: false,
    training_status: 'not trained — transparent hand-set simulator',
    validation_status: 'not validated; no error metrics exist',
    target: 'Total WBC (10⁹/L) and differential absolute counts',
    coverage_note: 'Pattern loosely informed by published ISS cohort findings (in-flight granulocyte rise; landing surge). Not fitted.',
  },
  learned: {
    model_id: 'aerol.learned.terra', model_version: null, mode: 'learned', trained: false, available: false,
    training_status: 'unavailable — insufficient matched longitudinal data',
    reason: 'Bundled TERRA data: one astronaut (NASA Twins Study, TW), 8 in-flight + 3 post-flight samples, no pre-flight personal baseline, station area dosimetry rather than personal dosimetry. Inspiration4 CBC (n=4) has no TERRA and no in-flight samples. No held-out astronaut or study is available.',
    requirements: [
      'Multiple astronauts with matched personal dosimetry and TERRA/WBC assays on the same timeline',
      'Pre-flight personal baselines with documented assay and normalization',
      'Evaluation on held-out astronauts/studies and later time windows, normalization fit on training data only',
      'Comparison against a baseline-only predictor (constant 1.0×)',
    ],
    evaluation: null,
  },
};

function stressShape(schedule, sc, t) {
  const { launch, stressOnset } = schedule;
  if (t < stressOnset) return 0;
  if (t < launch) return smoothstep((t - stressOnset) / (launch - stressOnset));
  return Math.exp(-(t - launch) / (sc.stress.decay_days * DAY));
}

function decayFrom(t, t0, tau) {
  return t >= t0 ? Math.exp(-(t - t0) / (tau * DAY)) : 0;
}

export function simulateTerra(schedule, segments, sc) {
  const p = sc.terra;
  const t0 = schedule.start;
  const n = Math.ceil((schedule.end - t0) / GRID_STEP) + 1;
  const fold = new Array(n);
  const stress = new Array(n);
  const radiation = new Array(n);
  const landing = new Array(n);
  const drive = new Array(n);
  let R = 0;
  let clamped = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i * GRID_STEP;
    const r = rateAt(segments, t - p.lag_days * DAY);
    const target = p.sensitivity * r;
    if (i > 0) {
      const tau = (target > R ? p.rise_days : p.recovery_days) * DAY;
      R = target + (R - target) * Math.exp(-GRID_STEP / tau);
    }
    const S = sc.stress.amplitude * stressShape(schedule, sc, t);
    const L = p.landing_amplitude * decayFrom(t, schedule.landing, p.landing_decay_days);
    let F = 1 + S + R + L;
    if (F < 0) { F = 0; clamped++; }
    fold[i] = F; stress[i] = S; radiation[i] = R; landing[i] = L; drive[i] = r;
  }
  const grid = values => ({ t0, dt: GRID_STEP, values });
  return { fold: grid(fold), stress: grid(stress), radiation: grid(radiation), landing: grid(landing), drive: grid(drive), clamped, n };
}

export const WBC_FRACTIONS = { neutrophils: 0.58, lymphocytes: 0.3, monocytes: 0.08, eosinophils: 0.03, basophils: 0.01 };
// Allocation of modeled WBC changes across the differential (assumption; granulocyte-led per Crucian et al. 2015).
export const WBC_ALLOCATION = { neutrophils: 0.85, monocytes: 0.1, lymphocytes: 0.05, eosinophils: 0, basophils: 0 };

export function simulateWbc(schedule, segments, sc) {
  const p = sc.wbc;
  const t0 = schedule.start;
  const n = Math.ceil((schedule.end - t0) / GRID_STEP) + 1;
  const total = new Array(n);
  const comp = { stress: new Array(n), flight: new Array(n), radiation: new Array(n), landing: new Array(n) };
  const diff = Object.fromEntries(Object.keys(WBC_FRACTIONS).map(k => [k, new Array(n)]));
  let rbar = 0;
  let flightAtLanding = 0;
  const tauR = 10 * DAY;
  for (let i = 0; i < n; i++) {
    const t = t0 + i * GRID_STEP;
    const r = rateAt(segments, t);
    if (i > 0) rbar = r + (rbar - r) * Math.exp(-GRID_STEP / tauR);
    const S = p.stress_share * stressShape(schedule, sc, t);
    let F = 0;
    if (t >= schedule.launch && t < schedule.landing) {
      F = p.flight_adaptation * (1 - Math.exp(-(t - schedule.launch) / (p.adaptation_days * DAY)));
      flightAtLanding = F;
    } else if (t >= schedule.landing) {
      F = flightAtLanding * decayFrom(t, schedule.landing, p.adaptation_days);
    }
    const Rw = p.radiation_per_mSv_day * rbar;
    const L = p.landing_amplitude * decayFrom(t, schedule.landing, p.landing_decay_days);
    const W = Math.max(0, p.baseline * (1 + S + F + Rw + L));
    total[i] = W;
    comp.stress[i] = p.baseline * S; comp.flight[i] = p.baseline * F; comp.radiation[i] = p.baseline * Rw; comp.landing[i] = p.baseline * L;
    const delta = W - p.baseline;
    for (const k of Object.keys(WBC_FRACTIONS)) diff[k][i] = Math.max(0, p.baseline * WBC_FRACTIONS[k] + WBC_ALLOCATION[k] * delta);
  }
  const grid = values => ({ t0, dt: GRID_STEP, values });
  return {
    total: grid(total),
    components: Object.fromEntries(Object.entries(comp).map(([k, v]) => [k, grid(v)])),
    differential: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, grid(v)])),
    n,
  };
}

// "Scenario sensitivity range": envelope across adjustable assumptions. Not a confidence interval.
export function terraEnvelope(schedule, segments, sc, buildSegmentsFn) {
  const variants = [];
  for (const ks of [0.5, 1.5]) for (const ka of [0.5, 1.5]) for (const inside of [0.4, 1.0]) {
    const v = JSON.parse(JSON.stringify(sc));
    v.terra.sensitivity *= ks; v.stress.amplitude *= ka; v.dose.inside = inside;
    variants.push(simulateTerra(schedule, buildSegmentsFn(schedule, v), v).fold.values);
  }
  return envelopeOf(variants, schedule.start, 'Scenario sensitivity range: TERRA sensitivity ×0.5–1.5, stress amplitude ×0.5–1.5, inside-magnetosphere rate 0.4–1.0 mSv/day');
}

export function wbcEnvelope(schedule, segments, sc, buildSegmentsFn) {
  const variants = [];
  for (const kf of [0.5, 1.5]) for (const kl of [0.5, 1.5]) for (const kr of [-1, 2]) {
    const v = JSON.parse(JSON.stringify(sc));
    v.wbc.flight_adaptation *= kf; v.wbc.landing_amplitude *= kl; v.wbc.radiation_per_mSv_day *= kr;
    variants.push(simulateWbc(schedule, buildSegmentsFn(schedule, v), v).total.values);
  }
  return envelopeOf(variants, schedule.start, 'Scenario sensitivity range: flight adaptation ×0.5–1.5, landing surge ×0.5–1.5, radiation coefficient ×(−1 to 2) — sign deliberately uncertain');
}

function envelopeOf(variants, t0, label) {
  const n = variants[0].length;
  const lo = new Array(n);
  const hi = new Array(n);
  for (let i = 0; i < n; i++) {
    let a = Infinity;
    let b = -Infinity;
    for (const v of variants) { if (v[i] < a) a = v[i]; if (v[i] > b) b = v[i]; }
    lo[i] = a; hi[i] = b;
  }
  return { lo: { t0, dt: GRID_STEP, values: lo }, hi: { t0, dt: GRID_STEP, values: hi }, label, kind: 'scenario_sensitivity_range' };
}

export const SYN_TERRA_BASELINE_RAW = 1.05e-3; // synthetic astronaut's assay-scale value (normalized abundance), illustrative

// Simulated lab draws. value_origin = 'simulation'. Results appear only at their result-availability time.
export function simulateLabSamples(schedule, sc, terra, wbc) {
  const out = [];
  const labCfg = sc.lab;
  let baselineTerraRaw = null;
  let baselineWbc = null;
  for (const s of schedule.samples) {
    const next = rng((sc.seed ^ hashLabel(s.label)) >>> 0);
    const inFlight = s.t >= schedule.launch && s.t < schedule.landing;
    for (const spec of s.specimens) {
      if (spec === 'terra') {
        const projected = sampleGrid(terra.fold, s.t);
        const measuredFold = Math.max(0, projected * (1 + sc.terra.residual_sd * gaussian(next)));
        const raw = SYN_TERRA_BASELINE_RAW * measuredFold;
        if (s.label === 'L-180') baselineTerraRaw = raw;
        const available = inFlight ? schedule.landing + labCfg.terra_inflight_assay_after_return_days * DAY : s.t + labCfg.terra_ground_result_delay_days * DAY;
        out.push({ kind: 'terra', label: s.label, t: s.t, available, raw, projected, purpose: s.purpose, inFlight });
      } else if (spec === 'wbc') {
        const projected = sampleGrid(wbc.total, s.t);
        const value = Math.max(0, projected * (1 + sc.wbc.residual_sd * gaussian(next)));
        const scale = projected > 0 ? value / projected : 1;
        const diff = Object.fromEntries(Object.entries(wbc.differential).map(([k, g]) => [k, sampleGrid(g, s.t) * scale]));
        if (s.label === 'L-180') baselineWbc = value;
        const available = s.t + (inFlight ? labCfg.wbc_inflight_result_delay_days : labCfg.wbc_ground_result_delay_days) * DAY;
        out.push({ kind: 'wbc', label: s.label, t: s.t, available, value, projected, diff, purpose: s.purpose, inFlight,
          method: inFlight ? 'Proposed onboard hematology analyzer (simulated)' : 'Clinical hematology analyzer (simulated)' });
      }
    }
  }
  for (const r of out) {
    if (r.kind === 'terra') {
      r.baseline_raw = baselineTerraRaw;
      r.fold = isNum(baselineTerraRaw) && baselineTerraRaw > 0 ? r.raw / baselineTerraRaw : null;
      r.pct = isNum(r.fold) ? 100 * (r.fold - 1) : null;
    } else {
      r.baseline = baselineWbc;
      r.pct_from_baseline = isNum(baselineWbc) && baselineWbc > 0 ? 100 * (r.value / baselineWbc - 1) : null;
    }
    r.phase = phaseAt(schedule, r.t);
    r.region = regionAt(schedule, r.t);
    r.mission_label = missionLabel(schedule, r.t);
  }
  return out;
}

function hashLabel(label) {
  let h = 2166136261;
  for (const c of label) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

// Model context available at time t. Uses only information timestamped ≤ t (no future observations).
export function modelContext({ schedule, segments, labs, vitalsDaily }, t) {
  const transitions = schedule.regionChanges.filter(c => Number.isFinite(c.t) && c.t <= t);
  const last = transitions[transitions.length - 1];
  const knownLabs = labs.filter(l => l.available <= t);
  const recentVitals = vitalsDaily.filter(d => d.t <= t).slice(-7);
  return {
    as_of: t,
    region: regionAt(schedule, t),
    phase: phaseAt(schedule, t),
    days_since_last_transition: last ? (t - last.t) / DAY : null,
    last_transition: last ? last.label : null,
    recent_dose_rate_mSv_day: rateAt(segments, t),
    dose_last_7d_mSv: doseAt(segments, t) - doseAt(segments, t - 7 * DAY),
    cumulative_dose_mSv: doseAt(segments, t),
    known_lab_results: knownLabs.length,
    latest_terra_fold: [...knownLabs].filter(l => l.kind === 'terra').sort((a, b) => a.t - b.t).pop()?.fold ?? null,
    latest_wbc: [...knownLabs].filter(l => l.kind === 'wbc').sort((a, b) => a.t - b.t).pop()?.value ?? null,
    mean_sleep_h_7d: recentVitals.length ? round(recentVitals.reduce((a, d) => a + (d.sleep_h ?? 0), 0) / recentVitals.length, 2) : null,
    mean_stress_estimate_7d: recentVitals.length ? round(recentVitals.reduce((a, d) => a + (d.stress ?? 0), 0) / recentVitals.length, 1) : null,
  };
}

// Baseline-only comparator (constant 1.0× / personal baseline WBC) for honest comparison displays.
export const baselineOnly = { terraFold: () => 1, wbc: sc => sc.wbc.baseline };
