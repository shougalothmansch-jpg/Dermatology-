import type { Topic } from '../db/types';

export const normTitle = (s: string) =>
  s
    .toLowerCase()
    .replace(/^\s*(chapter|section|part)\s+[\divxlc]+\s*[:.\-–—]?\s*/i, '')
    .replace(/^\s*\d+(\.\d+)*\s*[:.\-–—]?\s*/, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Finds the existing topic that best corresponds to a chapter/deck name, if any. */
export function matchTopic(name: string, topics: Topic[]): Topic | undefined {
  const n = normTitle(name);
  if (!n) return undefined;
  return (
    topics.find((t) => normTitle(t.name) === n) ??
    topics.find((t) => n.length >= 5 && (normTitle(t.name).startsWith(n) || n.startsWith(normTitle(t.name)))) ??
    topics.find((t) => n.length >= 6 && normTitle(t.name).includes(n)) ??
    topics.find((t) => normTitle(t.name).length >= 6 && n.includes(normTitle(t.name)))
  );
}

/** "Chapter 12: Psoriasis" / "12 Psoriasis" → "12" */
export function chapterNumber(title: string): string | undefined {
  return /^\s*(?:chapter\s+)?(\d+)\b/i.exec(title)?.[1];
}

export const FRONT_MATTER = /^\s*(cover|title page|half title|copyright|contents|table of contents|preface|index|front matter|back matter|dedication|foreword|contributors|acknowledg|abbreviations|about the|how to use|frontmatter|backmatter)/i;
