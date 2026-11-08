import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { ConfirmDialog, Modal, ProgressBar } from '../../components/ui';
import { toast } from '../../components/Toast';
import type { ImportProgress, ImportResult } from '../../lib/anki/importApkg';

export default function AnkiImport({ onClose }: { onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const running = !!progress && progress.phase !== 'done';

  const decks = useLiveQuery(async () => {
    const m = new Map<string, { cards: number; studied: number }>();
    await db.questions
      .filter((q) => q.type === 'anki')
      .each((q) => {
        const d = q.anki?.deck ?? 'Anki';
        const s = m.get(d) ?? { cards: 0, studied: 0 };
        s.cards++;
        if (q.attempts) s.studied++;
        m.set(d, s);
      });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, []);
  const mediaCount = useLiveQuery(() => db.media.count(), []);

  const run = async (file: File) => {
    setError(null);
    setResult(null);
    setProgress({ phase: 'reading', message: 'Starting…' });
    void navigator.storage?.persist?.();
    try {
      const mod = await import('../../lib/anki/importApkg');
      const fn = /\.(txt|tsv|csv)$/i.test(file.name) ? mod.importAnkiText : mod.importAnkiPackage;
      const r = await fn(file, setProgress);
      setResult(r);
      toast(`Imported ${r.added + r.updated} cards`);
    } catch (e) {
      const quota = e instanceof DOMException && e.name === 'QuotaExceededError';
      setError(quota ? 'This device ran out of storage space for the deck. Free up space on your iPhone and try again.' : e instanceof Error ? e.message : 'Import failed.');
      setProgress(null);
    }
  };

  const pctDone = progress?.total ? Math.round(((progress.done ?? 0) / progress.total) * 100) : progress?.phase === 'done' ? 100 : 0;

  return (
    <Modal open wide onClose={() => !running && onClose()} title="Import Anki deck">
      <div className="space-y-4 text-sm">
        {!running && !result && (
          <>
            <ol className="list-decimal space-y-1 pl-5">
              <li>In Anki, use <b>Export</b> (desktop: <b>File → Export</b>; AnkiMobile: the deck's export/share option), choose <b>Anki Deck Package (.apkg)</b> and make sure media is included.</li>
              <li>Save it to <b>Files</b>, then pick it below.</li>
            </ol>
            <p className="muted text-xs">
              All cards start fresh in Derm Path's spaced repetition (up to your daily new-card limit in Settings). Images are stored on this device. Importing the same deck again updates cards without losing your progress.
            </p>
            <button className="btn-primary" onClick={() => input.current?.click()}>Choose .apkg file…</button>
            <input
              ref={input}
              type="file"
              accept=".apkg,.colpkg,.txt,application/zip,application/octet-stream,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void run(f);
                e.target.value = '';
              }}
            />
          </>
        )}

        {progress && progress.phase !== 'done' && (
          <div className="space-y-2">
            <div className="font-medium">{progress.message}</div>
            <ProgressBar value={pctDone} />
            <p className="muted text-xs">Keep this screen open until it finishes. Large image decks can take a few minutes.</p>
          </div>
        )}

        {error && <p className="rounded-lg bg-rose-50 p-3 text-rose-700 dark:bg-rose-950 dark:text-rose-300">{error}</p>}

        {result && (
          <div className="rounded-lg bg-emerald-50 p-3 dark:bg-emerald-950">
            <div className="font-semibold text-emerald-800 dark:text-emerald-300">Import complete</div>
            <ul className="mt-1 space-y-0.5">
              <li>{result.added} new cards{result.updated ? `, ${result.updated} updated` : ''}</li>
              <li>{result.mediaFiles} images</li>
              <li>
                {result.decks.length} deck{result.decks.length === 1 ? '' : 's'}: {result.topicsMatched} matched to syllabus topics
                {result.topicsCreated ? `, ${result.topicsCreated} new topic${result.topicsCreated === 1 ? '' : 's'} created under “Anki: …” sections` : ''}
              </li>
            </ul>
            <button className="btn-secondary btn-sm mt-3" onClick={() => { setResult(null); setProgress(null); }}>Import another</button>
          </div>
        )}

        {decks && decks.length > 0 && (
          <div>
            <div className="label">Imported decks</div>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {decks.map(([name, s]) => (
                <li key={name} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate">{name.split('::').join(' › ')}</span>
                  <span className="muted shrink-0 text-xs">{s.cards} cards · {s.studied} studied</span>
                  <button className="btn-ghost btn-sm text-rose-600" disabled={running} onClick={() => setRemoving(name)}>Remove</button>
                </li>
              ))}
            </ul>
            {!!mediaCount && <p className="muted mt-1 text-xs">{mediaCount} images stored on this device.</p>}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={!!removing}
        title="Remove deck?"
        message={<>Remove all cards from “{removing}” and their review history? This cannot be undone.</>}
        confirmLabel="Remove"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          const ids = await db.questions.filter((q) => q.type === 'anki' && q.anki?.deck === removing).primaryKeys();
          await db.transaction('rw', [db.questions, db.attempts], async () => {
            await db.attempts.where('questionId').anyOf(ids).delete();
            await db.questions.bulkDelete(ids);
          });
          toast(`Removed ${ids.length} cards`);
        }}
      />
    </Modal>
  );
}

