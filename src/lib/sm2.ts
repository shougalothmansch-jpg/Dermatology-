import type { SrsState } from '../db/types';
import { addDays, todayStr } from './utils';

export function newSrs(): SrsState {
  return { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: todayStr() };
}

/**
 * Simple SM-2. quality: 0–5 (≥3 = recalled).
 * Again=1, Hard=3, Good=4, Easy=5.
 */
export function reviewSrs(prev: SrsState, quality: number): SrsState {
  const today = todayStr();
  let { ease, interval, reps, lapses } = prev;
  if (quality < 3) {
    reps = 0;
    interval = 1;
    lapses += 1;
  } else {
    reps += 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = quality === 3 ? 3 : 6;
    else interval = Math.max(1, Math.round(interval * ease * (quality === 3 ? 0.8 : quality === 5 ? 1.3 : 1)));
  }
  ease = Math.max(1.3, ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  return { ease: Math.round(ease * 100) / 100, interval, reps, lapses, due: addDays(today, interval), lastReviewed: today };
}

export const QUALITY_BUTTONS = [
  { quality: 1, label: 'Again', hint: '1 day' },
  { quality: 3, label: 'Hard', hint: 'shorter' },
  { quality: 4, label: 'Good', hint: 'normal' },
  { quality: 5, label: 'Easy', hint: 'longer' },
] as const;
