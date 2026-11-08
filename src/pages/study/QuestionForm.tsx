import { useState } from 'react';
import { db } from '../../db/db';
import type { Question, QuestionType } from '../../db/types';
import { Field, Modal } from '../../components/ui';
import AnkiCardView from '../../components/AnkiCardView';
import SourceQuote from '../../components/SourceQuote';
import { toast } from '../../components/Toast';
import { newSrs } from '../../lib/sm2';
import { cx, nowIso, uid } from '../../lib/utils';
import { TopicSelect, type StudyData } from './useStudyData';

export function blankQuestion(topicId = ''): Question {
  return {
    id: uid(),
    topicId,
    type: 'mcq',
    stem: '',
    options: ['', '', '', '', ''],
    correctIndex: 0,
    answer: '',
    explanation: '',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    srs: newSrs(),
    attempts: 0,
    correct: 0,
  };
}

export function validateQuestion(q: Question): string | null {
  if (!q.topicId) return 'Choose a topic.';
  if (q.type === 'anki') return null;
  if (!q.stem.trim()) return 'Write the question stem.';
  if (q.type === 'mcq') {
    const filled = q.options.filter((o) => o.trim());
    if (filled.length < 4) return 'MCQs need at least 4 options.';
    if (!q.options[q.correctIndex]?.trim()) return 'Mark a non-empty option as correct.';
  } else if (!q.answer.trim()) return 'Write the model answer.';
  return null;
}

/** Strip blank options while keeping the correct index aligned. */
export function normalizeQuestion(q: Question): Question {
  if (q.type === 'anki') return q;
  if (q.type !== 'mcq') return { ...q, options: [], correctIndex: 0 };
  const correctText = q.options[q.correctIndex];
  const options = q.options.map((o) => o.trim()).filter(Boolean);
  return { ...q, options, correctIndex: Math.max(0, options.indexOf(correctText.trim())) };
}

export function QuestionFields({ data, q, onChange }: { data: StudyData; q: Question; onChange: (q: Question) => void }) {
  const set = <K extends keyof Question>(k: K, v: Question[K]) => onChange({ ...q, [k]: v });
  const topic = data.topicById.get(q.topicId);
  const isAnki = q.type === 'anki';

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {isAnki ? (
        <div className="space-y-3 sm:col-span-2">
          <div className="muted text-xs">Anki card · {q.anki?.deck} — edit the card text in Anki and re-import; here you can change its topic, textbook link and notes.</div>
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"><AnkiCardView html={q.anki?.front ?? ''} notetypeId={q.anki?.notetypeId} /></div>
        </div>
      ) : (
      <Field label="Type">
        <select className="input" value={q.type} onChange={(e) => set('type', e.target.value as QuestionType)}>
          <option value="mcq">Multiple choice (MCQ)</option>
          <option value="short">Short answer</option>
        </select>
      </Field>
      )}
      <Field label="Topic">
        <TopicSelect data={data} value={q.topicId} onChange={(id) => set('topicId', id)} />
      </Field>
      <Field label="Textbook (optional)">
        <select
          className="input"
          value={q.textbookId ?? ''}
          onChange={(e) => {
            const tb = e.target.value || undefined;
            onChange({ ...q, textbookId: tb, chapter: q.chapter || (tb && topic?.chapters[tb]) || '' });
          }}
        >
          <option value="">—</option>
          {data.textbooks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </Field>
      <Field label="Chapter (optional)">
        <input className="input" value={q.chapter ?? ''} onChange={(e) => set('chapter', e.target.value)} placeholder="e.g. 8" />
      </Field>
      {q.source && (
        <div className="sm:col-span-2">
          <span className="label">Source passage</span>
          <SourceQuote source={q.source} onRemove={() => set('source', undefined)} />
        </div>
      )}
      {!isAnki && (<>
      <Field label="Question stem" className="sm:col-span-2">
        <textarea className="input min-h-[100px]" value={q.stem} onChange={(e) => set('stem', e.target.value)} placeholder="Clinical vignette or question…" />
      </Field>

      {q.type === 'mcq' ? (
        <div className="sm:col-span-2">
          <span className="label">Options — select the correct answer</span>
          <div className="space-y-2">
            {q.options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`correct-${q.id}`}
                  checked={q.correctIndex === i}
                  onChange={() => set('correctIndex', i)}
                  className="h-4 w-4 accent-brand-600"
                  aria-label={`Mark option ${String.fromCharCode(65 + i)} correct`}
                />
                <span className="w-5 text-sm font-semibold text-slate-500">{String.fromCharCode(65 + i)}</span>
                <input
                  className={cx('input', q.correctIndex === i && 'border-emerald-500 dark:border-emerald-500')}
                  value={opt}
                  onChange={(e) => set('options', q.options.map((o, j) => (j === i ? e.target.value : o)))}
                />
                {q.options.length > 4 && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => {
                      const options = q.options.filter((_, j) => j !== i);
                      const ci = q.correctIndex === i ? 0 : q.correctIndex > i ? q.correctIndex - 1 : q.correctIndex;
                      onChange({ ...q, options, correctIndex: ci });
                    }}
                    aria-label="Remove option"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {q.options.length < 5 && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => set('options', [...q.options, ''])}>+ Add option</button>
            )}
          </div>
        </div>
      ) : (
        <Field label="Model answer" className="sm:col-span-2">
          <textarea className="input min-h-[90px]" value={q.answer} onChange={(e) => set('answer', e.target.value)} />
        </Field>
      )}
      </>)}
      <Field label={isAnki ? 'My notes' : 'Explanation'} className="sm:col-span-2">
        <textarea className="input min-h-[90px]" value={q.explanation} onChange={(e) => set('explanation', e.target.value)} placeholder="Why the answer is correct, key distractors, a learning point…" />
      </Field>
    </div>
  );
}

export default function QuestionForm({
  data,
  question,
  defaultTopicId,
  initial,
  onClose,
}: {
  data: StudyData;
  question: Question | null;
  defaultTopicId?: string;
  /** prefill for a new question, e.g. a textbook passage */
  initial?: Partial<Question>;
  onClose: () => void;
}) {
  const [q, setQ] = useState<Question>(() => {
    if (!question) return { ...blankQuestion(defaultTopicId), ...initial };
    if (question.type === 'mcq' && question.options.length < 4) {
      return { ...question, options: [...question.options, ...Array(4 - question.options.length).fill('')] };
    }
    return question;
  });
  const [error, setError] = useState<string | null>(null);

  const save = async (addAnother: boolean) => {
    const err = validateQuestion(q);
    if (err) return setError(err);
    await db.questions.put({ ...normalizeQuestion(q), updatedAt: nowIso() });
    toast(question ? 'Question updated' : 'Question saved');
    if (addAnother) {
      setQ({ ...blankQuestion(q.topicId), type: q.type, textbookId: q.textbookId, chapter: q.chapter, source: q.source });
      setError(null);
    } else onClose();
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={question ? 'Edit question' : 'New question'}
      footer={
        <>
          {error && <span className="mr-auto self-center text-sm text-rose-600">{error}</span>}
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          {!question && <button className="btn-secondary" onClick={() => save(true)}>Save & add another</button>}
          <button className="btn-primary" onClick={() => save(false)}>Save</button>
        </>
      }
    >
      <QuestionFields data={data} q={q} onChange={setQ} />
    </Modal>
  );
}
