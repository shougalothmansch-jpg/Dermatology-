import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../db/db';
import type { Question, Topic } from '../db/types';
import type { BookMatch } from '../lib/bookSearch';
import { getApiKey, useAiEnabled } from '../lib/settings';
import SourceQuote from './SourceQuote';
import { toast } from './Toast';

/**
 * The textbook passage behind a question, shown after you answer:
 * your confirmed source if it has one, otherwise the best match found in your PDFs.
 */
export default function BookQuote({ question, topic }: { question: Question; topic?: Topic }) {
  const books = useLiveQuery(async () => {
    const files = await db.pdfs.toArray();
    return { total: files.length, searchable: files.filter((f) => (f.indexedPages ?? 0) > 0).length, indexing: files.some((f) => f.hasText && (f.indexedPages ?? 0) < f.pageCount) };
  }, []);
  const [matches, setMatches] = useState<BookMatch[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiEnabled] = useAiEnabled();
  // read live, so a source saved from this panel shows straight away
  const live = useLiveQuery(() => db.questions.get(question.id), [question.id]);
  const pinned = live ? live.source : question.source;

  useEffect(() => {
    if (pinned || !books?.searchable) return;
    let cancelled = false;
    setMatches(null);
    setIdx(0);
    import('../lib/bookSearch')
      .then((m) => m.findBookMatches(question, topic))
      .then((r) => !cancelled && setMatches(r))
      .catch(() => !cancelled && setMatches([]));
    return () => {
      cancelled = true;
    };
  }, [question, topic, pinned, books?.searchable]);

  const pin = async (m: BookMatch) => {
    const file = await db.pdfs.get(m.fileId);
    await db.questions.update(question.id, { source: { fileId: m.fileId, page: m.page, quote: m.quote }, textbookId: question.textbookId ?? file?.textbookId });
    toast('Saved as this question’s source');
  };

  const findWithAi = async () => {
    const key = getApiKey();
    if (!key || !matches?.length) return;
    setAiBusy(true);
    try {
      const { findQuote } = await import('../lib/anthropic');
      const { quoteFound } = await import('../lib/pdf');
      const { stripHtml } = await import('../lib/anki/template');
      // candidate pages: the pages of the best matches, deduplicated
      const seen = new Set<string>();
      const cands = matches.filter((m) => !seen.has(`${m.fileId}:${m.page}`) && seen.add(`${m.fileId}:${m.page}`)).slice(0, 5);
      const rows = await db.pdfPages.bulkGet(cands.map((c) => [c.fileId, c.page] as [string, number]));
      const pages = cands.map((c, i) => ({ ref: `P${i + 1}`, text: rows[i]?.text ?? '', c })).filter((p) => p.text);
      const q = question.anki ? stripHtml(question.anki.front) : question.stem;
      const a = question.anki ? stripHtml(question.anki.back) : question.type === 'mcq' ? `${question.options[question.correctIndex]}. ${question.explanation}` : `${question.answer} ${question.explanation}`;
      const r = await findQuote({ apiKey: key, question: q, answer: a, pages: pages.map(({ ref, text }) => ({ ref, text })) });
      const page = pages.find((p) => p.ref === r?.ref);
      if (!r || !page) return toast('Claude didn’t find this in the matched pages');
      if (!quoteFound(r.quote, page.text)) return toast('Claude’s quote didn’t match the book word-for-word — not saved');
      await pin({ fileId: page.c.fileId, page: page.c.page, quote: r.quote, score: 0 });
    } catch (e) {
      const { describeApiError } = await import('../lib/anthropic');
      toast(describeApiError(e));
    } finally {
      setAiBusy(false);
    }
  };

  if (pinned) return <SourceQuote source={pinned} label="From your textbook" />;
  if (!books) return null;
  if (!books.total)
    return (
      <p className="muted rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800">
        📖 Add your textbook PDFs under <Link to="/study?tab=textbooks" className="underline">Study → Textbooks</Link> to see the matching book quote here.
      </p>
    );
  if (!books.searchable)
    return <p className="muted rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800">📖 Your books are still being prepared for search — quotes will appear here soon.</p>;
  if (matches === null) return <p className="muted text-xs">📖 Searching your books…</p>;
  if (!matches.length)
    return <p className="muted rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800">📖 No matching passage found in your books{books.indexing ? ' yet (some are still being prepared)' : ''}.</p>;

  const m = matches[idx % matches.length];
  return (
    <SourceQuote source={m} label={`Best match in your books${matches.length > 1 ? ` · ${(idx % matches.length) + 1}/${matches.length}` : ''}`}>
      <button type="button" className="btn-secondary btn-sm" onClick={() => pin(m)}>✓ Use as source</button>
      {matches.length > 1 && (
        <button type="button" className="btn-ghost btn-sm" onClick={() => setIdx((i) => i + 1)}>Next match</button>
      )}
      {aiEnabled && (
        <button type="button" className="btn-ghost btn-sm" disabled={aiBusy} onClick={findWithAi}>
          {aiBusy ? 'Asking Claude…' : '✦ Find exact quote with AI'}
        </button>
      )}
    </SourceQuote>
  );
}
