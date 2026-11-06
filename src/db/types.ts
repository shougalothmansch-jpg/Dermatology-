// ---------- Study ----------

export interface Textbook {
  id: string;
  name: string;
  shortName: string;
  edition?: string;
  order: number;
}

export interface Section {
  id: string;
  name: string;
  order: number;
}

export const TOPIC_STATUSES = [
  'Not started',
  'Reading',
  'Questions done',
  'Essay done',
  'Mastered',
] as const;
export type TopicStatus = (typeof TOPIC_STATUSES)[number];

export interface Topic {
  id: string;
  sectionId: string;
  name: string;
  order: number;
  /** textbookId -> chapter reference (free text, e.g. "12" or "12–13") */
  chapters: Record<string, string>;
  status: TopicStatus;
  /** 0 = unrated, 1–5 */
  confidence: number;
  notes: string;
  updatedAt: string;
}

export type QuestionType = 'mcq' | 'short';

export interface SrsState {
  ease: number;
  interval: number; // days
  reps: number;
  lapses: number;
  due: string; // YYYY-MM-DD
  lastReviewed?: string;
}

export interface Question {
  id: string;
  topicId: string;
  textbookId?: string;
  chapter?: string;
  type: QuestionType;
  stem: string;
  options: string[]; // MCQ only
  correctIndex: number; // MCQ only
  answer: string; // short answer model answer
  explanation: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  srs: SrsState;
  attempts: number;
  correct: number;
}

export interface Attempt {
  id: string;
  questionId: string;
  topicId: string;
  correct: boolean;
  quality: number; // 0–5
  date: string; // ISO datetime
}

export interface EssayPrompt {
  id: string;
  /** Use {topic} as a placeholder for the topic name in templates */
  text: string;
  isTemplate: boolean;
  topicId?: string;
  createdAt: string;
}

export const RUBRIC_CRITERIA = [
  { key: 'structure', label: 'Structure & flow' },
  { key: 'pathogenesis', label: 'Pathogenesis' },
  { key: 'clinical', label: 'Clinical features' },
  { key: 'differentials', label: 'Differentials' },
  { key: 'investigations', label: 'Investigations' },
  { key: 'management', label: 'Management' },
  { key: 'references', label: 'References' },
] as const;
export type RubricKey = (typeof RUBRIC_CRITERIA)[number]['key'];

export interface Essay {
  id: string;
  topicId: string;
  prompt: string;
  content: string; // HTML
  wordCount: number;
  timeLimitMin?: number;
  durationSec: number;
  rubric: Partial<Record<RubricKey, number>>; // 0–5 each
  score: number; // percentage 0–100
  reflection: string;
  createdAt: string;
  updatedAt: string;
}

// ---------- Interest group ----------

export interface ClubEntry {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  role: string;
  activityType: string;
  description: string;
  hours: number;
  people: string;
  outcome: string;
  links: string[];
  createdAt: string;
  updatedAt: string;
}

// ---------- Research ----------

export interface Protocol {
  id: string; // PRS-YYYY-NNN
  name: string;
  fields: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface ProtocolTask {
  id: string;
  protocolId: string;
  title: string;
  due: string; // YYYY-MM-DD or ''
  done: boolean;
  isMilestone: boolean;
  createdAt: string;
}

// ---------- Misc ----------

export interface MetaRow {
  key: string;
  value: unknown;
}
