// Watch screen renderers (pure HTML strings). Interaction wiring lives in watch.js.
import { DAY, HOUR, isNum, fmt, signed, sampleGrid } from '../core/util.js';
import { missionLabel, PHASE_LABEL, REGION_LABEL } from '../core/schedule.js';
import { rateAt, doseAt } from '../core/radiation.js';
import { episodeStatus, SEVERITY_LABEL } from '../core/rules.js';
import { esc } from './dom.js';

export const PAGES = [
  ['home', 'Home'], ['vitals', 'Vitals'], ['wellness', 'Sleep · Activity · Stress'], ['radiation', 'Radiation'],
  ['alerts', 'Notifications'], ['checkin', 'Check-in'], ['followup', 'Follow-up'],
];

const REGION_CHIP = { inside_magnetosphere: 'inside', radiation_belt_transit: 'belt', beyond_magnetosphere: 'beyond' };
const SYMPTOMS = ['Fever / chills', 'Headache', 'Nausea', 'Unusual fatigue', 'Short of breath', 'Dizziness', 'Poor sleep', 'Skin / eye irritation', 'Other'];
const CONCERNS = ['Discuss this alert', 'Discuss sleep', 'Discuss workload / stress', 'Nothing specific'];

function delta(v, base, digits = 0, unit = '') {
  if (!isNum(v) || !isNum(base)) return '';
  const d = v - base;
  const cls = Math.abs(d) < 1e-9 ? '' : d > 0 ? 'up' : 'down';
  return `<span class="delta ${cls}">${signed(d, digits, unit)} vs baseline</span>`;
}

function spark(values, cls = '#8de0c0', lo = null, hi = null) {
  const v = values.filter(isNum);
  if (v.length < 2) return '<div class="wmuted">Not enough data for a trend.</div>';
  const a = lo ?? Math.min(...v);
  const b = hi ?? Math.max(...v);
  const span = b - a || 1;
  let d = '';
  values.forEach((x, i) => {
    if (!isNum(x)) return;
    const X = (i / (values.length - 1)) * 260;
    const Y = 42 - ((x - a) / span) * 38;
    d += `${d ? 'L' : 'M'}${X.toFixed(1)},${Y.toFixed(1)}`;
  });
  return `<svg class="spark" viewBox="0 0 260 46" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" stroke="${cls}"/></svg>`;
}

function ring(score) {
  const C = 2 * Math.PI * 50;
  const f = isNum(score) ? score / 100 : 0;
  const col = !isNum(score) ? '#555' : score >= 67 ? '#8de0c0' : score >= 34 ? '#e6c36a' : '#ff9a6a';
  return `<div class="ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="50" stroke="#1d2a2c" stroke-width="11" fill="none"/><circle cx="60" cy="60" r="50" stroke="${col}" stroke-width="11" fill="none" stroke-linecap="round" stroke-dasharray="${C * f} ${C}"/></svg>
    <div class="rc"><div><b>${isNum(score) ? score : '—'}</b><br><small>${isNum(score) ? 'RECOVERY' : 'INSUFFICIENT<br>DATA'}</small></div></div></div>`;
}

function priorityCard(store, w) {
  const top = w.top;
  if (top.kind === 'insufficient_data') {
    return `<div class="wcard sev-caution"><div class="wk">Status</div><div class="wv">Band not reporting</div><div class="wmuted">Vital signs unavailable — this is not an all-clear. Check fit and charge.</div></div>`;
  }
  if (top.kind === 'none') {
    const next = w.followups.find(f => f.kind === 'sample' && f.t > w.t);
    return `<div class="wcard"><div class="wk">Status</div><div class="wv">No active alerts</div><div class="wmuted">${next ? `Next: ${esc(next.title)} · ${esc(missionLabel(store.model.schedule, next.t))}` : 'Keep wearing the band.'}</div></div>`;
  }
  const rule = store.model.rules.find(r => r.id === top.e.rule_id);
  const lvl = rule.levels.find(l => l.severity === top.s.severity) || rule.levels[0];
  return `<button class="wcard tap sev-${top.s.severity}" data-open="${esc(top.e.episode_id)}">
    <div class="wk">${esc(SEVERITY_LABEL[top.s.severity])} · ${esc(top.s.acknowledged ? 'acknowledged — ongoing' : 'tap to review')}</div>
    <div class="wv">${esc(rule.label)}</div><div class="wmuted">Next: ${esc(lvl.action.split('. ')[0])}.</div></button>`;
}

export function homePage(store, w) {
  const urgentFirst = w.top.kind === 'alert' && ['caution', 'urgent'].includes(w.top.s.severity);
  const chips = `<div class="wchips"><span class="wchip">${esc(PHASE_LABEL[w.phase])}</span><span class="wchip ${REGION_CHIP[w.region] || ''}">${esc(REGION_LABEL[w.region])}</span></div>`;
  const rec = w.vitals.missing ? null : w.day?.recovery ?? null;
  const recNote = `<div class="wmuted" style="text-align:center">Demo estimate · never overrides alerts</div>`;
  return `<div class="wtitle"><span>Home</span><span>${esc(store.model.scenario.astronaut_id)}</span></div>${chips}
    ${urgentFirst ? priorityCard(store, w) + ring(rec) + recNote : ring(rec) + priorityCard(store, w) + recNote}`;
}

export function vitalsPage(store, w) {
  const v = w.vitals;
  const b = w.baseline;
  if (v.missing) {
    return `<div class="wtitle">Vitals</div><div class="wcard sev-caution"><div class="wv">No data</div><div class="wmuted">The band has not reported since ${v.since ? esc(missionLabel(store.model.schedule, v.since, true)) : 'start'}. Values are unavailable — not normal, not abnormal.</div></div>
      <button class="wbtn" data-goto="alerts">See data-quality alert</button>`;
  }
  const S = store.model.vitals;
  const i = Math.floor((w.t - S.t0) / S.step);
  const rest = [];
  for (let k = Math.max(0, i - 288); k <= i; k += 4) rest.push(S.rest_hr[k] ?? null);
  const poor = v.quality !== 'good';
  return `<div class="wtitle"><span>Vitals</span><span class="wmuted">${poor ? '⚠ poor contact' : 'signal good'}</span></div>
    <div class="wrow"><span class="lbl">Heart rate<small>PPG</small></span><span class="val">${fmt(v.hr, 0)}<small> bpm</small></span></div>
    <div class="wrow"><span class="lbl">Resting HR<small>rest-qualified</small></span><span class="val">${fmt(v.rest_hr, 0)}<small> bpm</small>${delta(v.rest_hr, b.rest_hr)}</span></div>
    <div class="wrow"><span class="lbl">HRV · RMSSD<small>PPG pulse-rate variability</small></span><span class="val">${fmt(v.hrv, 0)}<small> ms</small>${delta(v.hrv, b.hrv_all)}</span></div>
    <div class="wrow"><span class="lbl">Respiratory rate<small>estimated from PPG</small></span><span class="val">${fmt(v.resp, 1)}<small> /min</small></span></div>
    <div class="wrow"><span class="lbl">SpO₂ (wrist)<small>${poor ? 'excluded: poor contact' : 'confirm with medical oximeter'}</small></span><span class="val">${fmt(v.spo2, 0)}<small> %</small></span></div>
    <div class="wrow"><span class="lbl">Skin temp (wrist)<small>not core temperature</small></span><span class="val">${fmt(v.skin, 1)}<small> °C</small>${delta(v.skin, b.skin_all, 1, ' °C')}</span></div>
    <div class="wk wmuted" style="margin-top:6px">Resting HR · last 72 h</div>${spark(rest, '#8de0c0')}`;
}

export function wellnessPage(store, w) {
  const d = w.day;
  const b = w.baseline;
  if (!d || d.insufficient || w.vitals.missing) {
    return `<div class="wtitle">Sleep · Activity · Stress</div><div class="wcard sev-caution"><div class="wv">Insufficient data</div><div class="wmuted">Not enough wear time in the last day to estimate sleep, activity or stress.</div></div>`;
  }
  const ri = d.recovery_inputs;
  return `<div class="wtitle"><span>Last day</span><span class="wmuted">demo estimates</span></div>
    <div class="wrow"><span class="lbl">Sleep<small>score ${d.sleep_score}</small></span><span class="val">${fmt(d.sleep_h, 1)}<small> h</small>${delta(d.sleep_h, b.sleep_h, 1, ' h')}</span></div>
    <div class="wrow"><span class="lbl">Activity<small>score ${d.activity_score}</small></span><span class="val">${fmt(d.active_min, 0)}<small> min</small></span></div>
    <div class="wrow"><span class="lbl">Stress estimate<small>from HRV & resting HR</small></span><span class="val">${d.stress}<small>/100</small></span></div>
    <div class="wrow"><span class="lbl">Recovery<small>inputs below</small></span><span class="val">${d.recovery}<small>/100</small></span></div>
    <div class="wcard"><div class="wk">Recovery inputs</div><div class="wmuted">HRV ${fmt(ri.hrv, 0)} ms → ${ri.hrv_component} (×0.4) · Resting HR ${fmt(ri.rhr, 0)} → ${ri.rhr_component} (×0.3) · Sleep ${fmt(ri.sleep_h, 1)} h → ${ri.sleep_component} (×0.3) · coverage ${Math.round(ri.coverage * 100)}%</div></div>`;
}

export function radiationPage(store, w) {
  const m = store.model;
  const rates = [];
  for (let k = 14 * 24; k >= 0; k -= 6) rates.push(rateAt(m.segments, w.t - k * HOUR));
  const env = w.notes.filter(n => n.category === 'environmental').slice(-3).reverse();
  return `<div class="wtitle"><span>Radiation</span><span class="wchip ${REGION_CHIP[w.region] || ''}">${esc(REGION_LABEL[w.region])}</span></div>
    <div class="wbig">${fmt(w.rate, 2)}<small>mSv/day</small></div><div class="wmuted">Dose rate · simulated connected dosimeter</div>
    <div class="wrow"><span class="lbl">Last 24 h</span><span class="val">${fmt(doseAt(m.segments, w.t) - doseAt(m.segments, w.t - DAY), 2)}<small> mSv</small></span></div>
    <div class="wrow"><span class="lbl">Last 7 days</span><span class="val">${fmt(w.dose7, 1)}<small> mSv</small></span></div>
    <div class="wrow"><span class="lbl">Mission total</span><span class="val">${fmt(w.dose, 1)}<small> mSv</small></span></div>
    <div class="wk wmuted" style="margin-top:4px">Dose rate · last 14 days</div>${spark(rates, '#f0a24a', 0)}
    ${env.map(n => `<button class="wcard tap sev-${n.severity}" data-open="${esc(n.episode_id)}"><div class="wk">${esc(n.mission_label)} · ${esc(SEVERITY_LABEL[n.severity])}</div><div class="wv">${esc(n.rule_label)}</div></button>`).join('')}
    <div class="wmuted">Dose-equivalent scenario ledger — not NASA effective dose.</div>`;
}

export function alertsPage(store, w) {
  const notes = [...w.notes].reverse().slice(0, 30);
  if (!notes.length) return `<div class="wtitle">Notifications</div><div class="wmuted">No notifications yet.</div>`;
  return `<div class="wtitle"><span>Notifications</span><span class="wmuted">${notes.length}</span></div>` + notes.map(n => {
    const ep = store.model.alerts.episodes.find(e => e.episode_id === n.episode_id);
    const st = ep ? episodeStatus(ep, w.t, w.actions) : null;
    return `<button class="wcard tap sev-${n.severity}" data-open="${esc(n.episode_id)}"><div class="wk">${esc(n.mission_label)} · ${esc(SEVERITY_LABEL[n.severity])}${n.kind === 'escalate' ? ' · escalated' : ''}</div>
      <div class="wv">${esc(n.rule_label)}</div><div class="wmuted">${esc(st ? st.status : '')}</div></button>`;
  }).join('');
}

export function checkinPage(store, w, draft) {
  const linked = draft.episode_id ? store.model.alerts.episodes.find(e => e.episode_id === draft.episode_id) : null;
  const linkedRule = linked ? store.model.rules.find(r => r.id === linked.rule_id) : null;
  return `<div class="wtitle">Check-in</div>
    ${linkedRule ? `<div class="wmuted">Linked to: ${esc(linkedRule.label)}</div>` : ''}
    <div class="wk wmuted" style="margin:6px 0 4px">Symptoms</div>
    <div class="wsel">${SYMPTOMS.map(s => `<button data-sym="${esc(s)}" aria-pressed="${draft.symptoms.has(s)}">${esc(s)}</button>`).join('')}</div>
    <div class="wk wmuted" style="margin:8px 0 4px">Perceived stress</div>
    <div class="wscale">${[1, 2, 3, 4, 5].map(n => `<button data-stress="${n}" aria-pressed="${draft.stress === n}">${n}</button>`).join('')}</div>
    <div class="wk wmuted" style="margin:8px 0 4px">Fatigue</div>
    <div class="wscale">${[1, 2, 3, 4, 5].map(n => `<button data-fatigue="${n}" aria-pressed="${draft.fatigue === n}">${n}</button>`).join('')}</div>
    <div class="wk wmuted" style="margin:8px 0 4px">For the next medical check</div>
    <div class="wsel">${CONCERNS.map(c => `<button data-concern="${esc(c)}" aria-pressed="${draft.concern === c}">${esc(c)}</button>`).join('')}</div>
    <button class="wbtn primary" data-act="submit-checkin" style="margin-top:10px">Save check-in</button>
    <div class="wmuted">Saved onboard first; queued for Earth.</div>`;
}

export function followupPage(store, w) {
  const items = w.followups;
  if (!items.length) return `<div class="wtitle">Follow-up</div><div class="wmuted">Nothing pending.</div>`;
  return `<div class="wtitle"><span>Follow-up</span><span class="wmuted">${items.length}</span></div>` + items.slice(0, 12).map(f => `
    <div class="wcard sev-${f.severity === 'research' ? 'info' : f.severity}">
      <div class="wk">${esc(f.urgency || '')} · ${esc(f.status)}</div>
      <div class="wv">${esc(f.title)}</div>
      <div class="wmuted">${esc(missionLabel(store.model.schedule, f.t, true))}</div>
      ${f.messages.map(m => `<div class="wmuted" style="margin-top:4px">✉ ${esc(m.text)}</div>`).join('')}
      ${f.kind === 'health_check' && f.status === 'requested' ? `<button class="wbtn ghost" data-act="followup" data-ep="${esc(f.episode_id)}">Start follow-up</button>` : ''}
      ${f.kind === 'health_check' ? `<button class="wbtn ghost" data-act="contact" data-ep="${esc(f.episode_id)}">Contact crew medical support</button>` : ''}
    </div>`).join('');
}

// Full-screen alert detail on the watch.
export function alertOverlay(store, w, episodeId) {
  const m = store.model;
  const ep = m.alerts.episodes.find(e => e.episode_id === episodeId);
  if (!ep) return '';
  const rule = m.rules.find(r => r.id === ep.rule_id);
  const st = episodeStatus(ep, w.t, w.actions) || { severity: ep.severity_history[0].severity, status: 'not yet active' };
  const notes = m.alerts.notifications.filter(n => n.episode_id === ep.episode_id && n.t <= w.t);
  const last = notes[notes.length - 1] || m.alerts.notifications.find(n => n.episode_id === ep.episode_id);
  const lvl = rule.levels.find(l => l.severity === st.severity) || rule.levels[0];
  const urgent = st.severity === 'urgent';
  const digits = { bpm: 0, ms: 0, '°C': 1, '%': 0, 'mSv/day': 2, mSv: 1, h: 1, '10⁹/L': 1 }[rule.unit] ?? 2;
  const reading = isNum(last?.value) ? `${fmt(last.value, digits)} ${rule.type === 'lab_change' ? '% vs baseline' : rule.unit}` : '—';
  const ref = isNum(last?.baseline) ? `${rule.type === 'dose_rate_jump' ? 'trailing 72-h mean' : 'baseline'} ${fmt(last.baseline, digits)} ${rule.type === 'lab_change' ? '×10⁹/L' : rule.unit}` : '';
  const thr = last?.threshold;
  const th = !isNum(thr) ? (rule.type === 'lab_range' ? `lab range ${m.scenario.wbc.lab_range.join('–')} ×10⁹/L` : '')
    : rule.type === 'dose_rate_jump' ? `rule: ≥ ${thr}× trailing-72 h mean and ≥ ${rule.min_rate} mSv/day`
    : rule.type === 'mission_projection' ? `rule: projection ≥ ${Math.round(thr * 100)}% of ${rule.planning_level} mSv planning level`
    : rule.type === 'baseline_ratio_mean' ? `rule: ≤ ${Math.round(thr * 100)}% of baseline`
    : rule.type === 'baseline_delta_mean' ? `rule: ≥ baseline + ${thr} ${rule.unit}`
    : rule.type === 'quality_poor' ? `rule: ≥ ${Math.round(thr * 100)}% poor-contact samples`
    : rule.type === 'missing_data' ? `rule: no data for ≥ ${thr} h`
    : rule.type === 'lab_change' ? `rule: |change| ≥ ${thr}%`
    : `rule: ${rule.direction === 'below' ? '<' : '≥'} ${thr} ${rule.unit}`;
  return `<div class="walert sev-${st.severity}" role="dialog" aria-label="${esc(rule.label)}">
    <button class="wclose" data-act="close">Close</button>
    <span class="sev sev-${st.severity}">${esc(SEVERITY_LABEL[st.severity])}</span>
    <h3>${esc(rule.label)}</h3>
    ${urgent ? `<div class="wcard sev-urgent"><div class="wv">Follow the approved onboard protocol now.</div><div class="wmuted">Earth may be delayed. Onboard crew medical support is your immediate contact. Do not wait for a repeat reading.</div></div>` : ''}
    <div class="wmuted">${esc(missionLabel(m.schedule, ep.start, true))}${ep.severity_history.length > 1 ? ' · escalated ' + esc(missionLabel(m.schedule, ep.severity_history[ep.severity_history.length - 1].t, true)) : ''} · ${esc(st.status)}</div>
    <div class="wcard"><div class="wk">Reading</div><div class="wv">${esc(reading)}</div><div class="wmuted">${esc([ref, th].filter(Boolean).join(' · '))}</div><div class="wmuted">${esc(last?.origin || '')} · ${esc(rule.threshold_kind)}</div></div>
    <div class="wcard"><div class="wk">Next action</div><div class="wv" style="font-size:13px">${esc(lvl.action)}</div>
      <div class="wmuted">Health check: ${lvl.health_check?.needed ? esc(lvl.health_check.urgency || 'yes') : 'not needed'}</div></div>
    ${st.acknowledged ? '' : `<button class="wbtn ${urgent ? 'danger' : 'primary'}" data-act="ack" data-ep="${esc(ep.episode_id)}">Acknowledge</button>`}
    <button class="wbtn" data-act="symptoms" data-ep="${esc(ep.episode_id)}">Record symptoms</button>
    ${lvl.health_check?.needed ? `<button class="wbtn" data-act="followup" data-ep="${esc(ep.episode_id)}">${st.followup_started ? 'Follow-up started ✓' : 'Begin follow-up'}</button>` : ''}
    <button class="wbtn ${urgent || st.severity === 'caution' ? 'warn' : 'ghost'}" data-act="contact" data-ep="${esc(ep.episode_id)}">Contact crew medical support</button>
    <div class="wmuted" style="margin-top:6px">Acknowledging does not resolve the event. Route: ${esc(rule.escalation_route)}.</div>
  </div>`;
}

export { sampleGrid };
