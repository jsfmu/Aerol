// Mission events (aerol.event.v1), plain-language explanations, and peak/dip detection.
import { DAY, HOUR, iso, isNum, sampleGrid, round, fmt, signed } from './util.js';
import { phaseAt, regionAt, missionLabel, REGION_LABEL, PHASE_LABEL } from './schedule.js';
import { rateAt, doseAt } from './radiation.js';
import { emptyEvent } from './schema.js';

// ---- Extrema rule (documented) ----
// Model curves: index i is a local peak if it is the maximum within ±W days and its prominence
// v − max(min over [i−W, i], min over [i, i+W]) ≥ P. Dips are symmetric. W=14 d.
// P = 0.10 fold (TERRA) or 0.5 ×10⁹/L (WBC). Sparse samples: an extremum among samples is only a
// "sampled extremum" — the true peak may lie between samples and is never asserted.
export const EXTREMA_RULE = { window_days: 14, prominence: { terra: 0.1, wbc: 0.5 } };

export function curveExtrema(grid, { from, to, windowDays = EXTREMA_RULE.window_days, prominence }) {
  const W = Math.round(windowDays * DAY / grid.dt);
  const v = grid.values;
  const i0 = Math.max(0, Math.ceil((from - grid.t0) / grid.dt));
  const i1 = Math.min(v.length - 1, Math.floor((to - grid.t0) / grid.dt));
  const out = [];
  for (let i = i0 + 1; i < i1; i++) {
    const a = Math.max(i0, i - W);
    const b = Math.min(i1, i + W);
    let maxW = -Infinity, minW = Infinity, minL = Infinity, minR = Infinity, maxL = -Infinity, maxR = -Infinity;
    for (let k = a; k <= b; k++) { if (v[k] > maxW) maxW = v[k]; if (v[k] < minW) minW = v[k]; }
    for (let k = a; k <= i; k++) { if (v[k] < minL) minL = v[k]; if (v[k] > maxL) maxL = v[k]; }
    for (let k = i; k <= b; k++) { if (v[k] < minR) minR = v[k]; if (v[k] > maxR) maxR = v[k]; }
    if (v[i] === maxW && v[i] > v[i - 1]) {
      const prom = v[i] - Math.max(minL, minR);
      if (prom >= prominence) out.push({ kind: 'peak', t: grid.t0 + i * grid.dt, value: v[i], prominence: prom, basis: 'model curve' });
    }
    if (v[i] === minW && v[i] < v[i - 1]) {
      const prom = Math.min(maxL, maxR) - v[i];
      if (prom >= prominence) out.push({ kind: 'dip', t: grid.t0 + i * grid.dt, value: v[i], prominence: prom, basis: 'model curve' });
    }
  }
  // Whole-window extrema
  let gi = i0, gj = i0;
  for (let i = i0; i <= i1; i++) { if (v[i] > v[gi]) gi = i; if (v[i] < v[gj]) gj = i; }
  return { local: dedupe(out, grid.dt * 4), max: { t: grid.t0 + gi * grid.dt, value: v[gi] }, min: { t: grid.t0 + gj * grid.dt, value: v[gj] } };
}

function dedupe(list, minGap) {
  const out = [];
  for (const e of list) {
    const prev = out[out.length - 1];
    if (prev && prev.kind === e.kind && e.t - prev.t < minGap) { if ((e.kind === 'peak') === (e.value > prev.value)) out[out.length - 1] = e; }
    else out.push(e);
  }
  return out;
}

export function sampleExtrema(points, key = 'value') {
  const valid = points.filter(p => isNum(p[key])).sort((a, b) => a.t - b.t);
  if (!valid.length) return { max: null, min: null, local: [] };
  const max = valid.reduce((a, b) => (b[key] > a[key] ? b : a));
  const min = valid.reduce((a, b) => (b[key] < a[key] ? b : a));
  const local = [];
  for (let i = 1; i < valid.length - 1; i++) {
    if (valid[i][key] > valid[i - 1][key] && valid[i][key] > valid[i + 1][key]) local.push({ kind: 'peak', ...valid[i], basis: 'sampled extremum — true peak may be unsampled' });
    if (valid[i][key] < valid[i - 1][key] && valid[i][key] < valid[i + 1][key]) local.push({ kind: 'dip', ...valid[i], basis: 'sampled extremum — true dip may be unsampled' });
  }
  return { max, min, local };
}

// Lag between an exposure step and the simulated TERRA radiation component (timestamps untouched).
// Compares the simulated radiation term with a counterfactual in which the dose rate stays at its
// pre-step value, so an ongoing earlier rise is not mistaken for the response to this step.
export function lagInspector(model, stepT) {
  const p = model.scenario.terra;
  const from = rateAt(model.segments, stepT - 1);
  const to = rateAt(model.segments, stepT + 1);
  const change = p.sensitivity * (to - from);
  if (Math.abs(change) < 1e-9) return null;
  const dt = HOUR;
  let R = sampleGrid(model.terra.radiation, stepT);
  let Rc = R;
  let onset = null, half = null;
  const step = (x, drive) => { const target = p.sensitivity * drive; const tau = (target > x ? p.rise_days : p.recovery_days) * DAY; return target + (x - target) * Math.exp(-dt / tau); };
  for (let t = stepT; t < stepT + 400 * DAY && t < model.schedule.end; t += dt) {
    const lagged = t - p.lag_days * DAY;
    R = step(R, rateAt(model.segments, lagged));
    Rc = step(Rc, lagged < stepT ? rateAt(model.segments, lagged) : from);
    const d = R - Rc;
    if (onset === null && Math.abs(d) > 0.01 * Math.abs(change)) onset = t;
    if (half === null && Math.abs(d) >= 0.5 * Math.abs(change)) { half = t; break; }
  }
  return {
    step_t: stepT, from_rate: from, to_rate: to, assumed_lag_days: p.lag_days, change_in_steady_state_fold: change,
    onset_days: onset === null ? null : (onset - stepT) / DAY, half_response_days: half === null ? null : (half - stepT) / DAY,
    note: 'Difference between the simulated curve and a counterfactual with the pre-step dose rate. Onset/half-response follow from the assumed lag and timescales — they are not measured biology. Original timestamps are unchanged.',
  };
}

// ---- Explanations: what happened / term / values / contributors / evidence / uncertainty / action ----
function valuesAround(model, t, horizonDays = 30) {
  const f0 = sampleGrid(model.terra.fold, t);
  const f1 = sampleGrid(model.terra.fold, t + horizonDays * DAY);
  const w0 = sampleGrid(model.wbc.total, t);
  const w1 = sampleGrid(model.wbc.total, t + Math.min(horizonDays, 3) * DAY);
  return [
    `Dose rate: ${fmt(rateAt(model.segments, t - HOUR), 2)} → ${fmt(rateAt(model.segments, t + HOUR), 2)} mSv/day (scenario)`,
    `Cumulative mission dose at this time: ${fmt(doseAt(model.segments, t), 1)} mSv (dose-equivalent ledger)`,
    `Simulated TERRA: ${signed(100 * (f0 - 1), 0, '%')} now → ${signed(100 * (f1 - 1), 0, '%')} ${horizonDays} days later (projection)`,
    `Simulated WBC: ${fmt(w0, 1)} → ${fmt(w1, 1)} ×10⁹/L over the following ${Math.min(horizonDays, 3)} days (projection)`,
  ];
}

const EXPLAIN = {
  baseline_window: m => ({
    what: 'Personal-baseline window: samples here define each metric’s 1.0× / 0% reference.',
    term: 'Baseline — the astronaut’s own typical value, measured before pre-mission stress is assumed to begin.',
    contributors: ['Normal day-to-day variation'],
    evidence: 'The ISS immune study used L-180 as its baseline because samples closer to launch may be influenced by pre-mission stress (Crucian et al. 2015).',
    uncertainty: 'One baseline sample per metric is noisy; repeated baseline draws would be better.',
    action: 'None — reference only.', status: 'supported',
  }),
  preflight_stress: m => ({
    what: 'Modeled pre-mission stress contribution begins and rises until launch.',
    term: 'Pre-flight stress — training load, quarantine, travel and psychological pressure before launch.',
    contributors: ['Psychological stress (hypothesis)', 'Training, travel and schedule changes', 'Sampling time of day'],
    evidence: 'Requested simulation hypothesis. No bundled dataset shows a pre-flight TERRA rise. Inspiration4 WBC was higher at L-3 than L-44 in 4/4 crew (cause not established).',
    uncertainty: 'Amplitude, onset and decay are adjustable assumptions; the effect on TERRA is unproven.',
    action: 'None for the astronaut. Research: pre-flight serial samples would test this hypothesis.', status: 'hypothesis',
  }),
  launch: m => ({
    what: 'Launch. Flight phase begins; trajectory starts inside the magnetosphere.',
    term: 'Launch adaptation — the first days of fluid shifts, motion sickness, disrupted sleep and new routines.',
    contributors: ['Launch and early adaptation', 'Pre-flight stress contribution subsiding', 'Low-Earth-orbit ionizing radiation'],
    evidence: 'Early-flight physiological changes are well described; the TERRA decline after launch in this simulation reflects the assumed stress decay (τ = ' + m.scenario.stress.decay_days + ' d).',
    uncertainty: 'The partial TERRA decline is an assumption, not a measured response.',
    action: 'Wear the band consistently; complete check-ins if symptoms appear.', status: 'simulated',
  }),
  magnetosphere_exit: m => ({
    what: 'Magnetosphere exit (explicit trajectory event). Scenario dose rate switches to the beyond-magnetosphere reference.',
    term: 'Earth’s magnetosphere deflects many charged particles. Inside it, shielding is partial — exposure is reduced, not zero. Beyond it, galactic cosmic rays arrive with less geomagnetic shielding.',
    contributors: ['Galactic cosmic rays (steady background)', 'Spacecraft shielding', 'Solar cycle'],
    evidence: '1.84 mSv/day is the MSL RAD cruise reference (2011–12, inside a spacecraft en route to Mars). It is a historical reference, not a universal deep-space rate and not a safety threshold.',
    uncertainty: 'Real rates vary with shielding, solar cycle and trajectory. TERRA response starts after an assumed ' + m.scenario.terra.lag_days + '-day lag and rises gradually — the boundary itself does not cause an instantaneous biological jump.',
    action: 'Follow the configured radiation-response protocol; keep the dosimeter worn.', status: 'simulated',
  }),
  belt_transit: m => ({
    what: 'Radiation-belt transit (short, explicit trajectory interval).',
    term: 'The Van Allen belts are regions of trapped particles; crossing them briefly raises exposure.',
    contributors: ['Trapped protons and electrons', 'Transit duration', 'Shielding'],
    evidence: 'No source-backed belt-transit rate is bundled; the scenario uses a placeholder equal to the deep-space reference.',
    uncertainty: 'High — replace with mission-specific transit dosimetry.',
    action: 'Follow the configured protocol.', status: 'simulated',
  }),
  deep_space: m => ({
    what: 'Sustained exposure beyond the magnetosphere.',
    term: 'Sustained exposure — dose keeps accumulating at a roughly constant rate; the simulated TERRA term rises toward a plateau (k × rate).',
    contributors: ['Continuous galactic cosmic rays', 'Possible solar particle events (separate scenario)'],
    evidence: 'In vitro radiation increased TERRA; simulated microgravity did not (Al-Turki et al. 2024). Dose-response in astronauts is not established.',
    uncertainty: 'Sensitivity k and timescales are hand-set; beyond-magnetosphere biology is an extrapolation (no training subjects there).',
    action: 'Research review of projections; no clinical action from forecasts.', status: 'simulated',
  }),
  magnetosphere_reentry: m => ({
    what: 'Magnetosphere re-entry (separate from landing). Dose rate drops back to the inside-magnetosphere reference.',
    term: 'Re-entry into the magnetosphere restores partial geomagnetic shielding.',
    contributors: ['Return trajectory'],
    evidence: 'Scenario setting.',
    uncertainty: 'The simulated TERRA term begins to decline only after the assumed lag, with recovery τ = ' + m.scenario.terra.recovery_days + ' d.',
    action: 'None.', status: 'simulated',
  }),
  landing: m => ({
    what: 'Landing (R+0). Mission-attributable dose rate set to zero; cumulative mission dose plateaus (it never falls).',
    term: 'Landing-related stress — re-entry forces, gravity readaptation and stress hormones. A landing-day WBC surge is usually neutrophil-driven.',
    contributors: ['Stress hormones (adrenaline, cortisol)', 'Neutrophil demargination', 'Gravity readaptation', 'Earth background radiation is not zero but is outside the mission ledger'],
    evidence: 'Post-landing WBC surge confirmed in ISS crew and attributed to stress-induced neutrophil demargination (Crucian et al. 2015).',
    uncertainty: 'No landing-day TERRA sample is planned or available; the model does not create one.',
    action: 'Scheduled R+0 blood draw ~3 h after landing; medical team review.', status: 'supported',
  }),
  postflight_recovery: m => ({
    what: 'Post-flight recovery: simulated TERRA approaches personal baseline (1.0× = 0% change).',
    term: '“Back to zero” on the normalized chart means 0% change from baseline — not zero TERRA molecules.',
    contributors: ['Decline of the radiation-history term', 'Readaptation'],
    evidence: 'Twins Study post-flight TERRA (R+99, R+185) was lower than late-flight values; R+196 was higher again. One astronaut.',
    uncertainty: 'Recovery timescale is an adjustable assumption.',
    action: 'Scheduled recovery follow-ups (R+30, R+90, R+180).', status: 'simulated',
  }),
  sample: (m, e) => ({
    what: `Scheduled blood draw ${e.label}: ${e.purpose}.`,
    term: 'TERRA and WBC are laboratory assays from blood — the watch does not measure them.',
    contributors: [],
    evidence: e.note || 'Protocol schedule.',
    uncertainty: 'Results appear only when available (in-flight TERRA samples are assayed on Earth after return).',
    action: 'Follow the sampling protocol.', status: 'simulated',
  }),
  spe: m => ({
    what: 'Assumed solar particle event (separately labeled scenario).',
    term: 'Solar particle event — a burst of energetic protons from the Sun; outside the magnetosphere it can deliver a large dose in hours.',
    contributors: ['Solar activity'],
    evidence: `Scenario assumption: ${m.scenario.spe.dose_mSv} mSv over ${m.scenario.spe.duration_h} h. NASA-STD-3001 sets 30-day blood-forming-organ limits in mGy-Eq — a different quantity.`,
    uncertainty: 'Event size and shielding are highly uncertain.',
    action: 'Follow the approved onboard radiation-response protocol; shelter if the protocol instructs.', status: 'simulated',
  }),
  peak: (m, e) => ({
    what: `Local ${e.metric} ${e.kind} on the ${e.basis}.`,
    term: `Detected with the documented rule: maximum within ±${EXTREMA_RULE.window_days} days and prominence ≥ ${e.metric === 'TERRA' ? '0.10 fold' : '0.5 ×10⁹/L'}.`,
    contributors: e.contributors || [],
    evidence: e.basis === 'model curve' ? 'Model-curve extremum (simulated projection), not a measured peak.' : 'Sampled extremum; the true peak may be unsampled.',
    uncertainty: 'Depends on adjustable assumptions.', action: 'None.', status: 'simulated',
  }),
  comm_outage: m => ({
    what: 'Simulated communication outage. Watch alerts keep working; evidence packets queue onboard.',
    term: 'Offline escalation — onboard crew medical support is the immediate route; Earth may be delayed.',
    contributors: ['Antenna/relay availability (simulated)'],
    evidence: 'Scenario setting.', uncertainty: '—', action: 'Escalate onboard; packets transmit when the link returns.', status: 'simulated',
  }),
};

export function explainEvent(model, e) {
  const fn = EXPLAIN[e.explain || e.event_type];
  const x = fn ? fn(model, e) : { what: e.definition, term: '', contributors: e.possible_contributors || [], evidence: '', uncertainty: '', action: e.suggested_action || '', status: e.evidence_status };
  return { ...x, values: e.values || (isNum(e.t) ? valuesAround(model, e.t) : []) };
}

// Build the scenario's event list (independent of any alert episodes).
export function buildEvents(model) {
  const { schedule, scenario: sc } = model;
  const list = [];
  const add = (o) => list.push({ phase: phaseAt(schedule, o.t), region: regionAt(schedule, o.t), mission_label: missionLabel(schedule, o.t), ...o });
  add({ id: 'baseline_window', t: schedule.baselineWindow[0], t_end: schedule.baselineWindow[1], event_type: 'baseline_window', label: 'Baseline window', lane: 'schedule' });
  add({ id: 'stress_onset', t: schedule.stressOnset, t_end: schedule.launch, event_type: 'preflight_stress', label: 'Modeled pre-mission stress (hypothesis)', lane: 'schedule' });
  add({ id: 'launch', t: schedule.launch, event_type: 'launch', label: 'Launch', lane: 'trajectory' });
  for (const c of schedule.regionChanges) {
    if (!isNum(c.t) || c.t === schedule.launch || c.t === schedule.landing) continue;
    const type = c.key === 'magnetosphere_exit' ? 'magnetosphere_exit' : c.key === 'magnetosphere_reentry' ? 'magnetosphere_reentry' : 'belt_transit';
    add({ id: `region-${c.t}`, t: c.t, event_type: type, label: c.label, lane: 'trajectory' });
  }
  if (schedule.hasExit) add({ id: 'deep_space', t: schedule.exit, t_end: schedule.reentry, event_type: 'deep_space', label: 'Sustained beyond-magnetosphere exposure', lane: 'trajectory' });
  if (sc.spe?.enabled) add({ id: 'spe', t: schedule.launch + sc.spe.day * DAY, t_end: schedule.launch + sc.spe.day * DAY + sc.spe.duration_h * HOUR, event_type: 'spe', label: 'Assumed solar particle event', lane: 'trajectory' });
  add({ id: 'landing', t: schedule.landing, event_type: 'landing', label: 'Landing (R+0)', lane: 'trajectory' });
  add({ id: 'recovery', t: schedule.landing + 3 * DAY, t_end: schedule.end, event_type: 'postflight_recovery', label: 'Post-flight recovery', lane: 'schedule' });
  for (const o of sc.link?.outages || []) add({ id: `outage-${o.start_day}`, t: schedule.launch + o.start_day * DAY, t_end: schedule.launch + o.end_day * DAY, event_type: 'comm_outage', label: o.label, lane: 'link' });
  for (const s of schedule.samples) {
    const labs = model.labs.filter(l => l.label === s.label);
    const avail = labs.map(l => `${l.kind.toUpperCase()} result ${missionLabel(schedule, l.available)}`).join(' · ');
    add({ id: `sample-${s.label}`, t: s.t, event_type: 'sample', label: `Blood draw ${s.label}`, purpose: s.purpose, lane: 'samples',
      note: `Specimens: ${s.specimens.join(', ').toUpperCase()}. ${avail}.` });
  }
  const tEx = curveExtrema(model.terra.fold, { from: schedule.launch - 60 * DAY, to: schedule.end, prominence: EXTREMA_RULE.prominence.terra });
  for (const x of tEx.local) add({ id: `terra-${x.kind}-${x.t}`, t: x.t, event_type: 'peak', explain: 'peak', kind: x.kind, metric: 'TERRA', basis: x.basis, label: `TERRA projection ${x.kind} (${signed(100 * (x.value - 1), 0, '%')})`, lane: 'extrema' });
  const wEx = curveExtrema(model.wbc.total, { from: schedule.launch - 60 * DAY, to: schedule.end, prominence: EXTREMA_RULE.prominence.wbc });
  for (const x of wEx.local) add({ id: `wbc-${x.kind}-${x.t}`, t: x.t, event_type: 'peak', explain: 'peak', kind: x.kind, metric: 'WBC', basis: x.basis, label: `WBC projection ${x.kind} (${fmt(x.value, 1)} ×10⁹/L)`, lane: 'extrema' });
  list.sort((a, b) => a.t - b.t);
  model.extrema = { terra: tEx, wbc: wEx };
  return list;
}

// Convert to aerol.event.v1 records for export.
export function toEventRecords(model, events) {
  return events.map(e => {
    const x = explainEvent(model, e);
    return emptyEvent({
      event_id: `${model.scenario.mission_id}:${e.id}`, event_type: e.event_type, start_time: iso(e.t), end_time: isNum(e.t_end) ? iso(e.t_end) : null,
      phase: e.phase, region: e.region, affected_metrics: ['terra', 'wbc', 'dose_rate', 'cumulative_dose'], related_record_ids: [],
      definition: x.term, observed_change: x.values.join('; '), possible_contributors: x.contributors, evidence_status: x.status === 'supported' ? 'supported' : x.status,
      source_references: [x.evidence], suggested_action: x.action,
    });
  });
}

export { REGION_LABEL, PHASE_LABEL, round };
