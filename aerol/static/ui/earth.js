// Dashboard with two audiences: crew members (onboard, plain language, their own data)
// and Earth physicians/researchers (delayed ground view, review tools). Same store, same clock.
import { DAY, isNum, fmt, iso, signed } from '../core/util.js';
import { missionLabel, PHASES, PHASE_LABEL, REGION_LABEL, validateScenario } from '../core/schedule.js';
import { workedChecks, QUANTITIES } from '../core/radiation.js';
import { episodeStatus, SEVERITY_LABEL, RULESET_VERSION, defaultRules } from '../core/rules.js';
import { packetStatus, checkupBrief, actionSummary } from '../core/store.js';
import { explainEvent, EXTREMA_RULE } from '../core/events.js';
import { validateBatch, SHARED_FIELDS, TERRA_FIELDS, WBC_FIELDS, RADIATION_FIELDS, EVENT_FIELDS, VALUE_ORIGINS } from '../core/schema.js';
import { phaseComparison, dostelRows, dostelRecord } from '../core/research.js';
import { simulationRecords } from '../core/export.js';
import { mountTimeline } from './earth-timeline.js';
import { mountObserved } from './earth-observed.js';
import { phaseCompareHtml } from './phase-compare.js';
import { CREW_SECTIONS, crewHome, crewFollowup, crewLearn, crewActions, selfcareDashboard } from './earth-crew.js';
import { $, esc, toast, download, throttle, openDialog } from './dom.js';

const AUDIENCES = { crew: 'Crew member (onboard)', physician: 'Full mission view (crew + Earth team)' };
const PHYS_SECTIONS = [['timeline', 'Mission timeline · body & exposure'], ['phases', 'Compare with past missions'], ['review', 'Health reviews & messages'], ['events', 'What happened & why'], ['schedule', 'Schedule & blood draws'], ['data', 'Alert rules & data records']];

export function mountEarth(root, store, { research, navigate }) {
  let saved = null;
  try { saved = localStorage.getItem('aerol.audience'); } catch { /* storage unavailable */ }
  const ui = { audience: saved === 'crew' ? 'crew' : 'physician', section: saved === 'crew' ? 'crew-home' : 'timeline', mode: 'simulation', timeline: null, observed: null, eventFilter: 'all' };
  const sections = () => (ui.audience === 'crew' ? CREW_SECTIONS : PHYS_SECTIONS);
  root.innerHTML = `<div class="earth"><nav class="enav" aria-label="Dashboard sections"><div class="aud" role="group" aria-label="View as">
    <span class="nav-label">View as</span>${Object.entries(AUDIENCES).map(([k, l]) => `<button class="aud-btn" data-aud="${k}">${esc(l)}</button>`).join('')}</div>
    <div id="e-nav"></div><p class="nav-note" id="e-navnote"></p></nav>
    <div class="ebody"><div class="ehead"><div><h1 id="e-title"></h1><p class="sub" id="e-sub"></p></div><div id="e-mode"></div></div><div class="fresh" id="e-fresh"></div><div id="e-content"></div></div></div>`;
  const content = $('#e-content', root);
  const simRecords = () => simulationRecords(store.model);

  function renderNav() {
    $('#e-nav', root).innerHTML = sections().map(([id, l]) => `<button data-sec="${id}">${esc(l)}</button>`).join('');
    root.querySelectorAll('[data-aud]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.aud === ui.audience)));
    $('#e-navnote', root).textContent = ui.audience === 'crew'
      ? 'Your own data, onboard and current. Physicians on Earth see the same records after the link delay.'
      : '';
    $('#e-navnote', root).hidden = ui.audience !== 'crew';
  }

  function renderHead() {
    if (!sections().some(s => s[0] === ui.section)) ui.section = sections()[0][0];
    const [, title] = sections().find(s => s[0] === ui.section);
    $('#e-title', root).textContent = title;
    $('#e-sub', root).textContent = `${store.model.scenario.name} · ${store.model.scenario.description}`;
    root.querySelectorAll('[data-sec]').forEach(b => b.setAttribute('aria-current', String(b.dataset.sec === ui.section)));
    $('#e-mode', root).innerHTML = ui.section === 'timeline' && ui.audience === 'physician' ? `<div class="seg" role="group" aria-label="Data mode"><button data-mode="simulation" aria-pressed="${ui.mode === 'simulation'}">Simulated mission (what-if)</button><button data-mode="observed" aria-pressed="${ui.mode === 'observed'}">Real mission data (observed)</button></div>` : '';
    renderFresh();
  }

  function renderFresh() {
    const t = store.t;
    const g = store.groundView(t);
    const staleH = g.stalenessMs === null ? null : g.stalenessMs / 3600000;
    const el = $('#e-fresh', root);
    if (ui.audience === 'crew') {
      el.classList.remove('stale');
      el.innerHTML = `<b>Onboard view</b><span>Your data are current at ${esc(missionLabel(store.model.schedule, t, true))}. Earth sees them ${staleH !== null ? fmt(staleH, 1) + ' h later' : 'after the link delay'}${g.queued.length ? ` · ${g.queued.length} packet(s) waiting to send` : ''}.</span><span class="chip">Synthetic astronaut ${esc(store.model.scenario.astronaut_id)}</span>`;
      return;
    }
    el.classList.toggle('stale', staleH !== null && staleH > 12);
    el.innerHTML = `<b>What Earth can see</b><span>Astronaut-originated data current through ${g.latestCreated ? esc(missionLabel(store.model.schedule, g.latestCreated, true)) : '—'}${staleH !== null ? ` (${fmt(staleH, 1)} h behind mission clock ${esc(missionLabel(store.model.schedule, t, true))})` : ''}</span>
      <span class="chip">${g.queued.length} packet(s) queued onboard</span><span class="sub">Simulated link; no real ground station.</span>`;
  }

  function show(args = {}) {
    if (args.section) { if (!sections().some(x => x[0] === args.section)) ui.audience = 'physician'; ui.section = args.section; }
    renderNav();
    renderHead();
    renderSection();
  }

  function renderSection() {
    ui.timeline = null;
    if (ui.section === 'timeline') {
      content.innerHTML = '<div id="tl-host"></div>';
      if (ui.mode === 'simulation' || ui.audience === 'crew') ui.timeline = mountTimeline($('#tl-host', root), store, { simulationRecords: simRecords, audience: ui.audience });
      else ui.observed = mountObserved($('#tl-host', root), research);
    } else content.innerHTML = { 'crew-home': () => crewHome(store), selfcare: () => selfcareDashboard(store, store.t), 'crew-followup': () => crewFollowup(store), 'crew-learn': crewLearn, phases: phasesHtml, review: reviewHtml, events: eventsHtml, schedule: scheduleHtml, data: dataHtml }[ui.section]();
  }

  // ---------- Phase comparison ----------
  function phasesHtml() {
    if (!research) return '<div class="notice">Observed research bundle unavailable.</div>';
    const rows = phaseComparison(research, store.model);
    return phaseCompareHtml(research, store.model) + `<details class="panel"><summary>Show as table</summary><div><p class="sub">Columns align the six canonical phases. Each cell keeps its own timing labels, cohort and units — cells in the same column are <b>not</b> paired observations, and R+1, R+30 and R+99 are different times.</p>
      <div style="overflow-x:auto;margin-top:8px"><table class="phase-table"><thead><tr><th>Dataset · cohort · origin</th>${PHASES.map(p => `<th>${esc(PHASE_LABEL[p])}</th>`).join('')}</tr></thead><tbody>
      ${rows.map(r => `<tr><td><b>${esc(r.dataset)}</b><br><span class="sub">${esc(r.cohort)}</span><br><span class="chip ${r.origin.startsWith('observed') ? 'obs' : r.origin === 'simulation' ? 'sim' : 'pred'}">${esc(r.origin)}</span> <span class="sub">${esc(r.unit)}</span><br><span class="sub">${esc(r.note)}</span></td>
        ${PHASES.map(p => { const c = r.cells[p] || []; return `<td>${c.length ? `<ul>${c.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : `<span class="none">${esc(r.empty?.[p] || '—')}</span>`}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div></div></details>`;
  }

  // ---------- Review queue + brief ----------
  function reviewHtml() {
    const m = store.model;
    const t = store.t;
    const actions = store.actionsAt(t);
    const received = store.packets.filter(p => p.received <= t && p.kind !== 'daily_summary');
    const medical = received.filter(p => p.kind === 'evidence' && (p.health_check?.needed));
    const byEp = new Map();
    for (const p of medical) if (!byEp.has(p.episode_id)) byEp.set(p.episode_id, p);
    const research = m.alerts.episodes.filter(e => e.category === 'research' && e.start <= t);
    const checkins = received.filter(p => p.kind === 'checkin');
    const brief = store.state.briefText ?? checkupBrief(m, actions, t);
    return `<div class="qgrid">
      <section class="panel"><h2>Health reviews: crew ↔ Earth physicians</h2><p class="sub"><b>For astronauts:</b> alerts that asked for a health check land here once Earth receives them; a physician's reply comes back to your watch.</p><p class="sub">Evidence packets received on Earth that request a health check. Messages back travel on the next uplink (simulated). No message reaches a real person.</p>
        ${[...byEp.values()].reverse().map(p => {
          const ep = m.alerts.episodes.find(e => e.episode_id === p.episode_id);
          const st = episodeStatus(ep, t, actions);
          const rule = m.rules.find(r => r.id === ep.rule_id);
          const reviews = actions.filter(a => a.side === 'ground' && a.episode_id === ep.episode_id);
          return `<div class="qitem"><header><span class="sev sev-${st.severity}">${esc(SEVERITY_LABEL[st.severity])}</span><b>${esc(rule.label)}</b><span class="sub">${esc(missionLabel(m.schedule, ep.start, true))}</span></header>
            <div class="sub">Received ${esc(missionLabel(m.schedule, p.received, true))} (${fmt((p.received - p.created) / 3600000, 1)} h after creation) · ${esc(st.status)}${st.ack_t ? ' · acknowledged ' + esc(missionLabel(m.schedule, st.ack_t, true)) : ''}</div>
            <div>${esc(p.summary)} · <span class="sub">${esc(rule.threshold_kind)}</span></div>
            ${reviews.map(r => `<div class="sub">✓ ${esc(actionSummary(r))} — ${esc(missionLabel(m.schedule, r.t, true))}</div>`).join('')}
            <textarea data-note="${esc(ep.episode_id)}" placeholder="Message to the astronaut (simulated)"></textarea>
            <div class="row"><button class="btn small primary" data-review="${esc(ep.episode_id)}">Mark reviewed &amp; send message</button><button class="btn small" data-resolve="${esc(ep.episode_id)}">Resolve after review</button><button class="btn small" data-explain="ep:${esc(ep.episode_id)}">Explain</button></div></div>`;
        }).join('') || '<p class="sub">Nothing received that needs review yet.</p>'}
      </section>
      <section class="panel"><h2>Research reviews (science team)</h2><p class="sub"><b>For astronauts:</b> these are questions for scientists, not medical alerts. At most they may ask for an extra sample at your next scheduled draw.</p><p class="sub">Forecast-based items. No validated clinical cutoff exists for TERRA or forecast WBC; these never trigger treatment.</p>
        ${research.reverse().map(e => {
          const rule = m.rules.find(r => r.id === e.rule_id);
          const req = actions.find(a => a.action === 'request_sample' && a.episode_id === e.episode_id);
          return `<div class="qitem"><header><span class="sev sev-research">Research review</span><b>${esc(rule.label)}</b></header><div class="sub">${esc(missionLabel(m.schedule, e.start, true))} · peak ${signed(e.peak, 0, '%')} · predicted (simulated projection)</div>
            <div class="row">${req ? `<span class="sub">Confirmatory sample requested ${esc(missionLabel(m.schedule, req.t, true))}</span>` : `<button class="btn small" data-request="${esc(e.episode_id)}">Request confirmatory sample at next draw</button>`}<button class="btn small" data-goto-tl>Open timeline</button></div></div>`;
        }).join('') || '<p class="sub">No research items yet.</p>'}
        <h3>Check-ins received</h3>${checkins.length ? checkins.reverse().map(p => `<div class="sub">${esc(missionLabel(m.schedule, p.created, true))}: ${esc(p.summary)}</div>`).join('') : '<p class="sub">None received.</p>'}
      </section>
      <section class="panel brief" style="grid-column:1/-1"><h2>Check-up brief (shared by astronaut and flight physician)</h2><p class="sub">Generated from measured trends, symptoms, exposure history, unresolved alerts and suggested questions. Research predictions are labeled unconfirmed. Edit before use.</p>
        <textarea id="brief">${esc(brief)}</textarea>
        <div class="row"><button class="btn small primary" data-brief="save">Save edits</button><button class="btn small" data-brief="regen">Regenerate at current time</button><button class="btn small" data-brief="export">Export .txt</button>${store.state.briefEditedAt ? `<span class="sub">Edited ${esc(store.state.briefEditedAt)}</span>` : ''}</div></section>
      <section class="panel" style="grid-column:1/-1"><h2>Messages between spacecraft and Earth (packet log)</h2><div style="max-height:260px;overflow:auto"><table><thead><tr><th>Created</th><th>Kind</th><th>Summary</th><th>Status</th></tr></thead><tbody>
        ${store.packets.filter(p => p.created <= t && p.kind !== 'daily_summary').slice(-60).reverse().map(p => `<tr><td>${esc(missionLabel(m.schedule, p.created, true))}</td><td>${esc(p.kind)}</td><td>${esc(p.summary)}</td><td>${esc(packetStatus(p, t))}</td></tr>`).join('')}</tbody></table></div></section></div>`;
  }

  // ---------- Events ----------
  function eventsHtml() {
    const m = store.model;
    const lanes = ['all', 'trajectory', 'schedule', 'samples', 'extrema', 'link'];
    const list = m.events.filter(e => ui.eventFilter === 'all' || e.lane === ui.eventFilter);
    return `<section class="panel"><div class="row">${lanes.map(l => `<button class="btn small ${ui.eventFilter === l ? 'on' : ''}" data-filter="${l}">${l}</button>`).join('')}</div>
      <p class="sub" style="margin-top:6px">Peaks and dips: maximum/minimum within ±${EXTREMA_RULE.window_days} days with prominence ≥ ${EXTREMA_RULE.prominence.terra} fold (TERRA) or ${EXTREMA_RULE.prominence.wbc} ×10⁹/L (WBC), on model curves only. Sparse samples are never used to assert an unsampled peak.</p>
      <table style="margin-top:8px"><thead><tr><th>Time</th><th>Event</th><th>Phase · region</th><th></th></tr></thead><tbody>
      ${list.map(e => `<tr><td>${esc(e.mission_label)}<br><span class="sub">${esc(iso(e.t).slice(0, 16))}Z</span></td><td>${esc(e.label)}</td><td>${esc(PHASE_LABEL[e.phase])} · ${esc(REGION_LABEL[e.region])}</td><td><button class="btn small" data-explain="${esc(e.id)}">Explain</button> <button class="btn small" data-jump="${e.t}">Go to</button></td></tr>`).join('')}
      </tbody></table></section>`;
  }

  // ---------- Schedule editor ----------
  function scheduleHtml() {
    const sc = store.state.scenario;
    const m = store.model;
    const f = (k, label, v, type = 'number', step = '1') => `<label>${esc(label)}<input data-sk="${k}" type="${type}" step="${step}" value="${esc(v ?? '')}"></label>`;
    return `<section class="panel"><h2>Mission schedule (crew &amp; ground)</h2><p class="sub">Phase (timeline position) and exposure region (trajectory) are separate. Regions come only from these trajectory settings — never inferred from TERRA or HRV.</p>
      <div class="form-grid" style="margin-top:10px">
        ${f('launch_utc', 'Launch (UTC, ISO 8601)', sc.launch_utc, 'text')}${f('mission_days', 'Mission duration (days)', sc.mission_days)}
        ${f('exit_day', 'Magnetosphere exit (flight day; blank = none)', sc.exit_day, 'number', '0.25')}${f('reentry_day', 'Magnetosphere re-entry (flight day)', sc.reentry_day, 'number', '0.25')}
        ${f('belt_transit_hours', 'Belt transit duration (h)', sc.belt_transit_hours)}${f('phases.early_end_day', 'Early flight ends (FD)', sc.phases.early_end_day)}
        ${f('phases.mid_end_day', 'Mid flight ends (FD)', sc.phases.mid_end_day)}${f('phases.landing_window_days', 'Landing phase length (days)', sc.phases.landing_window_days)}
        ${f('baseline_window_days.0', 'Baseline window start (days rel. launch)', sc.baseline_window_days[0])}${f('baseline_window_days.1', 'Baseline window end', sc.baseline_window_days[1])}
        ${f('stress.onset_days_before_launch', 'Modeled stress onset (days before launch)', sc.stress.onset_days_before_launch)}
      </div><div class="row" style="margin-top:10px"><button class="btn primary" data-sched="apply">Apply schedule</button><span id="sched-err" class="notice err" hidden></span></div></section>
      <section class="panel"><h2>Mission timeline at a glance: phases, regions, blood draws and when results arrive</h2><table><thead><tr><th>Item</th><th>UTC</th><th>Notation</th></tr></thead><tbody>
        <tr><td>Launch</td><td>${esc(iso(m.schedule.launch))}</td><td>FD0</td></tr>
        ${m.schedule.regionChanges.filter(c => isNum(c.t)).map(c => `<tr><td>${esc(c.label)} → ${esc(REGION_LABEL[c.region])}</td><td>${esc(iso(c.t))}</td><td>${esc(missionLabel(m.schedule, c.t, true))}</td></tr>`).join('')}
        ${m.schedule.phases.map(p => `<tr><td>Phase: ${esc(PHASE_LABEL[p.phase])}</td><td>${esc(iso(p.start).slice(0, 16))} → ${esc(iso(p.end).slice(0, 16))}</td><td>${esc(missionLabel(m.schedule, p.start))} → ${esc(missionLabel(m.schedule, p.end))}</td></tr>`).join('')}
        <tr><td>Baseline window</td><td>${esc(iso(m.schedule.baselineWindow[0]).slice(0, 10))} → ${esc(iso(m.schedule.baselineWindow[1]).slice(0, 10))}</td><td>before modeled stress onset ${esc(missionLabel(m.schedule, m.schedule.stressOnset))}</td></tr>
        ${m.labs.map(l => `<tr><td>${esc(l.kind.toUpperCase())} sample ${esc(l.label)} — result available</td><td>${esc(iso(l.t).slice(0, 16))} → ${esc(iso(l.available).slice(0, 16))}</td><td>${esc(missionLabel(m.schedule, l.available, true))}</td></tr>`).join('')}
      </tbody></table></section>`;
  }

  // ---------- Rules, schema & data ----------
  function dataHtml() {
    const m = store.model;
    const fields = (name, list) => `<p><b>${name}</b>: ${list.map(x => `<code>${x}</code>`).join(' ')}</p>`;
    return `<section class="panel"><h2>Alert rules: what makes the watch alert <span class="chip">${RULESET_VERSION}</span></h2><p class="sub">Thresholds are labeled by kind. Edit demo values; operational limits must come from approved policy.</p>
      <div style="overflow-x:auto"><table><thead><tr><th>Rule</th><th>Category · metric</th><th>Levels (severity: threshold)</th><th>Persistence</th><th>Kind / policy</th><th>Escalation</th></tr></thead><tbody>
      ${m.rules.map((r, i) => `<tr><td><b>${esc(r.label)}</b><br><code>${esc(r.id)} v${r.version}</code></td><td>${esc(r.category)} · ${esc(r.metric)} (${esc(r.unit)})</td>
        <td>${r.levels.map((l, k) => `${esc(l.severity)}: ${isNum(l.threshold) ? `<input style="width:70px" type="number" step="any" value="${l.threshold}" data-rule="${i}" data-level="${k}">` : '—'}`).join('<br>')}</td>
        <td>${isNum(r.persistence_h) ? r.persistence_h + ' h' : '—'}${isNum(r.cooldown_h) ? ` · cooldown ${r.cooldown_h} h` : ''}</td><td>${esc(r.threshold_kind)}<br><span class="sub">${esc(r.source_policy)}</span></td><td class="sub">${esc(r.escalation_route)}</td></tr>`).join('')}
      </tbody></table></div><div class="row" style="margin-top:8px"><button class="btn small primary" data-rules="apply">Apply edited thresholds</button><button class="btn small" data-rules="defaults">Restore defaults</button></div></section>
      <section class="panel"><h2>Export</h2><div class="row">
        <button class="btn small" data-io="sim">Simulation records (JSON)</button><button class="btn small" data-io="obs">Observed research records (JSON)</button>
        <button class="btn small" data-io="workspace">Workspace (scenario, rules, actions)</button><label class="btn small">Import workspace<input type="file" id="ws-file" accept=".json" hidden></label></div></section>`;
  }

  // ---------- events ----------
  root.addEventListener('click', e => {
    const aud = e.target.closest('[data-aud]');
    if (aud) {
      ui.audience = aud.dataset.aud;
      try { localStorage.setItem('aerol.audience', ui.audience); } catch { /* ignore */ }
      ui.section = sections()[0][0];
      show(); return;
    }
    if (crewActions(e, store, toast, renderSection)) return;
    const scb = e.target.closest('[data-selfcare]');
    if (scb) { store.addAction({ action: 'selfcare', data: { kind: scb.dataset.selfcare } }); toast('Self-care logged.'); renderSection(); return; }
    const goCheck = e.target.closest('[data-sec-crew]');
    if (goCheck) { ui.section = 'crew-followup'; show(); return; }
    const sec = e.target.closest('[data-sec]');
    if (sec) { ui.section = sec.dataset.sec; show(); return; }
    const mode = e.target.closest('[data-mode]');
    if (mode) { ui.mode = mode.dataset.mode; show(); return; }
    const ex = e.target.closest('[data-explain]');
    if (ex) { explainDialog(ex.dataset.explain); return; }
    const jump = e.target.closest('[data-jump]');
    if (jump) { store.play(false); store.setTime(Number(jump.dataset.jump) + 1000); toast('Mission clock moved.'); return; }
    const fl = e.target.closest('[data-filter]');
    if (fl) { ui.eventFilter = fl.dataset.filter; renderSection(); return; }
    if (e.target.closest('[data-goto-tl]')) { ui.section = 'timeline'; ui.mode = 'simulation'; show(); return; }
    const rv = e.target.closest('[data-review]');
    if (rv) {
      const note = root.querySelector(`[data-note="${CSS.escape(rv.dataset.review)}"]`)?.value || 'Reviewed — continue monitoring; repeat measurement per protocol.';
      store.addAction({ action: 'ground_review', side: 'ground', episode_id: rv.dataset.review, data: { note } });
      toast('Review recorded. Message queued for the next uplink (simulated).');
      renderSection(); return;
    }
    const rs = e.target.closest('[data-resolve]');
    if (rs) { store.addAction({ action: 'resolve', side: 'ground', episode_id: rs.dataset.resolve }); toast('Marked resolved after review.'); renderSection(); return; }
    const rq = e.target.closest('[data-request]');
    if (rq) { store.addAction({ action: 'request_sample', side: 'ground', episode_id: rq.dataset.request }); toast('Research request queued — not a medical alert.'); renderSection(); return; }
    const br = e.target.closest('[data-brief]');
    if (br) {
      const box = $('#brief', root);
      if (br.dataset.brief === 'save') { store.state.briefText = box.value; store.state.briefEditedAt = missionLabel(store.model.schedule, store.t, true); store.commit(); toast('Brief saved locally.'); }
      if (br.dataset.brief === 'regen') { store.state.briefText = null; store.state.briefEditedAt = null; store.commit(); renderSection(); }
      if (br.dataset.brief === 'export') download('aerol-checkup-brief.txt', box.value, 'text/plain');
      return;
    }
    const sch = e.target.closest('[data-sched]');
    if (sch) { applySchedule(); return; }
    const rl = e.target.closest('[data-rules]');
    if (rl) {
      if (rl.dataset.rules === 'defaults') { store.setRules(defaultRules()); toast('Default rules restored.'); renderSection(); return; }
      const rules = JSON.parse(JSON.stringify(store.state.rules));
      root.querySelectorAll('[data-rule]').forEach(inp => { const v = Number(inp.value); if (Number.isFinite(v)) rules[inp.dataset.rule].levels[inp.dataset.level].threshold = v; });
      store.setRules(rules); toast('Rules re-evaluated over the whole mission.'); renderSection(); return;
    }
    const io = e.target.closest('[data-io]');
    if (io) handleIO(io.dataset.io);
  });

  root.addEventListener('change', async e => {
    if (e.target.id === 'import-file' && e.target.files[0]) { $('#import-box', root).value = await e.target.files[0].text(); handleIO('validate'); }
    if (e.target.id === 'ws-file' && e.target.files[0]) {
      try { store.importState(JSON.parse(await e.target.files[0].text())); toast('Workspace imported.'); show(); } catch (err) { toast(err.message); }
    }
  });

  function explainDialog(id) {
    const m = store.model;
    if (id.startsWith('ep:')) { ui.section = 'timeline'; ui.mode = 'simulation'; show(); ui.timeline?.explain(id); return; }
    const ev = m.events.find(x => x.id === id);
    if (!ev) return;
    const x = explainEvent(m, ev);
    const li = a => (a?.length ? `<ul>${a.map(v => `<li>${esc(v)}</li>`).join('')}</ul>` : '—');
    openDialog(`${ev.label} · ${ev.mission_label}`, `<div class="explain"><span class="chip">evidence: ${esc(x.status)}</span><dl>
      <dt>What happened?</dt><dd>${esc(x.what)}</dd><dt>What does this term mean?</dt><dd>${esc(x.term)}</dd><dt>Which values changed?</dt><dd>${li(x.values)}</dd>
      <dt>What could contribute?</dt><dd>${li(x.contributors)}</dd><dt>What evidence supports it?</dt><dd>${esc(x.evidence)}</dd><dt>What is uncertain?</dt><dd>${esc(x.uncertainty)}</dd><dt>Is any action indicated?</dt><dd>${esc(x.action)}</dd></dl></div>`);
  }

  function applySchedule() {
    const sc = JSON.parse(JSON.stringify(store.state.scenario));
    root.querySelectorAll('[data-sk]').forEach(inp => {
      const path = inp.dataset.sk.split('.');
      const raw = inp.value.trim();
      const val = inp.type === 'number' ? (raw === '' ? null : Number(raw)) : raw;
      let o = sc;
      for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
      o[path[path.length - 1]] = val;
    });
    if (sc.exit_day === null || sc.reentry_day === null) { sc.exit_day = null; sc.reentry_day = null; }
    const errs = validateScenario(sc);
    const box = $('#sched-err', root);
    if (errs.length) { box.hidden = false; box.textContent = errs.join(' '); return; }
    store.setScenario(sc, { scenarioId: 'custom' });
    toast('Schedule applied; models, alerts and the watch were recomputed.');
    renderSection();
  }

  function handleIO(kind) {
    if (kind === 'sim') download('aerol-simulation-records.json', JSON.stringify(simRecords(), null, 1));
    if (kind === 'obs') {
      if (!research) return toast('Observed bundle unavailable.');
      const radiation = ['DosTel1', 'DosTel2'].flatMap(d => dostelRows(research, d).map(r => dostelRecord(r, research.missions.twins)));
      download('aerol-observed-records.json', JSON.stringify([...research.records, ...radiation], null, 1));
    }
    if (kind === 'workspace') download('aerol-workspace.json', JSON.stringify(store.exportState(), null, 1));
    if (kind === 'validate') {
      const out = $('#import-result', root);
      try {
        const parsed = JSON.parse($('#import-box', root).value);
        const recs = Array.isArray(parsed) ? parsed : parsed.records || [parsed];
        const res = validateBatch(recs);
        const bad = res.results.filter(r => r.errors.length);
        out.innerHTML = `<p class="${res.valid ? 'ok' : 'bad'}">${recs.length} record(s): ${res.valid ? 'all valid' : bad.length + ' invalid'}.</p>` +
          bad.slice(0, 20).map(r => `<p class="sub"><code>${esc(r.record_id)}</code>: ${esc(r.errors.join('; '))}</p>`).join('');
        if (res.valid) postRecords(recs);
      } catch (err) { out.innerHTML = `<p class="bad">Not valid JSON: ${esc(err.message)}</p>`; }
    }
  }

  async function postRecords(recs) {
    try {
      const r = await fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records: recs }) });
      const body = await r.json();
      toast(r.ok ? `Stored ${body.stored} record(s) in the local SQLite workspace.` : `Server: ${body.error}`);
    } catch { toast('Validated locally; API unavailable (offline) — records not stored on the server.'); }
  }

  const onClock = throttle(() => {
    renderFresh();
    if (ui.timeline) ui.timeline.onClock();
    const typing = root.contains(document.activeElement?.closest?.('textarea, input') || null);
    if (['review', 'crew-home', 'selfcare', 'crew-followup'].includes(ui.section) && !typing) renderSection();
  }, 250);
  store.subscribe(kind => {
    if (root.hidden) return;
    if (kind === 'state') { renderHead(); if (ui.timeline) ui.timeline.onState(); else if (ui.section !== 'review' || !document.activeElement?.closest?.('textarea')) renderSection(); }
    else onClock();
  });
  window.addEventListener('resize', throttle(() => { ui.timeline?.resize(); ui.observed?.resize?.(); }, 200));
  return { show };
}
