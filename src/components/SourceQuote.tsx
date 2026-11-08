import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../db/db';
import type { QuestionSource } from '../db/types';
import { pageLabel } from '../pages/study/BookFiles';

/** Shows the textbook passage a question came from, with a link to that page in the reader. */
export default function SourceQuote({ source, onRemove }: { source: QuestionSource; onRemove?: () => void }) {
  const info = useLiveQuery(async () => {
    const file = await db.bookFiles.get(source.fileId);
    const book = file ? await db.textbooks.get(file.textbookId) : undefined;
    return { file, book };
  }, [source.fileId]);
  const file = info?.file;
  return (
    <figure className="rounded-lg border-l-4 border-brand-500 bg-brand-50/60 px-3 py-2 text-sm dark:bg-brand-950/40">
      <blockquote className="whitespace-pre-wrap italic text-slate-700 dark:text-slate-200">“{source.quote}”</blockquote>
      <figcaption className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span>
          📖 {info?.book?.shortName ?? 'Textbook'}
          {file && ` · ${file.name}`} · {pageLabel(file, source.page)}
        </span>
        {file ? (
          <Link to={`/read/${file.id}?page=${source.page}`} className="font-medium text-brand-700 underline dark:text-brand-300">
            Open page
          </Link>
        ) : (
          info && <span>(PDF not on this device)</span>
        )}
        {onRemove && (
          <button type="button" className="text-rose-600 underline" onClick={onRemove}>
            Remove source
          </button>
        )}
      </figcaption>
    </figure>
  );
}
