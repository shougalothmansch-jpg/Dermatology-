import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import type { Question } from '../../db/types';
import { ConfirmDialog, Empty } from '../../components/ui';
import AnkiCardView from '../../components/AnkiCardView';
import SourceQuote from '../../components/SourceQuote';
import AnkiImport from './AnkiImport';
import { toast } from '../../components/Toast';
import { useAiEnabled } from '../../lib/settings';
import { formatDate, pct, todayStr } from '../../lib/utils';
import GenerateQuestions from './GenerateQuestions';
import QuestionForm from './QuestionForm';
import { TopicSelect, type StudyData } from './useStudyData';

export default function QuestionBank({ data }: { data: StudyData }) {
  const questions = useLiveQuery(() => db.questions.orderBy('createdAt').reverse().toArray(), []);
  const [topicId, setTopicId] = useState('');
  const [textbookId, setTextbookId] = useState('');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Question | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Question | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [shown, setShown] = useState(50);
  const [aiEnabled] = useAiEnabled();
  const today = todayStr();

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (questions ?? []).filter(
      (q) =>
        (!topicId || q.topicId === topicId) &&
        (!textbookId || q.textbookId === textbookId) &&
        (!type || q.type === type || (type === 'sourced' && !!q.source)) &&
        (!s || q.stem.toLowerCase().includes(s) || q.explanation.toLowerCase().includes(s)),
    );
  }, [questions, topicId, textbookId, type, search]);

  if (!questions) return null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className="input max-w-xs flex-1" placeholder="Search questions…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <TopicSelect data={data} value={topicId} onChange={setTopicId} allowEmpty emptyLabel="All topics" className="input w-auto max-w-[14rem]" />
        <select className="input w-auto" value={textbookId} onChange={(e) => setTextbookId(e.target.value)}>
          <option value="">All textbooks</option>
          {data.textbooks.map((b) => <option key={b.id} value={b.id}>{b.shortName}</option>)}
        </select>
        <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          <option value="mcq">MCQ</option>
          <option value="short">Short answer</option>
          <option value="anki">Anki cards</option>
          <option value="sourced">From my textbooks</option>
        </select>
        <div className="ml-auto flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => setImporting(true)}>⇪ Import Anki deck</button>
          {aiEnabled && <button className="btn-secondary" onClick={() => setGenerating(true)}>✦ Generate questions</button>}
          <button className="btn-primary" onClick={() => setEditing('new')}>+ New question</button>
        </div>
      </div>
      <div className="muted mb-3 text-sm">{filtered.length} of {questions.length} questions</div>

      {filtered.length === 0 ? (
        <Empty title={questions.length ? 'No questions match these filters' : 'Your question bank is empty'}>
          {!questions.length && 'Write your first MCQ or short-answer question to start quizzing.'}
        </Empty>
      ) : (
        <ul className="space-y-2">
          {filtered.slice(0, shown).map((q) => {
            const topic = data.topicById.get(q.topicId);
            const book = q.textbookId ? data.textbookById.get(q.textbookId) : undefined;
            const isOpen = expanded === q.id;
            return (
              <li key={q.id} className="card p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <button className="min-w-0 flex-1 text-left" onClick={() => setExpanded(isOpen ? null : q.id)}>
                    <div className="mb-1 flex flex-wrap gap-1.5 text-xs">
                      <span className="badge bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300">{q.type === 'mcq' ? 'MCQ' : q.type === 'anki' ? 'Anki' : 'Short answer'}</span>
                      {q.source && <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">📖 sourced</span>}
                      <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{topic?.name ?? 'Unknown topic'}</span>
                      {book && <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{book.shortName}{q.chapter && ` ch. ${q.chapter}`}</span>}
                      {q.tags?.includes('ai-draft') && <span className="badge bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">AI-drafted</span>}
                    </div>
                    <div className={isOpen ? 'whitespace-pre-wrap text-sm' : 'line-clamp-2 text-sm'}>{q.stem}</div>
                  </button>
                  <div className="text-right text-xs">
                    <div className="font-medium">{q.attempts ? `${pct(q.correct, q.attempts)}% (${q.correct}/${q.attempts})` : 'Not attempted'}</div>
                    <div className={q.srs.due <= today ? 'text-amber-600 dark:text-amber-400' : 'muted'}>
                      {q.srs.due <= today ? 'Due now' : `Due ${formatDate(q.srs.due)}`}
                    </div>
                  </div>
                </div>
                {isOpen && (
                  <div className="mt-3 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
                    {q.type === 'anki' && q.anki ? (
                      <div className="mb-2 space-y-3">
                        <AnkiCardView html={q.anki.front} notetypeId={q.anki.notetypeId} />
                        <hr className="border-slate-200 dark:border-slate-700" />
                        <AnkiCardView html={q.anki.back} notetypeId={q.anki.notetypeId} />
                      </div>
                    ) : q.type === 'mcq' ? (
                      <ol className="mb-2 space-y-1">
                        {q.options.map((o, i) => (
                          <li key={i} className={i === q.correctIndex ? 'font-medium text-emerald-700 dark:text-emerald-400' : ''}>
                            {String.fromCharCode(65 + i)}. {o} {i === q.correctIndex && '✓'}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="mb-2 whitespace-pre-wrap"><b>Answer:</b> {q.answer}</p>
                    )}
                    {q.source && <div className="mb-2"><SourceQuote source={q.source} /></div>}
                    {q.explanation && <p className="muted whitespace-pre-wrap">{q.explanation}</p>}
                    <div className="mt-3 flex gap-2">
                      <button className="btn-secondary btn-sm" onClick={() => setEditing(q)}>Edit</button>
                      <button className="btn-ghost btn-sm text-rose-600" onClick={() => setDeleting(q)}>Delete</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {filtered.length > shown && (
        <div className="mt-4 text-center">
          <button className="btn-secondary" onClick={() => setShown((n) => n + 100)}>Show more ({filtered.length - shown} left)</button>
        </div>
      )}

      {importing && <AnkiImport onClose={() => setImporting(false)} />}
      {editing && <QuestionForm data={data} question={editing === 'new' ? null : editing} defaultTopicId={topicId || undefined} onClose={() => setEditing(null)} />}
      {generating && <GenerateQuestions data={data} defaultTopicId={topicId || undefined} onClose={() => setGenerating(false)} />}
      <ConfirmDialog
        open={!!deleting}
        title="Delete question?"
        message="This question and its attempt history will be permanently removed."
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await db.transaction('rw', [db.questions, db.attempts], async () => {
            await db.attempts.where('questionId').equals(deleting.id).delete();
            await db.questions.delete(deleting.id);
          });
          toast('Question deleted');
        }}
      />
    </div>
  );
}
