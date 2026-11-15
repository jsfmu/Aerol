// Shared mission transport: play/pause, speed, scrub, jump between events, scenario preset.
import { DAY, HOUR, iso } from '../core/util.js';
import { missionLabel, PHASE_LABEL, REGION_LABEL, phaseAt, regionAt, PRESETS } from '../core/schedule.js';
import { $, esc, toast } from './dom.js';

const SPEEDS = [
  [HOUR, '1 h/s'], [6 * HOUR, '6 h/s'], [12 * HOUR, '12 h/s'], [DAY, '1 day/s'], [3 * DAY, '3 days/s'], [7 * DAY, '1 week/s'],
];
const PRESET_LABELS = {
  'hypothesis-default': 'Hypothesis-driven mission (default)',
  'leo-only': 'Comparison: stays inside magnetosphere',
  'deep-whole': 'Comparison: beyond magnetosphere whole flight',
  'spe-event': 'Default + assumed solar particle event',
};

export function mountTransport(el, store) {
  el.innerHTML = `
    <div class="tp-controls">
      <button class="tp-btn" data-tp="prev" title="Previous event" aria-label="Previous event">⏮</button>
      <button class="tp-btn primary" data-tp="play" aria-label="Play mission clock">▶</button>
      <button class="tp-btn" data-tp="next" title="Next event" aria-label="Next event">⏭</button>
      <div class="tp-time" aria-live="off"><b id="tp-label"></b><small id="tp-sub"></small></div>
    </div>
    <div class="tp-track" id="tp-track" role="slider" tabindex="0" aria-label="Mission time" aria-valuemin="0" aria-valuemax="100">
      <div class="tp-rows"><div class="tp-row" id="tp-phases"></div><div class="tp-row" id="tp-regions"></div></div>
      <div id="tp-ticks"></div><div class="tp-head" id="tp-head"></div>
    </div>
    <div class="tp-side">
      <label class="sub" for="tp-speed">Speed</label>
      <select id="tp-speed">${SPEEDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <select id="tp-preset" aria-label="Scenario preset">${Object.keys(PRESETS).map(id => `<option value="${id}">${esc(PRESET_LABELS[id])}</option>`).join('')}<option value="custom" disabled>Custom (edited)</option></select>
      <button class="tp-btn" data-tp="reset" title="Reset workspace (clock, actions, scenario)">Reset</button>
    </div>`;
  const track = $('#tp-track', el);

  function layout() {
    const m = store.model;
    const { start, end } = m.schedule;
    const pct = t => `${((t - start) / (end - start)) * 100}%`;
    const width = t0 => t1 => `${((t1 - t0) / (end - start)) * 100}%`;
    $('#tp-phases', el).innerHTML = m.schedule.phases.map(p =>
      `<div class="tp-seg seg-${p.phase}" style="left:${pct(p.start)};width:${width(p.start)(p.end)}" title="${esc(PHASE_LABEL[p.phase])}">${esc(PHASE_LABEL[p.phase])}</div>`).join('');
    const rc = m.schedule.regionChanges;
    const regions = [];
    for (let i = 0; i < rc.length; i++) {
      const a = Math.max(start, rc[i].t);
      const b = i + 1 < rc.length ? Math.min(end, rc[i + 1].t) : end;
      if (b > a) regions.push({ region: rc[i].region, a, b });
    }
    $('#tp-regions', el).innerHTML = regions.map(r =>
      `<div class="tp-seg seg-${r.region}" style="left:${pct(r.a)};width:${width(r.a)(r.b)}" title="${esc(REGION_LABEL[r.region])}">${esc(REGION_LABEL[r.region])}</div>`).join('');
    $('#tp-ticks', el).innerHTML = m.alerts.notifications.filter(n => n.category !== 'research' && n.category !== 'schedule')
      .map(n => `<div class="tp-tick sev-${n.severity}" style="left:${pct(n.t)}" title="${esc(n.rule_label)} · ${esc(n.mission_label)}"></div>`).join('');
    const preset = $('#tp-preset', el);
    preset.value = PRESETS[store.state.scenarioId] ? store.state.scenarioId : 'custom';
  }

  function updateClock() {
    const m = store.model;
    const t = store.t;
    const { start, end } = m.schedule;
    $('#tp-head', el).style.left = `${((t - start) / (end - start)) * 100}%`;
    $('#tp-label', el).textContent = missionLabel(m.schedule, t, true);
    $('#tp-sub', el).textContent = `${iso(t).slice(0, 16).replace('T', ' ')} UTC · ${PHASE_LABEL[phaseAt(m.schedule, t)]} · ${REGION_LABEL[regionAt(m.schedule, t)]}`;
    const play = el.querySelector('[data-tp="play"]');
    play.textContent = store.state.clock.playing ? '❚❚' : '▶';
    play.setAttribute('aria-label', store.state.clock.playing ? 'Pause mission clock' : 'Play mission clock');
    track.setAttribute('aria-valuenow', String(Math.round(((t - start) / (end - start)) * 100)));
    track.setAttribute('aria-valuetext', missionLabel(m.schedule, t, true));
    $('#tp-speed', el).value = String(store.state.clock.speed);
  }

  function keyTimes() {
    const m = store.model;
    const s = new Set();
    for (const c of m.schedule.regionChanges) if (Number.isFinite(c.t)) s.add(c.t);
    for (const p of m.schedule.phases) s.add(p.start);
    for (const x of m.schedule.samples) s.add(x.t);
    for (const n of m.alerts.notifications) if (n.category !== 'research' && n.severity !== 'info') s.add(n.t);
    for (const l of m.labs) s.add(l.available);
    return [...s].filter(t => t >= m.schedule.start && t <= m.schedule.end).sort((a, b) => a - b);
  }

  let dragging = false;
  const scrubTo = e => {
    const r = track.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const { start, end } = store.model.schedule;
    store.setTime(start + f * (end - start));
  };
  track.addEventListener('pointerdown', e => { dragging = true; track.setPointerCapture(e.pointerId); store.play(false); scrubTo(e); });
  track.addEventListener('pointermove', e => { if (dragging) scrubTo(e); });
  track.addEventListener('pointerup', () => { dragging = false; });
  track.addEventListener('keydown', e => {
    const step = e.shiftKey ? 7 * DAY : DAY;
    if (e.key === 'ArrowRight') { store.setTime(store.t + step); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { store.setTime(store.t - step); e.preventDefault(); }
    if (e.key === ' ') { store.play(); e.preventDefault(); }
  });
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-tp]');
    if (!b) return;
    const act = b.dataset.tp;
    if (act === 'play') store.play();
    if (act === 'next') { const k = keyTimes().find(t => t > store.t + 60000); if (k) store.setTime(k + 1000); }
    if (act === 'prev') { const k = keyTimes().reverse().find(t => t < store.t - 60000); if (k) store.setTime(k + 1000); }
    if (act === 'reset' && confirm('Reset the workspace? This clears the clock position, astronaut/ground actions, edited scenario and brief stored in this browser.')) { store.reset(); toast('Workspace reset.'); }
  });
  $('#tp-speed', el).addEventListener('change', e => store.setSpeed(Number(e.target.value)));
  $('#tp-preset', el).addEventListener('change', e => { store.loadPreset(e.target.value); toast(`Scenario: ${PRESET_LABELS[e.target.value]}`); });

  store.subscribe(kind => { if (kind === 'state') layout(); updateClock(); });
  layout();
  updateClock();
  return { layout, updateClock };
}
