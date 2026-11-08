import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../../db/db';
import type { BookFile, Textbook } from '../../db/types';
import { ConfirmDialog, Field, Modal } from '../../components/ui';
import { toast } from '../../components/Toast';
import { nowIso, uid } from '../../lib/utils';

export function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Adds PDFs to a textbook. Files are stored only on this device. */
export async function addPdfs(textbookId: string, files: File[], onStatus: (s: string) => void) {
  onStatus('Preparing…');
  const { openPdf, detectText } = await import('../../lib/pdf');
  void navigator.storage?.persist?.();
  let added = 0;
  for (const f of files) {
    if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) {
      toast(`${f.name} is not a PDF`);
      continue;
    }
    onStatus(`Checking ${f.name}…`);
    try {
      const doc = await openPdf(f);
      const hasText = await detectText(doc);
      const pageCount = doc.numPages;
      await doc.destroy();
      onStatus(`Saving ${f.name}…`);
      await db.bookFiles.add({
        id: uid(),
        textbookId,
        name: f.name.replace(/\.pdf$/i, ''),
        blob: f,
        size: f.size,
        pageCount,
        hasText,
        addedAt: nowIso(),
      });
      added++;
      if (!hasText) toast(`${f.name}: no selectable text (scanned PDF) — you can read it, but quoting and AI questions need text`);
    } catch (e) {
      const quota = e instanceof DOMException && e.name === 'QuotaExceededError';
      toast(quota ? 'Not enough storage on this device for that PDF' : `Could not open ${f.name}`);
    }
  }
  onStatus('');
  if (added) toast(`Added ${added} PDF${added === 1 ? '' : 's'}`);
}

export default function BookFiles({ book }: { book: Textbook }) {
  const files = useLiveQuery(() => db.bookFiles.where('textbookId').equals(book.id).sortBy('name'), [book.id]);
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<BookFile | null>(null);
  const [deleting, setDeleting] = useState<BookFile | null>(null);

  return (
    <div className="mt-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">PDFs on this device</span>
        <button className="btn-secondary btn-sm ml-auto" disabled={!!status} onClick={() => input.current?.click()}>
          + Add PDF
        </button>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            // copy first: clearing the input below empties the live FileList
            const picked = Array.from(e.target.files ?? []);
            if (picked.length) void addPdfs(book.id, picked, setStatus);
            e.target.value = '';
          }}
        />
      </div>
      {status && <p className="mt-2 text-xs text-brand-700 dark:text-brand-300">{status}</p>}
      {files && files.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Link to={`/read/${f.id}${f.lastPage ? `?page=${f.lastPage}` : ''}`} className="min-w-0 flex-1 truncate font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300">
                📄 {f.name}
              </Link>
              <span className="muted text-xs">
                {f.pageCount} pp · {formatBytes(f.size)}
                {!f.hasText && ' · scanned'}
              </span>
              <button className="btn-ghost btn-sm" onClick={() => setEditing(f)}>Edit</button>
              <button className="btn-ghost btn-sm text-rose-600" onClick={() => setDeleting(f)} aria-label="Remove PDF">✕</button>
            </li>
          ))}
        </ul>
      ) : (
        !status && <p className="muted mt-1 text-xs">Add the whole book or individual chapters. They stay on this device and are not included in backups.</p>
      )}
      {editing && <FileEditor file={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        title="Remove PDF?"
        message={<>Remove “{deleting?.name}” from this device? Questions you made from it keep their quotes, but “Open page” links to it will stop working.</>}
        confirmLabel="Remove"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await db.bookFiles.delete(deleting.id);
          toast('PDF removed');
        }}
      />
    </div>
  );
}

function FileEditor({ file, onClose }: { file: BookFile; onClose: () => void }) {
  const [name, setName] = useState(file.name);
  const [printedFirst, setPrintedFirst] = useState(file.pageOffset !== undefined ? String(file.pageOffset + 1) : '');
  const save = async () => {
    const n = parseInt(printedFirst, 10);
    await db.bookFiles.update(file.id, { name: name.trim() || file.name, pageOffset: isNaN(n) ? undefined : n - 1 });
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Edit PDF"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save}>Save</button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Printed page number of the first PDF page (optional)" hint="If this PDF is a chapter that starts on book page 213, enter 213 so citations show the real book page.">
          <input className="input" inputMode="numeric" value={printedFirst} onChange={(e) => setPrintedFirst(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 213" />
        </Field>
      </div>
    </Modal>
  );
}

/** "p. 215" using the printed offset when set, else the PDF page. */
export function pageLabel(file: Pick<BookFile, 'pageOffset'> | undefined, pdfPage: number) {
  return file?.pageOffset !== undefined ? `p. ${pdfPage + file.pageOffset}` : `PDF p. ${pdfPage}`;
}
