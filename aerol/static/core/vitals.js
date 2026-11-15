// Simulated wristband stream (proposed device — no real hardware connected).
// 15-minute samples of HR, rest-qualified HR, PPG pulse-rate variability (RMSSD), respiratory
// rate, wrist SpO2, wrist skin temperature, movement and signal quality. Deterministic per seed.
import { DAY, HOUR, MINUTE, rng, gaussian, smoothstep, clamp, isNum, median, round } from './util.js';

export const STEP = 15 * MINUTE;

// RMSSD = sqrt( Σ (NN[i+1] − NN[i])² / (N−1) ), N = number of valid NN intervals in a run.
// Artifact handling: intervals outside 300–2000 ms are rejected; successive pairs whose change
// exceeds 20% of the preceding interval are excluded (ectopy/detection artifacts).
export function rmssd(nn, { minNN = 300, maxNN = 2000, maxRelDiff = 0.2, minPairs = 10 } = {}) {
  let sum = 0;
  let pairs = 0;
  let rejectedIntervals = 0;
  let rejectedPairs = 0;
  let prev = null;
  for (const x of nn) {
    if (!isNum(x) || x < minNN || x > maxNN) { rejectedIntervals++; prev = null; continue; }
    if (prev !== null) {
      const d = x - prev;
      if (Math.abs(d) / prev > maxRelDiff) rejectedPairs++;
      else { sum += d * d; pairs++; }
    }
    prev = x;
  }
  return {
    rmssd_ms: pairs >= minPairs ? Math.sqrt(sum / pairs) : null,
    pairs_used: pairs, rejected_intervals: rejectedIntervals, rejected_pairs: rejectedPairs,
    status: pairs >= minPairs ? 'ok' : 'insufficient_valid_intervals',
  };
}

const BASE = { sleep_hr: 52, wake_hr: 68, hrv: 52, resp: 14.5, spo2: 97.5, skin: 33.6, sleep_h: 7.6 };

function modifiers(schedule, sc, t) {
  const m = { drhr: 0, hrvMul: 1, dresp: 0, dskin: 0, dspo2: 0, sleepLoss: 0, worn: true, quality: 'good', spo2Artifact: false, episode: null };
  const day = (t - schedule.launch) / DAY;
  if (t >= schedule.stressOnset && t < schedule.launch) {
    const f = smoothstep((t - schedule.stressOnset) / (schedule.launch - schedule.stressOnset));
    m.drhr += 3 * f; m.hrvMul *= 1 - 0.1 * f; m.sleepLoss += 0.7 * f;
  }
  if (day >= 0 && day < 5 && t < schedule.landing) {
    const f = Math.exp(-day / 1.8);
    m.drhr += 6 * f; m.hrvMul *= 1 - 0.18 * f; m.sleepLoss += 1.6 * f;
  }
  if (t >= schedule.landing) {
    const r = (t - schedule.landing) / DAY;
    if (r < 6) { const f = Math.exp(-r / 1.6); m.drhr += 12 * f; m.hrvMul *= 1 - 0.25 * f; m.sleepLoss += 1.2 * f; }
  }
  for (const e of sc.vitals?.episodes || []) {
    if (day < e.start_day || day >= e.end_day) continue;
    const span = e.end_day - e.start_day;
    const x = (day - e.start_day) / span;
    if (e.kind === 'illness') {
      // ramps up, worsens on day ~1.5, then resolves
      const sev = x < 0.2 ? smoothstep(x / 0.2) : x < 0.7 ? 1 : 1 - smoothstep((x - 0.7) / 0.3);
      const worse = x >= 0.27 && x < 0.7 ? 1 : 0;
      m.drhr += 10 * sev + 7 * worse; m.hrvMul *= 1 - 0.38 * sev; m.dresp += 3.5 * sev; m.dskin += 0.9 * sev + 0.4 * worse; m.dspo2 -= 0.8 * sev; m.sleepLoss += 2 * sev;
      m.episode = e.kind;
    } else if (e.kind === 'sensor_fit') {
      m.quality = 'poor'; m.spo2Artifact = true; m.episode = e.kind;
    } else if (e.kind === 'disconnect') {
      m.worn = false; m.quality = null; m.episode = e.kind;
    }
  }
  return m;
}

// Nights are keyed by n = floor((t + 10 h) / day): night n spans [n·day − 10 h, n·day + 14 h) and its
// sleep is centered on n·day + 02:00 UTC (station time); duration shrinks symmetrically.
function sleepWindow(nightIndex, sleepH) {
  const mid = nightIndex * DAY + 2 * HOUR;
  return [mid - (sleepH / 2) * HOUR, mid + (sleepH / 2) * HOUR];
}

export function simulateVitals(schedule, sc) {
  const next = rng((sc.seed ^ 0x5eed) >>> 0);
  const t0 = Math.floor(schedule.start / DAY) * DAY;
  const n = Math.ceil((schedule.end - t0) / STEP);
  const S = {
    t0, step: STEP, n,
    t: new Float64Array(n), hr: new Array(n), rest_hr: new Array(n), hrv: new Array(n), resp: new Array(n),
    spo2: new Array(n), skin: new Array(n), move: new Array(n), quality: new Array(n), worn: new Array(n), asleep: new Array(n),
    hrv_meta: new Array(n),
  };
  const sleepCache = new Map();
  for (let i = 0; i < n; i++) {
    const t = t0 + i * STEP;
    S.t[i] = t;
    const m = modifiers(schedule, sc, t);
    const night = Math.floor((t + 10 * HOUR) / DAY);
    if (!sleepCache.has(night)) {
      const mm = modifiers(schedule, sc, night * DAY);
      sleepCache.set(night, sleepWindow(night, clamp(BASE.sleep_h - mm.sleepLoss + 0.45 * gaussian(next), 3.5, 9.5)));
    }
    const [s0, s1] = sleepCache.get(night);
    const asleep = t >= s0 && t < s1;
    if (!m.worn) {
      S.worn[i] = false; S.quality[i] = null; S.asleep[i] = null;
      S.hr[i] = S.rest_hr[i] = S.hrv[i] = S.resp[i] = S.spo2[i] = S.skin[i] = S.move[i] = null;
      S.hrv_meta[i] = null;
      continue;
    }
    const hour = new Date(t).getUTCHours();
    const exercise = !asleep && (hour === 9 || hour === 17) && next() < 0.8;
    const move = asleep ? 0.05 + 0.05 * next() : exercise ? 2.2 + next() : 0.35 + 0.4 * next();
    const base = asleep ? BASE.sleep_hr : BASE.wake_hr;
    const hr = base + m.drhr + (exercise ? 45 : 0) + 2.2 * gaussian(next);
    const restQualified = move < 0.3;
    const hrvTarget = Math.max(8, BASE.hrv * m.hrvMul * (asleep ? 1.15 : 0.9) * (exercise ? 0.4 : 1) * (1 + 0.08 * gaussian(next)));
    const meanNN = 60000 / hr;
    const sigma = hrvTarget / Math.SQRT2;
    const nn = [];
    for (let k = 0; k < 40; k++) nn.push(next() < 0.01 ? meanNN + 450 : meanNN + sigma * gaussian(next));
    const h = rmssd(nn);
    S.worn[i] = true;
    S.quality[i] = m.quality;
    S.asleep[i] = asleep;
    S.hr[i] = round(hr, 1);
    S.rest_hr[i] = restQualified ? round(hr, 1) : null;
    S.hrv[i] = h.rmssd_ms === null ? null : round(h.rmssd_ms, 1);
    S.hrv_meta[i] = { pairs: h.pairs_used, rejected: h.rejected_intervals + h.rejected_pairs };
    S.resp[i] = round(BASE.resp + m.dresp + (asleep ? -1.2 : 0.4) + (exercise ? 8 : 0) + 0.5 * gaussian(next), 1);
    S.spo2[i] = m.spo2Artifact ? round(87.5 + 1.5 * next(), 1) : round(clamp(BASE.spo2 + m.dspo2 + 0.5 * gaussian(next), 85, 100), 1);
    S.skin[i] = round(BASE.skin + m.dskin + (asleep ? 0.5 : 0) + 0.15 * gaussian(next), 2);
    S.move[i] = round(move, 2);
  }
  return S;
}

// Personal baseline from the baseline window (median of rest-qualified/sleep values).
export function vitalsBaseline(S, schedule) {
  const [a, b] = schedule.baselineWindow;
  const pick = (key, filter = () => true) => {
    const out = [];
    for (let i = 0; i < S.n; i++) if (S.t[i] >= a && S.t[i] < b && filter(i) && isNum(S[key][i])) out.push(S[key][i]);
    return out;
  };
  const rest = pick('rest_hr');
  const sleepRest = pick('hr', i => S.asleep[i] === true);
  const days = dailySummaries(S, schedule, null).filter(d => d.t >= a && d.t < b);
  return {
    window: [a, b],
    rhr: median(sleepRest.length ? sleepRest : rest),
    rest_hr: median(rest),
    hrv: median(pick('hrv', i => S.asleep[i] === true)),
    resp: median(pick('resp', i => S.asleep[i] === true)),
    spo2: median(pick('spo2', i => S.quality[i] === 'good')),
    skin: median(pick('skin', i => S.asleep[i] === true)),
    hrv_all: median(pick('hrv')),
    skin_all: median(pick('skin')),
    sleep_h: median(days.map(d => d.sleep_h)),
    n_samples: rest.length,
  };
}

// Daily summaries over 14:00→14:00 UTC windows (each holds one full night). Scores are DEMO
// ESTIMATES with visible inputs; null if coverage is insufficient.
export function dailySummaries(S, schedule, baseline, { minCoverage = 0.6 } = {}) {
  const perDay = DAY / S.step;
  const out = [];
  for (let i = Math.round(14 * HOUR / S.step); i + perDay <= S.n; i += perDay) {
    let worn = 0, sleep = 0, active = 0;
    const sleepHr = [], sleepHrv = [], rest = [], resp = [], skin = [];
    for (let k = i; k < i + perDay; k++) {
      if (!S.worn[k]) continue;
      worn++;
      if (S.asleep[k]) { sleep++; if (isNum(S.hr[k])) sleepHr.push(S.hr[k]); if (isNum(S.hrv[k])) sleepHrv.push(S.hrv[k]); if (isNum(S.resp[k])) resp.push(S.resp[k]); if (isNum(S.skin[k])) skin.push(S.skin[k]); }
      if (isNum(S.rest_hr[k])) rest.push(S.rest_hr[k]);
      if (S.move[k] > 1.5) active++;
    }
    const coverage = worn / perDay;
    const d = {
      t: S.t[i], coverage, sleep_h: round(sleep * S.step / HOUR, 2), active_min: active * S.step / MINUTE,
      rhr: median(sleepHr), hrv: median(sleepHrv), resp: median(resp), skin: median(skin),
      sleep_score: null, activity_score: null, stress: null, recovery: null, recovery_inputs: null, insufficient: coverage < minCoverage,
    };
    if (baseline && !d.insufficient && isNum(d.hrv) && isNum(d.rhr)) {
      const hrvC = clamp(50 + 50 * (d.hrv / baseline.hrv - 1) / 0.3, 0, 100);
      const rhrC = clamp(50 - 50 * (d.rhr - baseline.rhr) / 8, 0, 100);
      const sleepC = clamp(100 * d.sleep_h / 8, 0, 100);
      d.recovery = Math.round(0.4 * hrvC + 0.3 * rhrC + 0.3 * sleepC);
      d.recovery_inputs = { hrv_component: Math.round(hrvC), rhr_component: Math.round(rhrC), sleep_component: Math.round(sleepC),
        weights: { hrv: 0.4, rhr: 0.3, sleep: 0.3 }, hrv: d.hrv, rhr: d.rhr, sleep_h: d.sleep_h, coverage: round(coverage, 2) };
      d.sleep_score = Math.round(clamp(100 * d.sleep_h / 8, 0, 100));
      d.activity_score = Math.round(clamp(100 * d.active_min / 60, 0, 100));
      d.stress = Math.round(clamp(50 * (1 - d.hrv / baseline.hrv) / 0.3 + 25 * (d.rhr - baseline.rhr) / 8 + 25, 0, 100));
    }
    out.push(d);
  }
  return out;
}

export function sampleIndex(S, t) {
  const i = Math.floor((t - S.t0) / S.step);
  return i < 0 ? -1 : Math.min(i, S.n - 1);
}

// Latest reading at or before t; returns {missing:true} if the band is not reporting.
export function latestVitals(S, t) {
  const i = sampleIndex(S, t);
  if (i < 0) return { missing: true };
  if (!S.worn[i]) {
    let j = i;
    while (j >= 0 && !S.worn[j]) j--;
    return { missing: true, since: j >= 0 ? S.t[j + 1] : null };
  }
  let rest = null;
  for (let j = i; j >= Math.max(0, i - 16); j--) if (isNum(S.rest_hr[j])) { rest = S.rest_hr[j]; break; }
  return { missing: false, t: S.t[i], hr: S.hr[i], rest_hr: rest, hrv: S.hrv[i], resp: S.resp[i], spo2: S.spo2[i], skin: S.skin[i], move: S.move[i], quality: S.quality[i], asleep: S.asleep[i] };
}

// Rolling statistics over the trailing window ending at index i (for rules and watch trends).
export function trailing(S, key, i, hours, { requireGood = false } = {}) {
  const k0 = Math.max(0, i - Math.round(hours * HOUR / S.step) + 1);
  let sum = 0, n = 0, expected = i - k0 + 1;
  for (let k = k0; k <= i; k++) {
    if (!S.worn[k] || !isNum(S[key][k])) continue;
    if (requireGood && S.quality[k] !== 'good') continue;
    sum += S[key][k]; n++;
  }
  return { mean: n ? sum / n : null, n, coverage: expected ? n / expected : 0 };
}
