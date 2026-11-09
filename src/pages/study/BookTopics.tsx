import { useEffect, useMemo, useState } from 'react';
import { db } from '../../db/db';
import type { BookFile, Topic } from '../../db/types';
import { Modal } from '../../components/ui';
import { toast } from '../../components/Toast';
import type { OutlineItem } from '../../lib/pdf';
import { chapterNumber, FRONT_MATTER, matchTopic, normTitle } from '../../lib/topicMatch';
import { cx, nowIso, uid } from '../../lib/utils';
import { pageLabel } from './BookFiles';
import { TopicSelect, type StudyData } from './useStudyData';

const NEW = '__new__';
const SKIP = '__skip__';

interface Row {
  item: OutlineItem;
  parent?: string;
  target: string; // topic id, NEW, or SKIP
}

/** Builds or links syllabus topics from a PDF's chapter bookmarks. */
export default function BookTopics({ data, file, onClose }: { data: StudyData; file: BookFile; onClose: () => void }) {
  const [items, setItems] = useState<OutlineItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [depth, setDepth] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const book = data.textbookById.get(file.textbookId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { openStoredPdf, getChapters } = await import('../../lib/pdf');
        const doc = await openStoredPdf(file);
        const ch = await getChapters(doc);
        await doc.destroy();
        if (cancelled) return;
        setItems(ch);
        // default level: the shallowest one with a useful number of entries
        const counts = [0, 1, 2, 3].map((d) => ch.filter((c) => c.depth === d).length);
        setDepth(counts[0] >= 6 || counts[1] === 0 ? 0 : 1);
      } catch {
        if (!cancelled) setError('Could not read this PDF’s chapter list.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  useEffect(() => {
    if (!items) return;
    const out: Row[] = [];
    let parent: string | undefined;
    for (const it of items) {
      if (it.depth === depth - 1) parent = it.title;
      if (it.depth !== depth) continue;
      const m = FRONT_MATTER.test(it.title) ? undefined : matchTopic(it.title, data.topics);
      out.push({ item: it, parent, target: FRONT_MATTER.test(it.title) ? SKIP : m?.id ?? NEW });
    }
    setRows(out);
  }, [items, depth, data.topics]);

  const levels = useMemo(() => {
    const m = new Map<number, number>();
    items?.forEach((i) => m.set(i.depth, (m.get(i.depth) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [items]);

  const linked = rows.filter((r) => r.target !== NEW && r.target !== SKIP).length;
  const created = rows.filter((r) => r.target === NEW).length;

  const apply = async () => {
    setSaving(true);
    try {
      const sections = [...data.sections];
      const topicsBySection = new Map<string, number>();
      data.topics.forEach((t) => topicsBySection.set(t.sectionId, (topicsBySection.get(t.sectionId) ?? 0) + 1));
      const fallbackSection = `${book?.shortName ?? 'Textbook'} chapters`;
      const sectionFor = async (name: string) => {
        let s = sections.find((x) => normTitle(x.name) === normTitle(name));
        if (!s) {
          s = { id: uid(), name, order: sections.length };
          sections.push(s);
          await db.sections.add(s);
        }
        return s.id;
      };
      const updates: Topic[] = [];
      for (const r of rows) {
        if (r.target === SKIP) continue;
        const range = { fileId: file.id, from: r.item.page, to: r.item.endPage };
        const num = chapterNumber(r.item.title);
        if (r.target === NEW) {
          const sectionId = await sectionFor(r.parent ?? fallbackSection);
          const order = topicsBySection.get(sectionId) ?? 0;
          topicsBySection.set(sectionId, order + 1);
          updates.push({
            id: uid(),
            sectionId,
            name: r.item.title.replace(/^\s*chapter\s+\d+\s*[:.\-–—]?\s*/i, '').trim() || r.item.title,
            order,
            chapters: num && book ? { [book.id]: num } : {},
            pages: [range],
            status: 'Not started',
            confidence: 0,
            notes: '',
            updatedAt: nowIso(),
          });
        } else {
          const t = updates.find((u) => u.id === r.target) ?? data.topicById.get(r.target);
          if (!t) continue;
          const pages = [...(t.pages ?? []).filter((p) => !(p.fileId === file.id && p.from === range.from)), range];
          const chapters = num && book && !t.chapters[book.id] ? { ...t.chapters, [book.id]: num } : t.chapters;
          const next = { ...t, pages, chapters, updatedAt: nowIso() };
          const i = updates.findIndex((u) => u.id === t.id);
          if (i >= 0) updates[i] = next;
          else updates.push(next);
        }
      }
      await db.topics.bulkPut(updates);
      toast(`Linked ${linked} topic${linked === 1 ? '' : 's'}, created ${created}`);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`Topics from “${file.name}”`}
      footer={
        items?.length ? (
          <>
            <span className="muted mr-auto self-center text-xs">{linked} linked · {created} new</span>
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={saving || linked + created === 0} onClick={apply}>Apply</button>
          </>
        ) : undefined
      }
    >
      {error ? (
        <p className="text-sm text-rose-600">{error}</p>
      ) : items === null ? (
        <p className="muted text-sm">Reading chapter list…</p>
      ) : items.length === 0 ? (
        <div className="space-y-2 text-sm">
          <p>This PDF has no chapter bookmarks, so topics can't be built from it automatically.</p>
          <p className="muted">You can still link pages to a topic by hand: open the topic in the Topic map and add a page range under “Pages in your PDFs”.</p>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <p className="muted">
            Each chapter is linked to a matching topic in your syllabus, or added as a new topic. The app then knows which pages cover each topic — for finding book quotes after you answer, and for writing questions from that chapter.
          </p>
          {levels.length > 1 && (
            <div>
              <span className="label">Use as topics</span>
              <div className="flex flex-wrap gap-2">
                {levels.map(([d, n]) => (
                  <button key={d} className={depth === d ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setDepth(d)}>
                    {d === 0 ? 'Top-level entries' : `Level ${d + 1}`} ({n})
                  </button>
                ))}
              </div>
              {depth > 0 && <p className="muted mt-1 text-xs">New topics are grouped into sections named after the level above.</p>}
            </div>
          )}
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r, i) => (
              <li key={`${r.item.page}-${i}`} className={cx('flex flex-wrap items-center gap-2 py-2', r.target === SKIP && 'opacity-50')}>
                <div className="min-w-0 flex-1 basis-full sm:basis-0">
                  <div className="font-medium">{r.item.title}</div>
                  <div className="muted text-xs">
                    {pageLabel(file, r.item.page)}–{r.item.endPage}
                    {r.parent && ` · ${r.parent}`}
                  </div>
                </div>
                <select
                  className="input w-full sm:w-64"
                  value={r.target === NEW || r.target === SKIP ? r.target : 'link'}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, target: v === 'link' ? matchTopic(x.item.title, data.topics)?.id ?? data.topics[0]?.id ?? NEW : v } : x)));
                  }}
                >
                  <option value={NEW}>➕ New topic</option>
                  <option value="link">🔗 Link to existing topic</option>
                  <option value={SKIP}>Skip</option>
                </select>
                {r.target !== NEW && r.target !== SKIP && (
                  <TopicSelect
                    data={data}
                    value={r.target}
                    onChange={(id) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, target: id } : x)))}
                    className="input w-full sm:w-64"
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
