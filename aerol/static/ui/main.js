// Entry point: one store, one clock, two experiences (watch / Earth dashboard).
import { Store, linkUp } from '../core/store.js';
import { missionLabel } from '../core/schedule.js';
import { $, $$, esc, toast } from './dom.js';
import { mountTransport } from './transport.js';
import { mountWatchPage } from './watch.js';
import { mountEarth } from './earth.js';

const store = new Store();
let research = null;
let watch = null;
let earth = null;

function routeFromPath() {
  const p = location.pathname;
  if (p.startsWith('/earth')) return 'earth';
  if (p.startsWith('/mobile')) return 'watch-only';
  return 'watch';
}

let route = routeFromPath();

function navigate(to, args = {}) {
  const path = to === 'earth' ? '/earth/' : '/';
  if (location.pathname !== path) history.pushState({}, '', path);
  route = to;
  show(args);
}

function show(args = {}) {
  document.body.classList.toggle('watch-only', route === 'watch-only');
  const isEarth = route === 'earth';
  $('#watch-app').hidden = isEarth;
  $('#earth-app').hidden = !isEarth;
  $$('.modeswitch a').forEach(a => a.setAttribute('aria-current', a.dataset.route === (isEarth ? 'earth' : 'watch') ? 'page' : 'false'));
  if (isEarth) {
    if (!earth) earth = mountEarth($('#earth-app'), store, { research, navigate });
    earth.show(args);
  } else if (!watch) {
    watch = mountWatchPage($('#watch-app'), store, { navigate, watchOnly: route === 'watch-only' });
  } else watch.render();
  document.title = isEarth ? 'AEROL · Earth dashboard' : 'AEROL · Astronaut watch';
}

function renderStatus() {
  const m = store.model;
  const t = store.t;
  const up = linkUp(m, t);
  const g = store.groundView(t);
  const stale = g.stalenessMs === null ? '—' : `${Math.round(g.stalenessMs / 3600000)} h`;
  $('#appbar-status').innerHTML = `<span class="pill"><span class="dot ${up ? '' : 'down'}"></span>Earth link ${up ? 'up' : 'unavailable'} (simulated)</span>
    <span class="pill">Ground view lag ${esc(stale)} · ${g.queued.length} queued</span><span class="pill">${esc(missionLabel(m.schedule, t, true))}</span>`;
}

async function boot() {
  try {
    const res = await fetch('/data/research.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    research = await res.json();
    $('#foot-data').textContent = `Observed research data bundled ${research.built} · ${research.records.length + research.dostel_daily.rows.length} validated records`;
  } catch (err) {
    research = null;
    $('#foot-data').textContent = 'Observed research bundle unavailable offline — simulation still works.';
  }
  mountTransport($('#transport'), store);
  document.addEventListener('click', e => {
    const a = e.target.closest('.modeswitch a');
    if (!a) return;
    e.preventDefault();
    navigate(a.dataset.route);
  });
  window.addEventListener('popstate', () => { route = routeFromPath(); show(); });
  store.subscribe(() => renderStatus());
  show();
  renderStatus();
  let last = performance.now();
  const frame = now => {
    const dt = Math.min(250, now - last);
    last = now;
    if (store.state.clock.playing) {
      const fired = store.tick(dt);
      if (fired && watch && route !== 'earth') watch.onFired(fired);
      if (fired && route === 'earth') toast(`Watch alert at ${fired.mission_label}: ${fired.rule_label} (${fired.severity}). Clock paused.`);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

boot();
window.aerol = { store };
