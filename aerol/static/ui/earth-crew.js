// Earth dashboard · crew-member view. Runs onboard (no link delay for the crew's own data),
// in plain language. Physicians use the other audience view; both read the same store.
import { DAY, isNum, fmt, signed, sampleGrid } from '../core/util.js';
import { missionLabel, PHASE_LABEL, REGION_LABEL } from '../core/schedule.js';
import { rateAt, doseAt } from '../core/radiation.js';
import { episodeStatus, SEVERITY_LABEL } from '../core/rules.js';
import { followups, deliveryTime } from '../core/store.js';
import { selfcareDashboard } from './selfcare-view.js';
import { esc } from './dom.js';

export const CREW_SECTIONS = [['crew-home', 'My health today'], ['selfcare', 'Self-care'], ['timeline', 'My mission timeline'], ['crew-followup', 'Follow-up & messages'], ['crew-learn', 'What my data mean']];

export function crewHome(store) {
  const t = store.t;
  const m = store.model;
  const w = store.watchView(t);
  const top = w.top;
  const labs = m.labs.filter(l => l.available <= t).sort((a, b) => b.t - a.t);
  const wbc = labs.find(l => l.kind === 'wbc');
  const terra = labs.find(l => l.kind === 'terra');
  const proj = sampleGrid(m.terra.fold, t);
  const msgs = w.followups.flatMap(f => f.messages.map(x => ({ ...x, title: f.title }))).sort((a, b) => b.t - a.t).slice(0, 3);
  const nextDraw = m.schedule.samples.find(s => s.t > t);
  const status = top.kind === 'alert'
    ? `<span class="sev sev-${top.s.severity}">${esc(SEVERITY_LABEL[top.s.severity])}</span> <b>${esc(m.rules.find(r => r.id === top.e.rule_id).label)}</b><p class="sub">${esc(top.s.status)} · open the watch for the next step.</p>`
    : top.kind === 'insufficient_data' ? '<b>Band not reporting</b><p class="sub">No vital-sign data right now — this is not an all-clear. Check fit and charge.</p>'
      : '<b>No active alerts</b><p class="sub">Keep wearing the band; alerts appear on your watch first.</p>';
  return `<div class="cards crew-cards">
    <section class="panel"><h2>Status</h2>${status}</section>
    <section class="panel"><h2>Recovery</h2><div class="stat"><div class="v">${isNum(w.day?.recovery) && !w.vitals.missing ? w.day.recovery : '—'}<small>/100</small></div><div class="n">Demo estimate from HRV, resting heart rate and sleep. It never overrides an alert.</div></div></section>
    <section class="panel"><h2>Radiation exposure</h2><div class="stat"><div class="v">${fmt(rateAt(m.segments, t), 2)}<small> mSv/day</small></div><div class="n">${esc(REGION_LABEL[w.region])} · last 7 days ${fmt(w.dose7, 1)} mSv · mission ${fmt(w.dose, 1)} mSv (simulated dosimeter)</div></div></section>
    <section class="panel"><h2>Next blood draw</h2><div class="stat"><div class="v">${nextDraw ? esc(nextDraw.label) : '—'}</div><div class="n">${nextDraw ? `${esc(missionLabel(m.schedule, nextDraw.t, true))} · ${esc(nextDraw.purpose)}` : 'None scheduled'}</div></div></section>
  </div>
  <div class="qgrid">
    <section class="panel"><h2>My lab results</h2><p class="sub">Blood tests are run by a lab, never by the watch. In-flight TERRA samples are measured on Earth after you return.</p>
      <dl class="kv" style="margin-top:8px"><dt>White blood cells</dt><dd>${wbc ? `${fmt(wbc.value, 1)} ×10⁹/L at ${esc(wbc.label)} — ${signed(wbc.pct_from_baseline, 0, '%')} vs your baseline; lab range ${m.scenario.wbc.lab_range.join('–')}` : 'No result yet'}</dd>
      <dt>TERRA (research marker)</dt><dd>${terra ? `${fmt(terra.fold, 2)}× your baseline at ${esc(terra.label)}` : 'No result available yet'} <span class="chip pred">not a diagnosis</span></dd>
      <dt>TERRA projection now</dt><dd>${signed(100 * (proj - 1), 0, '%')} vs baseline <span class="chip sim">simulated projection</span></dd></dl>
      <p class="sub">All values here are from the simulation (synthetic astronaut ${esc(m.scenario.astronaut_id)}).</p></section>
    <section class="panel"><h2>Messages from Earth</h2>${msgs.length ? msgs.map(x => `<div class="msg"><b>${esc(x.title)}</b><p>${esc(x.text)}</p><span class="sub">delivered ${esc(missionLabel(m.schedule, x.t, true))}</span></div>`).join('') : '<p class="sub">No messages yet. Physician replies arrive on the next uplink (simulated).</p>'}</section>
  </div>`;
}

export function crewFollowup(store) {
  const t = store.t;
  const m = store.model;
  const actions = store.actionsAt(t);
  const items = followups(m, actions, t);
  const health = items.filter(f => f.kind === 'health_check');
  const sentToEarth = store.packets.filter(p => p.created <= t && (p.kind === 'checkin' || p.kind === 'action')).slice(-8).reverse();
  return `<div class="qgrid">
    <section class="panel"><h2>Health checks</h2>${health.length ? health.map(f => `<div class="qitem"><header><span class="sev sev-${f.severity}">${esc(SEVERITY_LABEL[f.severity])}</span><b>${esc(f.title)}</b></header>
      <div class="sub">${esc(f.urgency || '')} · ${esc(f.status)} · ${esc(missionLabel(m.schedule, f.t, true))}</div>
      ${f.messages.map(x => `<div class="msg"><p>${esc(x.text)}</p></div>`).join('')}
      <div class="row">${f.status === 'requested' ? `<button class="btn small primary" data-crew-act="followup" data-ep="${esc(f.episode_id)}">Start follow-up</button>` : ''}<button class="btn small" data-crew-act="contact" data-ep="${esc(f.episode_id)}">Contact crew medical support</button></div></div>`).join('') : '<p class="sub">No health checks requested.</p>'}</section>
    <section class="panel"><h2>Upcoming</h2>${items.filter(f => f.kind !== 'health_check').map(f => `<div class="qitem"><b>${esc(f.title)}</b><span class="sub">${esc(f.status)} · ${esc(missionLabel(m.schedule, f.t, true))}</span>${f.messages.map(x => `<p class="sub">${esc(x.text)}</p>`).join('')}</div>`).join('') || '<p class="sub">Nothing scheduled.</p>'}</section>
    <section class="panel" id="checkin"><h2>Quick check-in</h2><p class="sub">Same as the watch check-in. Saved onboard, then sent to Earth.</p>
      <div class="form-grid"><label>Symptoms (comma-separated)<input id="crew-sym" placeholder="e.g. headache, poor sleep"></label><label>Stress (1–5)<input id="crew-stress" type="number" min="1" max="5"></label><label>Fatigue (1–5)<input id="crew-fatigue" type="number" min="1" max="5"></label><label>For my next medical check<input id="crew-concern" maxlength="200"></label></div>
      <div class="row" style="margin-top:8px"><button class="btn small primary" data-crew-act="checkin">Save check-in</button></div></section>
    <section class="panel"><h2>Sent to Earth</h2>${sentToEarth.map(p => `<div class="sub">${esc(missionLabel(m.schedule, p.created, true))} · ${esc(p.summary)} — ${p.received <= t ? 'received' : 'queued onboard'}</div>`).join('') || '<p class="sub">Nothing yet.</p>'}</section></div>`;
}

export function crewLearn() {
  const card = (title, body) => `<section class="panel"><h2>${esc(title)}</h2><p>${body}</p></section>`;
  return `<div class="qgrid">
    ${card('TERRA', 'TERRA is RNA made at the ends of your chromosomes (telomeres). In lab studies it rose after radiation exposure but not under simulated microgravity. It is a <b>research marker</b>: it cannot diagnose injury, and there is no medical cut-off. On charts, 0% means equal to your own baseline, not zero molecules.')}
    ${card('White blood cells (WBC)', 'Your immune cells, counted from a blood draw. They often rise a little in flight and spike briefly after landing from stress hormones. A higher number does not mean better immunity. Measured results are compared with the lab range and your own baseline.')}
    ${card('Radiation dose', '<b>Dose rate</b> (mSv/day) is how fast exposure accumulates; <b>mission dose</b> (mSv) is the running total, which never goes down. Inside Earth’s magnetosphere you are partly shielded; beyond it, cosmic rays arrive with less shielding. Your watch shows readings from a simulated personal dosimeter.')}
    ${card('Phases vs. regions', 'Mission phase is where you are in the timeline (pre-flight, early/mid/late flight, landing, after return). Exposure region is where the spacecraft is (inside the magnetosphere, belt transit, beyond). They change independently.')}
    ${card('Alert levels', '<span class="sev sev-info">Info</span> reminders · <span class="sev sev-advisory">Advisory</span> check in or recheck · <span class="sev sev-caution">Caution</span> health check today · <span class="sev sev-urgent">Urgent</span> follow the onboard protocol now. Research reviews are for scientists and never mean treatment.')}
    ${card('What is simulated', 'In this prototype the wristband, dosimeter, lab results and astronaut are synthetic. Thresholds are demo values, not medical rules. Messages are not sent to real people.')}
  </div>`;
}

export function crewActions(e, store, toast, rerender) {
  const b = e.target.closest('[data-crew-act]');
  if (!b) return false;
  const act = b.dataset.crewAct;
  if (act === 'followup') { store.addAction({ action: 'followup', episode_id: b.dataset.ep }); toast('Follow-up started.'); }
  if (act === 'contact') { store.addAction({ action: 'contact_cmo', episode_id: b.dataset.ep }); toast('Simulated: onboard crew medical officer notified.'); }
  if (act === 'checkin') {
    const root = b.closest('.ebody');
    const num = id => { const v = Number(root.querySelector(id).value); return v >= 1 && v <= 5 ? v : null; };
    const symptoms = root.querySelector('#crew-sym').value.split(',').map(x => x.trim()).filter(Boolean);
    store.addAction({ action: 'checkin', data: { symptoms, stress: num('#crew-stress'), fatigue: num('#crew-fatigue'), concerns: root.querySelector('#crew-concern').value.trim() || null } });
    toast('Check-in saved onboard and queued for Earth.');
  }
  rerender();
  return true;
}

export { selfcareDashboard, PHASE_LABEL, episodeStatus, deliveryTime, DAY };
