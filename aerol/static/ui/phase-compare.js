// "Compare with past missions" as charts: x-axis = the six mission phases. Each source keeps its own
// timing labels, cohort and origin (shown on hover). Sources are only drawn on a shared axis when they
// share a unit; observed data are points (never joined), projections/simulations are dashed lines.
import { isNum, fmt, signed, median } from '../core/util.js';
import { PHASES, PHASE_LABEL } from '../core/schedule.js';
import { twinsTerra, i4Wbc } from '../core/research.js';
import { esc } from './dom.js';
import { niceTicks } from './charts.js';

const COLORS = { sim: '#5fd0b0', proj: '#f0a24a', twins: '#b896e8', i4: '#79aef0', iss: '#e46b9a' };

function seriesData(research, model) {
  const rp = research.report_projection;
  const terraPct = [
    { id: 'proj', label: 'Combined report deep-space projection', note: 'illustrative model output, read by eye ±5 pp', origin: 'digitized projection', line: true,
      points: PHASES.filter(p => isNum(rp.terra_pct[p])).map(p => ({ phase: p, v: rp.terra_pct[p], label: PHASE_LABEL[p] })) },
    { id: 'sim', label: `Simulation · ${model.scenario.astronaut_id}`, note: 'simulated lab draws vs L-180', origin: 'simulation', line: true,
      points: model.labs.filter(l => l.kind === 'terra').map(l => ({ phase: l.phase, v: l.pct, label: l.label, t: l.t })) },
  ];
  const twins = [{ id: 'twins', label: 'NASA Twins Study · flight subject TW (n = 1)', note: 'raw normalized abundance ×10⁻³ — no pre-flight baseline, so no % change', origin: 'observed', line: false,
    points: twinsTerra(research).map(x => ({ phase: x.rec.mission_phase, v: x.v, label: x.label, t: x.t })) }];
  const byLabel = {};
  for (const x of i4Wbc(research)) (byLabel[x.label] ||= []).push(x);
  const i4 = Object.entries(byLabel).map(([label, xs]) => {
    const pcts = xs.map(x => x.rec.percent_change_from_baseline).filter(isNum);
    return { phase: xs[0].rec.mission_phase, v: median(pcts), label, t: xs[0].t, extra: `median of n=${pcts.length}; range ${signed(Math.min(...pcts), 0, '%')} to ${signed(Math.max(...pcts), 0, '%')} vs each crew member's L-92` };
  });
  const iss = research.records.filter(r => r.study_id === 'combined_radiation_report')
    .map(r => ({ phase: r.mission_phase, v: r.relative_change_percent, label: r.mission_day !== null ? `FD~${r.mission_day}` : `R+${r.return_day}`, t: (r.mission_day ?? 1000 + r.return_day) }));
  const wbcPct = [
    { id: 'i4', label: 'Inspiration4 (OSD-569) · 4 crew', note: 'median % change vs own L-92', origin: 'observed', line: false, points: i4 },
    { id: 'iss', label: 'ISS crew as plotted in the combined report', note: 'aggregate, read by eye ±5 pp; baseline not stated', origin: 'digitized', line: false, points: iss },
    { id: 'proj', label: 'Combined report deep-space projection', note: 'illustrative model output', origin: 'digitized projection', line: true,
      points: PHASES.map(p => ({ phase: p, v: rp.wbc_pct[p], label: PHASE_LABEL[p] })) },
    { id: 'sim', label: `Simulation · ${model.scenario.astronaut_id}`, note: 'simulated lab draws vs L-180', origin: 'simulation', line: true,
      points: model.labs.filter(l => l.kind === 'wbc').map(l => ({ phase: l.phase, v: l.pct_from_baseline, label: l.label, t: l.t })) },
  ];
  const crucian = { preflight: 'L-180 baseline', early_flight: 'WBC & granulocytes ↑ (significant)', mid_flight: 'elevated, not significant', late_flight: 'WBC ↑ (significant)', landing: 'WBC surge ~3 h after landing', after_return: 'R+30 sample' };
  return { terraPct, twins, wbcPct, crucian };
}

function phaseChart(series, { title, unit, height = 260, yFmt = v => signed(v, 0, '%'), zeroLine = true, notes = null }) {
  const W = 1000;
  const M = { l: 62, r: 14, t: 14, b: notes ? 64 : 34 };
  const colW = (W - M.l - M.r) / PHASES.length;
  const all = series.flatMap(s => s.points.map(p => p.v)).filter(isNum);
  let lo = Math.min(...all, zeroLine ? 0 : Infinity);
  let hi = Math.max(...all, zeroLine ? 0 : -Infinity);
  const pad = (hi - lo) * 0.1 || 1;
  lo -= pad; hi += pad;
  const y = v => M.t + (1 - (v - lo) / (hi - lo)) * (height - M.t - M.b);
  // x position: within each phase column, spread that series' points by time order
  const placed = series.map((s, si) => {
    const pts = [];
    for (const p of PHASES) {
      const inPhase = s.points.filter(q => q.phase === p && isNum(q.v)).sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
      inPhase.forEach((q, k) => {
        const f = (k + 1) / (inPhase.length + 1);
        const x = M.l + PHASES.indexOf(p) * colW + colW * (0.12 + 0.76 * f) + (si - (series.length - 1) / 2) * 4;
        pts.push({ ...q, x, y: y(q.v) });
      });
    }
    return { ...s, pts };
  });
  const ticks = niceTicks(lo, hi, 5);
  const parts = [];
  PHASES.forEach((p, i) => {
    const x0 = M.l + i * colW;
    parts.push(`<rect x="${x0}" y="${M.t}" width="${colW}" height="${height - M.t - M.b}" class="pc-col ${i % 2 ? 'odd' : ''}"/>`);
    parts.push(`<text class="xtick" x="${x0 + colW / 2}" y="${height - M.b + 18}">${esc(p === 'landing' ? 'Landing day' : PHASE_LABEL[p])}</text>`);
    if (notes?.[p]) parts.push(`<foreignObject x="${x0 + 4}" y="${height - M.b + 24}" width="${colW - 8}" height="40"><div class="pc-note">${esc(notes[p])}</div></foreignObject>`);
  });
  for (const v of ticks) parts.push(`<line class="grid" x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}"/><text class="ytick" x="${M.l - 6}" y="${y(v) + 3}">${esc(yFmt(v))}</text>`);
  if (zeroLine && lo < 0 && hi > 0) parts.push(`<line class="hline" x1="${M.l}" x2="${W - M.r}" y1="${y(0)}" y2="${y(0)}"/><text class="hline-label" x="${W - M.r - 4}" y="${y(0) - 4}">baseline 0%</text>`);
  for (const s of placed) {
    if (s.line && s.pts.length > 1) parts.push(`<path d="${s.pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('')}" fill="none" stroke="${COLORS[s.id]}" stroke-width="2" stroke-dasharray="6 4"/>`);
    for (const p of s.pts) {
      const tip = `${s.label} · ${p.label}: ${unit === '%' ? signed(p.v, 0, '%') : fmt(p.v, 2) + ' ' + unit}${p.extra ? ' · ' + p.extra : ''} · ${s.origin}`;
      const shape = s.line ? `<path d="M${p.x},${p.y - 5.5}L${p.x + 5.5},${p.y}L${p.x},${p.y + 5.5}L${p.x - 5.5},${p.y}Z"` : `<circle cx="${p.x}" cy="${p.y}" r="5"`;
      parts.push(`<g class="pc-pt">${shape} fill="${COLORS[s.id]}" stroke="var(--panel)" stroke-width="1.5"><title>${esc(tip)}</title>${s.line ? '</path>' : '</circle>'}<text x="${p.x}" y="${p.y - 9}" class="pc-lbl ${s.line ? 'hover-only' : ''}">${esc(p.label)}</text></g>`);
    }
  }
  const legend = series.map(s => `<span><i style="background:${COLORS[s.id]}${s.line ? '' : ';border-radius:50%'}"></i><b>${esc(s.label)}</b> <span class="sub">${esc(s.note)}</span></span>`).join('');
  return `<section class="panel"><h2>${esc(title)}</h2><div class="pc-legend">${legend}</div>
    <svg class="pc-chart tchart" viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(title)}">${parts.join('')}</svg></section>`;
}

export function phaseCompareHtml(research, model) {
  const d = seriesData(research, model);
  return `<p class="sub">Each column is a mission phase. Points keep their own timing (hover for exact sample time, cohort and origin); different studies and people are <b>not</b> paired. Observed data are dots, projections and simulations are diamonds on dashed lines.</p>
    ${phaseChart(d.terraPct, { title: 'TERRA · % change from baseline', unit: '%', notes: { landing: 'No landing-day TERRA value exists (none fabricated)' } })}
    ${phaseChart(d.twins, { title: 'TERRA · NASA Twins Study (real astronaut data, raw units)', unit: '×10⁻³', height: 200, yFmt: v => fmt(v, 1), zeroLine: false, notes: { preflight: 'No pre-flight sample in bundle', landing: 'No landing-day sample' } })}
    ${phaseChart(d.wbcPct, { title: 'White blood cells · % change from baseline', unit: '%', notes: Object.fromEntries(Object.entries(d.crucian).map(([k, v]) => [k, 'ISS study (n=23): ' + v])) })}`;
}
