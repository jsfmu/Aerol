// Dashboard · synchronized simulation timeline (TERRA, WBC, dose rate, cumulative dose, events).
import { DAY, HOUR, isNum, fmt, signed, sampleGrid, iso } from '../core/util.js';
import { missionLabel, phaseAt, regionAt, PHASE_LABEL, REGION_LABEL } from '../core/schedule.js';
import { doseAt, rateAt, rateSteps } from '../core/radiation.js';
import { lagInspector, explainEvent } from '../core/events.js';
import { SEVERITY_LABEL } from '../core/rules.js';
import { ChartGroup, TimeChart } from './charts.js';
import { $, esc, toast, download, debounce } from './dom.js';

const SLIDERS = [
  ['stress.amplitude', 'Pre-mission stress amplitude (fold, hypothesis)', 0, 1, 0.05],
  ['stress.onset_days_before_launch', 'Stress onset before launch (days)', 5, 90, 1],
  ['dose.inside', 'Inside-magnetosphere rate (mSv/day, 0.4–1.0 reference)', 0.4, 1.0, 0.05],
  ['dose.beyond', 'Beyond-magnetosphere rate (mSv/day)', 0.5, 3, 0.01],
  ['exit_day', 'Departure: magnetosphere exit (flight day)', 1, 120, 1],
  ['reentry_day', 'Return: magnetosphere re-entry (flight day)', 2, 179, 1],
  ['terra.lag_days', 'TERRA biological lag (days)', 0, 30, 1],
  ['terra.sensitivity', 'TERRA sensitivity (fold per mSv/day)', 0, 2, 0.05],
  ['terra.rise_days', 'TERRA rise timescale (days)', 5, 120, 1],
  ['terra.recovery_days', 'TERRA recovery timescale (days)', 5, 180, 1],
  ['terra.landing_amplitude', 'TERRA landing contribution (optional)', 0, 0.5, 0.05],
  ['wbc.landing_amplitude', 'WBC landing surge (fraction)', 0, 1, 0.05],
  ['wbc.radiation_per_mSv_day', 'WBC radiation coefficient (sign uncertain)', -0.2, 0.2, 0.01],
];

const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
const mapGrid = (g, f) => ({ t0: g.t0, dt: g.dt, values: g.values.map(f) });

export function mountTimeline(host, store, ctx) {
  const ui = { pct: true, band: true, obs: true, proj: true, diff: false, compare: store.state.compareOn, explain: null, selection: null };
  host.innerHTML = `<div class="tl-grid"><div>
      <div class="toolbar" id="tl-tools"></div>
      <div class="legend" style="margin:8px 0">
        <span><span class="sw c-terra"></span>projection (dashed)</span><span><span class="shape diamond"></span>simulated lab sample</span>
        <span>samples appear only once their result is available (draws are marked in the Samples row)</span><span><span class="sw c-terra-b"></span>comparison scenario</span><span>shaded: scenario sensitivity range</span>
      </div>
      <div class="charts"><div id="c-terra"></div><div id="c-wbc"></div><div id="c-rate"></div><div id="c-dose"></div><div id="c-strip"></div></div>
      <p class="sub" style="margin-top:6px"><b>For astronauts:</b> dashed lines are simulated projections for a synthetic astronaut, not measurements of you. Diamonds are lab results, shown once the lab has reported them. 0% on TERRA means the same as baseline. Alerts always reach your watch first.</p>
      <p class="sub" style="margin-top:6px">Drag to pan · Shift-drag or “Select” to choose an interval · Ctrl/⌘-scroll to zoom · click a chart to move the mission clock · click a marker for its explanation.</p>
    </div><aside class="side" id="tl-side"></aside></div>`;

  const m0 = store.model;
  const group = new ChartGroup({
    domain: [m0.schedule.start, m0.schedule.end],
    formatTime: t => missionLabel(store.model.schedule, t).replace(/ \(\d+ h\)$/, ''),
    onCursor: t => { store.play(false); store.setTime(t); },
    onMarker: id => { ui.explain = id; renderSide(); },
    onSelect: sel => { ui.selection = sel; renderSide(); },
  });
  group.tickAnchor = m0.schedule.launch;
  group.phaseTicks = () => store.model.schedule.phases.map(p => ({ ...p, label: p.phase === 'landing' ? 'Landing day' : PHASE_LABEL[p.phase] }));
  group.tipContext = t => {
    const S = store.model.schedule;
    return `<div class="tipmeta">${esc(missionLabel(S, t, true))} · ${esc(iso(t).slice(0, 16))}Z<br>${esc(PHASE_LABEL[phaseAt(S, t)])} · ${esc(REGION_LABEL[regionAt(S, t)])}<br>Origin: simulation (hand-set simulator)</div>`;
  };
  const charts = {
    terra: group.add(new TimeChart($('#c-terra', host), { height: 170, title: 'TERRA · telomere RNA (lab blood test, research marker)', unit: '% change from your own baseline', note: '0% = 1.0× baseline, not zero molecules' })),
    wbc: group.add(new TimeChart($('#c-wbc', host), { height: 150, title: 'White blood cells · immune cells (lab blood test)', unit: '×10⁹/L', note: 'shaded band = normal lab range' })),
    rate: group.add(new TimeChart($('#c-rate', host), { height: 110, title: 'Radiation dose rate r(t) · how fast exposure is adding up', unit: 'mSv/day (dose-equivalent reference)', zeroBased: true, yFormat: v => fmt(v, 2) })),
    dose: group.add(new TimeChart($('#c-dose', host), { height: 120, title: 'Mission dose total D(t) · running exposure', unit: 'mSv · plateaus after landing, never falls', zeroBased: true, yFormat: v => fmt(v, 0) })),
    strip: group.add(new TimeChart($('#c-strip', host), { height: 132, title: 'Mission phase · where the spacecraft is · events', unit: '', kind: 'strip' })),
  };

  function terraLayers(m, cmp) {
    const toY = ui.pct ? f => 100 * (f - 1) : f => f;
    charts.terra.unit = ui.pct ? '% change from matched personal baseline' : 'fold change (1.0× = baseline)';
    charts.terra.yFormat = ui.pct ? v => signed(v, 0, '%') : v => fmt(v, 2) + '×';
    const t = store.t;
    const pts = m.labs.filter(l => l.kind === 'terra' && l.available <= t).map(l => ({
      t: l.t, v: l.available <= t ? toY(l.fold) : toY(l.projected), shape: 'diamond', filled: l.available <= t, cls: l.available <= t ? '' : 'pending',
      tip: `<b>Simulated lab sample ${esc(l.label)}</b><br>${l.available <= t ? `TERRA ${fmt(l.fold, 2)}× (${signed(l.pct, 0, '%')}) vs L-180` : `Result pending until ${esc(missionLabel(m.schedule, l.available, true))} (plotted at projection)`}<br>${esc(PHASE_LABEL[l.phase])} · ${esc(REGION_LABEL[l.region])}<div class="tipmeta">Origin: simulation · raw ${l.raw.toExponential(3)} normalized abundance (synthetic) · ${l.inFlight ? 'in-flight sample assayed on Earth after return' : 'ground sample'}</div>`,
    }));
    return [
      { type: 'band', lo: mapGrid(m.terraEnv.lo, toY), hi: mapGrid(m.terraEnv.hi, toY), cls: 'c-terra', label: m.terraEnv.label, tipLabel: 'Sensitivity range', hidden: !ui.band },
      { type: 'hline', v: toY(1), label: ui.pct ? 'baseline 0%' : 'baseline 1.0×' },
      { type: 'line', grid: mapGrid(m.terra.fold, toY), cls: 'c-terra c-proj', tipLabel: 'Projection', hidden: !ui.proj },
      cmp && { type: 'line', grid: mapGrid(cmp.terra.fold, toY), cls: 'c-terra-b', tipLabel: 'Comparison' },
      { type: 'points', points: pts, cls: 'c-terra', hidden: !ui.obs },
    ].filter(Boolean);
  }

  function wbcLayers(m, cmp) {
    const t = store.t;
    const [lo, hi] = m.scenario.wbc.lab_range;
    const pts = m.labs.filter(l => l.kind === 'wbc' && l.available <= t).map(l => ({
      t: l.t, v: l.available <= t ? l.value : l.projected, shape: 'diamond', filled: l.available <= t, cls: l.available <= t ? '' : 'pending',
      tip: `<b>Simulated lab sample ${esc(l.label)}</b><br>${l.available <= t ? `WBC ${fmt(l.value, 2)} ×10⁹/L (${signed(l.pct_from_baseline, 0, '%')} vs L-180)<br>Neutrophils ${fmt(l.diff.neutrophils, 2)} · Lymphocytes ${fmt(l.diff.lymphocytes, 2)}` : `Result pending until ${esc(missionLabel(m.schedule, l.available, true))}`}<div class="tipmeta">Origin: simulation · ${esc(l.method)} · lab range ${lo}–${hi}</div>`,
    }));
    return [
      { type: 'hband', lo, hi, label: `Lab reference range ${lo}–${hi} ×10⁹/L (OSD-569 lab)` },
      { type: 'band', lo: m.wbcEnv.lo, hi: m.wbcEnv.hi, cls: 'c-wbc', label: m.wbcEnv.label, tipLabel: 'Sensitivity range', hidden: !ui.band },
      { type: 'hline', v: m.scenario.wbc.baseline, label: 'personal baseline' },
      { type: 'line', grid: m.wbc.total, cls: 'c-wbc c-proj', tipLabel: 'Total WBC projection', hidden: !ui.proj },
      { type: 'line', grid: m.wbc.differential.neutrophils, cls: 'c-neut c-proj', tipLabel: 'Neutrophils', hidden: !ui.diff },
      { type: 'line', grid: m.wbc.differential.lymphocytes, cls: 'c-lymph c-proj', tipLabel: 'Lymphocytes', hidden: !ui.diff },
      cmp && { type: 'line', grid: cmp.wbc.total, cls: 'c-wbc-b', tipLabel: 'Comparison' },
      { type: 'points', points: pts, cls: 'c-wbc', hidden: !ui.obs },
    ].filter(Boolean);
  }

  const segs = m => m.segments.map(s => ({ start: s.start, end: s.end, v: s.rate }));
  function doseGrid(m) {
    const { start, end } = m.schedule;
    const dt = 6 * HOUR;
    const values = [];
    for (let t = start; t <= end; t += dt) values.push(doseAt(m.segments, t));
    return { t0: start, dt, values };
  }

  function stripLayers(m) {
    const S = m.schedule;
    const rows = { phase: [12, 34], region: [36, 58], traj: [62, 80], samples: [82, 98], alerts: [100, 118] };
    charts.strip.rowLabels = [{ label: 'Phase', y0: 12, y1: 34 }, { label: 'Region', y0: 36, y1: 58 }, { label: 'Trajectory', y0: 62, y1: 80 }, { label: 'Samples', y0: 82, y1: 98 }, { label: 'Alerts', y0: 100, y1: 118 }];
    const rc = S.regionChanges;
    const regionSpans = rc.map((c, i) => ({ start: Math.max(S.start, c.t), end: i + 1 < rc.length ? rc[i + 1].t : S.end, cls: 'seg-' + c.region, label: REGION_LABEL[c.region], short: REGION_LABEL[c.region] }));
    const ev = m.events;
    const traj = ev.filter(e => ['launch', 'magnetosphere_exit', 'magnetosphere_reentry', 'belt_transit', 'landing', 'spe', 'preflight_stress', 'baseline_window', 'comm_outage'].includes(e.event_type));
    return [
      { type: 'spans', row: rows.phase, labels: true, spans: S.phases.map(p => ({ start: p.start, end: p.end, cls: 'seg-' + p.phase, label: PHASE_LABEL[p.phase] })) },
      { type: 'spans', row: rows.region, labels: true, spans: regionSpans },
      { type: 'markers', row: rows.traj, ranges: true, markers: traj.map(e => ({ id: e.id, t: e.t, t_end: e.t_end, label: `${e.label} · ${e.mission_label}`, cls: e.event_type === 'comm_outage' ? 'outage' : '', glyph: { launch: '▲', landing: '▼', magnetosphere_exit: '◇', magnetosphere_reentry: '◆', spe: '☀' }[e.event_type] })) },
      { type: 'markers', row: rows.samples, markers: ev.filter(e => e.event_type === 'sample').map(e => ({ id: e.id, t: e.t, label: `${e.label} · ${e.note}`, glyph: '•' })) },
      { type: 'markers', row: rows.alerts, markers: m.alerts.episodes.filter(e => e.category !== 'schedule').map(e => {
        const sev = e.severity_history[e.severity_history.length - 1].severity;
        return { id: 'ep:' + e.episode_id, t: e.start, label: `${e.rule_id} · ${SEVERITY_LABEL[sev]} · ${missionLabel(S, e.start, true)}`, cls: 'sev-' + sev };
      }) },
      { type: 'markers', row: [0, 118], markers: ev.filter(e => e.event_type === 'peak').map(e => ({ id: e.id, t: e.t, label: e.label })), hidden: false },
    ];
  }

  function renderCharts() {
    const m = store.model;
    const cmp = ui.compare ? store.compareModel : null;
    if (group.domain[0] !== m.schedule.start || group.domain[1] !== m.schedule.end) { group.tickAnchor = m.schedule.launch; group.setDomain([m.schedule.start, m.schedule.end]); }
    charts.terra.layers = terraLayers(m, cmp);
    charts.wbc.layers = wbcLayers(m, cmp);
    charts.rate.layers = [
      { type: 'step', segments: segs(m), cls: 'c-rate', tipLabel: 'Dose rate', tipFormat: v => fmt(v, 2) },
      cmp && { type: 'step', segments: segs(cmp), cls: 'c-rate-b', tipLabel: 'Comparison', tipFormat: v => fmt(v, 2) },
    ].filter(Boolean);
    const planning = m.rules.find(r => r.id === 'rad_projection')?.planning_level;
    charts.dose.layers = [
      { type: 'line', grid: doseGrid(m), cls: 'c-dose', tipLabel: 'Cumulative', tipFormat: v => fmt(v, 1) },
      cmp && { type: 'line', grid: doseGrid(cmp), cls: 'c-dose-b', tipLabel: 'Comparison', tipFormat: v => fmt(v, 1) },
      planning && { type: 'hline', v: planning, label: `demo planning level ${planning} mSv dose equivalent — not the NASA 600 mSv effective-dose limit` },
    ].filter(Boolean);
    charts.strip.layers = stripLayers(m);
    group.cursor = store.t;
    group.renderAll();
  }

  function renderTools() {
    const tg = (k, label) => `<button class="btn small ${ui[k] ? 'on' : ''}" data-tg="${k}" aria-pressed="${ui[k]}">${label}</button>`;
    $('#tl-tools', host).innerHTML = `${tg('obs', 'Lab results (simulated)')}${tg('proj', 'Projections (model)')}${tg('band', 'What-if range')}${tg('diff', 'WBC cell types')}
      <button class="btn small" data-act="units">${ui.pct ? '% change' : 'fold ×'}</button><span class="sep"></span>
      <label class="sub">Compare <select id="tl-cmp" class="btn small">${[['', 'none'], ['leo-only', 'Stays inside magnetosphere'], ['deep-whole', 'Beyond magnetosphere whole flight'], ['spe-event', 'Default + solar particle event'], ['hypothesis-default', 'Default preset']].map(([v, l]) => `<option value="${v}" ${(ui.compare ? store.state.compareId : '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <span class="sep"></span><button class="btn small" data-act="zin" aria-label="Zoom in">＋</button><button class="btn small" data-act="zout" aria-label="Zoom out">－</button>
      <button class="btn small ${group.selectMode ? 'on' : ''}" data-act="select">Select</button><button class="btn small" data-act="reset">Reset view</button>
      <button class="btn small" data-act="focus-now">±30 d around clock</button>`;
  }

  host.addEventListener('click', e => {
    const tg = e.target.closest('[data-tg]');
    if (tg) { ui[tg.dataset.tg] = !ui[tg.dataset.tg]; renderTools(); renderCharts(); return; }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act;
    if (act === 'units') { ui.pct = !ui.pct; renderTools(); renderCharts(); }
    if (act === 'zin') group.zoom(0.6, store.t);
    if (act === 'zout') group.zoom(1.6, store.t);
    if (act === 'reset') group.reset();
    if (act === 'select') { group.selectMode = !group.selectMode; renderTools(); }
    if (act === 'focus-now') group.focus(store.t - 30 * DAY, store.t + 30 * DAY);
    if (act === 'export-sel') exportSelection();
    if (act === 'report-sel') exportReport();
    if (act === 'clear-explain') { ui.explain = null; renderSide(); }
    if (act === 'apply-spe') { const sc = JSON.parse(JSON.stringify(store.state.scenario)); sc.spe.enabled = !sc.spe.enabled; applyScenario(sc); }
  });
  host.addEventListener('change', e => {
    if (e.target.id === 'tl-cmp') { const v = e.target.value; ui.compare = !!v; store.setCompare(!!v, v || store.state.compareId); renderCharts(); }
  });

  // ---- side panel ----
  const applyScenario = sc => {
    const errs = store.setScenario(sc, { scenarioId: 'custom' });
    const box = $('#tl-errors', host);
    if (box) { box.hidden = !errs.length; box.textContent = errs.join(' '); }
  };
  const applyDebounced = debounce(applyScenario, 220);

  function explainHtml(id) {
    const m = store.model;
    if (id.startsWith('ep:')) {
      const ep = m.alerts.episodes.find(e => e.episode_id === id.slice(3));
      if (!ep) return '';
      const rule = m.rules.find(r => r.id === ep.rule_id);
      const notes = m.alerts.notifications.filter(n => n.episode_id === ep.episode_id);
      return section(`${rule.label}`, {
        what: `${SEVERITY_LABEL[ep.severity_history[0].severity]} alert opened ${missionLabel(m.schedule, ep.start, true)}${ep.end ? `, condition cleared ${missionLabel(m.schedule, ep.end, true)}` : ', ongoing'}. Severity history: ${ep.severity_history.map(h => `${h.severity} @ ${missionLabel(m.schedule, h.t, true)}`).join(' → ')}.`,
        term: `${rule.threshold_kind}. ${rule.source_policy}`,
        values: notes.map(n => `${n.mission_label}: ${isNum(n.value) ? fmt(n.value, 2) + ' ' + n.unit : '—'}${isNum(n.baseline) ? ' (baseline ' + fmt(n.baseline, 2) + ')' : ''} · ${n.origin}`),
        contributors: rule.category === 'physiological' ? ['Illness or infection', 'Sleep loss / workload', 'Sensor fit', 'Landing readaptation'] : rule.category === 'environmental' ? ['Trajectory (explicit region setting)', 'Solar activity', 'Shielding'] : ['See rule definition'],
        evidence: rule.category === 'research' ? 'Simulated projection only — no validated clinical cutoff exists.' : 'Simulated device reading / simulated lab result in this prototype.',
        uncertainty: 'Demo thresholds; not validated clinical rules. Acknowledgment does not resolve the event.',
        action: rule.levels.map(l => `${l.severity}: ${l.action}`).join(' '), status: 'simulated',
      });
    }
    const ev = m.events.find(e => e.id === id);
    if (!ev) return '';
    const x = explainEvent(m, ev);
    return section(`${ev.label} · ${ev.mission_label}`, x);
  }

  function section(title, x) {
    const li = a => (a && a.length ? `<ul>${a.map(v => `<li>${esc(v)}</li>`).join('')}</ul>` : '—');
    return `<section class="panel explain"><div class="row" style="justify-content:space-between"><h2>${esc(title)}</h2><button class="btn small" data-act="clear-explain">Close</button></div>
      <span class="chip ${x.status === 'hypothesis' ? 'hyp' : x.status === 'supported' ? 'obs' : 'sim'}">evidence: ${esc(x.status)}</span>
      <dl><dt>What happened?</dt><dd>${esc(x.what)}</dd><dt>What does this term mean?</dt><dd>${esc(x.term)}</dd>
      <dt>Which values changed?</dt><dd>${li(x.values)}</dd><dt>What could contribute?</dt><dd>${li(x.contributors)}</dd>
      <dt>What evidence supports it?</dt><dd>${esc(x.evidence)}</dd><dt>What is uncertain?</dt><dd>${esc(x.uncertainty)}</dd>
      <dt>Is any action indicated?</dt><dd>${esc(x.action)}</dd></dl></section>`;
  }

  function selectionStats(sel) {
    const m = store.model;
    const [a, b] = sel;
    let tSum = 0, tMax = -Infinity, wSum = 0, n = 0;
    for (let t = a; t <= b; t += 6 * HOUR) { const f = sampleGrid(m.terra.fold, t); tSum += f; tMax = Math.max(tMax, f); wSum += sampleGrid(m.wbc.total, t); n++; }
    const dose = doseAt(m.segments, b) - doseAt(m.segments, a);
    const eps = m.alerts.episodes.filter(e => e.start >= a && e.start <= b && e.category !== 'schedule');
    return { a, b, days: (b - a) / DAY, dose, meanRate: dose / ((b - a) / DAY), terraMean: tSum / n, terraMax: tMax, wbcMean: wSum / n, alerts: eps.length,
      samples: m.labs.filter(l => l.t >= a && l.t <= b).map(l => `${l.kind.toUpperCase()} ${l.label}`) };
  }

  function renderSide() {
    const m = store.model;
    const sc = store.state.scenario;
    const parts = [];
    if (ui.explain) parts.push(explainHtml(ui.explain));
    if (ui.selection) {
      const s = selectionStats(ui.selection);
      parts.push(`<section class="panel"><h2>Selected interval</h2><p class="sub">${esc(missionLabel(m.schedule, s.a, true))} → ${esc(missionLabel(m.schedule, s.b, true))} (${fmt(s.days, 1)} days)</p>
        <dl class="kv" style="margin-top:8px"><dt>Dose in interval</dt><dd>${fmt(s.dose, 2)} mSv (mean ${fmt(s.meanRate, 2)} mSv/day)</dd><dt>TERRA projection</dt><dd>mean ${signed(100 * (s.terraMean - 1), 0, '%')}, max ${signed(100 * (s.terraMax - 1), 0, '%')}</dd>
        <dt>WBC projection</dt><dd>mean ${fmt(s.wbcMean, 2)} ×10⁹/L</dd><dt>Alert episodes</dt><dd>${s.alerts}</dd><dt>Samples</dt><dd>${esc(s.samples.join(', ') || 'none')}</dd></dl>
        <div class="row" style="margin-top:8px"><button class="btn small" data-act="export-sel">Export CSV + JSON</button><button class="btn small" data-act="report-sel">Annotated report</button></div></section>`);
    }
    if (ctx.audience === 'crew') {
      parts.push(`<section class="panel"><h2>How to read these charts</h2><p class="sub">Dashed lines are <b>simulated projections</b> for the synthetic astronaut, not measurements. Diamonds are lab results, shown once the lab has reported them. TERRA at 0% means the same as your baseline. The shaded band shows how the projection changes when assumptions change. It is not a forecast of your health. Click any marker in the bottom strip for a plain-language explanation.</p></section>`);
      $('#tl-side', host).innerHTML = parts.join('');
      return;
    }
    const steps = rateSteps(m.segments).filter(s => s.t >= m.schedule.launch && s.t < m.schedule.landing);
    parts.push(`<section class="panel"><h2>Lag inspector · how long the body takes to respond</h2><p class="sub">Time from each exposure step to the simulated TERRA response (vs a no-step counterfactual). Timestamps are never shifted.</p>
      <table><thead><tr><th>Step</th><th>Rate</th><th>Onset</th><th>50%</th></tr></thead><tbody>${steps.map(st => {
        const L = lagInspector(m, st.t);
        return L ? `<tr><td>${esc(missionLabel(m.schedule, st.t, true))}<br><span class="sub">${esc(st.region_label)}</span></td><td>${fmt(st.from, 2)}→${fmt(st.to, 2)}</td><td>${fmt(L.onset_days, 1)} d</td><td>${L.half_response_days === null ? 'not reached' : fmt(L.half_response_days, 1) + ' d'}</td></tr>` : '';
      }).join('')}</tbody></table><p class="sub">Assumed lag ${sc.terra.lag_days} d; rise τ ${sc.terra.rise_days} d; recovery τ ${sc.terra.recovery_days} d.</p></section>`);
    parts.push(`<section class="panel"><h2>Model assumptions (what-if settings)</h2><p class="sub">Hypothesis-driven simulator — adjust and see consequences. Exposure duration: ${isNum(sc.exit_day) ? fmt(sc.reentry_day - sc.exit_day, 0) + ' days beyond the magnetosphere' : 'no exit in this scenario'}.</p>
      ${SLIDERS.map(([path, label, min, max, step]) => {
        const v = getPath(sc, path);
        if (!isNum(v)) return `<div class="slider"><span>${esc(label)}</span><output>n/a</output></div>`;
        return `<label class="slider"><span>${esc(label)}</span><output>${fmt(v, step < 1 ? 2 : 0)}</output><input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-path="${path}"></label>`;
      }).join('')}
      <div class="row"><button class="btn small" data-act="apply-spe">${sc.spe.enabled ? 'Remove' : 'Add'} assumed solar particle event (FD${sc.spe.day}, ${sc.spe.dose_mSv} mSv/${sc.spe.duration_h} h)</button></div>
      <div id="tl-errors" class="notice err" hidden></div></section>`);
    $('#tl-side', host).innerHTML = parts.join('');
  }

  host.addEventListener('input', e => {
    const p = e.target.dataset.path;
    if (!p) return;
    const sc = JSON.parse(JSON.stringify(store.state.scenario));
    setPath(sc, p, Number(e.target.value));
    e.target.previousElementSibling.textContent = fmt(Number(e.target.value), Number(e.target.step) < 1 ? 2 : 0);
    applyDebounced(sc);
  });

  function exportSelection() {
    const m = store.model;
    const [a, b] = ui.selection;
    const rows = ['timestamp_utc,mission_label,phase,region,dose_rate_mSv_day,cumulative_dose_mSv,terra_fold_projection,terra_pct_projection,wbc_projection_1e9_L,value_origin'];
    for (let t = a; t <= b; t += 6 * HOUR) {
      const f = sampleGrid(m.terra.fold, t);
      rows.push([iso(t), missionLabel(m.schedule, t, true), phaseAt(m.schedule, t), regionAt(m.schedule, t), rateAt(m.segments, t), doseAt(m.segments, t).toFixed(4), f.toFixed(4), (100 * (f - 1)).toFixed(2), sampleGrid(m.wbc.total, t).toFixed(3), 'simulation'].join(','));
    }
    download(`aerol-selection-${iso(a).slice(0, 10)}.csv`, rows.join('\n'), 'text/csv');
    const records = ctx.simulationRecords().filter(r => { const ts = Date.parse(r.timestamp_utc || r.start_time || ''); return ts >= a && ts <= b; });
    download(`aerol-selection-${iso(a).slice(0, 10)}.json`, JSON.stringify({ scenario: m.scenario, interval: [iso(a), iso(b)], records }, null, 1));
    toast('Exported selection (CSV + schema records).');
  }

  function exportReport() {
    const m = store.model;
    const s = selectionStats(ui.selection);
    const evs = m.events.filter(e => e.t >= s.a && e.t <= s.b);
    const md = [`# AEROL annotated interval report`, '', `Scenario: ${m.scenario.name} — ${m.scenario.description}`, `Interval: ${missionLabel(m.schedule, s.a, true)} → ${missionLabel(m.schedule, s.b, true)} (${iso(s.a)} → ${iso(s.b)})`, '',
      '> All values are simulated projections or simulated samples from a hand-set, unvalidated simulator. Not measured biology.', '',
      `- Dose in interval: ${fmt(s.dose, 2)} mSv (dose-equivalent scenario ledger; not NASA effective dose)`, `- TERRA projection: mean ${signed(100 * (s.terraMean - 1), 0, '%')}, max ${signed(100 * (s.terraMax - 1), 0, '%')} vs baseline`, `- WBC projection mean: ${fmt(s.wbcMean, 2)} ×10⁹/L`, `- Alert episodes started: ${s.alerts}`, '',
      '## Events', ...evs.map(e => { const x = explainEvent(m, e); return `### ${e.label} (${e.mission_label})\n- What happened: ${x.what}\n- Term: ${x.term}\n- Values: ${x.values.join('; ')}\n- Contributors: ${x.contributors.join(', ')}\n- Evidence: ${x.evidence}\n- Uncertainty: ${x.uncertainty}\n- Action: ${x.action}`; }),
      '', '## Assumptions', '```json', JSON.stringify({ dose: m.scenario.dose, stress: m.scenario.stress, terra: m.scenario.terra, wbc: m.scenario.wbc, exit_day: m.scenario.exit_day, reentry_day: m.scenario.reentry_day }, null, 2), '```'];
    download(`aerol-report-${iso(s.a).slice(0, 10)}.md`, md.join('\n'), 'text/markdown');
  }

  renderTools();
  renderCharts();
  renderSide();
  return {
    render: () => { renderTools(); renderCharts(); renderSide(); },
    onClock: () => {
      const avail = store.model.labs.filter(l => l.available <= store.t).length;
      if (avail !== ui.availCount) { ui.availCount = avail; renderCharts(); } // lab results appear when available
      else group.setCursor(store.t);
    },
    onState: () => { renderCharts(); renderSide(); },
    resize: () => group.renderAll(),
    explain: id => { ui.explain = id; renderSide(); },
    group,
  };
}
