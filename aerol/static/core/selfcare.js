// Gamified self-care. Rules that keep it safe:
//  - Points reward HABITS (wearing the band, sleep opportunity, exercise sessions, check-ins, logging),
//    never physiological outcomes (no points for a "better" heart rate or lab value).
//  - Reporting symptoms always earns points; nothing rewards ignoring or delaying an alert.
//  - Self-care never resolves, hides or outranks an alert or a medical follow-up.
//  - Personal progress only — no crew leaderboards.
import { DAY, rng } from './util.js';
import { growGarden, restState } from './garden.js';
import { latestVitals } from './vitals.js';

export const QUESTS = [
  { id: 'wear', label: 'Wear the band', detail: '≥ 90% of the day', xp: 10, icon: '⌚', auto: true },
  { id: 'sleep', label: 'Sleep opportunity', detail: '≥ 7 h in bed', xp: 10, icon: '☾', auto: true },
  { id: 'exercise', label: 'Countermeasure exercise', detail: '≥ 30 active min', xp: 15, icon: '⚡', auto: true },
  { id: 'checkin', label: 'Daily check-in', detail: 'how you feel, any symptoms', xp: 15, icon: '✓', auto: false },
  { id: 'hydration', label: 'Hydration', detail: 'log 4 drinks', xp: 10, icon: '💧', auto: false, target: 4 },
  { id: 'unwind', label: 'Wind-down', detail: '5-min breathing or stretch', xp: 10, icon: '❋', auto: false },
  { id: 'garden', label: 'Tend the garden', detail: 'real plant care, e.g. a Veggie-style grow unit', xp: 10, icon: '🌱', auto: false },
];
export const DAY_GOAL = 4; // quests per day that keep the streak alive (of 7)
export const LEVEL_XP = 250;

export const BADGES = [
  { id: 'first_checkin', label: 'First check-in', icon: '✓', why: 'Logged how you feel for the first time' },
  { id: 'speak_up', label: 'Speak up', icon: '🗣', why: 'Recorded symptoms linked to an alert (reporting always counts)' },
  { id: 'streak_7', label: '7-day streak', icon: '🔥', why: '7 days in a row meeting the daily goal' },
  { id: 'streak_30', label: '30-day streak', icon: '🏅', why: '30 days in a row meeting the daily goal' },
  { id: 'steady_signal', label: 'Steady signal', icon: '📶', why: '7 days in a row wearing the band ≥ 90%' },
  { id: 'unwind_3', label: 'Calm crew', icon: '❋', why: '3 wind-down sessions in one week' },
  { id: 'hydrated_week', label: 'Hydrated week', icon: '💧', why: 'Hydration goal met 5 days in one week' },
  { id: 'fast_ack', label: 'On it', icon: '⚑', why: 'Acknowledged an alert within an hour' },
  { id: 'first_bloom', label: 'First bloom', icon: '🌼', why: 'Grew a zinnia from seed to flower' },
  { id: 'garden_5', label: 'Green thumb', icon: '🌻', why: 'Five zinnias in your garden' },
];

const dayKey = t => Math.floor(t / DAY);

// Simulated check-in history for days before the user started interacting, so streaks are
// meaningful when jumping through a long mission. Clearly labeled "simulated history" in the UI.
function simulatedCheckin(seed, k) {
  const next = rng((seed ^ (k * 2654435761)) >>> 0);
  return next() < 0.8;
}

export function selfCareDays(model, actions, t) {
  const { daily, scenario } = model;
  const firstUser = actions.length ? Math.min(...actions.map(a => a.t)) : Infinity;
  const byDay = new Map();
  for (const a of actions) {
    if (a.t > t || a.side === 'ground') continue;
    const k = dayKey(a.t);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(a);
  }
  const start = model.schedule.baselineWindow[1];
  const out = [];
  for (const d of daily) {
    if (d.t < start || d.t + DAY > t) continue; // only finished days; today is scored live by todayProgress()
    const k = dayKey(d.t + DAY / 2);
    const acts = byDay.get(k) || [];
    const simulated = d.t + DAY < firstUser;
    const done = {
      wear: d.coverage >= 0.9,
      sleep: (d.sleep_h ?? 0) >= 7,
      exercise: (d.active_min ?? 0) >= 30,
      checkin: acts.some(a => a.action === 'checkin') || (simulated && simulatedCheckin(scenario.seed, k)),
      hydration: acts.filter(a => a.action === 'selfcare' && a.data?.kind === 'hydration').length >= 4 || (simulated && simulatedCheckin(scenario.seed + 7, k)),
      unwind: acts.some(a => a.action === 'selfcare' && a.data?.kind === 'unwind') || (simulated && simulatedCheckin(scenario.seed + 13, k) && k % 2 === 0),
      garden: acts.some(a => a.action === 'selfcare' && a.data?.kind === 'garden') || (simulated && simulatedCheckin(scenario.seed + 29, k) && k % 3 !== 0),
    };
    const hydrationCount = acts.filter(a => a.action === 'selfcare' && a.data?.kind === 'hydration').length;
    const xp = QUESTS.reduce((a, q) => a + (done[q.id] ? q.xp : 0), 0)
      + acts.filter(a => a.action === 'checkin' && (a.data?.symptoms || []).length).length * 5; // reporting symptoms is rewarded
    const count = Object.values(done).filter(Boolean).length;
    const reports = acts.filter(a => a.action === 'checkin' && (a.data?.symptoms || []).length).length;
    out.push({ t: d.t, key: k, done, count, met: count >= DAY_GOAL, xp, simulated, hydrationCount, reports, insufficient: d.insufficient });
  }
  return out;
}

// Today's progress for the day containing t (live, partial day).
export function todayProgress(model, actions, t) {
  const k = dayKey(t);
  const acts = actions.filter(a => a.t <= t && dayKey(a.t) === k && a.side !== 'ground');
  const S = model.vitals;
  let worn = 0, n = 0, asleep = 0, active = 0;
  for (let i = Math.max(0, Math.floor((k * DAY - S.t0) / S.step)); i < S.n && S.t[i] <= t; i++) {
    n++; if (S.worn[i]) worn++; if (S.move[i] > 1.5) active++;
  }
  // Sleep counts the most recent night (asleep samples in the trailing 20 h), not just since midnight.
  asleep = 0;
  for (let i = Math.max(0, Math.floor((t - 20 * 3600000 - S.t0) / S.step)); i < S.n && S.t[i] <= t; i++) if (S.asleep[i]) asleep++;
  const hours = n * S.step / 3600000;
  const hydration = acts.filter(a => a.action === 'selfcare' && a.data?.kind === 'hydration').length;
  const done = {
    wear: n > 0 && worn / n >= 0.9,
    sleep: asleep * S.step / 3600000 >= 7,
    exercise: active * S.step / 60000 >= 30,
    checkin: acts.some(a => a.action === 'checkin'),
    hydration: hydration >= 4,
    unwind: acts.some(a => a.action === 'selfcare' && a.data?.kind === 'unwind'),
    garden: acts.some(a => a.action === 'selfcare' && a.data?.kind === 'garden'),
  };
  const reports = acts.filter(a => a.action === 'checkin' && (a.data?.symptoms || []).length).length;
  return {
    done, hydration, hours, reports,
    activeMin: active * S.step / 60000, sleepH: asleep * S.step / 3600000, wearPct: n ? (100 * worn) / n : 0,
    count: Object.values(done).filter(Boolean).length,
    xp: QUESTS.reduce((a, q) => a + (done[q.id] ? q.xp : 0), 0),
  };
}

export function selfCareSummary(model, actions, t) {
  const days = selfCareDays(model, actions, t);
  const today = todayProgress(model, actions, t);
  let streak = 0;
  for (let i = days.length - 1; i >= 0 && days[i].met; i--) streak++;
  let best = 0, run = 0, wearRun = 0, bestWear = 0;
  for (const d of days) { run = d.met ? run + 1 : 0; best = Math.max(best, run); wearRun = d.done.wear ? wearRun + 1 : 0; bestWear = Math.max(bestWear, wearRun); }
  const xp = days.reduce((a, d) => a + d.xp, 0) + today.xp;
  const mine = actions.filter(a => a.t <= t && a.side !== 'ground');
  const badges = new Set();
  if (mine.some(a => a.action === 'checkin') || days.some(d => d.done.checkin)) badges.add('first_checkin');
  if (mine.some(a => a.action === 'checkin' && a.episode_id && (a.data?.symptoms || []).length)) badges.add('speak_up');
  if (best >= 7) badges.add('streak_7');
  if (best >= 30) badges.add('streak_30');
  if (bestWear >= 7) badges.add('steady_signal');
  for (let i = 0; i + 7 <= days.length; i++) {
    const w = days.slice(i, i + 7);
    if (w.filter(d => d.done.unwind).length >= 3) badges.add('unwind_3');
    if (w.filter(d => d.done.hydration).length >= 5) badges.add('hydrated_week');
  }
  for (const a of mine.filter(a => a.action === 'ack')) {
    const ep = model.alerts.episodes.find(e => e.episode_id === a.episode_id);
    if (ep && a.t - ep.start <= 3600000) badges.add('fast_ack');
  }
  // The mission garden is planted at launch; pre-flight habits still count for streaks and XP.
  const planted = t >= model.schedule.launch;
  const garden = growGarden(planted ? days.filter(d => d.t >= model.schedule.launch) : [], planted ? today : { count: 0 },
    restState(model, actions, t, latestVitals(model.vitals, t).missing), { planted });
  if (garden.blooms >= 1) badges.add('first_bloom');
  if (garden.blooms >= 5) badges.add('garden_5');
  return {
    days, today, streak: streak + (today.count >= DAY_GOAL ? 1 : 0), best: Math.max(best, streak + (today.count >= DAY_GOAL ? 1 : 0)),
    xp, level: 1 + Math.floor(xp / LEVEL_XP), levelProgress: (xp % LEVEL_XP) / LEVEL_XP,
    garden,
    badges: BADGES.map(b => ({ ...b, earned: badges.has(b.id) })),
    includesSimulatedHistory: days.some(d => d.simulated),
  };
}
