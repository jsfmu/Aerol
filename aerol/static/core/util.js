// Shared, dependency-free helpers. Pure functions only (importable in Node tests).
export const HOUR = 3600000;
export const DAY = 86400000;
export const MINUTE = 60000;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, f) => a + (b - a) * f;
export const isNum = v => typeof v === 'number' && Number.isFinite(v);
export const round = (v, d = 2) => (isNum(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

export function smoothstep(x) {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

// Deterministic PRNG so every scenario run (watch, charts, alerts, tests) is reproducible.
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(next) {
  let u = 0;
  let v = 0;
  while (u === 0) u = next();
  while (v === 0) v = next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Stable hash for ids derived from content (FNV-1a, 32-bit).
export function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const iso = t => (isNum(t) ? new Date(t).toISOString() : null);

export function median(values) {
  const v = values.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function mean(values) {
  const v = values.filter(isNum);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// Binary search: index of last element with key <= t (or -1).
export function bisectRight(arr, t, key = x => x.t) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(arr[mid]) <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

// Linear interpolation over a uniform grid {t0, dt, values}.
export function sampleGrid(grid, t) {
  const x = (t - grid.t0) / grid.dt;
  if (x <= 0) return grid.values[0];
  const n = grid.values.length - 1;
  if (x >= n) return grid.values[n];
  const i = Math.floor(x);
  const f = x - i;
  const a = grid.values[i];
  const b = grid.values[i + 1];
  if (!isNum(a) || !isNum(b)) return f < 0.5 ? a : b;
  return a + (b - a) * f;
}

export function fmt(v, digits = 1, fallback = '—') {
  if (!isNum(v)) return fallback;
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function signed(v, digits = 0, unit = '') {
  if (!isNum(v)) return '—';
  const s = v > 0 ? '+' : v < 0 ? '−' : '±';
  return s + fmt(Math.abs(v), digits) + unit;
}

export const esc = value =>
  String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
