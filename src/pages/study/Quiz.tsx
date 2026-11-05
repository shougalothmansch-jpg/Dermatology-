import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import type { Question } from '../../db/types';
import { Card, Field, ProgressBar } from '../../components/ui';
import { QUALITY_BUTTONS, reviewSrs } from '../../lib/sm2';
import { cx, nowIso, pct, shuffle, todayStr, uid } from '../../lib/utils';
import { TopicSelect, type StudyData } from './useStudyData';

export type QuizMode = 'due' | 'topic' | 'textbook' | 'mixed' | 'weak';

const MODES: { id: QuizMode; label: string; desc: string }[] = [
  { id: 'due', label: 'Due for review', desc: 'Spaced-repetition queue: questions scheduled for today or earlier.' },
  { id: 'topic', label: 'By topic', desc: 'All questions for one topic.' },
  { id: 'textbook', label: 'By textbook', desc: 'Questions tagged to a textbook (optionally one chapter).' },
  { id: 'mixed', label: 'Mixed random', desc: 'A random mix across your whole bank.' },
  { id: 'weak', label: 'Weak areas', desc: 'Lowest-confidence topics and most-missed questions first.' },
];

interface Result {
  questionId: string;
  correct: boolean;
  quality: number;
}

/** Higher = weaker. */
export function weaknessScore(q: Question, topicConfidence: number, topicAcc: number | null): number {
  const qAcc = q.attempts ? q.correct / q.attempts : null;
  let s = 0;
  if (qAcc !== null) s += (1 - qAcc) * 3;
  if (topicAcc !== null) s += (1 - topicAcc) * 2;
  if (topicConfidence > 0) s += (5 - topicConfidence) * 0.6;
  else s += 1; // unrated topics are mildly weak
  s += Math.min(q.srs.lapses, 5) * 0.4;
  if (!q.attempts) s += 0.5;
  return s;
}

export function buildWeakQueue(questions: Question[], data: StudyData): Question[] {
  const topicTotals = new Map<string, { a: number; c: number }>();
  for (const q of questions) {
    const t = topicTotals.get(q.topicId) ?? { a: 0, c: 0 };
    t.a += q.attempts;
    t.c += q.correct;
    topicTotals.set(q.topicId, t);
  }
  return questions
    .map((q) => {
      const tt = topicTotals.get(q.topicId);
      const tAcc = tt && tt.a ? tt.c / tt.a : null;
      return { q, s: weaknessScore(q, data.topicById.get(q.topicId)?.confidence ?? 0, tAcc) };
    })
    .sort((a, b) => b.s - a.s)
    .map((x) => x.q);
}

export default function Quiz({ data, initialMode = 'due' }: { data: StudyData; initialMode?: QuizMode }) {
  const questions = useLiveQuery(() => db.questions.toArray(), []);
  const [mode, setMode] = useState<QuizMode>(initialMode);
  const [topicId, setTopicId] = useState('');
  const [textbookId, setTextbookId] = useState('');
  const [chapter, setChapter] = useState('');
  const [count, setCount] = useState(20);
  const [session, setSession] = useState<Question[] | null>(null);

  const today = todayStr();
  const pool = useMemo(() => {
    const qs = questions ?? [];
    switch (mode) {
      case 'due':
        return qs.filter((q) => q.srs.due <= today).sort((a, b) => a.srs.due.localeCompare(b.srs.due));
      case 'topic':
        return topicId ? shuffle(qs.filter((q) => q.topicId === topicId)) : [];
      case 'textbook':
        return textbookId
          ? shuffle(qs.filter((q) => q.textbookId === textbookId && (!chapter.trim() || (q.chapter ?? '').trim() === chapter.trim())))
          : [];
      case 'mixed':
        return shuffle(qs);
      case 'weak':
        return buildWeakQueue(qs, data);
    }
  }, [questions, mode, topicId, textbookId, chapter, today, data]);

  if (!questions) return null;

  if (session) return <QuizSession data={data} questions={session} onExit={() => setSession(null)} />;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <Card title="Start a quiz">
        <div className="mb-5 grid gap-2 sm:grid-cols-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={cx(
                'rounded-lg border p-3 text-left transition-colors',
                mode === m.id
                  ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-950'
                  : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600',
              )}
            >
              <div className="text-sm font-semibold">{m.label}</div>
              <div className="muted text-xs">{m.desc}</div>
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {mode === 'topic' && (
            <Field label="Topic" className="sm:col-span-2"><TopicSelect data={data} value={topicId} onChange={setTopicId} /></Field>
          )}
          {mode === 'textbook' && (
            <>
              <Field label="Textbook">
                <select className="input" value={textbookId} onChange={(e) => setTextbookId(e.target.value)}>
                  <option value="">Select…</option>
                  {data.textbooks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
              <Field label="Chapter (optional)"><input className="input" value={chapter} onChange={(e) => setChapter(e.target.value)} placeholder="Any" /></Field>
            </>
          )}
          <Field label="Max questions">
            <input type="number" min={1} className="input" value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} />
          </Field>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <button className="btn-primary" disabled={pool.length === 0} onClick={() => setSession(pool.slice(0, count))}>
            Start ({Math.min(pool.length, count)} question{Math.min(pool.length, count) === 1 ? '' : 's'})
          </button>
          {pool.length === 0 && (
            <span className="muted text-sm">
              {questions.length === 0 ? 'Add questions in the Question bank first.' : mode === 'due' ? 'Nothing due — nice work!' : 'No questions match.'}
            </span>
          )}
        </div>
      </Card>
      <Card title="Queue">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="muted">Total questions</span><b>{questions.length}</b></div>
          <div className="flex justify-between"><span className="muted">Due today</span><b>{questions.filter((q) => q.srs.due <= today).length}</b></div>
          <div className="flex justify-between"><span className="muted">Never attempted</span><b>{questions.filter((q) => !q.attempts).length}</b></div>
          <div className="flex justify-between"><span className="muted">Missed at least once</span><b>{questions.filter((q) => q.srs.lapses > 0).length}</b></div>
        </div>
        <p className="muted mt-4 text-xs">
          After each answer, rate how well you knew it. “Again” or a wrong MCQ brings it back tomorrow; “Hard” shortens the interval; “Good” and “Easy” push it further out.
        </p>
      </Card>
    </div>
  );
}

function QuizSession({ data, questions, onExit }: { data: StudyData; questions: Question[]; onExit: () => void }) {
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [shortText, setShortText] = useState('');
  const [results, setResults] = useState<Result[]>([]);

  const q = questions[idx];
  const done = idx >= questions.length;

  const record = async (quality: number, correct: boolean) => {
    const fresh = await db.questions.get(q.id);
    if (fresh) {
      await db.transaction('rw', [db.questions, db.attempts], async () => {
        await db.questions.update(q.id, {
          srs: reviewSrs(fresh.srs, quality),
          attempts: fresh.attempts + 1,
          correct: fresh.correct + (correct ? 1 : 0),
        });
        await db.attempts.add({ id: uid(), questionId: q.id, topicId: q.topicId, correct, quality, date: nowIso() });
      });
    }
    setResults((r) => [...r, { questionId: q.id, correct, quality }]);
    setIdx((i) => i + 1);
    setSelected(null);
    setRevealed(false);
    setShortText('');
  };

  if (done) {
    const correct = results.filter((r) => r.correct).length;
    const missed = results.filter((r) => !r.correct).map((r) => questions.find((x) => x.id === r.questionId)!);
    return (
      <Card title="Quiz complete">
        <div className="mb-4 text-4xl font-semibold text-slate-900 dark:text-white">{pct(correct, results.length)}%</div>
        <p className="muted mb-4 text-sm">{correct} of {results.length} correct. Results have been saved and your review schedule updated.</p>
        {missed.length > 0 && (
          <div className="mb-4">
            <div className="label">Missed — scheduled for tomorrow</div>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {missed.map((m) => <li key={m.id} className="line-clamp-2">{m.stem}</li>)}
            </ul>
          </div>
        )}
        <button className="btn-primary" onClick={onExit}>Back to quiz setup</button>
      </Card>
    );
  }

  const topic = data.topicById.get(q.topicId);
  const isMcq = q.type === 'mcq';
  const mcqCorrect = selected === q.correctIndex;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex items-center gap-3">
        <button className="btn-ghost btn-sm" onClick={onExit}>✕ End</button>
        <ProgressBar value={pct(idx, questions.length)} className="flex-1" />
        <span className="muted text-sm">{idx + 1}/{questions.length}</span>
      </div>
      <Card>
        <div className="muted mb-2 text-xs">{topic?.name}{q.chapter && ` · ch. ${q.chapter}`}</div>
        <p className="mb-5 whitespace-pre-wrap text-base leading-relaxed text-slate-900 dark:text-slate-100">{q.stem}</p>

        {isMcq ? (
          <div className="space-y-2">
            {q.options.map((o, i) => {
              const state = !revealed ? (selected === i ? 'sel' : '') : i === q.correctIndex ? 'right' : selected === i ? 'wrong' : 'dim';
              return (
                <button
                  key={i}
                  disabled={revealed}
                  onClick={() => {
                    setSelected(i);
                    setRevealed(true);
                  }}
                  className={cx(
                    'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                    state === '' && 'border-slate-200 hover:border-brand-400 hover:bg-brand-50 dark:border-slate-700 dark:hover:bg-slate-800',
                    state === 'right' && 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950',
                    state === 'wrong' && 'border-rose-500 bg-rose-50 dark:bg-rose-950',
                    state === 'dim' && 'border-slate-200 opacity-60 dark:border-slate-700',
                  )}
                >
                  <span className="font-semibold text-slate-500">{String.fromCharCode(65 + i)}</span>
                  <span className="flex-1">{o}</span>
                  {state === 'right' && <span className="text-emerald-600">✓</span>}
                  {state === 'wrong' && <span className="text-rose-600">✕</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <div>
            <textarea className="input min-h-[100px]" placeholder="Type your answer (optional), then reveal…" value={shortText} onChange={(e) => setShortText(e.target.value)} disabled={revealed} />
            {!revealed && <button className="btn-primary mt-3" onClick={() => setRevealed(true)}>Show answer</button>}
            {revealed && (
              <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-950">
                <div className="label">Model answer</div>
                <p className="whitespace-pre-wrap">{q.answer}</p>
              </div>
            )}
          </div>
        )}

        {revealed && (
          <>
            {q.explanation && (
              <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
                <div className="label">Explanation</div>
                <p className="whitespace-pre-wrap">{q.explanation}</p>
              </div>
            )}
            <div className="mt-5">
              {isMcq && !mcqCorrect ? (
                <button className="btn-primary" onClick={() => record(1, false)}>Next — review again tomorrow</button>
              ) : (
                <>
                  <div className="label">How well did you know it?</div>
                  <div className="flex flex-wrap gap-2">
                    {QUALITY_BUTTONS.filter((b) => !isMcq || b.quality >= 3).map((b) => (
                      <button key={b.label} className={b.quality === 4 ? 'btn-primary' : 'btn-secondary'} onClick={() => record(b.quality, b.quality >= 3)}>
                        {b.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
