import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { db } from '../../db/db';
import { Empty } from '../../components/ui';
import { toast } from '../../components/Toast';
import { useAiEnabled } from '../../lib/settings';
import { copyText, cx } from '../../lib/utils';
import type { PDFDocumentProxy } from '../../lib/pdf';
import { pageLabel } from './BookFiles';
import GenerateQuestions from './GenerateQuestions';
import QuestionForm from './QuestionForm';
import { useStudyData } from './useStudyData';

type Mode = 'page' | 'text';
const MODE_KEY = 'dermpath.readerMode';

export default function Reader() {
  const { fileId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const file = useLiveQuery(() => db.bookFiles.get(fileId).then((f) => f ?? null), [fileId]);
  const book = useLiveQuery(async () => (file ? await db.textbooks.get(file.textbookId) : undefined), [file?.textbookId]);
  const data = useStudyData();
  const [aiEnabled] = useAiEnabled();
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return (localStorage.getItem(MODE_KEY) as Mode) || 'page';
    } catch {
      return 'page';
    }
  });
  const [text, setText] = useState<string | null>(null);
  const [selection, setSelection] = useState('');
  const [makeQuestion, setMakeQuestion] = useState<string | null>(null);
  const [generate, setGenerate] = useState(false);
  const [pageInput, setPageInput] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  const total = doc?.numPages ?? file?.pageCount ?? 1;
  const page = Math.min(Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1), total);

  const goto = useCallback(
    (p: number) => {
      const n = Math.min(Math.max(1, p), total);
      setParams({ page: String(n) }, { replace: true });
      window.scrollTo({ top: 0 });
    },
    [setParams, total],
  );

  // open the PDF
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    let opened: PDFDocumentProxy | null = null;
    import('../../lib/pdf')
      .then(({ openPdf }) => openPdf(file.blob))
      .then((d) => {
        opened = d;
        if (cancelled) void d.destroy();
        else setDoc(d);
      })
      .catch(() => setError('Could not open this PDF.'));
    return () => {
      cancelled = true;
      void opened?.destroy();
      setDoc(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id]);

  // remember position
  useEffect(() => {
    setPageInput(String(page));
    if (file) {
      const t = setTimeout(() => db.bookFiles.update(file.id, { lastPage: page }), 600);
      return () => clearTimeout(t);
    }
  }, [page, file]);

  // render page image
  useEffect(() => {
    if (!doc || mode !== 'page') return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    (async () => {
      const p = await doc.getPage(page);
      if (cancelled || !canvasRef.current || !boxRef.current) return;
      const cssWidth = boxRef.current.clientWidth;
      const base = p.getViewport({ scale: 1 });
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const viewport = p.getViewport({ scale: (cssWidth / base.width) * dpr });
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
      task = p.render({ canvasContext: canvas.getContext('2d')!, viewport });
      await task.promise.catch(() => undefined);
      p.cleanup();
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, mode]);

  // extract page text
  useEffect(() => {
    if (!doc || mode !== 'text') return;
    let cancelled = false;
    setText(null);
    import('../../lib/pdf').then(({ pageText }) => pageText(doc, page)).then((t) => !cancelled && setText(t));
    return () => {
      cancelled = true;
    };
  }, [doc, page, mode]);

  // track text selection inside the text view
  useEffect(() => {
    const h = () => {
      const sel = window.getSelection();
      const node = sel?.anchorNode;
      if (sel && node && textRef.current?.contains(node)) setSelection(sel.toString().replace(/\s+/g, ' ').trim());
      else setSelection('');
    };
    document.addEventListener('selectionchange', h);
    return () => document.removeEventListener('selectionchange', h);
  }, []);

  // keyboard paging
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || makeQuestion || generate) return;
      if (e.key === 'ArrowRight') goto(page + 1);
      if (e.key === 'ArrowLeft') goto(page - 1);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [page, goto, makeQuestion, generate]);

  const switchMode = (m: Mode) => {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
  };

  if (file === undefined) return null;
  if (file === null)
    return (
      <Empty title="PDF not found on this device">
        <Link to="/study?tab=textbooks" className="text-brand-600 underline">Go to Textbooks</Link>
      </Empty>
    );

  // try to preselect the topic linked to this book's chapter, if any
  const guessTopic = data.topics.find((t) => file.name && t.chapters[file.textbookId] && file.name.toLowerCase().includes(`ch ${t.chapters[file.textbookId]}`.toLowerCase()))?.id;

  return (
    <div className="-mt-2">
      <div className="no-print sticky top-[calc(3.25rem+env(safe-area-inset-top))] z-20 -mx-4 mb-3 border-b border-slate-200 bg-slate-50/95 px-4 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 md:top-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/study?tab=textbooks" className="btn-ghost btn-sm">←</Link>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{file.name}</div>
            <div className="muted truncate text-xs">{book?.name} · {pageLabel(file, page)}</div>
          </div>
          <div className="inline-flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700">
            {(['page', 'text'] as Mode[]).map((m) => (
              <button key={m} className={cx('rounded-md px-2.5 py-1 text-xs font-medium', mode === m ? 'bg-brand-600 text-white dark:bg-brand-500 dark:text-slate-950' : 'text-slate-600 dark:text-slate-300')} onClick={() => switchMode(m)}>
                {m === 'page' ? 'Page' : 'Text'}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => goto(page - 1)} aria-label="Previous page">‹ Prev</button>
          <form
            className="flex items-center gap-1 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              goto(parseInt(pageInput, 10) || page);
            }}
          >
            <input className="input w-16 px-2 py-1 text-center" inputMode="numeric" value={pageInput} onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))} aria-label="PDF page" />
            <span className="muted whitespace-nowrap">/ {total}</span>
          </form>
          <button className="btn-secondary btn-sm" disabled={page >= total} onClick={() => goto(page + 1)} aria-label="Next page">Next ›</button>
          {aiEnabled && file.hasText && (
            <button className="btn-ghost btn-sm ml-auto whitespace-nowrap" onClick={() => setGenerate(true)}>✦ AI questions</button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div ref={boxRef} className="w-full">
        {mode === 'page' ? (
          <>
            <canvas ref={canvasRef} className="mx-auto block rounded bg-white shadow-sm" />
            {file.hasText && <p className="muted mt-3 text-center text-xs">To quote a passage, switch to <b>Text</b>, select it, then tap “Make question”.</p>}
          </>
        ) : !file.hasText ? (
          <Empty title="No selectable text">This looks like a scanned PDF. You can read it in Page view, but text selection and AI questions need a PDF with a text layer.</Empty>
        ) : (
          <div ref={textRef} className="card select-text whitespace-pre-wrap p-4 text-[15px] leading-relaxed sm:p-6" style={{ WebkitUserSelect: 'text' }}>
            {text === null ? <span className="muted">Loading text…</span> : text || <span className="muted">(No text on this page.)</span>}
          </div>
        )}
      </div>

      {selection.length >= 8 && mode === 'text' && (
        <div className="no-print fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 md:bottom-6">
          <div className="flex max-w-xl items-center gap-2 rounded-xl bg-slate-900 p-2 pl-3 text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
            <span className="line-clamp-1 min-w-0 flex-1 italic opacity-80">“{selection}”</span>
            <button className="btn-sm rounded-lg bg-white/15 px-2 py-1 dark:bg-slate-900/10" onClick={async () => toast((await copyText(selection)) ? 'Copied' : 'Copy failed')}>Copy</button>
            <button className="btn-sm whitespace-nowrap rounded-lg bg-brand-500 px-2.5 py-1 font-semibold text-white" onMouseDown={(e) => e.preventDefault()} onClick={() => setMakeQuestion(selection)}>
              Make question
            </button>
          </div>
        </div>
      )}

      {makeQuestion !== null && data.loaded && (
        <QuestionForm
          data={data}
          question={null}
          defaultTopicId={guessTopic}
          initial={{ type: 'short', textbookId: file.textbookId, source: { fileId: file.id, page, quote: makeQuestion }, answer: makeQuestion }}
          onClose={() => {
            setMakeQuestion(null);
            window.getSelection()?.removeAllRanges();
          }}
        />
      )}
      {generate && data.loaded && (
        <GenerateQuestions data={data} defaultTopicId={guessTopic} initialPages={{ fileId: file.id, from: page, to: Math.min(total, page + 4) }} onClose={() => setGenerate(false)} />
      )}
    </div>
  );
}
