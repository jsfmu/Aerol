// Dashboard · Observed research mode. Source data keep their own units, timing and cohorts.
import { DAY, isNum, fmt, iso } from '../core/util.js';
import { PHASE_LABEL } from '../core/schedule.js';
import { twinsTerra, twinsPhases, dostelSegments, dostelCumulative, i4Wbc, correlationsTable, missionTimes } from '../core/research.js';
import { ChartGroup, TimeChart } from './charts.js';
import { $, esc } from './dom.js';

export function mountObserved(host, research) {
  if (!research) { host.innerHTML = '<div class="notice">Observed research bundle could not be loaded.</div>'; return { render() {} }; }
  const ui = { dataset: 'twins', detector: 'DosTel1' };
  host.innerHTML = `<div class="toolbar" id="ob-tools"></div><div id="ob-body"></div>`;

  function renderTools() {
    $('#ob-tools', host).innerHTML = `<div class="seg" role="group" aria-label="Observed dataset">
      <button data-ds="twins" aria-pressed="${ui.dataset === 'twins'}">NASA Twins Study · TERRA + ISS radiation</button>
      <button data-ds="i4" aria-pressed="${ui.dataset === 'i4'}">Inspiration4 · CBC (OSD-569)</button></div>
      ${ui.dataset === 'twins' ? `<label class="sub">Detector <select id="ob-det" class="btn small"><option ${ui.detector === 'DosTel1' ? 'selected' : ''}>DosTel1</option><option ${ui.detector === 'DosTel2' ? 'selected' : ''}>DosTel2</option></select></label>` : ''}
      <button class="btn small" data-ob="reset">Reset view</button>`;
  }

  let group = null;
  function renderTwins() {
    const tw = research.missions.twins;
    const { launch, landing } = missionTimes(tw);
    const label = t => (t < launch ? `L−${Math.ceil((launch - t) / DAY)}` : t < landing ? `FD${Math.floor((t - launch) / DAY)}` : `R+${Math.floor((t - landing) / DAY)}`);
    $('#ob-body', host).innerHTML = `<div class="notice" style="margin:8px 0">Observed data, one astronaut (TW). TERRA is in raw normalized-abundance units: no pre-flight personal baseline exists in the bundle, so no fold change is computed. Station dosimetry is an <b>area monitor</b> (absorbed dose, µGy/h) — not a personal dosimeter and not dose equivalent. Sparse samples are shown as points only, never interpolated.</div>
      <div class="charts"><div id="o-terra"></div><div id="o-rate"></div><div id="o-dose"></div><div id="o-strip"></div></div>
      <section class="panel" style="margin-top:10px"><h2>Exploratory association: station radiation vs TERRA (matched windows only)</h2><p class="sub">${esc(research.correlation_note)} Mean station dose rate over the window preceding each in-flight sample; FD334 excluded (&lt;80% coverage).</p>
      <table><thead><tr><th>Detector</th><th>Window</th><th>n</th><th>Pearson r</th><th>Spearman ρ</th><th>Partial r (linear flight day)</th></tr></thead><tbody>${correlationsTable(research).map(c => `<tr><td>${c.detector}</td><td>${c.window_days} d before sample</td><td>${c.n}</td><td>${fmt(c.r, 2)}</td><td>${fmt(c.rho, 2)}</td><td>${fmt(c.partial, 2)}</td></tr>`).join('')}</tbody></table>
      <p class="sub">Association and temporal order only — shared time trends, one subject and an environmental exposure proxy preclude causal or clinical conclusions.</p></section>`;
    const phases = twinsPhases(research);
    group = new ChartGroup({ domain: [launch - 20 * DAY, landing + 205 * DAY], formatTime: label });
    group.tickAnchor = launch;
    group.tipContext = t => `<div class="tipmeta">${esc(label(t))} · ${esc(iso(t).slice(0, 10))}</div>`;
    const terra = group.add(new TimeChart($('#o-terra', host), { height: 160, title: 'TERRA (UUAGGG) · real astronaut data (NASA Twins Study)', unit: 'normalized abundance ×10⁻³ (raw)', yFormat: v => fmt(v, 2) }));
    const rate = group.add(new TimeChart($('#o-rate', host), { height: 120, title: `Station absorbed dose rate · ${ui.detector}`, unit: 'µGy/h (daily time-weighted mean; gaps = no coverage)', yFormat: v => fmt(v, 1) }));
    const cum = dostelCumulative(research, ui.detector);
    const dose = group.add(new TimeChart($('#o-dose', host), { height: 110, title: 'Station radiation total (area monitor, covered hours only)', unit: 'mGy — not personal, not mSv', zeroBased: true, yFormat: v => fmt(v, 0), note: `${fmt(cum.missingHours, 0)} uncovered hours are not filled` }));
    const strip = group.add(new TimeChart($('#o-strip', host), { height: 70, title: 'Phases (thirds of flight) · solar proton events (GOES, not ISS dose)', kind: 'strip' }));
    terra.setLayers([{ type: 'points', cls: 'c-obs', points: twinsTerra(research).map(p => ({ t: p.t, v: p.v, tip: `<b>${esc(p.label)}</b> · ${esc(p.rec.time_window_start.slice(0, 10))}<br>${fmt(p.v, 3)} ×10⁻³ normalized abundance<br>${esc(PHASE_LABEL[p.rec.mission_phase])}<div class="tipmeta">Observed · ${esc(p.rec.source_reference)} · ${esc(p.rec.quality_flag)}</div>` })) }]);
    rate.setLayers([{ type: 'step', segments: dostelSegments(research, ui.detector).map(s => ({ ...s, v: s.eligible ? s.v : null })).filter(s => isNum(s.v)), cls: 'c-rate', tipLabel: 'Daily mean', tipUnit: 'µGy/h' }]);
    dose.setLayers([{ type: 'line', points: cum.points, cls: 'c-dose' }]);
    const sep = research.records.filter(r => r.event_type === 'solar_particle_event');
    strip.rowLabels = [{ label: 'Phase', y0: 10, y1: 30 }, { label: 'Events', y0: 34, y1: 52 }];
    strip.setLayers([
      { type: 'spans', row: [10, 30], labels: true, spans: phases.map(p => ({ start: p.start, end: p.end, cls: 'seg-' + p.phase, label: PHASE_LABEL[p.phase] })) },
      { type: 'markers', row: [34, 52], markers: [{ id: 'launch', t: launch, label: 'Launch (Soyuz TMA-16M)', glyph: '▲' }, { id: 'landing', t: landing, label: 'Landing (Soyuz TMA-18M)', glyph: '▼' },
        ...sep.map(e => ({ id: e.event_id, t: Date.parse(e.start_time), label: `${e.observed_change} — catalog marker, not ISS dose`, glyph: '☀' }))] },
    ]);
  }

  function renderI4() {
    const m = research.missions.inspiration4;
    const { launch, landing } = missionTimes(m);
    const label = t => (t < launch ? `L−${Math.round((launch - t) / DAY)}` : t < landing ? 'flight' : `R+${Math.round((t - landing) / DAY)}`);
    const pts = i4Wbc(research);
    const subj = ['C001', 'C002', 'C003', 'C004'];
    $('#ob-body', host).innerHTML = `<div class="notice" style="margin:8px 0">Observed CBC for four Inspiration4 crew (3-day flight). Each subject is shown separately; no in-flight samples exist; R+1 is the closest sample to landing. These are different people from the Twins Study and are not paired with it.</div>
      <div class="legend">${subj.map((s, i) => `<span><span class="shape" style="background:var(--s${i + 1},${['#2b6cb0', '#c0568f', '#2f9e8f', '#a8731f'][i]})"></span>${s}</span>`).join('')}<span>shaded: lab reference range reported in the file</span></div>
      <div class="charts"><div id="o-wbc"></div><div id="o-neut"></div><div id="o-lymph"></div></div>`;
    group = new ChartGroup({ domain: [launch - 100 * DAY, landing + 200 * DAY], formatTime: label });
    group.tickAnchor = launch;
    const mk = (id, title, key, lo, hi) => {
      const c = group.add(new TimeChart($(id, host), { height: 150, title, unit: '×10⁹/L', yFormat: v => fmt(v, 1) }));
      const layers = [{ type: 'hband', lo, hi, label: 'Lab reference range' }];
      subj.forEach((s, i) => layers.push({ type: 'points', cls: 's' + (i + 1), points: pts.filter(p => p.subject === s).map(p => {
        const v = key ? p.rec.differential_absolute?.[key] : p.v;
        return { t: p.t, v, tip: `<b>${s} · ${esc(p.label)}</b><br>${fmt(v, 2)} ×10⁹/L${key ? '' : ` (${p.rec.percent_change_from_baseline >= 0 ? '+' : ''}${fmt(p.rec.percent_change_from_baseline, 0)}% vs L-92)`}<div class="tipmeta">Observed · OSD-569 · ${esc(PHASE_LABEL[p.rec.mission_phase])} · clock time unknown</div>` };
      }) }));
      c.setLayers(layers);
    };
    const r0 = pts[0].rec;
    mk('#o-wbc', 'Total WBC', null, r0.lab_reference_low, r0.lab_reference_high);
    mk('#o-neut', 'Neutrophils (absolute)', 'neutrophils', 1.5, 7.8);
    mk('#o-lymph', 'Lymphocytes (absolute)', 'lymphocytes', 0.85, 3.9);
  }

  function render() {
    renderTools();
    if (ui.dataset === 'twins') renderTwins(); else renderI4();
  }
  host.addEventListener('click', e => {
    const ds = e.target.closest('[data-ds]');
    if (ds) { ui.dataset = ds.dataset.ds; render(); }
    if (e.target.closest('[data-ob="reset"]')) group?.reset();
  });
  host.addEventListener('change', e => { if (e.target.id === 'ob-det') { ui.detector = e.target.value; render(); } });
  render();
  return { render, resize: () => group?.renderAll() };
}
