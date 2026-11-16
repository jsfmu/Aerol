// Zinnia garden — inspired by the zinnias grown in NASA's Veggie unit aboard the ISS (2016).
// Not a NASA program. Rules:
//  - Growth comes only from self-care habits (quests completed, symptom reports). Never from vitals.
//  - The plant never wilts or dies. During a health alert or missing data it "rests" (calm state).
//  - Every bloom is kept in a personal garden; nothing is lost and nothing is compared across crew.
import { episodeStatus, severityRank } from './rules.js';

export const BLOOM_AT = 70; // ≈ two weeks of steady self-care per flower
export const STAGES = [
  { id: 'seed', label: 'Seed', at: 0 },
  { id: 'sprout', label: 'Sprout', at: 8 },
  { id: 'leaves', label: 'Leaves', at: 22 },
  { id: 'bud', label: 'Bud', at: 42 },
  { id: 'bloom', label: 'Bloom', at: BLOOM_AT },
];
export const PETAL_COLORS = ['#ff6b6b', '#ff9f43', '#ffd166', '#ff6fb5', '#c77dff', '#f8f4ec', '#ef476f', '#f4a261'];

export const growthOf = d => (d?.count || 0) + (d?.reports || 0);

// Rest when the astronaut has an active physiological, lab or data-quality alert, or no band data.
export function restState(model, actions, t, vitalsMissing) {
  if (vitalsMissing) return { resting: true, reason: 'No band data right now. Your Aerol Buddy rests until it reconnects.' };
  const live = model.alerts.episodes.filter(e => ['physiological', 'lab', 'data_quality'].includes(e.category))
    .map(e => ({ e, s: episodeStatus(e, t, actions) }))
    .filter(x => x.s && x.s.active && severityRank(x.s.severity) >= 1);
  if (live.length) return { resting: true, reason: 'Resting while you take care of yourself. Health first, your Aerol Buddy will wait.' };
  return { resting: false, reason: null };
}

export function growGarden(days, today, rest = { resting: false }, { planted = true } = {}) {
  const finished = days.reduce((a, d) => a + growthOf(d), 0);
  const total = finished + growthOf(today);
  const blooms = Math.floor(total / BLOOM_AT);
  const growth = total % BLOOM_AT;
  // Show the newest flower in full bloom on the day it opens.
  const justBloomed = blooms > 0 && growth < growthOf(today);
  const stageIdx = justBloomed ? STAGES.length - 1 : STAGES.reduce((i, s, k) => (growth >= s.at ? k : i), 0);
  const flowers = Array.from({ length: blooms }, (_, i) => ({ index: i, color: PETAL_COLORS[i % PETAL_COLORS.length] }));
  return {
    total, blooms, growth, toNext: BLOOM_AT - growth, progress: growth / BLOOM_AT,
    stage: STAGES[stageIdx], stageIdx, justBloomed,
    color: PETAL_COLORS[(justBloomed ? blooms - 1 : blooms) % PETAL_COLORS.length],
    flowers, resting: !!rest.resting, restReason: rest.reason, planted,
  };
}
