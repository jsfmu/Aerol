// Self-care renderers for the watch (compact) and the crew dashboard (detailed).
import { DAY, fmt } from '../core/util.js';
import { missionLabel } from '../core/schedule.js';
import { QUESTS, DAY_GOAL, LEVEL_XP, selfCareSummary } from '../core/selfcare.js';
import { esc } from './dom.js';
import { gardenWatchCard, gardenPanel } from './garden-view.js';

const SAFETY = 'Points reward habits, never vitals. Reporting symptoms always earns points. Alerts and medical follow-up always come first.';

function questButton(q, s, compact) {
  const done = s.today.done[q.id];
  let act = '';
  if (q.id === 'checkin') act = done ? '' : `data-goto="checkin" data-sec-crew="checkin"`;
  if (q.id === 'hydration') act = `data-selfcare="hydration"`;
  if (q.id === 'unwind') act = done ? '' : `data-selfcare="unwind"`;
  const progress = q.id === 'hydration' ? ` ${s.today.hydration}/4`
    : q.id === 'exercise' ? ` ${fmt(s.today.activeMin, 0)}/30 min`
    : q.id === 'sleep' ? ` ${fmt(s.today.sleepH, 1)}/7 h`
    : q.id === 'wear' ? ` ${fmt(s.today.wearPct, 0)}%` : '';
  const tag = act ? 'button' : 'div';
  return `<${tag} class="${compact ? 'wquest' : 'quest'} ${done ? 'done' : ''}" ${act}>
    <span class="qicon" aria-hidden="true">${done ? '✓' : q.icon}</span>
    <span class="qtext"><b>${esc(q.label)}</b><small>${esc(q.auto ? q.detail + ' · automatic' : q.detail)}${esc(progress)}</small></span>
    <span class="qxp">+${q.xp}</span></${tag}>`;
}

function rings(s, size = 112) {
  const r1 = 46, r2 = 36;
  const c1 = 2 * Math.PI * r1, c2 = 2 * Math.PI * r2;
  const f1 = s.today.count / QUESTS.length;
  const f2 = s.levelProgress;
  return `<svg viewBox="0 0 110 110" width="${size}" height="${size}" aria-hidden="true" style="transform:rotate(-90deg)">
    <circle cx="55" cy="55" r="${r1}" stroke="#2a3a2d" stroke-width="9" fill="none"/><circle cx="55" cy="55" r="${r1}" stroke="#9be564" stroke-width="9" fill="none" stroke-linecap="round" stroke-dasharray="${c1 * f1} ${c1}"/>
    <circle cx="55" cy="55" r="${r2}" stroke="#3a2f1a" stroke-width="9" fill="none"/><circle cx="55" cy="55" r="${r2}" stroke="#ffb547" stroke-width="9" fill="none" stroke-linecap="round" stroke-dasharray="${c2 * f2} ${c2}"/></svg>`;
}

export function selfcareWatchPage(store, w) {
  const s = selfCareSummary(store.model, w.actions, w.t);
  const earned = s.badges.filter(b => b.earned);
  return `<div class="wtitle"><span>Self-care</span><span>Lv ${s.level}</span></div>
    <div class="sc-hero"><div class="sc-rings">${rings(s)}<div class="sc-center"><div><b>🔥 ${s.streak}</b><small>day streak</small></div></div></div>
      <div class="sc-meta"><div><b>${s.today.count}/${QUESTS.length}</b> quests today</div><div class="wmuted">Goal ${DAY_GOAL} keeps the streak</div>
      <div class="xpbar"><i style="width:${Math.round(s.levelProgress * 100)}%"></i></div><div class="wmuted">${s.xp % LEVEL_XP}/${LEVEL_XP} XP to Lv ${s.level + 1}</div></div></div>
    ${gardenWatchCard(s)}
    ${QUESTS.map(q => questButton(q, s, true)).join('')}
    <div class="wk wmuted" style="margin-top:8px">Badges ${earned.length}/${s.badges.length}</div>
    <div class="sc-badges">${s.badges.map(b => `<span class="sc-badge ${b.earned ? 'on' : ''}" title="${esc(b.label)} — ${esc(b.why)}">${b.icon}</span>`).join('')}</div>
    <div class="wmuted" style="margin-top:6px">${esc(SAFETY)}</div>`;
}

export function selfcareDashboard(store, t) {
  const actions = store.actionsAt(t);
  const s = selfCareSummary(store.model, actions, t);
  const last = s.days.slice(-28);
  const S = store.model.schedule;
  return `<div class="qgrid">
    ${gardenPanel(s)}
    <section class="panel sc-panel"><h2>Today</h2><p class="sub">${esc(missionLabel(S, t, true))} · personal progress only — no crew leaderboards.</p>
      <div class="sc-hero light"><div class="sc-rings">${rings(s, 128)}<div class="sc-center"><div><b>🔥 ${s.streak}</b><small>day streak</small></div></div></div>
        <div class="sc-meta"><div class="stat-line"><b>Level ${s.level}</b> · ${s.xp.toLocaleString()} XP</div><div class="xpbar"><i style="width:${Math.round(s.levelProgress * 100)}%"></i></div>
        <div class="sub">Best streak ${s.best} days · daily goal ${DAY_GOAL} of ${QUESTS.length} quests</div></div></div>
      <div class="quests">${QUESTS.map(q => questButton(q, s, false)).join('')}</div>
      <p class="sub" style="margin-top:8px">${esc(SAFETY)}</p></section>
    <section class="panel"><h2>Last 4 weeks</h2><p class="sub">Each square is one day; darker = more quests completed.${s.includesSimulatedHistory ? ' Days before you started using the demo include <b>simulated history</b> for the synthetic astronaut.' : ''}</p>
      <div class="sc-heat">${last.map(d => `<span class="lvl${Math.min(4, Math.floor(d.count * 4 / QUESTS.length))} ${d.met ? 'met' : ''}" title="${esc(missionLabel(S, d.t + DAY / 2))}: ${d.count}/${QUESTS.length} quests${d.simulated ? ' (simulated history)' : ''}"></span>`).join('')}</div>
      <h3>Badges</h3><div class="sc-badge-grid">${s.badges.map(b => `<div class="sc-badge-card ${b.earned ? 'on' : ''}"><span>${b.icon}</span><div><b>${esc(b.label)}</b><small>${esc(b.why)}</small></div></div>`).join('')}</div></section></div>`;
}
