// Minimal synchronized SVG time-chart engine: shared view (zoom/pan), shared hover, mission cursor,
// interval selection, tooltips, clickable markers. No dependencies.
import { esc, isNum, fmt } from '../core/util.js';

const M = { left: 62, right: 14, top: 10, bottom: 22 };
const NS = 'http://www.w3.org/2000/svg';

export class ChartGroup {
  constructor({ domain, formatTime, onCursor, onMarker, onSelect }) {
    this.domain = domain;
    this.view = { t0: domain[0], t1: domain[1] };
    this.charts = [];
    this.hover = null;
    this.cursor = null;
    this.selection = null;
    this.selectMode = false;
    this.formatTime = formatTime;
    this.onCursor = onCursor;
    this.onMarker = onMarker;
    this.onSelect = onSelect;
  }
  add(chart) { chart.group = this; this.charts.push(chart); return chart; }
  setDomain(domain, keepView = false) {
    this.domain = domain;
    if (!keepView) this.view = { t0: domain[0], t1: domain[1] };
    this.renderAll();
  }
  zoom(factor, center) {
    const { t0, t1 } = this.view;
    const c = center ?? (t0 + t1) / 2;
    const span = Math.max(6 * 3600000, (t1 - t0) * factor);
    let a = c - (c - t0) * span / (t1 - t0);
    let b = a + span;
    const [d0, d1] = this.domain;
    if (span >= d1 - d0) { a = d0; b = d1; }
    else if (a < d0) { a = d0; b = d0 + span; }
    else if (b > d1) { b = d1; a = d1 - span; }
    this.view = { t0: a, t1: b };
    this.renderAll();
  }
  pan(dt) {
    const [d0, d1] = this.domain;
    const span = this.view.t1 - this.view.t0;
    let a = Math.min(Math.max(d0, this.view.t0 + dt), d1 - span);
    this.view = { t0: a, t1: a + span };
    this.renderAll();
  }
  reset() { this.view = { t0: this.domain[0], t1: this.domain[1] }; this.selection = null; this.renderAll(); this.onSelect?.(null); }
  focus(t0, t1) { this.view = { t0: Math.max(this.domain[0], t0), t1: Math.min(this.domain[1], t1) }; this.renderAll(); }
  setHover(t, source) { this.hover = t; for (const c of this.charts) c.renderOverlay(c === source); }
  setCursor(t) { this.cursor = t; for (const c of this.charts) c.renderOverlay(false); }
  setSelection(sel) { this.selection = sel; for (const c of this.charts) c.renderOverlay(false); this.onSelect?.(sel); }
  renderAll() { for (const c of this.charts) c.render(); }
}

export class TimeChart {
  constructor(el, { height = 150, title = '', unit = '', yFormat = v => fmt(v, 1), yDomain = null, zeroBased = false, note = '', kind = 'xy' } = {}) {
    this.el = el;
    this.height = height;
    this.title = title;
    this.unit = unit;
    this.yFormat = yFormat;
    this.yDomain = yDomain;
    this.zeroBased = zeroBased;
    this.note = note;
    this.kind = kind;
    this.layers = [];
    el.classList.add('tchart');
    el.innerHTML = `<div class="tchart-head"><span class="tchart-title">${esc(title)}</span><span class="tchart-unit">${esc(unit)}</span><span class="tchart-note">${esc(note)}</span></div>
      <div class="tchart-body"><svg xmlns="${NS}" class="tchart-svg" role="img" aria-label="${esc(title)} over mission time"><g class="base"></g><g class="overlay"></g></svg><div class="tchart-tip" hidden></div></div>`;
    this.svg = el.querySelector('svg');
    this.base = el.querySelector('.base');
    this.overlay = el.querySelector('.overlay');
    this.tip = el.querySelector('.tchart-tip');
    this.bind();
  }

  setLayers(layers) { this.layers = layers; this.render(); }

  get width() { return Math.max(280, this.el.querySelector('.tchart-body').clientWidth || 600); }
  x(t) { const { t0, t1 } = this.group.view; return M.left + (t - t0) / (t1 - t0) * (this.width - M.left - M.right); }
  tAt(px) { const { t0, t1 } = this.group.view; return t0 + (px - M.left) / (this.width - M.left - M.right) * (t1 - t0); }
  y(v) { const [a, b] = this.yd; return this.height - M.bottom - (v - a) / (b - a) * (this.height - M.top - M.bottom); }

  computeY() {
    if (this.kind === 'strip') { this.yd = [0, 1]; return; }
    if (this.yDomain) { this.yd = this.yDomain; return; }
    const { t0, t1 } = this.group.view;
    let lo = Infinity, hi = -Infinity;
    const take = v => { if (isNum(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
    for (const L of this.layers) {
      if (L.hidden) continue;
      if (L.type === 'line' && L.grid) { const [i0, i1] = gridRange(L.grid, t0, t1); for (let i = i0; i <= i1; i++) take(L.grid.values[i]); }
      if (L.type === 'line' && L.points) for (const p of L.points) if (p.t >= t0 && p.t <= t1) take(p.v);
      if (L.type === 'band') { const [i0, i1] = gridRange(L.lo, t0, t1); for (let i = i0; i <= i1; i++) { take(L.lo.values[i]); take(L.hi.values[i]); } }
      if (L.type === 'points') for (const p of L.points) if (p.t >= t0 && p.t <= t1) take(p.v);
      if (L.type === 'step') for (const s of L.segments) if (s.end >= t0 && s.start <= t1) take(s.v);
      if (L.type === 'hline' && L.inDomain !== false) take(L.v);
      if (L.type === 'hband') { take(L.lo); take(L.hi); }
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (this.zeroBased) lo = Math.min(0, lo);
    if (hi - lo < 1e-9) { hi += 1; lo -= this.zeroBased ? 0 : 1; }
    const pad = (hi - lo) * 0.08;
    this.yd = [this.zeroBased && lo >= 0 ? 0 : lo - pad, hi + pad];
  }

  render() {
    if (!this.group) return;
    const W = this.width;
    const H = this.height;
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.svg.setAttribute('height', H);
    this.computeY();
    const { t0, t1 } = this.group.view;
    const parts = [];
    parts.push(`<defs><clipPath id="clip-${this.uid()}"><rect x="${M.left}" y="${M.top - 2}" width="${W - M.left - M.right}" height="${H - M.top - M.bottom + 4}"/></clipPath></defs>`);
    // spans (background)
    for (const L of this.layers) if (L.type === 'spans' && !L.hidden) {
      for (const s of L.spans) {
        if (s.end < t0 || s.start > t1) continue;
        const a = Math.max(M.left, this.x(s.start)); const b = Math.min(W - M.right, this.x(s.end));
        const y0 = L.row ? L.row[0] : M.top; const y1 = L.row ? L.row[1] : H - M.bottom;
        parts.push(`<rect class="span ${esc(s.cls || '')}" x="${a}" y="${y0}" width="${Math.max(0, b - a)}" height="${y1 - y0}"><title>${esc(s.label || '')}</title></rect>`);
        if (L.labels && b - a > 46) parts.push(`<text class="span-label" x="${a + 4}" y="${y0 + (y1 - y0) / 2 + 3}">${esc(shorten(s.short || s.label, (b - a) / 6))}</text>`);
      }
    }
    if (this.kind !== 'strip') {
      // y grid
      const ticks = niceTicks(this.yd[0], this.yd[1], Math.max(2, Math.floor((H - M.top - M.bottom) / 32)));
      for (const v of ticks) parts.push(`<line class="grid" x1="${M.left}" x2="${W - M.right}" y1="${this.y(v)}" y2="${this.y(v)}"/><text class="ytick" x="${M.left - 6}" y="${this.y(v) + 3}">${esc(this.yFormat(v))}</text>`);
    }
    // x ticks
    if (this.group.phaseTicks) {
      // x-axis labeled by mission phase: a gridline at each phase boundary, the phase name centered on its visible span
      const phases = this.group.phaseTicks();
      let lastRight = -Infinity;
      for (const p of phases) {
        if (p.end <= t0 || p.start >= t1) continue;
        if (p.start > t0) { const xb = this.x(p.start); parts.push(`<line class="xgrid" x1="${xb}" x2="${xb}" y1="${M.top}" y2="${H - M.bottom}"/>`); }
        const a = this.x(Math.max(p.start, t0));
        const b = this.x(Math.min(p.end, t1));
        const label = p.label;
        const half = label.length * 3.1;
        let cx = (a + b) / 2;
        if (cx - half < lastRight + 6) cx = lastRight + 6 + half; // nudge right instead of overlapping
        if (cx + half > W - M.right + 2) continue;
        parts.push(`<text class="xtick" x="${cx}" y="${H - 6}">${esc(label)}</text>`);
        lastRight = cx + half;
      }
    } else for (const tk of timeTicks(t0, t1, W, this.group.tickAnchor ?? 0)) {
      const xx = this.x(tk);
      parts.push(`<line class="xgrid" x1="${xx}" x2="${xx}" y1="${M.top}" y2="${H - M.bottom}"/><text class="xtick" x="${xx}" y="${H - 6}">${esc(this.group.formatTime(tk, t1 - t0))}</text>`);
    }
    parts.push(`<g clip-path="url(#clip-${this.uid()})">`);
    for (const L of this.layers) {
      if (L.hidden) continue;
      if (L.type === 'hband') parts.push(`<rect class="hband ${esc(L.cls || '')}" x="${M.left}" width="${W - M.left - M.right}" y="${this.y(L.hi)}" height="${Math.max(0, this.y(L.lo) - this.y(L.hi))}"><title>${esc(L.label)}</title></rect>`);
    }
    for (const L of this.layers) {
      if (L.hidden) continue;
      if (L.type === 'band') parts.push(`<path class="band ${esc(L.cls || '')}" d="${this.bandPath(L)}"><title>${esc(L.label)}</title></path>`);
    }
    for (const L of this.layers) {
      if (L.hidden) continue;
      if (L.type === 'hline') parts.push(`<line class="hline ${esc(L.cls || '')}" x1="${M.left}" x2="${W - M.right}" y1="${this.y(L.v)}" y2="${this.y(L.v)}"/>${L.label ? `<text class="hline-label" x="${W - M.right - 4}" y="${this.y(L.v) < M.top + 14 ? this.y(L.v) + 12 : this.y(L.v) - 4}">${esc(L.label)}</text>` : ''}`);
      if (L.type === 'line') parts.push(`<path class="line ${esc(L.cls || '')}" d="${L.grid ? this.gridPath(L.grid) : this.pointPath(L.points)}"/>`);
      if (L.type === 'step') parts.push(`<path class="line step ${esc(L.cls || '')}" d="${this.stepPath(L.segments)}"/>`);
    }
    for (const L of this.layers) {
      if (L.hidden || L.type !== 'points') continue;
      for (const p of L.points) {
        if (p.t < t0 || p.t > t1 || !isNum(p.v)) continue;
        parts.push(shape(p.shape || L.shape || 'circle', this.x(p.t), this.y(p.v), L.cls + (p.cls ? ' ' + p.cls : ''), p.filled ?? L.filled ?? true, p.tip || ''));
      }
    }
    parts.push('</g>');
    // markers
    for (const L of this.layers) {
      if (L.hidden || L.type !== 'markers') continue;
      const row = L.row || [M.top, H - M.bottom];
      for (const m of L.markers) {
        if (m.t < t0 || m.t > t1) continue;
        const xx = this.x(m.t);
        if (isNum(m.t_end) && L.ranges) {
          const b = Math.min(W - M.right, this.x(m.t_end));
          parts.push(`<rect class="mrange ${esc(m.cls || '')}" x="${xx}" y="${row[0] + 3}" width="${Math.max(2, b - xx)}" height="${row[1] - row[0] - 6}" data-marker="${esc(m.id)}"><title>${esc(m.label)}</title></rect>`);
        }
        parts.push(`<g class="marker ${esc(m.cls || '')}" data-marker="${esc(m.id)}" tabindex="0" role="button" aria-label="${esc(m.label)}"><line x1="${xx}" x2="${xx}" y1="${row[0]}" y2="${row[1]}"/><rect class="hit" x="${xx - 6}" y="${row[0]}" width="12" height="${row[1] - row[0]}"/>${m.glyph ? `<text class="glyph" x="${xx}" y="${(row[0] + row[1]) / 2 + 4}">${esc(m.glyph)}</text>` : ''}<title>${esc(m.label)}</title></g>`);
      }
    }
    if (this.kind === 'strip' && this.rowLabels) for (const r of this.rowLabels) parts.push(`<text class="row-label" x="${M.left - 6}" y="${(r.y0 + r.y1) / 2 + 3}">${esc(r.label)}</text>`);
    this.base.innerHTML = parts.join('');
    this.renderOverlay(false);
  }

  uid() { if (!this._uid) this._uid = Math.random().toString(36).slice(2, 8); return this._uid; }

  gridPath(grid) {
    const { t0, t1 } = this.group.view;
    const [i0, i1] = gridRange(grid, t0, t1);
    const px = this.width - M.left - M.right;
    const n = i1 - i0 + 1;
    let d = '';
    if (n <= px * 2) {
      let open = false;
      for (let i = i0; i <= i1; i++) {
        const v = grid.values[i];
        if (!isNum(v)) { open = false; continue; }
        d += `${open ? 'L' : 'M'}${this.x(grid.t0 + i * grid.dt).toFixed(1)},${this.y(v).toFixed(1)}`;
        open = true;
      }
      return d;
    }
    const per = n / px;
    for (let k = 0; k < px; k++) {
      const a = i0 + Math.floor(k * per);
      const b = Math.min(i1, i0 + Math.floor((k + 1) * per));
      let lo = Infinity, hi = -Infinity;
      for (let i = a; i <= b; i++) { const v = grid.values[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      const xx = (M.left + k + 0.5).toFixed(1);
      d += `${k ? 'L' : 'M'}${xx},${this.y(lo).toFixed(1)}L${xx},${this.y(hi).toFixed(1)}`;
    }
    return d;
  }

  pointPath(points) {
    let d = '';
    let open = false;
    for (const p of points) {
      if (!isNum(p.v)) { open = false; continue; }
      d += `${open ? 'L' : 'M'}${this.x(p.t).toFixed(1)},${this.y(p.v).toFixed(1)}`;
      open = true;
    }
    return d;
  }

  stepPath(segs) {
    const { t0, t1 } = this.group.view;
    let d = '';
    let prevEnd = null;
    for (const s of segs) {
      if (s.end < t0 || s.start > t1 || !isNum(s.v)) { prevEnd = null; continue; }
      const a = this.x(Math.max(s.start, t0)).toFixed(1);
      const b = this.x(Math.min(s.end, t1)).toFixed(1);
      const yy = this.y(s.v).toFixed(1);
      const contiguous = prevEnd !== null && Math.abs(s.start - prevEnd) < 1000;
      d += `${contiguous ? 'L' : 'M'}${a},${yy}L${b},${yy}`;
      prevEnd = s.end;
    }
    return d;
  }

  bandPath(L) {
    const { t0, t1 } = this.group.view;
    const [i0, i1] = gridRange(L.lo, t0, t1);
    const stride = Math.max(1, Math.floor((i1 - i0) / (this.width - M.left - M.right)));
    let up = '';
    let down = '';
    for (let i = i0; i <= i1; i += stride) {
      const xx = this.x(L.lo.t0 + i * L.lo.dt).toFixed(1);
      up += `${up ? 'L' : 'M'}${xx},${this.y(L.hi.values[i]).toFixed(1)}`;
      down = `L${xx},${this.y(L.lo.values[i]).toFixed(1)}` + down;
    }
    return up + down + 'Z';
  }

  renderOverlay(withTip) {
    if (!this.group || !this.yd) return;
    const H = this.height;
    const W = this.width;
    const g = this.group;
    const parts = [];
    if (g.selection) {
      const a = Math.max(M.left, this.x(g.selection[0]));
      const b = Math.min(W - M.right, this.x(g.selection[1]));
      if (b > a) parts.push(`<rect class="selection" x="${a}" y="${M.top}" width="${b - a}" height="${H - M.top - M.bottom}"/>`);
    }
    if (isNum(g.cursor) && g.cursor >= g.view.t0 && g.cursor <= g.view.t1) {
      const xx = this.x(g.cursor);
      parts.push(`<line class="cursor" x1="${xx}" x2="${xx}" y1="${M.top - 4}" y2="${H - M.bottom}"/>`);
    }
    if (isNum(g.hover) && g.hover >= g.view.t0 && g.hover <= g.view.t1) {
      const xx = this.x(g.hover);
      parts.push(`<line class="hoverline" x1="${xx}" x2="${xx}" y1="${M.top}" y2="${H - M.bottom}"/>`);
      if (this.kind !== 'strip') for (const L of this.layers) {
        if (L.hidden || L.type !== 'line' || !L.grid) continue;
        const v = sampleAt(L.grid, g.hover);
        if (isNum(v)) parts.push(`<circle class="hoverdot ${esc(L.cls || '')}" cx="${xx}" cy="${this.y(v)}" r="3.5"/>`);
      }
    }
    this.overlay.innerHTML = parts.join('');
    if (withTip && isNum(g.hover)) this.showTip(g.hover);
    else this.tip.hidden = true;
  }

  showTip(t) {
    const rows = [];
    const near = this.nearestPoint(t);
    if (near) rows.push(near.tip || '');
    else {
      for (const L of this.layers) {
        if (L.hidden || !L.tipLabel) continue;
        let v = null;
        if (L.type === 'line' && L.grid) v = sampleAt(L.grid, t);
        if (L.type === 'step') { const s = L.segments.find(s => t >= s.start && t < s.end); v = s ? s.v : null; }
        if (L.type === 'band') { const lo = sampleAt(L.lo, t); const hi = sampleAt(L.hi, t); rows.push(`<div><b>${esc(L.tipLabel)}</b> ${esc(this.yFormat(lo))}–${esc(this.yFormat(hi))} ${esc(this.unit)}</div>`); continue; }
        if (isNum(v)) rows.push(`<div><span class="sw ${esc(L.cls || '')}"></span><b>${esc(L.tipLabel)}</b> ${esc(L.tipFormat ? L.tipFormat(v) : this.yFormat(v))} ${esc(L.tipUnit ?? this.unit)}</div>`);
      }
    }
    const ctx = this.group.tipContext ? this.group.tipContext(t) : '';
    if (!rows.length && !ctx) { this.tip.hidden = true; return; }
    this.tip.innerHTML = rows.join('') + (near ? '' : ctx);
    this.tip.hidden = false;
    const xx = this.x(near ? near.t : t);
    const w = this.tip.offsetWidth || 220;
    this.tip.style.left = `${Math.min(this.width - w - 4, Math.max(4, xx + 12))}px`;
    this.tip.style.top = '6px';
  }

  nearestPoint(t) {
    const px = this.x(t);
    let best = null;
    let bd = 9;
    for (const L of this.layers) {
      if (L.hidden || L.type !== 'points') continue;
      for (const p of L.points) {
        if (!isNum(p.v)) continue;
        const d = Math.abs(this.x(p.t) - px);
        if (d < bd) { bd = d; best = p; }
      }
    }
    return best;
  }

  bind() {
    const body = this.el.querySelector('.tchart-body');
    let down = null;
    const local = e => { const r = this.svg.getBoundingClientRect(); return { px: (e.clientX - r.left) * (this.width / r.width), py: e.clientY - r.top }; };
    body.addEventListener('pointermove', e => {
      const { px } = local(e);
      const t = this.tAt(px);
      if (down) {
        const dx = px - down.px;
        if (Math.abs(dx) > 4) down.moved = true;
        if (down.moved) {
          if (down.select) this.group.setSelection([Math.min(down.t, t), Math.max(down.t, t)]);
          else { this.group.view = { ...down.view }; this.group.pan(-(dx / (this.width - M.left - M.right)) * (down.view.t1 - down.view.t0)); }
          return;
        }
      }
      if (px < M.left || px > this.width - M.right) { this.group.setHover(null, this); return; }
      this.group.setHover(t, this);
    });
    body.addEventListener('pointerleave', () => { if (!down) this.group.setHover(null, this); });
    body.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const { px } = local(e);
      const marker = e.target.closest('[data-marker]');
      down = { px, t: this.tAt(px), view: { ...this.group.view }, select: this.group.selectMode || e.shiftKey, marker: marker?.dataset.marker, moved: false };
      body.setPointerCapture(e.pointerId);
    });
    body.addEventListener('pointerup', e => {
      if (!down) return;
      const d = down;
      down = null;
      try { body.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (d.moved) return;
      if (d.marker) { this.group.onMarker?.(d.marker); return; }
      if (d.px >= M.left && d.px <= this.width - M.right) this.group.onCursor?.(d.t);
    });
    body.addEventListener('keydown', e => {
      const marker = e.target.closest('[data-marker]');
      if (marker && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.group.onMarker?.(marker.dataset.marker); }
    });
    body.addEventListener('wheel', e => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      this.group.zoom(e.deltaY > 0 ? 1.25 : 0.8, this.tAt(local(e).px));
    }, { passive: false });
  }
}

function shape(kind, x, y, cls, filled, tip) {
  const c = `pt ${cls || ''} ${filled ? 'filled' : 'hollow'}`;
  const t = tip ? `<title>${esc(tip.replace(/<[^>]+>/g, ' '))}</title>` : '';
  if (kind === 'diamond') return `<path class="${c}" d="M${x},${y - 5.5}L${x + 5.5},${y}L${x},${y + 5.5}L${x - 5.5},${y}Z">${t}</path>`;
  if (kind === 'square') return `<rect class="${c}" x="${x - 4.5}" y="${y - 4.5}" width="9" height="9">${t}</rect>`;
  if (kind === 'triangle') return `<path class="${c}" d="M${x},${y - 6}L${x + 5.5},${y + 4}L${x - 5.5},${y + 4}Z">${t}</path>`;
  return `<circle class="${c}" cx="${x}" cy="${y}" r="4.6">${t}</circle>`;
}

export function gridRange(grid, t0, t1) {
  const n = grid.values.length;
  const i0 = Math.max(0, Math.floor((t0 - grid.t0) / grid.dt));
  const i1 = Math.min(n - 1, Math.ceil((t1 - grid.t0) / grid.dt));
  return [i0, Math.max(i0, i1)];
}

function sampleAt(grid, t) {
  const x = (t - grid.t0) / grid.dt;
  if (x < 0 || x > grid.values.length - 1) return null;
  const i = Math.floor(x);
  const f = x - i;
  const a = grid.values[i];
  const b = grid.values[Math.min(i + 1, grid.values.length - 1)];
  return isNum(a) && isNum(b) ? a + (b - a) * f : a;
}

export function niceTicks(lo, hi, count) {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.abs(v) < 1e-12 ? 0 : v);
  return out;
}

function timeTicks(t0, t1, width, origin = 0) {
  const DAYMS = 86400000;
  const target = Math.max(2, Math.floor(width / 95));
  const spanDays = (t1 - t0) / DAYMS;
  const steps = [0.25, 0.5, 1, 2, 5, 7, 10, 14, 30, 60, 90, 120, 180, 270, 365, 730];
  const stepDays = steps.find(s => spanDays / s <= target) || 365;
  const step = stepDays * DAYMS;
  const anchor = origin + Math.ceil((t0 - origin) / step) * step;
  const out = [];
  for (let t = anchor; t <= t1; t += step) out.push(t);
  return out;
}

function shorten(text, chars) {
  const s = String(text || '');
  return s.length > chars ? s.slice(0, Math.max(1, Math.floor(chars) - 1)) + '…' : s;
}
