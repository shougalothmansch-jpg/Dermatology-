import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../../db/db';
import type { Question, Topic, TopicPages } from '../../db/types';
import { Field, Modal, ProgressBar } from '../../components/ui';
import { toast } from '../../components/Toast';
import { getApiKey } from '../../lib/settings';
import { cx } from '../../lib/utils';
import { blankQuestion, normalizeQuestion } from './QuestionForm';
import type { StudyData } from './useStudyData';

const MAX_PAGES_PER_CALL = 40;
// Claude Opus 5.5 list prices (USD per million tokens), for a rough estimate only
const PRICE_IN = 4;
const PRICE_OUT = 20;

type Status = 'waiting' | 'running' | 'done' | 'skipped' | 'error';
interface Job {
  topic: Topic;
  parts: TopicPages[]; // page ranges split to ≤40 pages each
  pages: number;
  existing: number;
  status: Status;
  saved: number;
  note?: string;
}

function splitRanges(pages: TopicPages[]): TopicPages[] {
  const out: TopicPages[] = [];
  for (const r of pages) for (let a = r.from; a <= r.to; a += MAX_PAGES_PER_CALL) out.push({ fileId: r.fileId, from: a, to: Math.min(r.to, a + MAX_PAGES_PER_CALL - 1) });
  return out;
}

/** Writes questions for every topic that is linked to textbook pages, one chapter at a time. */
export default function BatchGenerate({ data, onClose }: { data: StudyData; onClose: () => void }) {
  const files = useLiveQuery(() => db.pdfs.toArray(), []);
  const aiCounts = useLiveQuery(async () => {
    const m = new Map<string, number>();
    await db.questions.filter((q) => !!q.tags?.includes('ai-draft') && !!q.source).each((q) => m.set(q.topicId, (m.get(q.topicId) ?? 0) + 1));
    return m;
  }, []);
  const [perChapter, setPerChapter] = useState(5);
  const [difficulty, setDifficulty] = useState('Advanced (board exam level)');
  const [skipDone, setSkipDone] = useState(true);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [running, setRunning] = useState(false);
  const cancel = useRef(false);
  const apiKey = getApiKey();

  const fileById = useMemo(() => new Map((files ?? []).map((f) => [f.id, f])), [files]);
  const plan = useMemo(() => {
    if (!files || !aiCounts) return null;
    return data.topics
      .filter((t) => t.pages?.some((p) => fileById.get(p.fileId)?.hasText))
      .map((t) => {
        const ranges = (t.pages ?? []).filter((p) => fileById.get(p.fileId)?.hasText);
        return { topic: t, parts: splitRanges(ranges), pages: ranges.reduce((n, r) => n + r.to - r.from + 1, 0), existing: aiCounts.get(t.id) ?? 0 };
      });
  }, [data.topics, files, aiCounts, fileById]);

  const todo = (plan ?? []).filter((j) => !(skipDone && j.existing >= perChapter));
  const notIndexed = (files ?? []).filter((f) => f.hasText && (f.indexedPages ?? 0) < f.pageCount);
  const totalPages = todo.reduce((n, j) => n + j.pages, 0);
  // ~550 tokens of text per page + prompt; ~350 output tokens per question (plus thinking)
  const estUsd = (totalPages * 550 * PRICE_IN + todo.length * perChapter * 700 * PRICE_OUT) / 1e6;

  const run = async () => {
    if (!apiKey) return;
    cancel.current = false;
    setRunning(true);
    // keep the screen on while generating (iPhone pauses the app when the screen locks)
    let wake: { release: () => Promise<void> } | null = null;
    try {
      wake = await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null;
    } catch {
      /* not supported — the note in the dialog asks to keep the app open */
    }
    const list: Job[] = todo.map((j) => ({ ...j, status: 'waiting', saved: 0 }));
    setJobs(list);
    const update = (i: number, patch: Partial<Job>) => {
      list[i] = { ...list[i], ...patch };
      setJobs([...list]);
    };
    const api = await import('../../lib/anthropic');
    const { quoteFound } = await import('../../lib/pdf');
    let totalSaved = 0;
    for (let i = 0; i < list.length; i++) {
      if (cancel.current) break;
      const job = list[i];
      update(i, { status: 'running' });
      try {
        let saved = 0;
        const totalJobPages = job.parts.reduce((n, p) => n + p.to - p.from + 1, 0);
        for (const part of job.parts) {
          if (cancel.current) break;
          const n = Math.max(1, Math.round((perChapter * (part.to - part.from + 1)) / totalJobPages));
          const rows = await db.pdfPages.where('[fileId+page]').between([part.fileId, part.from], [part.fileId, part.to], true, true).toArray();
          const text = rows.map((r) => `[Page ${r.page}]\n${r.text}`).join('\n\n');
          if (text.replace(/\[Page \d+\]|\s/g, '').length < 80) continue; // blank or figure-only pages
          const file = fileById.get(part.fileId)!;
          const book = data.textbookById.get(file.textbookId);
          const drafts = await api.generateQuestions({
            apiKey,
            topic: job.topic.name,
            section: data.sectionById.get(job.topic.sectionId)?.name ?? '',
            count: n,
            difficulty,
            sourceText: text,
            sourceLabel: `${book?.name ?? 'a dermatology textbook'} (${file.name})`,
          });
          const pages = new Map(rows.map((r) => [r.page, r.text]));
          const keep: Question[] = [];
          for (const d of drafts) {
            // only keep questions whose quote is really in the book (allowing an off-by-one page)
            let page = d.sourcePage ?? part.from;
            let ok = !!d.sourceQuote && quoteFound(d.sourceQuote, pages.get(page) ?? '');
            if (!ok && d.sourceQuote) for (const [p, t] of pages) if (quoteFound(d.sourceQuote, t)) { page = p; ok = true; break; }
            if (!ok || d.options.length < 4) continue;
            keep.push(
              normalizeQuestion({
                ...blankQuestion(job.topic.id),
                stem: d.stem,
                options: d.options.slice(0, 5),
                correctIndex: Math.min(d.correctIndex, 4),
                explanation: d.explanation,
                tags: ['ai-draft'],
                textbookId: file.textbookId,
                chapter: book ? job.topic.chapters[book.id] || '' : '',
                source: { fileId: file.id, page, quote: d.sourceQuote! },
              }),
            );
          }
          await db.questions.bulkAdd(keep);
          saved += keep.length;
          update(i, { saved });
        }
        totalSaved += saved;
        update(i, { status: 'done', saved, note: saved ? undefined : 'no verifiable questions' });
      } catch (e) {
        update(i, { status: 'error', note: api.describeApiError(e) });
        // stop on problems that will repeat for every chapter
        if (/Invalid API key|permission|credit|billing/i.test(api.describeApiError(e))) break;
      }
    }
    void wake?.release().catch(() => undefined);
    setRunning(false);
    toast(cancel.current ? `Stopped — ${totalSaved} questions saved` : `Done — ${totalSaved} questions saved`);
  };

  const doneCount = jobs?.filter((j) => j.status === 'done' || j.status === 'error').length ?? 0;

  return (
    <Modal
      open
      wide
      onClose={() => !running && onClose()}
      title="Generate questions for every chapter"
      footer={
        jobs ? (
          running ? (
            <button className="btn-secondary" onClick={() => (cancel.current = true)}>Stop after this chapter</button>
          ) : (
            <button className="btn-primary" onClick={onClose}>Close</button>
          )
        ) : (
          <>
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={!apiKey || !todo.length} onClick={run}>
              Generate for {todo.length} chapter{todo.length === 1 ? '' : 's'}
            </button>
          </>
        )
      }
    >
      {!apiKey ? (
        <p className="text-sm">
          This uses Claude with your own Anthropic API key. Turn on <b>AI question drafting</b> and add your key in{' '}
          <Link to="/settings" className="text-brand-600 underline" onClick={onClose}>Settings</Link> first.
        </p>
      ) : !plan ? null : !plan.length ? (
        <div className="space-y-2 text-sm">
          <p>No topics are linked to textbook pages yet.</p>
          <p className="muted">
            Go to <b>Study → Textbooks</b>, tap <b>Topics from chapters</b> on each PDF, and apply. Then come back here.
          </p>
        </div>
      ) : !jobs ? (
        <div className="space-y-4 text-sm">
          <p className="muted">
            For each topic linked to book pages, Claude writes questions using only those pages. Every question cites a page and an exact quote, which the app checks against your PDF — questions whose quote can't be found are dropped. Questions are saved straight to your bank, marked <b>AI-drafted</b> so you can review them.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Questions per chapter">
              <input type="number" min={1} max={20} className="input" value={perChapter} onChange={(e) => setPerChapter(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
            </Field>
            <Field label="Difficulty">
              <select className="input" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                <option>Foundational (medical student)</option>
                <option>Intermediate (residency level)</option>
                <option>Advanced (board exam level)</option>
              </select>
            </Field>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-brand-600" checked={skipDone} onChange={(e) => setSkipDone(e.target.checked)} />
            Skip chapters that already have {perChapter}+ AI questions
          </label>
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
            <div>
              <b>{todo.length}</b> chapter{todo.length === 1 ? '' : 's'} · {totalPages} pages · about <b>{todo.length * perChapter}</b> questions
            </div>
            <div className="muted text-xs">
              Estimated cost on your Anthropic account: roughly ${Math.max(0.01, estUsd).toFixed(2)} (a rough guide; actual cost depends on the text). Takes about 30–60 seconds per chapter. Keep the app open and the phone unlocked; if it stops, tap this again — finished chapters are skipped. For a whole textbook, you can run it in a few sittings.
            </div>
          </div>
          {notIndexed.length > 0 && (
            <p className="text-xs text-amber-600">
              {notIndexed.map((f) => f.name).join(', ')} {notIndexed.length === 1 ? 'is' : 'are'} still being prepared for search — chapters from {notIndexed.length === 1 ? 'it' : 'them'} will have partial text until that finishes.
            </p>
          )}
          <details>
            <summary className="cursor-pointer text-xs text-slate-500">Show chapters</summary>
            <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto text-xs">
              {(plan ?? []).map((j) => (
                <li key={j.topic.id} className={cx(!todo.includes(j) && 'opacity-50')}>
                  {j.topic.name} — {j.pages} pp{j.existing ? ` · ${j.existing} AI questions already` : ''}
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <ProgressBar value={Math.round((doneCount / jobs.length) * 100)} />
          <div className="muted text-xs">
            {doneCount} of {jobs.length} chapters · {jobs.reduce((n, j) => n + j.saved, 0)} questions saved{running ? ' — keep the app open' : ''}
          </div>
          <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
            {jobs.map((j) => (
              <li key={j.topic.id} className="flex items-center gap-2">
                <span className="w-5 text-center">
                  {j.status === 'done' ? '✓' : j.status === 'running' ? '…' : j.status === 'error' ? '⚠' : '·'}
                </span>
                <span className={cx('min-w-0 flex-1 truncate', j.status === 'waiting' && 'muted')}>{j.topic.name}</span>
                <span className={cx('shrink-0 text-xs', j.status === 'error' ? 'text-rose-600' : 'muted')}>{j.note ?? (j.status === 'done' || j.saved ? `${j.saved} saved` : '')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
