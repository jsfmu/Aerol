// Astronaut watch simulator + demo walkthrough panel.
import { DAY, HOUR, fmt } from '../core/util.js';
import { missionLabel, PHASE_LABEL, REGION_LABEL } from '../core/schedule.js';
import { packetStatus, actionSummary, linkUp } from '../core/store.js';
import { SEVERITY_LABEL } from '../core/rules.js';
import { $, $$, esc, toast, throttle } from './dom.js';
import { selfcareWatchPage } from './selfcare-view.js';
import { PAGES, homePage, vitalsPage, wellnessPage, radiationPage, alertsPage, checkinPage, followupPage, alertOverlay } from './watch-screens.js';

const RENDER = { home: homePage, selfcare: selfcareWatchPage, vitals: vitalsPage, wellness: wellnessPage, radiation: radiationPage, alerts: alertsPage, checkin: checkinPage, followup: followupPage };

export function mountWatchPage(root, store, { navigate, watchOnly = false }) {
  const ui = { page: 0, overlay: null, draft: freshDraft(), step: null };
  root.innerHTML = `<div class="watch-page">
    <section class="stage" aria-label="Astronaut watch simulator">
      <div class="device">
        <div class="strap"></div>
        <div class="case" id="w-case">
          <button class="crown" id="w-crown" aria-label="Digital crown: press for Home, scroll to change screen"></button>
          <button class="sidebtn" id="w-side" aria-label="Side button: notifications"></button>
          <div class="screen" id="w-screen" tabindex="0" aria-roledescription="watch screen" aria-live="polite">
            <div class="ws-status" id="w-status"></div>
            <div class="pages" id="w-pages">${PAGES.map(([id, name]) => `<div class="wpage" data-page="${id}" aria-label="${esc(name)}"></div>`).join('')}</div>
            <div class="wdots" id="w-dots">${PAGES.map(() => '<i></i>').join('')}</div>
            <div id="w-overlay"></div>
          </div>
        </div>
        <div class="strap bottom"></div>
      </div>
      <div class="watch-nav" role="tablist" aria-label="Watch screens">${PAGES.map(([id, name], i) => `<button data-nav="${i}" role="tab">${esc(name)}</button>`).join('')}</div>
      <p class="stage-caption">Swipe or use ← → on the watch, scroll or press the crown, side button for notifications. Haptic feedback is shown visually when the browser cannot vibrate.</p>
    </section>
    ${watchOnly ? '' : `<aside class="demo" id="demo"></aside>`}
  </div>`;

  const screen = $('#w-screen', root);
  const caseEl = $('#w-case', root);

  function go(i) {
    ui.page = (i + PAGES.length) % PAGES.length;
    $('#w-pages', root).style.transform = `translateX(${-100 * ui.page}%)`;
    $$('#w-dots i', root).forEach((d, k) => d.classList.toggle('on', k === ui.page));
    $$('.watch-nav button', root).forEach((b, k) => b.setAttribute('aria-current', String(k === ui.page)));
    renderPage(ui.page);
  }
  const goto = id => go(PAGES.findIndex(p => p[0] === id));

  function renderPage(i) {
    const w = store.watchView();
    const [id] = PAGES[i];
    const el = root.querySelector(`.wpage[data-page="${id}"]`);
    const scroll = el.scrollTop;
    el.innerHTML = RENDER[id](store, w, ui.draft);
    el.scrollTop = scroll;
  }

  function renderStatus() {
    const m = store.model;
    const t = store.t;
    const up = linkUp(m, t);
    const queued = store.packets.filter(p => p.created <= t && p.received > t).length;
    const hh = new Date(t).toISOString().slice(11, 16);
    const outage = (m.scenario.link.outages || []).some(o => t >= m.schedule.launch + o.start_day * DAY && t < m.schedule.launch + o.end_day * DAY);
    $('#w-status', root).innerHTML = `<span>${esc(missionLabel(m.schedule, t))} ${hh}</span><span class="ws-link ${up ? '' : outage ? 'off' : 'down'}" title="Earth link (simulated)">${up ? '⟟ link' : outage ? '⟟ outage' : '⟟ LOS'}${queued ? ' · ' + queued + '⇡' : ''}</span>`;
  }

  function renderOverlay() {
    const host = $('#w-overlay', root);
    host.innerHTML = ui.overlay ? alertOverlay(store, store.watchView(), ui.overlay) : '';
  }

  const render = () => { renderStatus(); renderPage(ui.page); renderOverlay(); renderDemo(); };
  const renderThrottled = throttle(render, 120);

  // ---- haptics ----
  function haptic(severity) {
    try { if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(severity === 'urgent' ? [200, 80, 200, 80, 200] : [120, 60, 120]); } catch { /* unsupported */ }
    caseEl.classList.remove('haptic');
    void caseEl.offsetWidth;
    caseEl.classList.add('haptic');
  }

  function openAlert(episodeId, { buzz = false } = {}) {
    const n = store.model.alerts.notifications.find(x => x.episode_id === episodeId);
    ui.overlay = episodeId;
    if (buzz) haptic(n?.severity);
    renderOverlay();
  }

  // ---- interaction ----
  root.addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) return go(Number(nav.dataset.nav));
    const open = e.target.closest('[data-open]');
    if (open) return openAlert(open.dataset.open);
    const gotoBtn = e.target.closest('[data-goto]');
    if (gotoBtn) return goto(gotoBtn.dataset.goto);
    const sym = e.target.closest('[data-sym]');
    if (sym) { const s = sym.dataset.sym; ui.draft.symptoms.has(s) ? ui.draft.symptoms.delete(s) : ui.draft.symptoms.add(s); return renderPage(ui.page); }
    const sx = e.target.closest('[data-stress]');
    if (sx) { ui.draft.stress = Number(sx.dataset.stress); return renderPage(ui.page); }
    const fx = e.target.closest('[data-fatigue]');
    if (fx) { ui.draft.fatigue = Number(fx.dataset.fatigue); return renderPage(ui.page); }
    const cx = e.target.closest('[data-concern]');
    if (cx) { ui.draft.concern = cx.dataset.concern; return renderPage(ui.page); }
    const sc = e.target.closest('[data-selfcare]');
    if (sc) {
      store.addAction({ action: 'selfcare', data: { kind: sc.dataset.selfcare } });
      toast({ hydration: 'Drink logged (+ hydration quest progress).', unwind: 'Wind-down session logged. Nice.', garden: 'Garden tended. Your zinnia grows a little.' }[sc.dataset.selfcare] || 'Logged.');
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const ep = act.dataset.ep;
    switch (act.dataset.act) {
      case 'close': ui.overlay = null; renderOverlay(); break;
      case 'ack': store.addAction({ action: 'ack', episode_id: ep }); toast('Acknowledged. The alert stays open until its condition clears or it is reviewed.'); break;
      case 'symptoms': ui.draft = freshDraft(ep); ui.overlay = null; renderOverlay(); goto('checkin'); break;
      case 'followup': store.addAction({ action: 'followup', episode_id: ep }); toast('Follow-up started: added to your follow-up list; the evidence packet joins the physician review queue when received on Earth.'); break;
      case 'contact': store.addAction({ action: 'contact_cmo', episode_id: ep }); toast('Simulated: onboard crew medical officer notified. No real person is contacted.'); break;
      case 'submit-checkin': {
        const d = ui.draft;
        store.addAction({ action: 'checkin', episode_id: d.episode_id, data: { symptoms: [...d.symptoms], stress: d.stress, fatigue: d.fatigue, concerns: d.concern } });
        ui.draft = freshDraft();
        toast('Check-in saved onboard and queued for Earth (simulated packet).');
        goto('followup');
        break;
      }
      default: break;
    }
  });

  // swipe
  let sx0 = null;
  screen.addEventListener('pointerdown', e => { if (!ui.overlay) sx0 = { x: e.clientX, y: e.clientY }; });
  screen.addEventListener('pointerup', e => {
    if (!sx0) return;
    const dx = e.clientX - sx0.x;
    const dy = e.clientY - sx0.y;
    sx0 = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) go(ui.page + (dx < 0 ? 1 : -1));
  });
  screen.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') { go(ui.page + 1); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { go(ui.page - 1); e.preventDefault(); }
    if (e.key === 'Escape' && ui.overlay) { ui.overlay = null; renderOverlay(); }
  });
  const crown = $('#w-crown', root);
  crown.addEventListener('click', () => { ui.overlay = null; renderOverlay(); go(0); });
  crown.addEventListener('wheel', e => { e.preventDefault(); go(ui.page + (e.deltaY > 0 ? 1 : -1)); }, { passive: false });
  $('#w-side', root).addEventListener('click', () => { ui.overlay = null; renderOverlay(); goto('alerts'); });

  // ---- demo walkthrough ----
  function renderDemo() {
    const STEPS = demoSteps(store);
    const host = $('#demo', root);
    if (!host) return;
    const m = store.model;
    const t = store.t;
    const w = store.watchView();
    const queued = store.packets.filter(p => p.created <= t && p.received > t);
    const recent = store.packets.filter(p => p.created <= t && p.kind !== 'daily_summary').slice(-6).reverse();
    host.innerHTML = `
      <section class="panel pitch">
        <h1>A watch that helps astronauts recognize changes, receive exposure alerts, and know when to get checked.</h1>
        <p>Connected to TERRA, white-blood-cell and ionizing-radiation research tools on Earth. Every value here is labeled as simulated, measured, or predicted.</p>
      </section>
      <section class="panel"><h2>Demo walkthrough</h2><p class="sub">Each step moves the shared mission clock; the watch, Earth charts and alerts stay in sync.</p>
        <ol class="steps">${STEPS.map((s, i) => `<li class="${ui.step === i ? 'active' : ''}"><div><b>${esc(s.title)}</b><p>${esc(s.caption)}</p></div><button class="btn small ${ui.step === i ? 'primary' : ''}" data-step="${i}">Go</button></li>`).join('')}</ol>
      </section>
      <section class="panel"><h2>Now</h2>
        <dl class="kv"><dt>Mission time</dt><dd>${esc(missionLabel(m.schedule, t, true))}</dd><dt>Phase</dt><dd>${esc(PHASE_LABEL[w.phase])}</dd><dt>Exposure region</dt><dd>${esc(REGION_LABEL[w.region])} <span class="sub">(trajectory setting)</span></dd>
        <dt>Dose rate</dt><dd>${fmt(w.rate, 2)} mSv/day · total ${fmt(w.dose, 1)} mSv</dd>
        <dt>Earth link</dt><dd>${w.linkUp ? 'up' : 'unavailable'} (simulated) · ${queued.length} packet(s) queued onboard</dd>
        <dt>Scenario</dt><dd>${esc(m.scenario.name)}</dd></dl>
        <div class="row" style="margin-top:10px"><button class="btn" data-nav-earth>Open dashboard →</button></div>
      </section>
      <section class="panel"><h2>Evidence packets</h2><p class="sub">Alerts and check-ins leave the watch as packets. Delivery depends on the simulated link; the ground view is stale until they arrive.</p>
        <div class="loglist">${recent.length ? recent.map(p => `<div><span>${esc(missionLabel(m.schedule, p.created, true))} · ${esc(p.summary)}</span><span class="sub">${esc(packetStatus(p, t))}</span></div>`).join('') : '<span class="sub">No packets yet.</span>'}</div>
      </section>
      <section class="panel"><h2>Simulated hardware</h2><p class="sub">AEROL wristband (proposed): PPG heart rate, pulse-rate variability, respiratory-rate and SpO₂ estimates, wrist skin temperature, 3-axis motion. Radiation comes from a <b>simulated connected personal dosimeter</b>, not the wrist sensors. TERRA and WBC require laboratory blood assays; the watch never measures them.</p></section>`;
  }

  root.addEventListener('click', e => {
    const s = e.target.closest('[data-step]');
    if (s) { runStep(Number(s.dataset.step)); return; }
    if (e.target.closest('[data-nav-earth]')) navigate('earth');
  });

  function runStep(i) {
    const s = demoSteps(store)[i];
    ui.step = i;
    store.play(false);
    store.setTime(s.t);
    if (s.page) goto(s.page);
    ui.overlay = s.open ? s.open : null;
    if (s.open) haptic(store.model.alerts.notifications.find(n => n.episode_id === s.open)?.severity);
    if (s.play) { store.setSpeed(s.play); store.play(true); }
    if (s.route) navigate(s.route, s.routeArgs);
    render();
  }

  // When the clock passes a new alert during playback, buzz and open it.
  function onFired(n) {
    if (!n) return;
    ui.overlay = n.episode_id;
    haptic(n.severity);
    if (n.severity === 'urgent') toast('Urgent alert on the watch.');
  }

  store.subscribe(() => renderThrottled());
  go(0);
  render();
  return { onFired, render, runStep, goto };
}

function freshDraft(episode_id = null) {
  return { symptoms: new Set(), stress: null, fatigue: null, concern: null, episode_id };
}

// Walkthrough: watch status → mission progression → exposure change → actionable watch alert →
// health-check workflow → Earth research review → landing and recovery.
export function demoSteps(store) {
  const m = store.model;
  const S = m.schedule;
  const ep = id => m.alerts.episodes.find(e => e.rule_id === id && e.start >= S.launch);
  const jump = ep('rad_rate_jump');
  const rhr = m.alerts.episodes.find(e => e.rule_id === 'phys_rhr_sustained' && e.start > S.launch + 60 * DAY && e.start < S.landing);
  const escT = rhr ? rhr.severity_history[rhr.severity_history.length - 1].t : S.launch + 97 * DAY;
  const outage = m.scenario.link.outages?.[0];
  const outEnd = outage ? S.launch + outage.end_day * DAY : escT + DAY;
  const beltStart = S.regionChanges.find(c => c.region === 'radiation_belt_transit')?.t ?? S.launch + 28 * DAY;
  return [
    { title: 'Watch status', caption: 'Flight day 18, inside the magnetosphere. Home shows mission time, recovery estimate, status and the top action.', t: S.launch + 18 * DAY + 9 * HOUR, page: 'home' },
    { title: 'Mission progression', caption: 'Play the shared clock at 12 h per second. It pauses automatically when a new alert fires.', t: S.launch + 26 * DAY, page: 'radiation', play: 12 * HOUR },
    { title: 'Exposure change', caption: 'Explicit trajectory events: belt transit, then magnetosphere exit. Dose rate steps from 0.7 to 1.84 mSv/day; biology does not jump instantly.', t: beltStart + 2 * HOUR, page: 'radiation' },
    { title: 'Actionable watch alert', caption: 'The alert states what changed, the reading, threshold, status and one next action.', t: (jump?.start ?? beltStart) + 3 * HOUR, page: 'home', open: jump?.episode_id },
    { title: 'Health-check workflow', caption: 'A sustained resting-HR rise escalates to Caution during a communication outage. Record symptoms, begin follow-up, contact onboard crew medical support.', t: escT + HOUR, page: 'home', open: rhr?.episode_id },
    { title: 'Earth research review', caption: 'After the outage, queued packets reach the (simulated) ground. Physicians review and message back; researchers check TERRA/WBC projections.', t: outEnd + 3 * HOUR, route: 'earth', routeArgs: { section: 'review' } },
    { title: 'Landing and recovery', caption: 'Dose plateaus at landing, the R+0 WBC result arrives (measured, simulated), and TERRA projections relax toward 1.0×.', t: S.landing + 1.3 * DAY, page: 'followup' },
  ];
}

export { SEVERITY_LABEL, actionSummary };
