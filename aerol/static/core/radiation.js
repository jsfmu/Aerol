// Ionizing-radiation arithmetic. Three separate quantities:
//   r(t)  dose rate                      mSv/day   (dose-equivalent reference in the scenario)
//   D(t)  accumulated mission dose       mSv       (same quantity as r)
//   dr/dt change in dose rate            mSv/day²  (step changes reported per transition)
// r(t) = dD/dt. For piecewise-constant intervals D(t+Δt) = D(t) + r(t)·Δt_days.
import { DAY, HOUR, isNum, round } from './util.js';
import { REGION_LABEL } from './schedule.js';

export const QUANTITIES = {
  scenario_dose_equivalent: {
    label: 'Dose equivalent (scenario reference)', rate_unit: 'mSv/day', total_unit: 'mSv',
    note: 'Scenario reference values in the style of MSL RAD / ISS dose-equivalent rates. Not NASA effective dose, not organ dose, not a personal record.',
  },
  station_absorbed: {
    label: 'Absorbed dose (ISS area monitor, DosTel)', rate_unit: 'µGy/h', total_unit: 'mGy',
    note: 'Measured absorbed dose rate in silicon at a station location. Not a personal dosimeter and not dose equivalent.',
  },
  nasa_effective: {
    label: 'NASA effective dose', total_unit: 'mSv',
    note: 'Quantity used by the NASA career limit (600 mSv, NASA Q, 2012 cancer model). Not directly comparable with other dose quantities without a documented conversion.',
  },
};

export const REGION_RATE_KEY = { ground: null, inside_magnetosphere: 'inside', radiation_belt_transit: 'belt', beyond_magnetosphere: 'beyond', unknown: null };

// Piecewise-constant mission-attributable dose-rate segments, split at every exposure transition.
export function buildSegments(schedule, scenario) {
  const bounds = new Set([schedule.start, schedule.end]);
  for (const c of schedule.regionChanges) if (isNum(c.t) && c.t > schedule.start && c.t < schedule.end) bounds.add(c.t);
  let spe = null;
  if (scenario.spe?.enabled) {
    const s = schedule.launch + scenario.spe.day * DAY;
    const e = s + scenario.spe.duration_h * HOUR;
    spe = { start: s, end: e, rate: scenario.spe.dose_mSv / (scenario.spe.duration_h / 24) };
    bounds.add(s); bounds.add(e);
  }
  const edges = [...bounds].sort((a, b) => a - b);
  const segments = [];
  let D = 0;
  for (let i = 0; i < edges.length - 1; i++) {
    const start = edges[i];
    const end = edges[i + 1];
    if (end <= start) continue;
    const mid = (start + end) / 2;
    let region = 'unknown';
    for (const c of schedule.regionChanges) { if (c.t <= mid) region = c.region; else break; }
    const key = REGION_RATE_KEY[region];
    const background = key ? scenario.dose[key] : 0; // after landing: mission-attributable rate is 0 (Earth background is not zero; it is outside this ledger)
    const speRate = spe && mid >= spe.start && mid < spe.end ? spe.rate : 0;
    const rate = background + speRate;
    segments.push({ start, end, rate, region, components: { background, spe: speRate }, D0: D });
    D += rate * (end - start) / DAY;
  }
  return segments;
}

function segIndex(segments, t) {
  let lo = 0;
  let hi = segments.length - 1;
  if (t < segments[0].start) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].start <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function rateAt(segments, t) {
  const i = segIndex(segments, t);
  if (i < 0 || t >= segments[segments.length - 1].end) return 0;
  return segments[i].rate;
}

// Exact integral of the piecewise-constant rate from the first segment to t.
export function doseAt(segments, t) {
  const i = segIndex(segments, t);
  if (i < 0) return 0;
  const s = segments[i];
  return s.D0 + s.rate * (Math.min(t, s.end) - s.start) / DAY;
}

export const doseBetween = (segments, a, b) => doseAt(segments, b) - doseAt(segments, a);
export const rollingDose = (segments, t, days) => doseBetween(segments, t - days * DAY, t);

// Rate transitions (dr) at segment boundaries, for annotating step changes.
export function rateSteps(segments) {
  const out = [];
  for (let i = 1; i < segments.length; i++) {
    const dr = segments[i].rate - segments[i - 1].rate;
    if (Math.abs(dr) > 1e-12) out.push({ t: segments[i].start, from: segments[i - 1].rate, to: segments[i].rate, dr, region: segments[i].region, region_label: REGION_LABEL[segments[i].region] });
  }
  return out;
}

// Integrate an arbitrary piecewise-constant list [{days, rate}] — used for the worked checks.
export function integratePieces(pieces) {
  let D = 0;
  for (const p of pieces) D += p.rate * p.days;
  return D;
}

export function workedChecks() {
  const a = integratePieces([{ days: 7, rate: 0.7 }, { days: 3, rate: 1.84 }]);
  const b = integratePieces([{ days: 340, rate: 1.84 }]);
  return [
    { id: 'mixed_10_day', description: '7 days at 0.7 mSv/day, then 3 days at 1.84 mSv/day', expected: 10.42, computed: round(a, 6),
      working: '7 × 0.7 = 4.90 mSv; 3 × 1.84 = 5.52 mSv; total 10.42 mSv', pass: Math.abs(a - 10.42) < 1e-9 },
    { id: 'constant_340_day', description: 'Separate hypothetical: constant 1.84 mSv/day for 340 days', expected: 625.6, computed: round(b, 6),
      working: '340 × 1.84 = 625.60 mSv. Arithmetic projection only — the NASA Twins Study (ISS) recorded 76.18 mGy physical dosimeter dose and 146.34 mSv effective dose.', pass: Math.abs(b - 625.6) < 1e-9 },
  ];
}

// ----- Ingest irregular dosimeter readings -----
// readings: [{t, device_id, kind: 'rate'|'cumulative', value, unit, interval_start?, interval_end?}]
// Units: rate in mSv/day or µSv/h (same quantity, scale only); cumulative in mSv or µSv.
// Absorbed-dose units (Gy) are rejected: relabeling Gy as Sv needs a documented quality factor.
const RATE_SCALE = { 'mSv/day': 1, 'µSv/h': 24 / 1000, 'uSv/h': 24 / 1000 };
const TOTAL_SCALE = { mSv: 1, 'µSv': 1 / 1000, uSv: 1 / 1000 };

export function ingestReadings(readings, { maxGapHours = 2, transitions = [] } = {}) {
  const report = { total_mSv: 0, increments: [], gaps: [], resets: [], duplicates_dropped: 0, conflicts: [], rejected: [], notes: [], coverage_hours: 0, series: [] };
  const clean = [];
  const seen = new Map();
  for (const r of readings) {
    if (!isNum(r.t) || !isNum(r.value)) { report.rejected.push({ reading: r, reason: 'missing timestamp or value (null is kept as missing, never zero)' }); continue; }
    const scale = r.kind === 'rate' ? RATE_SCALE[r.unit] : TOTAL_SCALE[r.unit];
    if (!scale) { report.rejected.push({ reading: r, reason: `unit ${r.unit} is not a supported dose-equivalent unit for kind ${r.kind}; absorbed dose (Gy) is not relabeled as Sv` }); continue; }
    const key = `${r.device_id}|${r.kind}|${r.t}`;
    const v = r.value * scale;
    if (seen.has(key)) {
      if (Math.abs(seen.get(key) - v) < 1e-12) report.duplicates_dropped++;
      else report.conflicts.push({ t: r.t, device_id: r.device_id, kept: seen.get(key), dropped: v });
      continue;
    }
    seen.set(key, v);
    clean.push({ ...r, v });
  }
  const devices = [...new Set(clean.map(r => r.device_id))];
  const maxGap = maxGapHours * HOUR;
  const tx = [...transitions].sort((a, b) => a - b);
  for (const device of devices) {
    const rows = clean.filter(r => r.device_id === device).sort((a, b) => a.t - b.t);
    const cumulative = rows.filter(r => r.kind === 'cumulative');
    const rates = rows.filter(r => r.kind === 'rate');
    if (cumulative.length >= 2) {
      if (rates.length) report.notes.push(`${device}: ${rates.length} rate readings ignored because a cumulative counter covers the same device (prevents double counting).`);
      for (let i = 1; i < cumulative.length; i++) {
        const a = cumulative[i - 1];
        const b = cumulative[i];
        let dose = b.v - a.v;
        let method = 'cumulative_difference';
        if (dose < 0) {
          // Counter restarted between readings: b.v is dose since the restart (a lower bound for the interval);
          // dose between the last pre-reset readout and the restart was not recorded and is reported, not guessed.
          report.resets.push({ device_id: device, t: b.t, before: a.v, after: b.v });
          report.gaps.push({ device_id: device, t0: a.t, t1: b.t, reason: 'counter_reset_unrecorded_interval' });
          dose = b.v; method = 'counter_reset';
        }
        if (b.t - a.t > maxGap) report.notes.push(`${device}: ${((b.t - a.t) / HOUR).toFixed(1)} h between counter readings at ${new Date(a.t).toISOString()} — counter still captures dose in the gap.`);
        report.increments.push({ device_id: device, t0: a.t, t1: b.t, dose, method });
        report.coverage_hours += (b.t - a.t) / HOUR;
      }
      continue;
    }
    const withIntervals = rates.filter(r => isNum(r.interval_start) && isNum(r.interval_end));
    const instants = rates.filter(r => !(isNum(r.interval_start) && isNum(r.interval_end)));
    let lastEnd = -Infinity;
    for (const r of withIntervals.sort((a, b) => a.interval_start - b.interval_start)) {
      const start = Math.max(r.interval_start, lastEnd);
      if (start > r.interval_start) report.notes.push(`${device}: overlapping interval trimmed at ${new Date(r.interval_start).toISOString()}.`);
      if (r.interval_end <= start) continue;
      if (isFinite(lastEnd) && start - lastEnd > maxGap) report.gaps.push({ device_id: device, t0: lastEnd, t1: start });
      const dose = r.v * (r.interval_end - start) / DAY;
      report.increments.push({ device_id: device, t0: start, t1: r.interval_end, dose, method: 'rate_x_interval' });
      report.coverage_hours += (r.interval_end - start) / HOUR;
      lastEnd = r.interval_end;
    }
    for (let i = 1; i < instants.length; i++) {
      const a = instants[i - 1];
      const b = instants[i];
      if (b.t - a.t > maxGap) { report.gaps.push({ device_id: device, t0: a.t, t1: b.t }); continue; }
      const cut = tx.find(x => x > a.t && x < b.t);
      const dose = isNum(cut)
        ? (a.v * (cut - a.t) + b.v * (b.t - cut)) / DAY // split at the exposure transition instead of smoothing across it
        : ((a.v + b.v) / 2) * (b.t - a.t) / DAY;
      report.increments.push({ device_id: device, t0: a.t, t1: b.t, dose, method: isNum(cut) ? 'split_at_transition' : 'trapezoid' });
      report.coverage_hours += (b.t - a.t) / HOUR;
    }
  }
  report.increments.sort((a, b) => a.t1 - b.t1);
  let D = 0;
  for (const inc of report.increments) { D += inc.dose; report.series.push({ t: inc.t1, D }); }
  report.total_mSv = D;
  return report;
}

// Simulated connected personal dosimeter: hourly cumulative counter readings derived from the
// scenario dose-rate profile, including one demonstration counter reset after a battery swap.
export function simulateDosimeter(segments, schedule, { stepHours = 1, resetAtDay = 75, device_id = 'SIM-DOSI-01' } = {}) {
  const out = [];
  const t0 = schedule.launch - 2 * DAY;
  const t1 = schedule.landing + 2 * DAY;
  let offset = 0;
  const resetT = isNum(resetAtDay) ? schedule.launch + resetAtDay * DAY + 20 * 60000 : null; // battery swap 20 min after a readout
  let didReset = false;
  for (let t = t0; t <= t1; t += stepHours * HOUR) {
    if (resetT && !didReset && t >= resetT) { offset = doseAt(segments, t); didReset = true; }
    out.push({ t, device_id, kind: 'cumulative', unit: 'mSv', value: doseAt(segments, t) - offset, simulated: true });
  }
  return out;
}
