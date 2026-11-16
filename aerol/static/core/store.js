// One shared store + simulation clock. The watch and the dashboard both read from here,
// so they cannot disagree; the ground view is explicitly delayed via simulated packets.
import { DAY, HOUR, MINUTE, isNum, iso, fmt, signed, sampleGrid, round } from './util.js';
import { buildSchedule, scenarioFromPreset, regionAt, phaseAt, missionLabel, friendlyCode, validateScenario, REGION_LABEL, PHASE_LABEL } from './schedule.js';
import { buildSegments, rateAt, doseAt, simulateDosimeter, ingestReadings } from './radiation.js';
import { simulateTerra, simulateWbc, terraEnvelope, wbcEnvelope, simulateLabSamples, MODEL_REGISTRY } from './models.js';
import { simulateVitals, vitalsBaseline, dailySummaries, latestVitals } from './vitals.js';
import { defaultRules, evaluateRules, episodeStatus, topPriority, severityRank, RULESET_VERSION } from './rules.js';
import { buildEvents } from './events.js';

const STORAGE_KEY = 'aerol.v2.state';
let vitalsCache = null;

export function computeModel(scenario, rules = defaultRules()) {
  const schedule = buildSchedule(scenario);
  const segments = buildSegments(schedule, scenario);
  const terra = simulateTerra(schedule, segments, scenario);
  const wbc = simulateWbc(schedule, segments, scenario);
  const terraEnv = terraEnvelope(schedule, segments, scenario, buildSegments);
  const wbcEnv = wbcEnvelope(schedule, segments, scenario, buildSegments);
  const vkey = JSON.stringify([scenario.launch_utc, scenario.mission_days, scenario.view_days, scenario.vitals, scenario.stress.onset_days_before_launch, scenario.seed, scenario.baseline_window_days]);
  if (!vitalsCache || vitalsCache.key !== vkey) {
    const S = simulateVitals(schedule, scenario);
    const baseline = vitalsBaseline(S, schedule);
    vitalsCache = { key: vkey, S, baseline, daily: dailySummaries(S, schedule, baseline) };
  }
  const { S, baseline, daily } = vitalsCache;
  const labs = simulateLabSamples(schedule, scenario, terra, wbc);
  const transitions = schedule.regionChanges.map(c => c.t).filter(isNum);
  const dosimeterReadings = simulateDosimeter(segments, schedule);
  const dosimeter = ingestReadings(dosimeterReadings, { transitions, maxGapHours: 2 });
  const alerts = evaluateRules({ schedule, segments, S, baseline, labs, terra, wbc, sc: scenario, rules });
  const model = { scenario, schedule, segments, terra, wbc, terraEnv, wbcEnv, vitals: S, baseline, daily, labs, dosimeter, dosimeterReadings, alerts, rules, registry: MODEL_REGISTRY };
  model.events = buildEvents(model);
  return model;
}

// ---- Simulated communication link ----
export function linkUp(model, t) {
  const sc = model.scenario;
  const { schedule } = model;
  for (const o of sc.link.outages || []) if (t >= schedule.launch + o.start_day * DAY && t < schedule.launch + o.end_day * DAY) return false;
  const region = regionAt(schedule, t);
  if (region === 'ground') return true;
  const hours = region === 'inside_magnetosphere' ? sc.link.leo_contact_hours_per_day : sc.link.deep_contact_hours_per_day;
  const hourOfDay = ((t % DAY) + DAY) % DAY / HOUR;
  return hourOfDay >= 24 - hours; // loss-of-signal window at the start of each UTC day
}

export function deliveryTime(model, t, direction = 'down') {
  let x = t;
  const limit = t + 60 * DAY;
  while (x < limit && !linkUp(model, x)) x += 5 * MINUTE;
  const light = model.scenario.link.light_time_s * 1000 * (regionAt(model.schedule, x) === 'ground' ? 0 : 1);
  return x + light + (direction === 'down' ? model.scenario.link.ground_processing_min * MINUTE : MINUTE);
}

// Evidence packets: deterministic from alerts, check-ins and daily summaries.
export function buildPackets(model, actions) {
  const packets = [];
  const add = (p) => {
    const received = deliveryTime(model, p.created, 'down');
    const ack = deliveryTime(model, received + 2 * MINUTE, 'up');
    packets.push({ ...p, received, ack });
  };
  for (const n of model.alerts.notifications) {
    if (n.category === 'research' || n.category === 'schedule') continue;
    add({ packet_id: `pkt-${n.id}`, kind: 'evidence', created: n.t, episode_id: n.episode_id, notification_id: n.id,
      summary: `${n.rule_label} · ${n.severity} · ${isNum(n.value) ? fmt(n.value, 1) + ' ' + n.unit : ''}`.trim(), severity: n.severity, health_check: n.health_check });
  }
  for (const a of actions) {
    if (a.side === 'ground') continue;
    add({ packet_id: `pkt-act-${a.id}`, kind: a.action === 'checkin' ? 'checkin' : 'action', created: a.t, episode_id: a.episode_id || null, action_id: a.id,
      summary: actionSummary(a) });
  }
  const { schedule } = model;
  // Daily wearable/dosimeter summaries across the whole schedule (ground network before launch and after landing).
  for (let t = Math.ceil(schedule.start / DAY) * DAY + 6 * HOUR; t < schedule.end; t += DAY) {
    add({ packet_id: `pkt-daily-${t}`, kind: 'daily_summary', created: t, summary: `Daily vitals & dosimeter summary ${missionLabel(schedule, t)}` });
  }
  packets.sort((a, b) => a.created - b.created);
  return packets;
}

export function packetStatus(p, t) {
  if (p.created > t) return null;
  if (p.received > t) return 'queued onboard';
  if (p.ack > t) return 'received by simulated ground station';
  return 'receipt acknowledged (simulated)';
}

export function actionSummary(a) {
  switch (a.action) {
    case 'ack': return 'Alert acknowledged';
    case 'symptoms': case 'checkin': return `Check-in: ${(a.data?.symptoms || []).join(', ') || 'no symptoms'}; stress ${a.data?.stress ?? '—'}/5; fatigue ${a.data?.fatigue ?? '—'}/5${a.data?.concerns ? '; “' + a.data.concerns + '”' : ''}`;
    case 'followup': return 'Follow-up started';
    case 'contact_cmo': return 'Crew medical support contacted (simulated, onboard)';
    case 'ground_review': return `Reviewed on Earth: ${a.data?.note || 'no note'}`;
    case 'request_sample': return 'Research confirmatory sample requested';
    case 'selfcare': return `Self-care logged: ${a.data?.kind || 'activity'}`;
    case 'resolve': return 'Marked resolved by reviewer';
    default: return a.action;
  }
}

// ---- Follow-up list (astronaut) and review queue (Earth) ----
export function followups(model, actions, t) {
  const items = [];
  const { schedule } = model;
  for (const ep of model.alerts.episodes) {
    if (ep.start > t || ep.category === 'research' || ep.category === 'schedule') continue;
    const rule = model.rules.find(r => r.id === ep.rule_id);
    const st = episodeStatus(ep, t, actions);
    const level = rule.levels[Math.min(ep.level, rule.levels.length - 1)];
    const hist = ep.severity_history.filter(h => h.t <= t);
    const sevLevel = rule.levels.find(l => l.severity === hist[hist.length - 1].severity) || level;
    if (!sevLevel.health_check?.needed) continue;
    const review = actions.filter(a => a.side === 'ground' && a.episode_id === ep.episode_id && a.action === 'ground_review');
    const reviewMsg = review.map(r => ({ ...r, delivered: deliveryTime(model, r.t, 'up') })).filter(r => r.delivered <= t);
    items.push({ id: `fu-${ep.episode_id}`, kind: 'health_check', title: `Health check: ${rule.label}`, urgency: sevLevel.health_check.urgency,
      severity: hist[hist.length - 1].severity, t: ep.start, episode_id: ep.episode_id, status: st.resolved_by_review ? 'completed' : st.followup_started ? 'started' : 'requested',
      messages: reviewMsg.map(r => ({ t: r.delivered, text: `Reviewed by simulated medical personnel: ${r.data?.note || 'acknowledged'}` })) });
  }
  for (const s of schedule.samples) {
    if (s.t < t - DAY) continue;
    items.push({ id: `fu-sample-${s.label}`, kind: 'sample', title: `Blood draw · ${friendlyCode(s.label)}`, urgency: 'scheduled', severity: 'info', t: s.t, status: s.t <= t ? 'due now' : 'upcoming', messages: [] });
  }
  for (const a of actions.filter(a => a.action === 'request_sample' && a.side === 'ground')) {
    const delivered = deliveryTime(model, a.t, 'up');
    if (delivered > t) continue;
    items.push({ id: `fu-research-${a.id}`, kind: 'research_request', title: 'Research team request: confirmatory sample at next scheduled draw', urgency: 'research (not medical)', severity: 'research', t: delivered, status: 'requested',
      messages: [{ t: delivered, text: 'Research request — not a medical alert. No action needed before the next scheduled draw.' }] });
  }
  return items.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.t - b.t);
}

// ---- Medical check-up brief (editable text) ----
export function checkupBrief(model, actions, t) {
  const { schedule, daily, baseline } = model;
  const recent = daily.filter(d => d.t <= t && d.t > t - 7 * DAY);
  const valid = recent.filter(d => !d.insufficient);
  const avg = k => (valid.length ? valid.reduce((a, d) => a + (d[k] ?? 0), 0) / valid.length : null);
  const unresolved = model.alerts.episodes.filter(e => e.category !== 'research' && e.category !== 'schedule').map(e => ({ e, s: episodeStatus(e, t, actions) }))
    .filter(x => x.s && (x.s.active || !x.s.resolved_by_review) && x.e.start > t - 30 * DAY);
  const checkins = actions.filter(a => (a.action === 'checkin' || a.action === 'symptoms') && a.t <= t && a.t > t - 14 * DAY);
  const labs = model.labs.filter(l => l.available <= t).sort((a, b) => b.t - a.t);
  const lastW = labs.find(l => l.kind === 'wbc');
  const lastT = labs.find(l => l.kind === 'terra');
  const proj = sampleGrid(model.terra.fold, t);
  const lines = [
    `AEROL check-up brief — ${missionLabel(schedule, t, true)} (${iso(t).slice(0, 16)}Z) · ${PHASE_LABEL[phaseAt(schedule, t)]} · ${REGION_LABEL[regionAt(schedule, t)]}`,
    `Synthetic astronaut ${model.scenario.astronaut_id}. Simulated data — prototype, not a medical record.`,
    '',
    'MEASURED TRENDS (simulated wristband, last 7 days vs personal baseline)',
    valid.length ? `- Resting HR ${fmt(avg('rhr'), 0)} bpm (baseline ${fmt(baseline.rhr, 0)}); RMSSD ${fmt(avg('hrv'), 0)} ms (baseline ${fmt(baseline.hrv, 0)}); sleep ${fmt(avg('sleep_h'), 1)} h; data coverage ${fmt(100 * recent.reduce((a, d) => a + d.coverage, 0) / Math.max(1, recent.length), 0)}%.`
      : '- Insufficient wearable data in the last 7 days.',
    '',
    'SYMPTOMS / CHECK-INS (last 14 days)',
    ...(checkins.length ? checkins.map(c => `- ${missionLabel(schedule, c.t, true)}: ${actionSummary(c)}`) : ['- None logged.']),
    '',
    'EXPOSURE HISTORY (connected dosimeter, simulated; dose-equivalent ledger)',
    `- Current rate ${fmt(rateAt(model.segments, t), 2)} mSv/day; 7-day ${fmt(doseAt(model.segments, t) - doseAt(model.segments, t - 7 * DAY), 1)} mSv; mission total ${fmt(doseAt(model.segments, t), 1)} mSv.`,
    '- Not NASA effective dose; not comparable with the 600 mSv career limit without a documented conversion.',
    '',
    'UNRESOLVED / RECENT ALERTS',
    ...(unresolved.length ? unresolved.map(x => `- ${missionLabel(schedule, x.e.start, true)} ${x.e.rule_id}: ${x.s.severity}, ${x.s.status}`) : ['- None.']),
    '',
    'LABORATORY RESULTS AVAILABLE (simulated lab results)',
    lastW ? `- WBC ${fmt(lastW.value, 1)} ×10⁹/L on ${friendlyCode(lastW.label)} (${signed(lastW.pct_from_baseline, 0, '%')} vs 6-month pre-flight baseline; lab range ${model.scenario.wbc.lab_range.join('–')}).` : '- No WBC result yet.',
    lastT ? `- TERRA ${fmt(lastT.fold, 2)}× baseline on ${friendlyCode(lastT.label)} (assay result).` : '- No TERRA assay result available yet (in-flight samples are assayed on Earth after return).',
    '',
    'RESEARCH PREDICTIONS — UNCONFIRMED, NOT FOR CLINICAL DECISIONS',
    `- Simulated TERRA projection now: ${signed(100 * (proj - 1), 0, '%')} vs baseline (hand-set simulator, not validated).`,
    '',
    'SUGGESTED QUESTIONS',
    '- Any fever, breathlessness, unusual fatigue or sleep disruption since the last check?',
    '- Was the band worn snugly during flagged readings (signal quality)?',
    '- Are recent alerts explained by schedule, workload or landing timing?',
    '- Is a protocol-specified repeat CBC indicated?',
  ];
  return lines.join('\n');
}

// ---- Store ----
function defaultState() {
  const scenario = scenarioFromPreset('hypothesis-default');
  const launch = Date.parse(scenario.launch_utc);
  return {
    version: 2, scenarioId: 'hypothesis-default', scenario, compareId: 'leo-only', compareOn: false, rules: defaultRules(),
    clock: { t: launch + 18 * DAY, playing: false, speed: DAY / 2, autoPause: true },
    actions: [], briefText: null, briefEditedAt: null, mode: 'simulation', seenAlerts: [],
  };
}

export class Store {
  constructor({ storage = globalThis.localStorage, channelName = 'aerol-sync' } = {}) {
    this.storage = storage;
    this.listeners = new Set();
    this.state = this.load() || defaultState();
    this.recompute();
    this.compareModel = null;
    this.channel = null;
    if (channelName && typeof BroadcastChannel !== 'undefined') {
      try { this.channel = new BroadcastChannel(channelName); this.channel.onmessage = e => this.receive(e.data); this.channel.unref?.(); } catch { this.channel = null; }
    }
    this.tabId = Math.random().toString(36).slice(2);
  }

  load() {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (s.version !== 2 || validateScenario(s.scenario).length) return null;
      s.clock.playing = false;
      if (s.scenario?.astronaut_id === 'SYN-A01') s.scenario.astronaut_id = 'Astronaut 1'; // migrate saved workspaces
      return { ...defaultState(), ...s };
    } catch { return null; }
  }

  save() {
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify({ ...this.state, clock: { ...this.state.clock, playing: false } })); } catch { /* storage unavailable: session-only */ }
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind) { for (const fn of this.listeners) fn(kind, this); }

  broadcast(type) {
    if (!this.channel) return;
    try { this.channel.postMessage({ type, from: this.tabId, clock: this.state.clock, state: type === 'state' ? this.state : undefined }); } catch { /* ignore */ }
  }

  receive(msg) {
    if (!msg || msg.from === this.tabId) return;
    if (msg.type === 'clock') { this.state.clock = { ...msg.clock }; this.emit('clock'); }
    if (msg.type === 'state' && msg.state) {
      const scenarioChanged = JSON.stringify(msg.state.scenario) !== JSON.stringify(this.state.scenario) || JSON.stringify(msg.state.rules) !== JSON.stringify(this.state.rules);
      this.state = { ...msg.state, clock: { ...msg.state.clock } };
      if (scenarioChanged) this.recompute();
      this.emit('state');
    }
  }

  recompute() {
    this.model = computeModel(this.state.scenario, this.state.rules);
    this.packets = buildPackets(this.model, this.state.actions);
    if (this.state.compareOn) this.compareModel = computeModel(scenarioFromPreset(this.state.compareId), this.state.rules);
  }

  get t() { return this.state.clock.t; }

  setTime(t, { broadcast = true } = {}) {
    const { schedule } = this.model;
    this.state.clock.t = Math.min(schedule.end, Math.max(schedule.start, t));
    if (broadcast) this.broadcast('clock');
    this.emit('clock');
  }

  play(on = !this.state.clock.playing) { this.state.clock.playing = on; this.broadcast('clock'); this.emit('clock'); }
  setSpeed(s) { this.state.clock.speed = s; this.broadcast('clock'); this.emit('clock'); }

  // Advance the mission clock; auto-pause when a new non-info watch notification fires.
  tick(realMs) {
    const c = this.state.clock;
    if (!c.playing) return null;
    const before = c.t;
    const after = Math.min(this.model.schedule.end, before + c.speed * realMs / 1000);
    let fired = null;
    if (c.autoPause) {
      fired = this.model.alerts.notifications.find(n => n.t > before && n.t <= after && n.category !== 'research' && n.category !== 'schedule' && severityRank(n.severity) >= 1);
    }
    if (fired) { c.t = fired.t; c.playing = false; }
    else { c.t = after; if (after >= this.model.schedule.end) c.playing = false; }
    this.broadcast('clock');
    this.emit('clock');
    return fired;
  }

  commit({ recompute = false } = {}) {
    if (recompute) this.recompute();
    else this.packets = buildPackets(this.model, this.state.actions);
    this.save();
    this.broadcast('state');
    this.emit('state');
  }

  setScenario(scenario, { scenarioId = 'custom' } = {}) {
    const errors = validateScenario(scenario);
    if (errors.length) return errors;
    this.state.scenario = scenario;
    this.state.scenarioId = scenarioId;
    this.commit({ recompute: true });
    this.setTime(this.state.clock.t, { broadcast: false });
    return [];
  }

  loadPreset(id) { return this.setScenario(scenarioFromPreset(id), { scenarioId: id }); }

  setCompare(on, id = this.state.compareId) {
    this.state.compareOn = on; this.state.compareId = id;
    this.compareModel = on ? computeModel(scenarioFromPreset(id), this.state.rules) : null;
    this.save(); this.broadcast('state'); this.emit('state');
  }

  setRules(rules) { this.state.rules = rules; this.commit({ recompute: true }); }

  addAction(a) {
    const action = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, t: this.t, wall_time: new Date().toISOString(), side: 'astronaut', ...a };
    this.state.actions.push(action);
    this.commit();
    return action;
  }

  actionsAt(t = this.t) { return this.state.actions.filter(a => a.t <= t); }

  reset() {
    this.state = defaultState();
    this.save();
    this.recompute();
    this.broadcast('state');
    this.emit('state');
  }

  exportState() {
    return { exported_at: new Date().toISOString(), format: 'aerol.workspace.v2', ruleset: RULESET_VERSION, state: { ...this.state, clock: { ...this.state.clock, playing: false } } };
  }

  importState(obj) {
    if (!obj || obj.format !== 'aerol.workspace.v2' || !obj.state) throw new Error('Not an AEROL workspace export (format aerol.workspace.v2).');
    const errors = validateScenario(obj.state.scenario);
    if (errors.length) throw new Error('Scenario invalid: ' + errors.join(' '));
    this.state = { ...defaultState(), ...obj.state };
    this.commit({ recompute: true });
  }

  // Convenience views at the current time
  watchView(t = this.t) {
    const m = this.model;
    const actions = this.actionsAt(t);
    const v = latestVitals(m.vitals, t);
    const day = m.daily.filter(d => d.t <= t - DAY / 2).pop() || null;
    const top = topPriority(m.alerts.episodes, t, actions, { dataMissing: v.missing });
    const notes = m.alerts.notifications.filter(n => n.t <= t && n.category !== 'research');
    return {
      t, label: missionLabel(m.schedule, t), phase: phaseAt(m.schedule, t), region: regionAt(m.schedule, t),
      vitals: v, day, baseline: m.baseline, top, notes,
      rate: rateAt(m.segments, t), dose7: doseAt(m.segments, t) - doseAt(m.segments, t - 7 * DAY), dose: doseAt(m.segments, t),
      followups: followups(m, actions, t), linkUp: linkUp(m, t), actions,
    };
  }

  groundView(t = this.t) {
    const received = this.packets.filter(p => p.received <= t);
    const queued = this.packets.filter(p => p.created <= t && p.received > t);
    const latest = received.length ? received[received.length - 1] : null;
    return { received, queued, latestCreated: latest ? Math.max(...received.map(p => p.created)) : null, stalenessMs: latest ? t - Math.max(...received.map(p => p.created)) : null };
  }
}

export { round };
