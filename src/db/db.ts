import Dexie, { type Table } from 'dexie';
import type {
  Attempt,
  ClubEntry,
  Essay,
  EssayPrompt,
  MetaRow,
  Protocol,
  ProtocolTask,
  Question,
  Section,
  Textbook,
  Topic,
} from './types';
import {
  SEED_ACTIVITY_TYPES,
  SEED_CLUB_ROLES,
  SEED_ESSAY_TEMPLATES,
  SEED_SYLLABUS,
  SEED_TEXTBOOKS,
} from './seed';
import { nowIso, uid } from '../lib/utils';

export class DermPathDB extends Dexie {
  textbooks!: Table<Textbook, string>;
  sections!: Table<Section, string>;
  topics!: Table<Topic, string>;
  questions!: Table<Question, string>;
  attempts!: Table<Attempt, string>;
  essayPrompts!: Table<EssayPrompt, string>;
  essays!: Table<Essay, string>;
  clubEntries!: Table<ClubEntry, string>;
  protocols!: Table<Protocol, string>;
  protocolTasks!: Table<ProtocolTask, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('derm-path');
    this.version(1).stores({
      textbooks: 'id, order',
      sections: 'id, order',
      topics: 'id, sectionId, order, status',
      questions: 'id, topicId, textbookId, srs.due, createdAt',
      attempts: 'id, questionId, topicId, date',
      essayPrompts: 'id, topicId, isTemplate',
      essays: 'id, topicId, createdAt',
      clubEntries: 'id, date, role, activityType',
      protocols: 'id, updatedAt',
      protocolTasks: 'id, protocolId, due',
      meta: 'key',
    });
    this.on('populate', (tx) => {
      const seed = buildSeed();
      tx.table('textbooks').bulkAdd(seed.textbooks);
      tx.table('sections').bulkAdd(seed.sections);
      tx.table('topics').bulkAdd(seed.topics);
      tx.table('essayPrompts').bulkAdd(seed.essayPrompts);
      tx.table('meta').bulkAdd(seed.meta);
    });
  }
}

export const db = new DermPathDB();

export const TABLE_NAMES = [
  'textbooks',
  'sections',
  'topics',
  'questions',
  'attempts',
  'essayPrompts',
  'essays',
  'clubEntries',
  'protocols',
  'protocolTasks',
  'meta',
] as const;
export type TableName = (typeof TABLE_NAMES)[number];

export function buildSeed() {
  const now = nowIso();
  const textbooks: Textbook[] = SEED_TEXTBOOKS.map((t, i) => ({ id: uid(), ...t, order: i }));
  const sections: Section[] = [];
  const topics: Topic[] = [];
  SEED_SYLLABUS.forEach((s, si) => {
    const sectionId = uid();
    sections.push({ id: sectionId, name: s.section, order: si });
    s.topics.forEach((name, ti) =>
      topics.push({
        id: uid(),
        sectionId,
        name,
        order: ti,
        chapters: {},
        status: 'Not started',
        confidence: 0,
        notes: '',
        updatedAt: now,
      }),
    );
  });
  const essayPrompts: EssayPrompt[] = SEED_ESSAY_TEMPLATES.map((text) => ({
    id: uid(),
    text,
    isTemplate: true,
    createdAt: now,
  }));
  const meta: MetaRow[] = [
    { key: 'clubRoles', value: SEED_CLUB_ROLES },
    { key: 'activityTypes', value: SEED_ACTIVITY_TYPES },
  ];
  return { textbooks, sections, topics, essayPrompts, meta };
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return (row?.value as T) ?? fallback;
}

export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value });
}
