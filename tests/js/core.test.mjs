// Run: node --test tests/js/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DAY, HOUR, sampleGrid } from '../../aerol/static/core/util.js';
import { buildSchedule, scenarioFromPreset, phaseAt, regionAt, missionLabel, PHASES, validateScenario } from '../../aerol/static/core/schedule.js';
import { buildSegments, rateAt, doseAt, workedChecks, ingestReadings, simulateDosimeter, rateSteps } from '../../aerol/static/core/radiation.js';
import { modelContext, MODEL_REGISTRY } from '../../aerol/static/core/models.js';
import { rmssd } from '../../aerol/static/core/vitals.js';
import { episodeStatus, topPriority, defaultRules } from '../../aerol/static/core/rules.js';
import { validateRecord, validateBatch, TERRA_SCHEMA } from '../../aerol/static/core/schema.js';
import { computeModel, Store, packetStatus, linkUp, buildPackets } from '../../aerol/static/core/store.js';
import { curveExtrema, sampleExtrema, lagInspector } from '../../aerol/static/core/events.js';

const memoryStorage = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const sc = scenarioFromPreset('hypothesis-default');
const model = computeModel(sc);
const { schedule: S } = model;
const at = d => S.launch + d * DAY;
const ret = d => S.landing + d * DAY;

test('six canonical phases and independent exposure regions', () => {
  assert.deepEqual(PHASES, ['preflight', 'early_flight', 'mid_flight', 'late_flight', 'landing', 'after_return']);
  assert.equal(phaseAt(S, at(-10)), 'preflight'); assert.equal(regionAt(S, at(-10)), 'ground');
  assert.equal(phaseAt(S, at(10)), 'early_flight'); assert.equal(regionAt(S, at(10)), 'inside_magnetosphere');
  assert.equal(phaseAt(S, at(40)), 'early_flight'); assert.equal(regionAt(S, at(40)), 'beyond_magnetosphere');
  assert.equal(regionAt(S, at(28.1)), 'radiation_belt_transit');
  assert.equal(phaseAt(S, at(155)), 'late_flight'); assert.equal(regionAt(S, at(155)), 'inside_magnetosphere');
  assert.equal(phaseAt(S, ret(1)), 'landing'); assert.equal(regionAt(S, ret(1)), 'ground');
  assert.equal(phaseAt(S, ret(10)), 'after_return');
  // re-entry is separate from landing
  assert.ok(S.reentry < S.landing - DAY);
  assert.equal(missionLabel(S, at(-12)), 'L−12');
  assert.equal(missionLabel(S, at(45.2)), 'FD45');
  assert.equal(missionLabel(S, ret(30.5)), 'R+30');
  assert.equal(missionLabel(S, ret(0.125)), 'R+0 (3 h)');
  assert.deepEqual(validateScenario(sc), []);
  assert.ok(validateScenario({ ...sc, exit_day: 160, reentry_day: 150 }).length > 0);
});

test('worked radiation checks', () => {
  const [a, b] = workedChecks();
  assert.ok(a.pass, a.computed); assert.equal(a.computed, 10.42);
  assert.ok(b.pass, b.computed); assert.equal(b.computed, 625.6);
});

test('dose integrates piecewise, splits at transitions and plateaus after landing (never falls)', () => {
  const seg = model.segments;
  const belt = sc.belt_transit_hours / 24;
  const expected = sc.exit_day * 0.7 + belt * 1.84 + (sc.reentry_day - sc.exit_day - 2 * belt) * 1.84 + belt * 1.84 + (sc.mission_days - sc.reentry_day) * 0.7;
  assert.ok(Math.abs(doseAt(seg, S.landing) - expected) < 1e-9, `${doseAt(seg, S.landing)} vs ${expected}`);
  assert.equal(rateAt(seg, ret(5)), 0);
  assert.equal(doseAt(seg, ret(100)), doseAt(seg, S.landing));
  let prev = -1;
  for (let t = S.start; t < S.end; t += 6 * HOUR) { const d = doseAt(seg, t); assert.ok(d >= prev - 1e-12); prev = d; }
  // r = dD/dt
  const t = at(60); const h = HOUR;
  assert.ok(Math.abs((doseAt(seg, t + h) - doseAt(seg, t)) / (h / DAY) - rateAt(seg, t)) < 1e-9);
  const steps = rateSteps(seg);
  assert.ok(steps.some(s => s.from === 0.7 && s.to === 1.84 && s.region === 'radiation_belt_transit'));
  assert.ok(steps.some(s => s.from === 1.84 && s.to === 0.7 && s.region === 'inside_magnetosphere'));
});

test('dosimeter ingestion: counter reset, duplicates, unit rejection, gaps, no double counting', () => {
  const readings = simulateDosimeter(model.segments, S);
  const dup = [...readings, readings[100], { ...readings[200], value: readings[200].value + 5 }];
  const rep = ingestReadings(dup, { transitions: S.regionChanges.map(c => c.t) });
  const truth = doseAt(model.segments, readings[readings.length - 1].t) - doseAt(model.segments, readings[0].t);
  assert.equal(rep.resets.length, 1);
  const gap = rep.gaps.find(g => g.reason === 'counter_reset_unrecorded_interval');
  const lost = doseAt(model.segments, gap.t1) - doseAt(model.segments, gap.t0);
  assert.ok(rep.total_mSv <= truth + 1e-9 && truth - rep.total_mSv <= lost + 1e-9, `${rep.total_mSv} vs ${truth}`);
  assert.ok(truth - rep.total_mSv > 0, 'unrecorded interval is reported, not guessed');
  assert.equal(rep.duplicates_dropped, 1);
  assert.equal(rep.conflicts.length, 1);
  const r2 = ingestReadings([{ t: 0, device_id: 'x', kind: 'rate', value: 8, unit: 'µGy/h' }]);
  assert.equal(r2.rejected.length, 1);
  const r3 = ingestReadings([
    { t: 0, device_id: 'y', kind: 'rate', value: 0.7, unit: 'mSv/day' },
    { t: HOUR, device_id: 'y', kind: 'rate', value: 0.7, unit: 'mSv/day' },
    { t: 10 * HOUR, device_id: 'y', kind: 'rate', value: 0.7, unit: 'mSv/day' },
  ], { maxGapHours: 2 });
  assert.equal(r3.gaps.length, 1);
  assert.ok(Math.abs(r3.total_mSv - 0.7 / 24) < 1e-12); // gap is not filled
  const r4 = ingestReadings([
    { t: 0, device_id: 'z', kind: 'rate', value: 0.7, unit: 'mSv/day' },
    { t: 2 * HOUR, device_id: 'z', kind: 'rate', value: 1.84, unit: 'mSv/day' },
  ], { transitions: [HOUR] });
  assert.ok(Math.abs(r4.total_mSv - (0.7 + 1.84) / 24) < 1e-12);
  assert.equal(r4.increments[0].method, 'split_at_transition');
});

test('TERRA baseline convention: 1.0× = 0% and simulated landing has no TERRA sample', () => {
  const base = model.labs.find(l => l.kind === 'terra' && l.label === 'L-180');
  assert.equal(base.fold, 1); assert.equal(base.pct, 0);
  assert.ok(!model.labs.some(l => l.kind === 'terra' && l.label === 'R+0'));
  for (const l of model.labs.filter(l => l.kind === 'terra')) assert.ok(Math.abs(l.pct - 100 * (l.fold - 1)) < 1e-9);
  assert.ok(Math.abs(sampleGrid(model.terra.fold, ret(300)) - 1) < 0.05, 'approaches baseline after return');
  const inflight = model.labs.filter(l => l.kind === 'terra' && l.inFlight);
  assert.ok(inflight.every(l => l.available >= S.landing), 'in-flight TERRA results only after return');
});

test('simulated TERRA story: pre-flight rise, partial early decline, stronger deep-space response with lag', () => {
  const f = t => sampleGrid(model.terra.fold, t);
  assert.ok(f(at(-1)) > f(at(-60)) + 0.2, 'pre-flight stress rise');
  assert.ok(f(at(20)) < f(at(0)), 'partial decline after launch');
  assert.ok(f(at(20)) > 1.2, 'inside-magnetosphere contribution present');
  const exit = S.exit;
  assert.ok(Math.abs(f(exit + 6 * DAY) - f(exit)) < 0.03, 'no instantaneous jump at the boundary');
  assert.ok(f(at(140)) > f(at(25)) + 0.4, 'stronger sustained response beyond magnetosphere');
  const beltStart = S.regionChanges.find(c => c.region === 'radiation_belt_transit').t;
  const lag = lagInspector(model, beltStart);
  assert.ok(lag.onset_days >= sc.terra.lag_days - 0.05 && lag.onset_days < sc.terra.lag_days + 1, `onset ${lag.onset_days}`);
  assert.ok(lag.half_response_days > lag.onset_days);
});

test('WBC modeled separately with its own landing surge', () => {
  const w = t => sampleGrid(model.wbc.total, t);
  assert.ok(w(S.landing + 3 * HOUR) > w(at(170)) * 1.25);
  assert.ok(w(ret(20)) < w(S.landing + 3 * HOUR));
  assert.equal(MODEL_REGISTRY.learned.available, false);
});

test('alerts: radiation + physiological rules fire, escalate, dedupe and survive acknowledgment', () => {
  const { episodes, notifications } = model.alerts;
  const jump = episodes.find(e => e.rule_id === 'rad_rate_jump');
  assert.ok(jump && Math.abs(jump.start - S.regionChanges.find(c => c.region === 'radiation_belt_transit').t) < DAY);
  const rhr = episodes.filter(e => e.rule_id === 'phys_rhr_sustained' && e.start > at(90) && e.start < at(105));
  assert.equal(rhr.length, 1, 'one episode, no repeated identical alerts');
  assert.deepEqual(rhr[0].severity_history.map(h => h.severity), ['advisory', 'caution'], 'worsening escalates');
  assert.equal(notifications.filter(n => n.episode_id === rhr[0].episode_id).length, 2);
  const ack = [{ episode_id: rhr[0].episode_id, action: 'ack', t: rhr[0].start + HOUR }];
  const st = episodeStatus(rhr[0], rhr[0].start + 2 * HOUR, ack);
  assert.equal(st.acknowledged, true); assert.equal(st.active, true, 'acknowledgment does not resolve');
  assert.ok(episodes.some(e => e.rule_id === 'quality_signal'), 'poor contact → data-quality rule');
  assert.ok(!episodes.some(e => e.rule_id === 'phys_spo2_low' && e.start > at(45) && e.start < at(46)), 'poor-contact SpO2 is not a medical alert');
  assert.ok(episodes.some(e => e.rule_id === 'quality_disconnect' && e.severity_history.length === 2), 'disconnect escalates');
  assert.ok(episodes.some(e => e.rule_id === 'lab_wbc_change' && e.lab_label === 'R+0'), 'measured (simulated) lab rule at landing');
  assert.ok(episodes.some(e => e.rule_id === 'research_terra_forecast'));
  assert.ok(!episodes.some(e => e.rule_id === 'rad_acute'));
  const spe = computeModel(scenarioFromPreset('spe-event'));
  assert.ok(spe.alerts.episodes.some(e => e.rule_id === 'rad_acute' && e.severity_history[0].severity === 'urgent'));
});

test('missing data never shows all clear; recovery score never suppresses alerts', () => {
  const tDis = at(122.3);
  const store = new Store({ storage: memoryStorage() });
  store.setTime(tDis);
  const wv = store.watchView();
  assert.equal(wv.vitals.missing, true);
  assert.notEqual(wv.top.kind, 'none');
  assert.equal(topPriority([], tDis, [], { dataMissing: true }).kind, 'insufficient_data');
  // a day with a good recovery score and an active radiation alert
  const t = S.exit + 2 * HOUR;
  const day = model.daily.filter(d => d.t <= t).pop();
  assert.ok(day.recovery >= 50, `recovery ${day.recovery}`);
  const top = topPriority(model.alerts.episodes, t, [], { dataMissing: false });
  assert.equal(top.kind, 'alert');
});

test('rate presets produce consistent watch and chart values', () => {
  const store = new Store({ storage: memoryStorage() });
  for (const id of ['hypothesis-default', 'leo-only', 'deep-whole']) {
    store.loadPreset(id);
    store.setTime(store.model.schedule.launch + 60 * DAY);
    const w = store.watchView();
    assert.equal(w.rate, rateAt(store.model.segments, store.t));
    assert.equal(w.dose, doseAt(store.model.segments, store.t));
  }
  store.loadPreset('leo-only');
  assert.equal(store.watchView().rate, 0.7);
  store.loadPreset('deep-whole');
  assert.equal(store.watchView().rate, 1.84);
});

test('offline escalation: alerts fire during an outage; packets queue until the link returns', () => {
  const o = sc.link.outages[0];
  const inOutage = model.alerts.notifications.filter(n => n.t >= at(o.start_day) && n.t < at(o.end_day) && n.category === 'physiological');
  assert.ok(inOutage.length >= 1);
  assert.equal(linkUp(model, at(o.start_day + 0.5)), false);
  const packets = buildPackets(model, []);
  const p = packets.find(x => x.notification_id === inOutage[0].id);
  assert.ok(p.received >= at(o.end_day));
  assert.equal(packetStatus(p, at(o.end_day) - HOUR), 'queued onboard');
  assert.ok(packetStatus(p, p.ack + 1).startsWith('receipt acknowledged'));
});

test('model context uses no future observations', () => {
  const t = at(100);
  const ctx = modelContext({ schedule: S, segments: model.segments, labs: model.labs, vitalsDaily: model.daily }, t);
  assert.equal(ctx.known_lab_results, model.labs.filter(l => l.available <= t).length);
  assert.equal(ctx.latest_terra_fold, model.labs.filter(l => l.kind === 'terra' && l.available <= t).sort((a, b) => a.t - b.t).pop()?.fold ?? null);
});

test('extrema rule distinguishes model-curve and sampled extrema', () => {
  const ex = curveExtrema(model.terra.fold, { from: S.launch - 60 * DAY, to: S.end, prominence: 0.1 });
  assert.ok(ex.local.some(e => e.kind === 'peak'));
  assert.ok(ex.max.value > 1.8);
  const se = sampleExtrema(model.labs.filter(l => l.kind === 'terra').map(l => ({ t: l.t, value: l.fold })));
  assert.ok(se.local.every(e => e.basis.startsWith('sampled extremum')));
});

test('HRV RMSSD formula with artifact rejection', () => {
  assert.ok(Math.abs(rmssd([800, 810, 790], { minPairs: 1 }).rmssd_ms - Math.sqrt(250)) < 1e-12);
  const r = rmssd([800, 810, 1300, 805, 815], { minPairs: 1 });
  assert.equal(r.rejected_pairs, 2);
  assert.ok(Math.abs(r.rmssd_ms - Math.sqrt((100 + 100) / 2)) < 1e-12);
  assert.equal(rmssd([800, 810]).rmssd_ms, null);
});

test('schema contract: shared fixtures and bundled research data', () => {
  const fx = JSON.parse(readFileSync(new URL('../fixtures/records.json', import.meta.url)));
  for (const r of fx.valid) assert.deepEqual(validateRecord(r), [], r.record_id || r.event_id);
  for (const c of fx.invalid) assert.ok(validateRecord(c.record).length > 0, c.why);
  const leak = validateBatch(fx.leakage_batch);
  assert.equal(leak.valid, false);
  assert.ok(leak.results[1].errors.some(e => e.includes('future leakage')));
  const research = JSON.parse(readFileSync(new URL('../../aerol/static/data/research.json', import.meta.url)));
  const res = validateBatch(research.records);
  assert.ok(res.valid, JSON.stringify(res.results.filter(r => r.errors.length).slice(0, 3)));
  const terra = research.records.filter(r => r.schema_version === TERRA_SCHEMA);
  assert.equal(terra.length, 11);
  assert.ok(terra.every(r => r.terra_fold_change === null), 'no pre-flight personal baseline → no fold change invented');
  assert.equal(research.report_projection.terra_pct.landing, null, 'no fabricated landing-day TERRA');
});

test('bone-related functionality is absent', () => {
  const dirs = ['../../aerol/static/core/', '../../aerol/static/ui/'];
  for (const d of dirs) {
    let files = [];
    try { files = readdirSync(new URL(d, import.meta.url)); } catch { continue; }
    for (const f of files) {
      const text = readFileSync(new URL(d + f, import.meta.url), 'utf8');
      assert.ok(!/bone/i.test(text), `${f} mentions bone`);
    }
  }
  assert.ok(!defaultRules().some(r => /bone/i.test(r.id + r.metric)));
});
