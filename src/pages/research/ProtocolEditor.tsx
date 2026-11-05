import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { db } from '../../db/db';
import type { Protocol } from '../../db/types';
import { Card, Empty, ProgressBar, SaveStatus } from '../../components/ui';
import { toast } from '../../components/Toast';
import { completionPct, PROSPERO_TEMPLATE, protocolToMarkdown, type ProsperoField } from '../../lib/prospero';
import { cx, downloadFile, formatDateTime, nowIso, slugify } from '../../lib/utils';
import TaskTracker from './TaskTracker';

export default function ProtocolEditor() {
  const { id = '' } = useParams();
  const stored = useLiveQuery(() => db.protocols.get(id).then((p) => p ?? null), [id]);
  const [draft, setDraft] = useState<Protocol | null>(null);
  const [state, setState] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const timer = useRef<number>();
  const latest = useRef<Protocol | null>(null);

  useEffect(() => {
    if (stored && (!draft || draft.id !== stored.id)) {
      setDraft(stored);
      latest.current = stored;
    }
  }, [stored, draft]);

  const persist = useCallback(async () => {
    window.clearTimeout(timer.current);
    const p = latest.current;
    if (!p) return;
    setState('saving');
    const updatedAt = nowIso();
    await db.protocols.update(p.id, { name: p.name, fields: p.fields, updatedAt });
    latest.current = { ...p, updatedAt };
    setDraft((d) => (d ? { ...d, updatedAt } : d));
    setState('saved');
  }, []);

  const change = (patch: Partial<Protocol>) => {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, ...patch };
      latest.current = next;
      return next;
    });
    setState('dirty');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(persist, 900);
  };

  const setField = (key: string, value: string) => {
    if (!latest.current) return;
    change({ fields: { ...latest.current.fields, [key]: value } });
  };

  // warn on tab close with unsaved changes; flush pending edits on unmount
  const dirty = useRef(false);
  dirty.current = state !== 'saved';
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        void persist();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', h);
    return () => {
      window.removeEventListener('beforeunload', h);
      if (dirty.current) void persist();
    };
  }, [persist]);

  // Ctrl/Cmd+S
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void persist().then(() => toast('Saved'));
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [persist]);

  if (stored === undefined) return null;
  if (stored === null) {
    return (
      <Empty title="Protocol not found">
        <Link to="/research" className="text-brand-600 underline">Back to Research</Link>
      </Empty>
    );
  }
  if (!draft) return null;

  const completion = completionPct(draft.fields);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link to="/research" className="btn-ghost">← Protocols</Link>
        <span className="font-mono text-sm font-semibold text-brand-700 dark:text-brand-300">{draft.id}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SaveStatus state={state} />
          <button className="btn-primary" onClick={() => persist().then(() => toast('Saved'))} disabled={state === 'saving'}>
            Save
          </button>
          <button
            className="btn-secondary"
            onClick={() => downloadFile(`${draft.id}-${slugify(draft.name)}.md`, protocolToMarkdown(draft.id, draft.name, draft.fields), 'text/markdown')}
          >
            Export .md
          </button>
          <Link to={`/research/${draft.id}/print`} target="_blank" className="btn-secondary" onClick={() => persist()}>
            Print / PDF
          </Link>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <label className="label" htmlFor="pname">Working name</label>
            <input id="pname" className="input text-lg font-semibold" value={draft.name} onChange={(e) => change({ name: e.target.value })} />
            <div className="mt-3 flex items-center gap-3">
              <ProgressBar value={completion} className="flex-1" />
              <span className="text-sm tabular-nums">{completion}% complete</span>
            </div>
            <div className="muted mt-1 text-xs">Last saved {formatDateTime(draft.updatedAt)} · autosaves as you type</div>
          </Card>

          {PROSPERO_TEMPLATE.map((g, gi) => (
            <Card key={g.title} title={g.title} className="scroll-mt-20">
              <div id={`group-${gi}`} className="space-y-5">
                {g.fields.map((f) => (
                  <FieldInput key={f.key} field={f} value={draft.fields[f.key] ?? ''} onChange={(v) => setField(f.key, v)} />
                ))}
              </div>
            </Card>
          ))}
        </div>

        <aside className="space-y-5 lg:sticky lg:top-4 lg:self-start">
          <Card title="Sections">
            <ul className="space-y-1.5 text-sm">
              {PROSPERO_TEMPLATE.map((g, gi) => {
                const filled = g.fields.filter((f) => (draft.fields[f.key] ?? '').trim()).length;
                return (
                  <li key={g.title}>
                    <a href={`#group-${gi}`} className="flex justify-between gap-2 hover:text-brand-600" onClick={(e) => { e.preventDefault(); document.getElementById(`group-${gi}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>
                      <span>{g.title}</span>
                      <span className={cx('tabular-nums', filled === g.fields.length ? 'text-emerald-600' : 'muted')}>{filled}/{g.fields.length}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </Card>
          <TaskTracker protocolId={draft.id} />
        </aside>
      </div>
    </div>
  );
}

function FieldInput({ field, value, onChange }: { field: ProsperoField; value: string; onChange: (v: string) => void }) {
  const filled = value.trim().length > 0;
  const id = `f-${field.key}`;
  return (
    <div>
      <label htmlFor={id} className="mb-0.5 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
        <span className={cx('inline-block h-2 w-2 rounded-full', filled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600')} aria-hidden />
        {field.label}
      </label>
      <p className="muted mb-1.5 text-xs">{field.hint}</p>
      {field.kind === 'textarea' ? (
        <textarea id={id} className="input min-h-[96px]" value={value} onChange={(e) => onChange(e.target.value)} />
      ) : field.kind === 'date' ? (
        <input id={id} type="date" className="input sm:max-w-xs" value={value} onChange={(e) => onChange(e.target.value)} />
      ) : field.kind === 'select' ? (
        <select id={id} className="input sm:max-w-sm" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Select —</option>
          {field.options?.map((o) => <option key={o}>{o}</option>)}
        </select>
      ) : (
        <input id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
