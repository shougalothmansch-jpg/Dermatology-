import Dexie from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta } from '../db/db';
import type { Question } from '../db/types';
import { todayStr } from './utils';

export const DEFAULT_NEW_PER_DAY = 20;

export async function getNewPerDay(): Promise<number> {
  return getMeta<number>('newPerDay', DEFAULT_NEW_PER_DAY);
}

/**
 * Today's review queue, Anki-style: every studied card that is due, plus
 * up to N never-seen cards per day (in the order they were added).
 */
export async function dueQueue(): Promise<{ reviews: Question[]; fresh: Question[] }> {
  const today = todayStr();
  const reviews = await db.questions
    .where('srs.due')
    .belowOrEqual(today)
    .filter((q) => q.attempts > 0)
    .toArray();
  reviews.sort((a, b) => a.srs.due.localeCompare(b.srs.due));
  const remaining = await newRemainingToday();
  const fresh = remaining > 0 ? await db.questions.where('[attempts+createdAt]').between([0, Dexie.minKey], [0, Dexie.maxKey]).limit(remaining).toArray() : [];
  return { reviews, fresh };
}

async function newRemainingToday(): Promise<number> {
  const [limit, studiedToday] = await Promise.all([getNewPerDay(), db.questions.where('firstStudied').equals(todayStr()).count()]);
  return Math.max(0, limit - studiedToday);
}

export async function dueCounts(): Promise<{ reviews: number; fresh: number; total: number }> {
  const today = todayStr();
  const [reviews, unseen, remaining] = await Promise.all([
    db.questions.where('srs.due').belowOrEqual(today).filter((q) => q.attempts > 0).count(),
    db.questions.where('attempts').equals(0).count(),
    newRemainingToday(),
  ]);
  const fresh = Math.min(unseen, remaining);
  return { reviews, fresh, total: reviews + fresh };
}

export function useDueCounts() {
  const today = todayStr();
  return useLiveQuery(() => dueCounts(), [today]);
}
