// Versioned, configurable alert-rule registry and a deterministic episode engine.
// Thresholds are labeled by kind: operational limit (configured), lab reference range,
// personal deviation, or demo-only threshold. Nothing here is a validated clinical rule.
import { DAY, HOUR, MINUTE, isNum, round } from './util.js';
import { rateAt, doseAt } from './radiation.js';
import { sampleGrid } from './util.js';
import { missionLabel } from './schedule.js';

export const RULESET_VERSION = 'aerol.rules.v1';
export const SEVERITIES = ['info', 'advisory', 'caution', 'urgent'];
export const SEVERITY_LABEL = { info: 'Info', advisory: 'Advisory', caution: 'Caution', urgent: 'Urgent', research: 'Research review' };

const CMO = 'Crew medical officer (onboard, immediate) → flight surgeon (ground, may be delayed)';

export function defaultRules() {
  return [
    {
      id: 'phys_rhr_sustained', version: 1, category: 'physiological', metric: 'rest_hr', unit: 'bpm', type: 'baseline_delta_mean',
      label: 'Sustained resting heart-rate rise', window_h: 24, persistence_h: 4, clear_h: 12, cooldown_h: 48, min_coverage: 0.15,
      quality: 'Rest-qualified PPG samples only (movement < 0.3 m/s², mostly sleep); ≥15% of the 24 h window must be rest-qualified', threshold_kind: 'personal deviation (demo threshold)',
      source_policy: 'Demo threshold: trailing-24 h mean ≥ personal baseline + 8 bpm (caution ≥ +15 bpm). Not a validated clinical rule.',
      levels: [
        { severity: 'advisory', threshold: 8, action: 'Complete a symptom check-in now and repeat a seated resting measurement in 2 hours.', health_check: { needed: true, urgency: 'routine — next medical conference' } },
        { severity: 'caution', threshold: 15, action: 'Request a health check with the crew medical officer today.', health_check: { needed: true, urgency: 'same day' } },
      ],
      recheck: 'Seated resting HR after 5 min rest; confirm band fit.', escalation_route: CMO,
    },
    {
      id: 'phys_hrv_low', version: 1, category: 'physiological', metric: 'hrv', unit: 'ms', type: 'baseline_ratio_mean', direction: 'below',
      label: 'Sustained low pulse-rate variability', window_h: 24, persistence_h: 12, clear_h: 12, cooldown_h: 48, min_coverage: 0.3,
      quality: 'PPG-derived RMSSD (pulse-rate variability); artifact-rejected NN intervals', threshold_kind: 'personal deviation (demo threshold)',
      source_policy: 'Demo threshold: trailing-24 h mean ≤ 70% of personal baseline for 12 h. PPG PRV is not interchangeable with ECG HRV.',
      levels: [{ severity: 'advisory', threshold: 0.7, action: 'Log sleep, workload and any symptoms in Check-in.', health_check: { needed: false, urgency: null } }],
      recheck: 'Overnight recording with good band contact.', escalation_route: 'Self-log → crew medical officer if symptomatic',
    },
    {
      id: 'phys_skin_temp', version: 1, category: 'physiological', metric: 'skin', unit: '°C', type: 'baseline_delta_mean',
      label: 'Wrist skin-temperature rise', window_h: 12, persistence_h: 3, clear_h: 12, cooldown_h: 48, min_coverage: 0.3,
      quality: 'Wrist skin temperature — not core body temperature', threshold_kind: 'personal deviation (demo threshold)',
      source_policy: 'Demo threshold: trailing-12 h mean ≥ personal baseline + 0.8 °C.',
      levels: [{ severity: 'advisory', threshold: 0.8, action: 'Measure core temperature with the medical thermometer per protocol and log symptoms.', health_check: { needed: true, urgency: 'if core temperature is elevated' } }],
      recheck: 'Core temperature with medical thermometer.', escalation_route: CMO,
    },
    {
      id: 'phys_spo2_low', version: 1, category: 'physiological', metric: 'spo2', unit: '%', type: 'absolute_mean', direction: 'below',
      label: 'Low wrist SpO₂ (good signal)', window_h: 0.5, persistence_h: 0.25, clear_h: 1, cooldown_h: 6, min_coverage: 0.5, require_good_quality: true,
      quality: 'Only samples with good signal quality are evaluated', threshold_kind: 'demo threshold (configure per flight-medicine policy)',
      source_policy: 'Demo threshold: 30-min mean < 92% with good signal quality.',
      levels: [{ severity: 'caution', threshold: 92, action: 'Repeat now with the medical-grade pulse oximeter. If you are short of breath or unwell, contact the crew medical officer immediately — do not wait for the repeat.', health_check: { needed: true, urgency: 'immediate if confirmed or symptomatic' } }],
      recheck: 'Medical-grade pulse oximeter.', escalation_route: CMO,
    },
    {
      id: 'quality_signal', version: 1, category: 'data_quality', metric: 'quality', unit: '', type: 'quality_poor',
      label: 'Poor sensor contact', window_h: 0.5, persistence_h: 0.25, clear_h: 0.5, cooldown_h: 6, fraction: 0.5,
      quality: 'Signal-quality index from the band', threshold_kind: 'data-quality rule',
      source_policy: '≥50% of samples in 30 min flagged poor. Affected readings are excluded from physiological alerts.',
      levels: [{ severity: 'info', threshold: 0.5, action: 'Adjust the band and clean the sensor. A low reading with poor contact is not treated as a medical alert.', health_check: { needed: false, urgency: null } }],
      recheck: 'Re-seat band; repeat reading.', escalation_route: 'Self',
    },
    {
      id: 'quality_disconnect', version: 1, category: 'data_quality', metric: 'worn', unit: 'h', type: 'missing_data',
      label: 'Wristband not reporting', window_h: 2, persistence_h: 0, clear_h: 0.5, cooldown_h: 2,
      quality: 'No samples received', threshold_kind: 'data-quality rule',
      source_policy: 'No data for 2 h (caution after 6 h). Missing data never displays as all clear.',
      levels: [
        { severity: 'advisory', threshold: 2, action: 'Check band fit and charge. Vital-sign alerts cannot run while no data arrive.', health_check: { needed: false, urgency: null } },
        { severity: 'caution', threshold: 6, action: 'Band still offline. Crew lead is notified onboard; use manual vital-sign checks per protocol.', health_check: { needed: false, urgency: null } },
      ],
      recheck: 'Confirm band reconnects.', escalation_route: 'Self → crew lead (onboard)',
    },
    {
      id: 'rad_rate_jump', version: 1, category: 'environmental', metric: 'dose_rate', unit: 'mSv/day', type: 'dose_rate_jump',
      label: 'Dose rate rose sharply', factor: 2, min_rate: 1.2, persistence_h: 0.5, clear_h: 6, cooldown_h: 24,
      quality: 'Connected personal dosimeter (simulated)', threshold_kind: 'demo threshold',
      source_policy: 'Demo: current rate ≥ 2× trailing-72 h mean and ≥ 1.2 mSv/day.',
      levels: [{ severity: 'advisory', threshold: 2, action: 'Follow the configured radiation-response protocol and confirm your dosimeter is worn. Crew lead is informed.', health_check: { needed: false, urgency: null } }],
      recheck: 'Dosimeter status check.', escalation_route: 'Crew lead (onboard) → ground radiation team (delayed)',
    },
    {
      id: 'rad_rolling_7d', version: 1, category: 'environmental', metric: 'dose_7d', unit: 'mSv', type: 'rolling_dose', window_days: 7,
      label: 'Rolling 7-day dose above planning level', persistence_h: 0.5, clear_h: 12, cooldown_h: 48,
      quality: 'Connected personal dosimeter (simulated)', threshold_kind: 'demo planning level (dose equivalent)',
      source_policy: 'Demo planning level: 10 mSv per rolling 7 days. Not a NASA limit.',
      levels: [{ severity: 'advisory', threshold: 10, action: 'Review exposure and shielding options with the crew lead.', health_check: { needed: false, urgency: null } }],
      recheck: 'Review dosimeter history.', escalation_route: 'Crew lead (onboard) → ground radiation team (delayed)',
    },
    {
      id: 'rad_projection', version: 1, category: 'environmental', metric: 'projected_mission_dose', unit: 'mSv', type: 'mission_projection', planning_level: 300,
      label: 'Projected mission dose approaching planning level', persistence_h: 0.5, clear_h: 24, cooldown_h: 72,
      quality: 'Cumulative dose + current rate × time to scheduled landing', threshold_kind: 'demo planning level (dose equivalent, not the NASA 600 mSv effective-dose career limit)',
      source_policy: 'Demo: projection ≥ 80% of a 300 mSv dose-equivalent planning level (caution ≥ 100%).',
      levels: [
        { severity: 'advisory', threshold: 0.8, action: 'Exposure plan review requested. No immediate action unless the protocol says otherwise.', health_check: { needed: false, urgency: null } },
        { severity: 'caution', threshold: 1.0, action: 'Projected dose exceeds the mission planning level. Contact the crew lead and follow the exposure-management protocol.', health_check: { needed: false, urgency: null } },
      ],
      recheck: 'Recompute projection after next dosimeter readout.', escalation_route: 'Crew lead → ground radiation team (delayed)',
    },
    {
      id: 'rad_acute', version: 1, category: 'environmental', metric: 'dose_rate', unit: 'mSv/day', type: 'dose_rate_absolute',
      label: 'Very high dose rate (possible solar particle event)', persistence_h: 0.25, clear_h: 2, cooldown_h: 12,
      quality: 'Connected personal dosimeter (simulated)', threshold_kind: 'demo threshold (configure per approved radiation-response protocol)',
      source_policy: 'Demo: dose rate ≥ 10 mSv/day.',
      levels: [{ severity: 'urgent', threshold: 10, action: 'Follow the approved onboard radiation-response protocol now. Move to the designated shelter if the protocol instructs it. Contact the crew lead.', health_check: { needed: true, urgency: 'after the event, per protocol' } }],
      recheck: 'Do not delay the protocol to repeat a reading.', escalation_route: 'Crew lead + crew medical officer (onboard, immediate) → ground (delayed)',
    },
    {
      id: 'lab_wbc_range', version: 1, category: 'lab', metric: 'wbc', unit: '10⁹/L', type: 'lab_range',
      label: 'Measured WBC outside lab reference range', threshold_kind: 'lab reference range',
      source_policy: 'Reference range 3.8–10.8 ×10⁹/L (range reported with the OSD-569 CBC; use the performing lab’s own range).',
      levels: [{ severity: 'caution', threshold: null, action: 'Crew medical officer review; protocol-specified repeat CBC.', health_check: { needed: true, urgency: 'same day' } }],
      recheck: 'Repeat CBC per protocol.', escalation_route: CMO,
    },
    {
      id: 'lab_wbc_change', version: 1, category: 'lab', metric: 'wbc', unit: '%', type: 'lab_change', threshold_pct: 40,
      label: 'Measured WBC changed from personal baseline', threshold_kind: 'clinically configured change (demo value)',
      source_policy: 'Demo: |change| ≥ 40% vs matched personal baseline (6 months before launch). Higher WBC does not mean better immunity.',
      levels: [{ severity: 'advisory', threshold: 40, action: 'Medical review at the next conference; note recent stressors and landing timing.', health_check: { needed: true, urgency: 'routine' } }],
      recheck: 'Repeat CBC at next scheduled draw.', escalation_route: CMO,
    },
    {
      id: 'research_terra_forecast', version: 1, category: 'research', metric: 'terra_pct', unit: '%', type: 'research_forecast', series: 'terra',
      label: 'Simulated TERRA projection above research review level', threshold_pct: 75, persistence_h: 6, clear_h: 24, cooldown_h: 168,
      threshold_kind: 'research review level (no validated clinical cutoff exists)',
      source_policy: 'Research review when the simulated projection exceeds +75% vs baseline. Not a medical alert; no treatment is recommended from forecasts.',
      levels: [{ severity: 'research', threshold: 75, action: 'Research review. A confirmatory sample may be requested at the next scheduled draw.', health_check: { needed: false, urgency: null } }],
      recheck: 'Confirmatory laboratory TERRA assay (Earth-side).', escalation_route: 'Research team (Earth) — not a crew medical route',
    },
    {
      id: 'research_wbc_forecast', version: 1, category: 'research', metric: 'wbc_pct', unit: '%', type: 'research_forecast', series: 'wbc',
      label: 'Simulated WBC projection change', threshold_pct: 25, persistence_h: 6, clear_h: 24, cooldown_h: 168,
      threshold_kind: 'research review level',
      source_policy: 'Research review when the simulated WBC projection differs from baseline by ≥25%. Forecast only.',
      levels: [{ severity: 'research', threshold: 25, action: 'Research review; confirm with a measured CBC if clinically indicated.', health_check: { needed: false, urgency: null } }],
      recheck: 'Measured CBC.', escalation_route: 'Research team (Earth)',
    },
    {
      id: 'schedule_sample_due', version: 1, category: 'schedule', metric: 'sample', unit: '', type: 'schedule_due', lead_h: 24,
      label: 'Scheduled sample due', threshold_kind: 'schedule',
      source_policy: 'Reminder 24 h before a protocol blood draw.',
      levels: [{ severity: 'info', threshold: null, action: 'Blood draw scheduled. Follow the sampling protocol.', health_check: { needed: false, urgency: null } }],
      recheck: '', escalation_route: 'Self',
    },
  ];
}

function prefix(S, key, filter) {
  const sum = new Float64Array(S.n + 1);
  const cnt = new Float64Array(S.n + 1);
  for (let i = 0; i < S.n; i++) {
    const v = S[key][i];
    const ok = S.worn[i] && isNum(v) && (!filter || filter(i));
    sum[i + 1] = sum[i] + (ok ? v : 0);
    cnt[i + 1] = cnt[i] + (ok ? 1 : 0);
  }
  return { sum, cnt };
}

function windowStat(p, i, nSamples) {
  const a = Math.max(0, i - nSamples + 1);
  const c = p.cnt[i + 1] - p.cnt[a];
  return { mean: c ? (p.sum[i + 1] - p.sum[a]) / c : null, n: c, coverage: c / (i - a + 1) };
}

export function evaluateRules(ctx) {
  const { schedule, segments, S, baseline, labs, terra, wbc, sc } = ctx;
  const rules = ctx.rules || defaultRules();
  const step = S.step;
  const start = Math.max(S.t0, schedule.baselineWindow[1]);
  const i0 = Math.ceil((start - S.t0) / step);
  const pre = {
    rest_hr: prefix(S, 'rest_hr'), hrv: prefix(S, 'hrv'), skin: prefix(S, 'skin'),
    spo2good: prefix(S, 'spo2', i => S.quality[i] === 'good'),
  };
  const wornP = new Float64Array(S.n + 1);
  const poorP = new Float64Array(S.n + 1);
  for (let i = 0; i < S.n; i++) { wornP[i + 1] = wornP[i] + (S.worn[i] ? 1 : 0); poorP[i + 1] = poorP[i] + (S.quality[i] === 'poor' ? 1 : 0); }
  const base = { rest_hr: baseline.rest_hr, hrv: baseline.hrv_all, skin: baseline.skin_all };
  const samplesIn = h => Math.max(1, Math.round(h * HOUR / step));

  function condition(rule, i, t) {
    const lv = rule.levels;
    const levelFor = (v, cmp) => { let L = -1; lv.forEach((l, k) => { if (cmp(v, l.threshold)) L = k; }); return L; };
    switch (rule.type) {
      case 'baseline_delta_mean': {
        const w = windowStat(pre[rule.metric], i, samplesIn(rule.window_h));
        if (w.coverage < rule.min_coverage || !isNum(w.mean)) return { level: -1, insufficient: true };
        const d = w.mean - base[rule.metric];
        return { level: levelFor(d, (v, th) => v >= th), value: w.mean, delta: d, baseline: base[rule.metric] };
      }
      case 'baseline_ratio_mean': {
        const w = windowStat(pre[rule.metric], i, samplesIn(rule.window_h));
        if (w.coverage < rule.min_coverage || !isNum(w.mean)) return { level: -1, insufficient: true };
        const r = w.mean / base[rule.metric];
        return { level: levelFor(r, (v, th) => v <= th), value: w.mean, ratio: r, baseline: base[rule.metric] };
      }
      case 'absolute_mean': {
        const w = windowStat(pre.spo2good, i, samplesIn(rule.window_h));
        if (w.coverage < rule.min_coverage || !isNum(w.mean)) return { level: -1, insufficient: true };
        return { level: levelFor(w.mean, (v, th) => v < th), value: w.mean };
      }
      case 'quality_poor': {
        const n = samplesIn(rule.window_h);
        const a = Math.max(0, i - n + 1);
        const frac = (poorP[i + 1] - poorP[a]) / (i - a + 1);
        return { level: levelFor(frac, (v, th) => v >= th), value: frac };
      }
      case 'missing_data': {
        let k = i;
        while (k >= 0 && !S.worn[k]) k--;
        const hours = (i - k) * step / HOUR;
        return { level: levelFor(hours, (v, th) => v >= th), value: hours };
      }
      case 'dose_rate_jump': {
        const r = rateAt(segments, t);
        const mean72 = (doseAt(segments, t) - doseAt(segments, t - 3 * DAY)) / 3;
        const met = r >= rule.min_rate && r >= rule.factor * mean72;
        return { level: met ? 0 : -1, value: r, baseline: mean72 };
      }
      case 'rolling_dose': {
        const d = doseAt(segments, t) - doseAt(segments, t - rule.window_days * DAY);
        return { level: levelFor(d, (v, th) => v >= th), value: d };
      }
      case 'mission_projection': {
        if (t >= schedule.landing || t < schedule.launch) return { level: -1 };
        const proj = doseAt(segments, t) + rateAt(segments, t) * (schedule.landing - t) / DAY;
        return { level: levelFor(proj / rule.planning_level, (v, th) => v >= th), value: proj, threshold: rule.planning_level };
      }
      case 'dose_rate_absolute': {
        const r = rateAt(segments, t);
        return { level: levelFor(r, (v, th) => v >= th), value: r };
      }
      case 'research_forecast': {
        if (rule.series === 'terra') {
          const f = sampleGrid(terra.fold, t);
          return { level: levelFor(100 * (f - 1), (v, th) => v >= th), value: 100 * (f - 1) };
        }
        const w = sampleGrid(wbc.total, t);
        const pct = 100 * (w / sc.wbc.baseline - 1);
        return { level: levelFor(Math.abs(pct), (v, th) => v >= th), value: pct };
      }
      default: return { level: -1 };
    }
  }

  const episodes = [];
  const notifications = [];
  const continuous = rules.filter(r => !['lab_range', 'lab_change', 'schedule_due'].includes(r.type) && r.enabled !== false);
  for (const rule of continuous) {
    let open = null;
    let since = null;
    let escSince = null;
    let clearSince = null;
    let lastClose = -Infinity;
    let lastMax = -1;
    const stride = rule.type === 'research_forecast' ? 8 : 1;
    for (let i = i0; i < S.n; i += stride) {
      const t = S.t0 + i * step;
      const c = condition(rule, i, t);
      if (open) {
        if (c.level > open.level) {
          escSince ??= t;
          if (t - escSince >= (rule.persistence_h || 0) * HOUR) {
            open.level = c.level;
            open.severity_history.push({ t, severity: rule.levels[c.level].severity, value: c.value });
            notifications.push(makeNote(rule, open, t, c, 'escalate'));
            escSince = null;
          }
        } else escSince = null;
        if (c.level < 0) {
          clearSince ??= t;
          if (t - clearSince >= (rule.clear_h || 0) * HOUR) { open.end = t; lastClose = t; lastMax = open.level; open = null; clearSince = null; }
        } else {
          clearSince = null;
          if (isNum(c.value) && (open.peak === null || Math.abs(c.value) > Math.abs(open.peak))) open.peak = c.value;
        }
        continue;
      }
      if (c.level >= 0) {
        since ??= t;
        const persisted = t - since >= (rule.persistence_h || 0) * HOUR;
        const cooled = t - lastClose >= (rule.cooldown_h || 0) * HOUR || c.level > lastMax;
        if (persisted && cooled) {
          open = { episode_id: `${rule.id}@${Math.round(t / MINUTE)}`, rule_id: rule.id, category: rule.category, start: t, end: null, level: c.level, peak: c.value ?? null,
            severity_history: [{ t, severity: rule.levels[c.level].severity, value: c.value }] };
          episodes.push(open);
          notifications.push(makeNote(rule, open, t, c, 'open'));
          since = null;
        }
      } else since = null;
    }
  }

  // Lab rules fire when a (simulated) measured result becomes available.
  const wbcLabs = labs.filter(l => l.kind === 'wbc').sort((a, b) => a.available - b.available);
  for (const rule of rules.filter(r => (r.type === 'lab_range' || r.type === 'lab_change') && r.enabled !== false)) {
    let open = null;
    for (const lab of wbcLabs) {
      const [lo, hi] = sc.wbc.lab_range;
      const met = rule.type === 'lab_range' ? lab.value < lo || lab.value > hi
        : isNum(lab.pct_from_baseline) && Math.abs(lab.pct_from_baseline) >= rule.threshold_pct && lab.label !== 'L-180';
      if (open && !met) { open.end = lab.available; open = null; }
      if (!open && met) {
        open = { episode_id: `${rule.id}@${lab.label}`, rule_id: rule.id, category: 'lab', start: lab.available, end: null, level: 0, peak: lab.value,
          severity_history: [{ t: lab.available, severity: rule.levels[0].severity, value: lab.value }], lab_label: lab.label, sample_t: lab.t };
        episodes.push(open);
        notifications.push(makeNote(rule, open, lab.available, { value: rule.type === 'lab_change' ? lab.pct_from_baseline : lab.value, baseline: lab.baseline, lab }, 'open'));
      }
    }
  }
  const due = rules.find(r => r.type === 'schedule_due' && r.enabled !== false);
  if (due) {
    for (const s of schedule.samples) {
      const t = s.t - due.lead_h * HOUR;
      const ep = { episode_id: `${due.id}@${s.label}`, rule_id: due.id, category: 'schedule', start: t, end: s.t, level: 0, peak: null,
        severity_history: [{ t, severity: 'info', value: null }], sample_label: s.label };
      episodes.push(ep);
      notifications.push(makeNote(due, ep, t, { value: null, sample: s }, 'open'));
    }
  }
  episodes.sort((a, b) => a.start - b.start);
  notifications.sort((a, b) => a.t - b.t);
  return { episodes, notifications, rules, version: RULESET_VERSION };

  function makeNote(rule, ep, t, c, kind) {
    const level = rule.levels[ep.level];
    return {
      id: `${ep.episode_id}#${ep.severity_history.length}`, episode_id: ep.episode_id, rule_id: rule.id, rule_label: rule.label,
      category: rule.category, kind, t, severity: level.severity, action: level.action, health_check: level.health_check,
      value: isNum(c.value) ? round(c.value, 2) : null, unit: rule.unit, baseline: isNum(c.baseline) ? round(c.baseline, 2) : null,
      threshold: level.threshold, threshold_kind: rule.threshold_kind, source_policy: rule.source_policy,
      origin: rule.category === 'research' ? 'predicted (simulated projection)' : rule.category === 'lab' ? 'measured (simulated lab result)' : rule.category === 'schedule' ? 'schedule' : 'simulated device reading',
      mission_label: missionLabel(schedule, t), escalation_route: rule.escalation_route, recheck: rule.recheck,
      lab_label: c.lab?.label ?? null, sample_label: c.sample?.label ?? null,
    };
  }
}

// Episode status at time t (acknowledgment never resolves the underlying event).
export function episodeStatus(ep, t, actions = []) {
  if (ep.start > t) return null;
  const hist = ep.severity_history.filter(h => h.t <= t);
  const current = hist[hist.length - 1];
  const acts = actions.filter(a => a.episode_id === ep.episode_id && a.t <= t);
  const ack = acts.find(a => a.action === 'ack');
  const conditionActive = ep.end === null || ep.end > t;
  const followup = acts.find(a => a.action === 'followup');
  const resolved = acts.find(a => a.action === 'resolve');
  return {
    severity: current.severity, active: conditionActive, acknowledged: !!ack, ack_t: ack?.t ?? null,
    followup_started: !!followup, resolved_by_review: !!resolved,
    status: resolved ? 'resolved' : conditionActive ? (ack ? 'acknowledged — condition ongoing' : 'unacknowledged') : (ack || followup ? 'condition cleared — follow-up open' : 'condition cleared — not yet acknowledged'),
  };
}

const RANK = { info: 0, research: 0, advisory: 1, caution: 2, urgent: 3 };
export const severityRank = s => RANK[s] ?? 0;

// Highest-priority item for the watch home screen. Recovery score is deliberately not an input.
export function topPriority(episodes, t, actions, { dataMissing }) {
  const live = episodes
    .filter(e => e.category !== 'research')
    .map(e => ({ e, s: episodeStatus(e, t, actions) }))
    .filter(x => x.s && (x.s.active || !x.s.acknowledged) && !x.s.resolved_by_review && !(x.e.category === 'schedule' && !x.s.active));
  live.sort((a, b) => severityRank(b.s.severity) - severityRank(a.s.severity) || (a.s.acknowledged - b.s.acknowledged) || b.e.start - a.e.start);
  if (live.length) return { kind: 'alert', ...live[0] };
  if (dataMissing) return { kind: 'insufficient_data' };
  return { kind: 'none' };
}
