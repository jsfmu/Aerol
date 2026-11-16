// Zinnia garden rendering (SVG). The plant only grows or rests — it never droops or dies.
import { BLOOM_AT, STAGES } from '../core/garden.js';
import { esc } from './dom.js';

const LEAF = '#4caf50';
const LEAF_DARK = '#2e7d32';

function flowerHead(cx, cy, r, color, open = 1) {
  const outer = [];
  const inner = [];
  for (let i = 0; i < 16; i++) {
    const a = (i * 360) / 16;
    outer.push(`<ellipse cx="${cx}" cy="${cy - r * 0.62 * open}" rx="${r * 0.2}" ry="${r * 0.45 * open}" fill="${color}" transform="rotate(${a} ${cx} ${cy})"/>`);
  }
  for (let i = 0; i < 12; i++) {
    const a = (i * 360) / 12 + 15;
    inner.push(`<ellipse cx="${cx}" cy="${cy - r * 0.38 * open}" rx="${r * 0.15}" ry="${r * 0.3 * open}" fill="${color}" opacity=".85" transform="rotate(${a} ${cx} ${cy})" style="filter:brightness(1.15)"/>`);
  }
  return `<g class="zinnia-head">${outer.join('')}${inner.join('')}<circle cx="${cx}" cy="${cy}" r="${r * 0.26}" fill="#5a3a1a"/><circle cx="${cx}" cy="${cy}" r="${r * 0.17}" fill="#ffcf3f" opacity=".9"/></g>`;
}

function leaf(x, y, dir, size) {
  const s = size;
  return `<path d="M${x},${y} q${dir * s * 0.9},${-s * 0.55} ${dir * s * 1.6},${-s * 0.15} q${-dir * s * 0.7},${s * 0.55} ${-dir * s * 1.6},${s * 0.15}z" fill="${LEAF}" stroke="${LEAF_DARK}" stroke-width=".8"/>`;
}

export function zinniaSvg(g, size = 96, { label = true } = {}) {
  const st = g.stage.id;
  const within = (() => {
    const i = g.stageIdx;
    if (i >= STAGES.length - 1) return 1;
    return Math.min(1, (g.growth - STAGES[i].at) / (STAGES[i + 1].at - STAGES[i].at));
  })();
  const soil = 92;
  const parts = [];
  // pot
  parts.push(`<path d="M24,${soil} L76,${soil} L70,118 L30,118 Z" fill="#b5653a"/><rect x="21" y="${soil - 4}" width="58" height="8" rx="3" fill="#c97a4a"/><ellipse cx="50" cy="${soil - 3}" rx="26" ry="3" fill="#4a3020"/>`);
  if (st === 'seed') {
    parts.push(`<ellipse cx="50" cy="${soil - 5}" rx="${3 + within * 2}" ry="${2 + within}" fill="#6b4a2a"/>`);
    if (within > 0.5) parts.push(`<path d="M50,${soil - 6} q1,-4 3,-6" stroke="${LEAF}" stroke-width="2" fill="none" stroke-linecap="round"/>`);
  } else {
    const top = { sprout: 74 - within * 6, leaves: 60 - within * 10, bud: 44 - within * 6, bloom: 36 }[st];
    parts.push(`<path d="M50,${soil - 3} C48,${(soil + top) / 2} 52,${(soil + top) / 2} 50,${top}" stroke="${LEAF_DARK}" stroke-width="3" fill="none" stroke-linecap="round"/>`);
    if (st === 'sprout') parts.push(leaf(50, top + 2, -1, 7 + within * 3), leaf(50, top + 2, 1, 7 + within * 3));
    else {
      parts.push(leaf(50, soil - 14, -1, 13), leaf(50, soil - 20, 1, 12));
      if (st !== 'leaves' || within > 0.5) parts.push(leaf(50, soil - 30, -1, 10), leaf(50, soil - 36, 1, 9));
    }
    if (st === 'bud') {
      const r = 5 + within * 3;
      parts.push(`<ellipse cx="50" cy="${top - r * 0.6}" rx="${r * 0.75}" ry="${r}" fill="${g.color}"/><path d="M${50 - r * 0.8},${top} q${r * 0.8},${-r * 1.4} ${r * 1.6},0 z" fill="${LEAF}"/>`);
    }
    if (st === 'bloom') parts.push(flowerHead(50, top - 2, 19, g.color, 1));
  }
  if (g.resting) parts.push('<g class="rest"><circle cx="82" cy="18" r="8" fill="#cfd8ff" opacity=".85"/><circle cx="86" cy="15" r="7" fill="var(--z-bg, #000)"/><text x="66" y="14" font-size="9" fill="#cfd8ff">z</text><text x="60" y="7" font-size="7" fill="#cfd8ff">z</text></g>');
  else if (g.justBloomed) parts.push('<g class="sparkle" fill="#ffd166"><path d="M18,22 l2,5 5,2 -5,2 -2,5 -2,-5 -5,-2 5,-2z"/><path d="M82,40 l1.5,3.5 3.5,1.5 -3.5,1.5 -1.5,3.5 -1.5,-3.5 -3.5,-1.5 3.5,-1.5z"/></g>');
  const title = `Aerol Buddy — ${g.stage.label}${g.resting ? ' (resting)' : ''}, ${g.growth}/${BLOOM_AT} growth`;
  return `<svg class="zinnia" viewBox="0 0 100 120" width="${size}" height="${size * 1.2}" role="img" aria-label="${esc(title)}"${label ? `><title>${esc(title)}</title>` : '>'}${parts.join('')}</svg>`;
}

export function gardenShelf(g, max = 14) {
  if (!g.flowers.length) return '<p class="sub">Your first bloom will appear here.</p>';
  const shown = g.flowers.slice(-max);
  const more = g.flowers.length - shown.length;
  return `<div class="garden-shelf">${shown.map(f => `<svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true">${flowerHead(20, 20, 17, f.color)}</svg>`).join('')}${more > 0 ? `<span class="sub">+${more} more</span>` : ''}</div>`;
}

export function gardenWatchCard(s) {
  const g = s.garden;
  const tended = s.today.done.garden;
  return `<div class="wcard garden-card">
    <div class="garden-row">${zinniaSvg(g, 54)}<div style="flex:1;min-width:0">
      <div class="wk">Aerol Buddy · ${esc(g.stage.label)}${g.resting ? ' · resting' : ''}</div>
      <div class="growbar"><i style="width:${Math.round(g.progress * 100)}%"></i></div>
      <div class="wmuted">${!g.planted ? 'Your seed is planted at launch.' : g.justBloomed ? 'It bloomed! Added to your garden.' : `${g.toNext} more growth to bloom`} · 🌼 ${g.blooms}</div>
      ${g.resting ? `<div class="wmuted">${esc(g.restReason)}</div>` : ''}
    </div></div>
    ${tended ? '' : '<button class="wbtn ghost" data-selfcare="garden">🌱 I tended the garden</button>'}
  </div>`;
}

export function gardenPanel(s) {
  const g = s.garden;
  return `<section class="panel garden-panel"><h2>My Aerol Buddy garden</h2>
    <p class="sub">Every completed quest helps your Aerol Buddy grow (and reporting symptoms always counts). It never wilts: when you're unwell or the band is offline, it rests.</p>
    <div class="garden-hero">${zinniaSvg(g, 150)}<div>
      <div class="stat-line"><b>${esc(g.stage.label)}</b>${g.resting ? ' · <span class="chip">resting</span>' : ''}</div>
      <div class="growbar big"><i style="width:${Math.round(g.progress * 100)}%"></i></div>
      <div class="sub">${!g.planted ? 'Your mission seed is planted at launch.' : `${g.growth}/${BLOOM_AT} growth${g.justBloomed ? ' · bloomed today!' : ` · ${g.toNext} to bloom`}`}</div>
      ${g.resting ? `<p class="sub">${esc(g.restReason)}</p>` : ''}
      <div class="stages">${STAGES.map((x, i) => `<span class="${i <= g.stageIdx ? 'on' : ''}">${esc(x.label)}</span>`).join('')}</div>
      ${s.today.done.garden ? '<p class="sub">✓ Garden tended today</p>' : '<button class="btn small primary" data-selfcare="garden">🌱 I tended the garden today</button>'}
    </div></div>
    <h3>Garden · ${g.blooms} bloom${g.blooms === 1 ? '' : 's'}</h3>${gardenShelf(g)}
    <p class="sub" style="margin-top:8px">Inspired by the zinnias astronauts grew in NASA's Veggie unit on the ISS (2016). This is not a NASA program.</p></section>`;
}
