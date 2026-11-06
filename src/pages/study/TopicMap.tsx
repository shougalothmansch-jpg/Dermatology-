import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { TOPIC_STATUSES, type Section, type Topic, type TopicStatus } from '../../db/types';
import { ConfidenceStars, ConfirmDialog, Empty, Field, Modal, ProgressBar } from '../../components/ui';
import { toast } from '../../components/Toast';
import { cx, nowIso, pct, uid } from '../../lib/utils';
import type { StudyData } from './useStudyData';

export const STATUS_STYLES: Record<TopicStatus, string> = {
  'Not started': 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  Reading: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  'Questions done': 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  'Essay done': 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  Mastered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
};

export function StatusBadge({ status }: { status: TopicStatus }) {
  return <span className={cx('badge', STATUS_STYLES[status])}>{status}</span>;
}

/** Swap `order` of item at index with its neighbour, renumbering the list. */
async function moveItem<T extends { id: string; order: number }>(
  table: 'topics' | 'sections' | 'textbooks',
  list: T[],
  index: number,
  dir: -1 | 1,
) {
  const j = index + dir;
  if (j < 0 || j >= list.length) return;
  const reordered = [...list];
  [reordered[index], reordered[j]] = [reordered[j], reordered[index]];
  await db.transaction('rw', db.table(table), async () => {
    await Promise.all(reordered.map((item, i) => db.table(table).update(item.id, { order: i })));
  });
}
export { moveItem };

export default function TopicMap({ data }: { data: StudyData }) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Topic | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [sectionModal, setSectionModal] = useState<Section | 'new' | null>(null);
  const [deleteSection, setDeleteSection] = useState<Section | null>(null);
  const [reorderMode, setReorderMode] = useState(false);

  const questionCounts = useLiveQuery(async () => {
    const m = new Map<string, number>();
    await db.questions.each((q) => m.set(q.topicId, (m.get(q.topicId) ?? 0) + 1));
    return m;
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.grouped.map((g) => ({
      ...g,
      visible: g.topics.filter(
        (t) => (!q || t.name.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q)) && (!statusFilter || t.status === statusFilter),
      ),
    }));
  }, [data.grouped, query, statusFilter]);

  const totalMastered = data.topics.filter((t) => t.status === 'Mastered').length;
  const isFiltering = !!query || !!statusFilter;

  const setStatus = (t: Topic, status: TopicStatus) => db.topics.update(t.id, { status, updatedAt: nowIso() });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className="input max-w-xs flex-1" placeholder="Search topics or notes…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="input w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {TOPIC_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          <button className={reorderMode ? 'btn-primary' : 'btn-secondary'} onClick={() => setReorderMode((v) => !v)}>
            {reorderMode ? 'Done reordering' : 'Reorder'}
          </button>
          <button className="btn-secondary" onClick={() => setSectionModal('new')}>+ Section</button>
        </div>
      </div>
      <div className="muted mb-4 text-sm">
        {data.topics.length} topics · {totalMastered} mastered ({pct(totalMastered, data.topics.length)}%)
      </div>

      <div className="space-y-3">
        {filtered.map(({ section, topics, visible }, si) => {
          if (isFiltering && visible.length === 0) return null;
          const mastered = topics.filter((t) => t.status === 'Mastered').length;
          const isCollapsed = collapsed[section.id] && !isFiltering;
          return (
            <div key={section.id} className="card overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setCollapsed((c) => ({ ...c, [section.id]: !c[section.id] }))}>
                  <span className="text-slate-400">{isCollapsed ? '▸' : '▾'}</span>
                  <span className="truncate font-semibold text-slate-900 dark:text-white">{section.name}</span>
                  <span className="muted shrink-0 text-xs">{mastered}/{topics.length}</span>
                </button>
                <ProgressBar value={pct(mastered, topics.length)} className="w-24 sm:w-40" />
                <div className="flex gap-1">
                  {reorderMode && (
                    <>
                      <button className="btn-ghost btn-sm" disabled={si === 0} onClick={() => moveItem('sections', data.sections, si, -1)} aria-label="Move section up">↑</button>
                      <button className="btn-ghost btn-sm" disabled={si === data.sections.length - 1} onClick={() => moveItem('sections', data.sections, si, 1)} aria-label="Move section down">↓</button>
                    </>
                  )}
                  <button className="btn-ghost btn-sm" onClick={() => setSectionModal(section)}>Rename</button>
                  <button className="btn-ghost btn-sm" onClick={() => setCreatingIn(section.id)}>+ Topic</button>
                  <button className="btn-ghost btn-sm text-rose-600" onClick={() => setDeleteSection(section)} aria-label="Delete section">✕</button>
                </div>
              </div>
              {!isCollapsed && (
                <ul className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
                  {visible.length === 0 && <li className="muted px-4 py-3 text-sm">No topics yet.</li>}
                  {visible.map((t) => {
                    const idx = topics.indexOf(t);
                    const chapterSummary = data.textbooks
                      .filter((b) => t.chapters[b.id])
                      .map((b) => `${b.shortName} ${t.chapters[b.id]}`)
                      .join(' · ');
                    const qn = questionCounts?.get(t.id) ?? 0;
                    return (
                      <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        {reorderMode && !isFiltering && (
                          <div className="flex gap-0.5">
                            <button className="btn-ghost btn-sm" disabled={idx === 0} onClick={() => moveItem('topics', topics, idx, -1)} aria-label="Move up">↑</button>
                            <button className="btn-ghost btn-sm" disabled={idx === topics.length - 1} onClick={() => moveItem('topics', topics, idx, 1)} aria-label="Move down">↓</button>
                          </div>
                        )}
                        <button className="min-w-0 basis-full text-left sm:basis-0 sm:flex-1" onClick={() => setEditing(t)}>
                          <div className="text-sm sm:truncate font-medium text-slate-800 dark:text-slate-100">{t.name}</div>
                          <div className="muted truncate text-xs">
                            {chapterSummary || 'No chapters linked'}
                            {qn > 0 && ` · ${qn} question${qn === 1 ? '' : 's'}`}
                            {t.notes && ' · has notes'}
                          </div>
                        </button>
                        <ConfidenceStars value={t.confidence} size="sm" onChange={(v) => db.topics.update(t.id, { confidence: v, updatedAt: nowIso() })} />
                        <select
                          className={cx('rounded-full border-0 py-0.5 pl-2 pr-7 text-xs font-medium', STATUS_STYLES[t.status])}
                          value={t.status}
                          onChange={(e) => setStatus(t, e.target.value as TopicStatus)}
                          aria-label="Status"
                        >
                          {TOPIC_STATUSES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
        {data.sections.length === 0 && <Empty title="No sections yet">Add a section to start building your syllabus.</Empty>}
      </div>

      {(editing || creatingIn) && (
        <TopicEditor
          data={data}
          topic={editing}
          defaultSectionId={creatingIn ?? undefined}
          onClose={() => {
            setEditing(null);
            setCreatingIn(null);
          }}
        />
      )}
      {sectionModal && <SectionEditor section={sectionModal === 'new' ? null : sectionModal} count={data.sections.length} onClose={() => setSectionModal(null)} />}
      <ConfirmDialog
        open={!!deleteSection}
        title="Delete section?"
        message={
          <>
            This deletes <b>{deleteSection?.name}</b> and all{' '}
            {data.topics.filter((t) => t.sectionId === deleteSection?.id).length} of its topics, including their questions and essays. This cannot be undone.
          </>
        }
        onClose={() => setDeleteSection(null)}
        onConfirm={async () => {
          if (!deleteSection) return;
          const ids = data.topics.filter((t) => t.sectionId === deleteSection.id).map((t) => t.id);
          await deleteTopicsCascade(ids);
          await db.sections.delete(deleteSection.id);
          toast('Section deleted');
        }}
      />
    </div>
  );
}

export async function deleteTopicsCascade(topicIds: string[]) {
  if (!topicIds.length) return;
  await db.transaction('rw', [db.topics, db.questions, db.attempts, db.essays, db.essayPrompts], async () => {
    await db.questions.where('topicId').anyOf(topicIds).delete();
    await db.attempts.where('topicId').anyOf(topicIds).delete();
    await db.essays.where('topicId').anyOf(topicIds).delete();
    await db.essayPrompts.where('topicId').anyOf(topicIds).delete();
    await db.topics.bulkDelete(topicIds);
  });
}

function SectionEditor({ section, count, onClose }: { section: Section | null; count: number; onClose: () => void }) {
  const [name, setName] = useState(section?.name ?? '');
  const save = async () => {
    if (!name.trim()) return;
    if (section) await db.sections.update(section.id, { name: name.trim() });
    else await db.sections.add({ id: uid(), name: name.trim(), order: count });
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={section ? 'Rename section' : 'New section'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={!name.trim()}>Save</button>
        </>
      }
    >
      <Field label="Section name">
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      </Field>
    </Modal>
  );
}

function TopicEditor({ data, topic, defaultSectionId, onClose }: { data: StudyData; topic: Topic | null; defaultSectionId?: string; onClose: () => void }) {
  const [draft, setDraft] = useState<Topic>(
    topic ?? {
      id: uid(),
      sectionId: defaultSectionId ?? data.sections[0]?.id ?? '',
      name: '',
      order: 0,
      chapters: {},
      status: 'Not started',
      confidence: 0,
      notes: '',
      updatedAt: nowIso(),
    },
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof Topic>(k: K, v: Topic[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    if (!draft.name.trim()) return;
    let order = draft.order;
    if (!topic || topic.sectionId !== draft.sectionId) {
      order = data.topics.filter((t) => t.sectionId === draft.sectionId).length;
    }
    await db.topics.put({ ...draft, name: draft.name.trim(), order, updatedAt: nowIso() });
    toast(topic ? 'Topic updated' : 'Topic added');
    onClose();
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={topic ? 'Edit topic' : 'New topic'}
      footer={
        <>
          {topic && <button className="btn-ghost mr-auto text-rose-600" onClick={() => setConfirmDelete(true)}>Delete topic</button>}
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={!draft.name.trim()}>Save</button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Topic name" className="sm:col-span-2">
          <input className="input" autoFocus value={draft.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Section">
          <select className="input" value={draft.sectionId} onChange={(e) => set('sectionId', e.target.value)}>
            {data.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className="input" value={draft.status} onChange={(e) => set('status', e.target.value as TopicStatus)}>
            {TOPIC_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <span className="label">Confidence</span>
          <div className="flex items-center gap-3">
            <ConfidenceStars value={draft.confidence} onChange={(v) => set('confidence', v)} />
            <span className="muted text-sm">{draft.confidence ? `${draft.confidence}/5` : 'Not rated'}</span>
          </div>
        </div>
        <div className="sm:col-span-2">
          <span className="label">Textbook chapters</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.textbooks.map((b) => (
              <label key={b.id} className="flex items-center gap-2">
                <span className="w-28 shrink-0 truncate text-sm" title={b.name}>{b.shortName}</span>
                <input
                  className="input"
                  placeholder="e.g. 8 or 8–9"
                  value={draft.chapters[b.id] ?? ''}
                  onChange={(e) => set('chapters', { ...draft.chapters, [b.id]: e.target.value })}
                />
              </label>
            ))}
            {data.textbooks.length === 0 && <span className="muted text-sm">Add textbooks in the Textbooks tab.</span>}
          </div>
        </div>
        <Field label="Notes" className="sm:col-span-2">
          <textarea className="input min-h-[140px]" value={draft.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Your own summary, mnemonics, key points…" />
        </Field>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete topic?"
        message={<>Delete <b>{topic?.name}</b> together with its questions, attempts and essays? This cannot be undone.</>}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (topic) await deleteTopicsCascade([topic.id]);
          toast('Topic deleted');
          onClose();
        }}
      />
    </Modal>
  );
}
