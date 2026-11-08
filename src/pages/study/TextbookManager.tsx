import { useState } from 'react';
import { db } from '../../db/db';
import type { Textbook } from '../../db/types';
import { Card, ConfirmDialog, Empty, Field, Modal } from '../../components/ui';
import { toast } from '../../components/Toast';
import { uid } from '../../lib/utils';
import BookFiles from './BookFiles';
import { moveItem } from './TopicMap';
import type { StudyData } from './useStudyData';

export default function TextbookManager({ data }: { data: StudyData }) {
  const [editing, setEditing] = useState<Textbook | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Textbook | null>(null);

  const linkedCount = (id: string) => data.topics.filter((t) => t.chapters[id]).length;

  return (
    <Card
      title="Textbooks"
      actions={<button className="btn-primary" onClick={() => setEditing('new')}>+ Add textbook</button>}
    >
      <p className="muted mb-4 text-sm">
        Link topics to chapters, and add your own PDFs of each book to read them here, quote passages in your questions, and generate questions from specific pages. PDFs stay on this device only.
      </p>
      {data.textbooks.length === 0 ? (
        <Empty title="No textbooks yet" />
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.textbooks.map((b, i) => (
            <li key={b.id} className="py-3">
              <div className="flex flex-wrap items-center gap-3">
              <div className="flex gap-0.5">
                <button className="btn-ghost btn-sm" disabled={i === 0} onClick={() => moveItem('textbooks', data.textbooks, i, -1)} aria-label="Move up">↑</button>
                <button className="btn-ghost btn-sm" disabled={i === data.textbooks.length - 1} onClick={() => moveItem('textbooks', data.textbooks, i, 1)} aria-label="Move down">↓</button>
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{b.name}{b.edition && <span className="muted font-normal"> · {b.edition}</span>}</div>
                <div className="muted text-xs">Short name: {b.shortName} · {linkedCount(b.id)} topics linked</div>
              </div>
              <button className="btn-secondary btn-sm" onClick={() => setEditing(b)}>Edit</button>
              <button className="btn-ghost btn-sm text-rose-600" onClick={() => setDeleting(b)}>Delete</button>
              </div>
              <BookFiles book={b} />
            </li>
          ))}
        </ul>
      )}
      {editing && <TextbookEditor book={editing === 'new' ? null : editing} count={data.textbooks.length} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        title="Delete textbook?"
        message={<>Remove <b>{deleting?.name}</b>? Chapter links and its PDFs on this device will be removed. Your questions are kept.</>}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const id = deleting.id;
          await db.transaction('rw', [db.textbooks, db.topics, db.questions, db.bookFiles], async () => {
            await db.textbooks.delete(id);
            await db.bookFiles.where('textbookId').equals(id).delete();
            await db.topics.toCollection().modify((t) => {
              delete t.chapters[id];
            });
            await db.questions.where('textbookId').equals(id).modify({ textbookId: undefined });
          });
          toast('Textbook deleted');
        }}
      />
    </Card>
  );
}

function TextbookEditor({ book, count, onClose }: { book: Textbook | null; count: number; onClose: () => void }) {
  const [name, setName] = useState(book?.name ?? '');
  const [shortName, setShortName] = useState(book?.shortName ?? '');
  const [edition, setEdition] = useState(book?.edition ?? '');
  const save = async () => {
    if (!name.trim()) return;
    const sn = shortName.trim() || name.trim().split(' ')[0];
    if (book) await db.textbooks.update(book.id, { name: name.trim(), shortName: sn, edition: edition.trim() });
    else await db.textbooks.add({ id: uid(), name: name.trim(), shortName: sn, edition: edition.trim(), order: count });
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={book ? 'Edit textbook' : 'Add textbook'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!name.trim()} onClick={save}>Save</button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Full name"><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Short name" hint="Shown in compact lists, e.g. “Bolognia”."><input className="input" value={shortName} onChange={(e) => setShortName(e.target.value)} /></Field>
        <Field label="Edition (optional)"><input className="input" value={edition} onChange={(e) => setEdition(e.target.value)} placeholder="e.g. 5th ed." /></Field>
      </div>
    </Modal>
  );
}
