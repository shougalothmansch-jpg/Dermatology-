import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../../db/db';
import type { Question } from '../../db/types';
import { Field, Modal } from '../../components/ui';
import { toast } from '../../components/Toast';
import { getApiKey } from '../../lib/settings';
import { cx } from '../../lib/utils';
import { pageLabel } from './BookFiles';
import { blankQuestion, normalizeQuestion, QuestionFields, validateQuestion } from './QuestionForm';
import { TopicSelect, type StudyData } from './useStudyData';

interface Draft {
  q: Question;
  keep: boolean;
  /** false when the quoted passage could not be found on the cited page */
  quoteVerified?: boolean;
}

const MAX_PAGES = 40;

export default function GenerateQuestions({
  data,
  defaultTopicId,
  initialPages,
  onClose,
}: {
  data: StudyData;
  defaultTopicId?: string;
  initialPages?: { fileId: string; from: number; to: number };
  onClose: () => void;
}) {
  const files = useLiveQuery(() => db.bookFiles.toArray(), []);
  const [topicId, setTopicId] = useState(defaultTopicId ?? '');
  const [fromBook, setFromBook] = useState(!!initialPages);
  const [fileId, setFileId] = useState(initialPages?.fileId ?? '');
  const [from, setFrom] = useState(String(initialPages?.from ?? 1));
  const [to, setTo] = useState(String(initialPages?.to ?? 5));
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState('Intermediate (residency level)');
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const apiKey = getApiKey();

  const textFiles = (files ?? []).filter((f) => f.hasText);
  const file = textFiles.find((f) => f.id === fileId);
  const pFrom = Math.max(1, parseInt(from, 10) || 1);
  const pTo = Math.min(file?.pageCount ?? 9999, Math.max(pFrom, parseInt(to, 10) || pFrom));
  const rangeError = fromBook && file && pTo - pFrom + 1 > MAX_PAGES ? `Pick at most ${MAX_PAGES} pages at a time.` : null;

  const run = async () => {
    const topic = data.topicById.get(topicId);
    if (!topic || !apiKey) return;
    setError(null);
    try {
      let sourceText: string | undefined;
      let pages: Map<number, string> | undefined;
      let sourceLabel: string | undefined;
      if (fromBook) {
        if (!file) return setError('Choose a PDF.');
        if (rangeError) return setError(rangeError);
        const { openPdf, rangeText } = await import('../../lib/pdf');
        setBusy('Reading pages…');
        const doc = await openPdf(file.blob);
        try {
          const r = await rangeText(doc, pFrom, pTo, (p) => setBusy(`Reading page ${p} of ${pTo}…`));
          sourceText = r.text;
          pages = r.pages;
        } finally {
          void doc.destroy();
        }
        if (sourceText.replace(/\[Page \d+\]|\s/g, '').length < 200) throw new Error('These pages contain almost no text to write questions from.');
        const book = data.textbookById.get(file.textbookId);
        sourceLabel = `${book?.name ?? 'a dermatology textbook'} (${file.name})`;
      }
      setBusy('Writing questions… (this can take a minute)');
      const api = await import('../../lib/anthropic');
      const { quoteFound } = await import('../../lib/pdf');
      const result = await api
        .generateQuestions({
          apiKey,
          topic: topic.name,
          section: data.sectionById.get(topic.sectionId)?.name ?? '',
          count,
          difficulty,
          focus: focus.trim() || undefined,
          sourceText,
          sourceLabel,
        })
        .catch((e) => {
          throw new Error(api.describeApiError(e));
        });
      setDrafts(
        result.map((r) => {
          const q: Question = {
            ...blankQuestion(topicId),
            stem: r.stem,
            options: r.options.slice(0, 5),
            correctIndex: Math.min(r.correctIndex, 4),
            explanation: r.explanation,
            tags: ['ai-draft'],
          };
          let quoteVerified: boolean | undefined;
          if (fromBook && file && pages && r.sourceQuote) {
            // accept the cited page, or find the quote on a neighbouring page if the model was off by one
            let page = r.sourcePage ?? pFrom;
            quoteVerified = quoteFound(r.sourceQuote, pages.get(page) ?? '');
            if (!quoteVerified) {
              for (const [p, t] of pages) if (quoteFound(r.sourceQuote, t)) {
                page = p;
                quoteVerified = true;
                break;
              }
            }
            q.source = { fileId: file.id, page: Math.min(Math.max(page, pFrom), pTo), quote: r.sourceQuote };
            q.textbookId = file.textbookId;
            q.chapter = data.topicById.get(topicId)?.chapters[file.textbookId] || '';
          }
          return { keep: quoteVerified !== false, quoteVerified, q };
        }),
      );
      if (!result.length) setError('No questions were returned. Try again.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const saveKept = async () => {
    const kept = drafts.filter((d) => d.keep);
    for (const [i, d] of kept.entries()) {
      const err = validateQuestion(d.q);
      if (err) return setError(`Draft ${i + 1}: ${err}`);
    }
    await db.questions.bulkPut(kept.map((d) => normalizeQuestion(d.q)));
    toast(`${kept.length} question${kept.length === 1 ? '' : 's'} saved`);
    onClose();
  };

  const unverified = drafts.filter((d) => d.quoteVerified === false).length;

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Generate questions (AI draft)"
      footer={
        drafts.length ? (
          <>
            {error && <span className="mr-auto self-center text-sm text-rose-600">{error}</span>}
            <button className="btn-secondary" onClick={() => setDrafts([])}>Back</button>
            <button className="btn-primary" disabled={!drafts.some((d) => d.keep)} onClick={saveKept}>
              Save {drafts.filter((d) => d.keep).length} reviewed
            </button>
          </>
        ) : (
          <>
            {error && <span className="mr-auto self-center text-sm text-rose-600">{error}</span>}
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={!topicId || !apiKey || !!busy || (fromBook && (!file || !!rangeError))} onClick={run}>
              {busy ? 'Working…' : 'Generate drafts'}
            </button>
          </>
        )
      }
    >
      {!apiKey ? (
        <p className="text-sm">
          Add your Anthropic API key in <Link to="/settings" className="text-brand-600 underline" onClick={onClose}>Settings</Link> first.
        </p>
      ) : drafts.length === 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <span className="label">Write questions from</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { v: true, t: 'My textbook pages', d: 'Only facts in the pages you choose, each with a page + exact quote.' },
                { v: false, t: 'General knowledge', d: 'Claude writes from its own knowledge of the topic.' },
              ].map((o) => (
                <button
                  key={String(o.v)}
                  type="button"
                  onClick={() => setFromBook(o.v)}
                  className={cx('rounded-lg border p-3 text-left', fromBook === o.v ? 'border-brand-500 bg-brand-50 dark:bg-brand-950' : 'border-slate-200 dark:border-slate-700')}
                >
                  <div className="text-sm font-semibold">{o.t}</div>
                  <div className="muted text-xs">{o.d}</div>
                </button>
              ))}
            </div>
          </div>

          {fromBook && (
            <>
              <Field label="PDF" className="sm:col-span-2">
                <select className="input" value={fileId} onChange={(e) => setFileId(e.target.value)}>
                  <option value="">Choose a PDF…</option>
                  {data.textbooks.map((b) => {
                    const fs = textFiles.filter((f) => f.textbookId === b.id);
                    return fs.length ? (
                      <optgroup key={b.id} label={b.name}>
                        {fs.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.pageCount} pp)</option>)}
                      </optgroup>
                    ) : null;
                  })}
                </select>
                {files && textFiles.length === 0 && (
                  <span className="mt-1 block text-xs text-amber-600">No PDFs with text yet — add them under Study → Textbooks.</span>
                )}
              </Field>
              <Field label="From PDF page" hint={file ? pageLabel(file, pFrom) : undefined}>
                <input className="input" inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, ''))} />
              </Field>
              <Field label="To PDF page" hint={file ? `${pageLabel(file, pTo)} · ${pTo - pFrom + 1} pages` : undefined}>
                <input className="input" inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, ''))} />
              </Field>
              {rangeError && <p className="text-sm text-rose-600 sm:col-span-2">{rangeError}</p>}
            </>
          )}

          <Field label="Tag questions to topic" className="sm:col-span-2"><TopicSelect data={data} value={topicId} onChange={setTopicId} /></Field>
          <Field label="Number of questions">
            <input type="number" min={1} max={20} className="input" value={count} onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
          </Field>
          <Field label="Difficulty">
            <select className="input" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option>Foundational (medical student)</option>
              <option>Intermediate (residency level)</option>
              <option>Advanced (board exam level)</option>
            </select>
          </Field>
          <Field label="Focus (optional)" className="sm:col-span-2" hint="e.g. histopathology, first-line treatment, associated syndromes">
            <input className="input" value={focus} onChange={(e) => setFocus(e.target.value)} />
          </Field>
          {busy && <p className="text-sm text-brand-700 dark:text-brand-300 sm:col-span-2">{busy}</p>}
          <p className="muted text-xs sm:col-span-2">
            {fromBook
              ? 'The text of the selected pages is sent from this browser to the Anthropic API with your key, only to write these questions. '
              : 'Your key is sent directly from this browser to the Anthropic API. '}
            Drafts can contain errors — review every question before saving.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="muted text-sm">
            Review and edit each draft. Untick any you don't want to keep.
            {unverified > 0 && <span className="text-amber-600"> {unverified} quote{unverified === 1 ? '' : 's'} couldn't be matched word-for-word in the PDF and {unverified === 1 ? 'is' : 'are'} unticked — check before keeping.</span>}
          </p>
          {drafts.map((d, i) => (
            <div key={d.q.id} className={cx('rounded-lg border p-4', d.quoteVerified === false ? 'border-amber-400' : 'border-slate-200 dark:border-slate-700')}>
              <label className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={d.keep} onChange={(e) => setDrafts((ds) => ds.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} />
                Draft {i + 1}
                {d.quoteVerified === true && <span className="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">quote verified</span>}
                {d.quoteVerified === false && <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">quote not found in PDF</span>}
              </label>
              {d.keep && <QuestionFields data={data} q={d.q} onChange={(q) => setDrafts((ds) => ds.map((x, j) => (j === i ? { ...x, q } : x)))} />}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
