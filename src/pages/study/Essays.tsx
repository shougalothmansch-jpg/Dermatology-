import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { RUBRIC_CRITERIA, TOPIC_STATUSES, type Essay, type EssayPrompt, type RubricKey } from '../../db/types';
import { Card, ConfirmDialog, Empty, Field, Modal, SaveStatus } from '../../components/ui';
import RichTextEditor from '../../components/RichTextEditor';
import { toast } from '../../components/Toast';
import { cx, formatDate, nowIso, uid } from '../../lib/utils';
import { TopicSelect, type StudyData } from './useStudyData';

export function rubricScore(rubric: Essay['rubric']): number {
  const vals = Object.values(rubric).filter((v): v is number => typeof v === 'number');
  if (!vals.length) return 0;
  return Math.round((vals.reduce((a, b) => a + b, 0) / (vals.length * 5)) * 100);
}

export function fillPrompt(text: string, topicName: string) {
  return text.replace(/\{topic\}/gi, topicName);
}

type View = { kind: 'list' } | { kind: 'new' } | { kind: 'essay'; id: string; phase: 'writing' | 'assess' | 'review' };

export default function Essays({ data }: { data: StudyData }) {
  const essays = useLiveQuery(() => db.essays.orderBy('createdAt').reverse().toArray(), []);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [topicFilter, setTopicFilter] = useState('');
  const [managePrompts, setManagePrompts] = useState(false);

  if (!essays) return null;

  if (view.kind === 'new') {
    return <EssaySetup data={data} onCancel={() => setView({ kind: 'list' })} onStart={(id) => setView({ kind: 'essay', id, phase: 'writing' })} />;
  }
  if (view.kind === 'essay') {
    return <EssayWorkspace key={view.id} data={data} essayId={view.id} initialPhase={view.phase} onExit={() => setView({ kind: 'list' })} />;
  }

  const list = essays.filter((e) => !topicFilter || e.topicId === topicFilter);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TopicSelect data={data} value={topicFilter} onChange={setTopicFilter} allowEmpty emptyLabel="All topics" className="input w-auto max-w-xs" />
        <div className="ml-auto flex gap-2">
          <button className="btn-secondary" onClick={() => setManagePrompts(true)}>Manage prompts</button>
          <button className="btn-primary" onClick={() => setView({ kind: 'new' })}>+ New essay</button>
        </div>
      </div>
      {list.length === 0 ? (
        <Empty title="No essays yet">Pick a topic, get a prompt, and write against the clock.</Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((e) => {
            const assessed = Object.keys(e.rubric).length > 0;
            return (
              <li key={e.id}>
                <button className="card block w-full p-4 text-left hover:border-brand-300 dark:hover:border-brand-700" onClick={() => setView({ kind: 'essay', id: e.id, phase: 'review' })}>
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <div className="font-medium">{data.topicById.get(e.topicId)?.name ?? 'Unknown topic'}</div>
                    <span className={cx('badge shrink-0', assessed ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300')}>
                      {assessed ? `${e.score}%` : 'Not assessed'}
                    </span>
                  </div>
                  <div className="muted line-clamp-2 text-sm">{e.prompt}</div>
                  <div className="muted mt-2 text-xs">
                    {formatDate(e.createdAt)} · {e.wordCount} words{e.durationSec ? ` · ${Math.round(e.durationSec / 60)} min` : ''}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {managePrompts && <PromptManager data={data} onClose={() => setManagePrompts(false)} />}
    </div>
  );
}

// ---------- Setup ----------

function EssaySetup({ data, onCancel, onStart }: { data: StudyData; onCancel: () => void; onStart: (essayId: string) => void }) {
  const prompts = useLiveQuery(() => db.essayPrompts.toArray(), []);
  const [topicId, setTopicId] = useState('');
  const [choice, setChoice] = useState<string>(''); // prompt id or 'custom'
  const [custom, setCustom] = useState('');
  const [saveCustom, setSaveCustom] = useState(true);
  const [minutes, setMinutes] = useState(0);
  const topic = data.topicById.get(topicId);

  const available = useMemo(() => {
    const ps = prompts ?? [];
    return [...ps.filter((p) => p.topicId === topicId && !p.isTemplate), ...ps.filter((p) => p.isTemplate)];
  }, [prompts, topicId]);

  const randomPick = () => {
    if (available.length) setChoice(available[Math.floor(Math.random() * available.length)].id);
  };

  const promptText = choice === 'custom' ? custom.trim() : fillPrompt(available.find((p) => p.id === choice)?.text ?? '', topic?.name ?? '');

  const start = async () => {
    if (!topic || !promptText) return;
    if (choice === 'custom' && saveCustom) {
      await db.essayPrompts.add({ id: uid(), text: custom.trim(), isTemplate: false, topicId, createdAt: nowIso() });
    }
    const id = uid();
    await db.essays.add({
      id,
      topicId,
      prompt: promptText,
      content: '',
      wordCount: 0,
      timeLimitMin: minutes || undefined,
      durationSec: 0,
      rubric: {},
      score: 0,
      reflection: '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    onStart(id);
  };

  return (
    <Card title="New essay" actions={<button className="btn-ghost" onClick={onCancel}>Cancel</button>}>
      <div className="space-y-5">
        <Field label="1. Topic"><TopicSelect data={data} value={topicId} onChange={(id) => { setTopicId(id); setChoice(''); }} /></Field>

        {topic && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="label mb-0">2. Prompt</span>
              <button className="btn-ghost btn-sm" onClick={randomPick}>🎲 Random</button>
            </div>
            <div className="space-y-2">
              {available.map((p) => (
                <label key={p.id} className={cx('flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm', choice === p.id ? 'border-brand-500 bg-brand-50 dark:bg-brand-950' : 'border-slate-200 dark:border-slate-700')}>
                  <input type="radio" className="mt-0.5 accent-brand-600" checked={choice === p.id} onChange={() => setChoice(p.id)} />
                  <span className="flex-1">{fillPrompt(p.text, topic.name)}</span>
                  {!p.isTemplate && <span className="badge bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">yours</span>}
                </label>
              ))}
              <label className={cx('flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm', choice === 'custom' ? 'border-brand-500 bg-brand-50 dark:bg-brand-950' : 'border-slate-200 dark:border-slate-700')}>
                <input type="radio" className="mt-0.5 accent-brand-600" checked={choice === 'custom'} onChange={() => setChoice('custom')} />
                <span className="flex-1">Write my own prompt</span>
              </label>
              {choice === 'custom' && (
                <div className="pl-7">
                  <textarea className="input min-h-[80px]" autoFocus value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={`e.g. Discuss the role of IL-17 in ${topic.name}.`} />
                  <label className="mt-2 flex items-center gap-2 text-sm">
                    <input type="checkbox" className="accent-brand-600" checked={saveCustom} onChange={(e) => setSaveCustom(e.target.checked)} />
                    Save this prompt for {topic.name}
                  </label>
                </div>
              )}
            </div>
          </div>
        )}

        {topic && (
          <div>
            <span className="label">3. Timer</span>
            <div className="flex flex-wrap items-center gap-2">
              {[0, 15, 30, 45, 60].map((m) => (
                <button key={m} className={minutes === m ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setMinutes(m)}>
                  {m === 0 ? 'No timer' : `${m} min`}
                </button>
              ))}
              <input type="number" min={0} className="input w-24" value={minutes || ''} placeholder="Custom" onChange={(e) => setMinutes(Math.max(0, Number(e.target.value) || 0))} aria-label="Custom minutes" />
            </div>
          </div>
        )}

        <button className="btn-primary" disabled={!topic || !promptText} onClick={start}>Start writing</button>
      </div>
    </Card>
  );
}

// ---------- Writing / assessing / reviewing ----------

function useCountdown(limitMin: number | undefined, startedAtMs: number, running: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const elapsed = Math.floor((now - startedAtMs) / 1000);
  const remaining = limitMin ? limitMin * 60 - elapsed : null;
  return { elapsed, remaining };
}

function fmtClock(sec: number) {
  const s = Math.abs(sec);
  const m = Math.floor(s / 60);
  return `${sec < 0 ? '+' : ''}${m}:${String(s % 60).padStart(2, '0')}`;
}

function EssayWorkspace({ data, essayId, initialPhase, onExit }: { data: StudyData; essayId: string; initialPhase: 'writing' | 'assess' | 'review'; onExit: () => void }) {
  const essay = useLiveQuery(() => db.essays.get(essayId), [essayId]);
  const [phase, setPhase] = useState(initialPhase);
  const [content, setContent] = useState<string | null>(null);
  const [words, setWords] = useState(0);
  const [rubric, setRubric] = useState<Essay['rubric']>({});
  const [reflection, setReflection] = useState('');
  const [markEssayDone, setMarkEssayDone] = useState(true);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const startedAt = useRef(Date.now());
  const baseDuration = useRef(0);
  const initialized = useRef(false);
  const timer = useRef<number>();

  useEffect(() => {
    if (essay && !initialized.current) {
      initialized.current = true;
      setContent(essay.content);
      setWords(essay.wordCount);
      setRubric(essay.rubric);
      setReflection(essay.reflection);
      baseDuration.current = essay.durationSec;
    }
  }, [essay]);

  const { elapsed, remaining } = useCountdown(essay?.timeLimitMin, startedAt.current - baseDuration.current * 1000, phase === 'writing');

  // debounced autosave of content
  const scheduleSave = (html: string, wc: number) => {
    setSaveState('dirty');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setSaveState('saving');
      const patch: Partial<Essay> = { content: html, wordCount: wc, updatedAt: nowIso() };
      if (phase === 'writing') patch.durationSec = Math.floor((Date.now() - startedAt.current) / 1000) + baseDuration.current;
      await db.essays.update(essayId, patch);
      setSaveState('saved');
    }, 800);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (essay === undefined || content === null) return null;
  if (essay === null) return <Empty title="Essay not found" />;

  const topic = data.topicById.get(essay.topicId);

  const finishWriting = async () => {
    window.clearTimeout(timer.current);
    await db.essays.update(essayId, { content, wordCount: words, durationSec: elapsed, updatedAt: nowIso() });
    setSaveState('saved');
    setPhase('assess');
  };

  const saveAssessment = async () => {
    window.clearTimeout(timer.current);
    await db.essays.update(essayId, { content, wordCount: words, rubric, reflection, score: rubricScore(rubric), updatedAt: nowIso() });
    if (markEssayDone && topic) {
      const order = TOPIC_STATUSES.indexOf(topic.status);
      if (order < TOPIC_STATUSES.indexOf('Essay done')) await db.topics.update(topic.id, { status: 'Essay done', updatedAt: nowIso() });
    }
    setSaveState('saved');
    toast('Essay saved');
    setPhase('review');
  };

  const score = rubricScore(rubric);
  const overTime = remaining !== null && remaining < 0;

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-2">
        <button className="btn-ghost" onClick={onExit}>← All essays</button>
        <div className="ml-auto flex items-center gap-3">
          <SaveStatus state={saveState} />
          {phase === 'review' && <button className="btn-ghost text-rose-600" onClick={() => setConfirmDelete(true)}>Delete</button>}
        </div>
      </div>

      <Card>
        <div className="muted text-xs">{topic?.name} · {formatDate(essay.createdAt)}</div>
        <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{essay.prompt}</h2>
      </Card>

      {phase === 'writing' && (
        <div className="sticky top-14 z-20 flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white/95 px-4 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 md:top-2">
          <div className={cx('font-mono text-xl font-semibold tabular-nums', overTime ? 'text-rose-600' : remaining !== null && remaining < 60 ? 'text-amber-600' : 'text-slate-900 dark:text-white')}>
            {remaining !== null ? fmtClock(remaining) : fmtClock(elapsed)}
          </div>
          <div className="muted text-sm">{remaining !== null ? (overTime ? "Time's up — over time" : 'remaining') : 'elapsed'}</div>
          <div className="text-sm"><b>{words}</b> <span className="muted">words</span></div>
          <button className="btn-primary ml-auto" onClick={finishWriting}>Finish & self-assess</button>
        </div>
      )}

      <div>
        {phase !== 'writing' && <div className="muted mb-2 text-sm">{words} words · {Math.round(essay.durationSec / 60)} min writing time</div>}
        <RichTextEditor
          value={essay.content}
          onChange={(html, wc) => {
            setContent(html);
            setWords(wc);
            scheduleSave(html, wc);
          }}
          placeholder="Start writing… Use headings to structure: Introduction, Pathogenesis, Clinical features, Differentials, Investigations, Management, Conclusion."
        />
      </div>

      {phase !== 'writing' && (
        <Card title="Self-assessment rubric" actions={<span className="text-2xl font-semibold text-brand-700 dark:text-brand-300">{score}%</span>}>
          <div className="space-y-3">
            {RUBRIC_CRITERIA.map((c) => (
              <div key={c.key} className="flex flex-wrap items-center gap-3">
                <span className="w-40 text-sm font-medium">{c.label}</span>
                <div className="flex gap-1">
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => setRubric((r) => ({ ...r, [c.key]: n }))}
                      className={cx(
                        'h-8 w-8 rounded-md border text-sm font-medium',
                        rubric[c.key as RubricKey] === n
                          ? 'border-brand-600 bg-brand-600 text-white dark:border-brand-400 dark:bg-brand-500 dark:text-slate-950'
                          : 'border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800',
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                {rubric[c.key as RubricKey] !== undefined && (
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() =>
                      setRubric((r) => {
                        const next = { ...r };
                        delete next[c.key as RubricKey];
                        return next;
                      })
                    }
                  >
                    N/A
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="muted mt-2 text-xs">0 = missing · 3 = adequate · 5 = excellent. Unscored criteria count as N/A.</p>
          <Field label="Reflection — what to improve next time" className="mt-4">
            <textarea className="input min-h-[80px]" value={reflection} onChange={(e) => setReflection(e.target.value)} />
          </Field>
          {phase === 'assess' && topic && TOPIC_STATUSES.indexOf(topic.status) < TOPIC_STATUSES.indexOf('Essay done') && (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-brand-600" checked={markEssayDone} onChange={(e) => setMarkEssayDone(e.target.checked)} />
              Mark “{topic.name}” as Essay done
            </label>
          )}
          <div className="mt-4">
            <button className="btn-primary" onClick={saveAssessment}>Save assessment</button>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete essay?"
        message="This essay and its assessment will be permanently deleted."
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await db.essays.delete(essayId);
          toast('Essay deleted');
          onExit();
        }}
      />
    </div>
  );
}

// ---------- Prompt manager ----------

function PromptManager({ data, onClose }: { data: StudyData; onClose: () => void }) {
  const prompts = useLiveQuery(() => db.essayPrompts.toArray(), []);
  const [text, setText] = useState('');
  const [topicId, setTopicId] = useState('');
  const [editing, setEditing] = useState<EssayPrompt | null>(null);

  const add = async () => {
    if (!text.trim()) return;
    if (editing) {
      await db.essayPrompts.update(editing.id, { text: text.trim(), topicId: topicId || undefined, isTemplate: !topicId });
    } else {
      await db.essayPrompts.add({ id: uid(), text: text.trim(), isTemplate: !topicId, topicId: topicId || undefined, createdAt: nowIso() });
    }
    setText('');
    setEditing(null);
  };

  const templates = (prompts ?? []).filter((p) => p.isTemplate);
  const specific = (prompts ?? []).filter((p) => !p.isTemplate);

  const Row = ({ p }: { p: EssayPrompt }) => (
    <li className="flex items-start gap-2 py-2 text-sm">
      <div className="flex-1">
        {p.text}
        {p.topicId && <div className="muted text-xs">{data.topicById.get(p.topicId)?.name}</div>}
      </div>
      <button className="btn-ghost btn-sm" onClick={() => { setEditing(p); setText(p.text); setTopicId(p.topicId ?? ''); }}>Edit</button>
      <button className="btn-ghost btn-sm text-rose-600" onClick={() => db.essayPrompts.delete(p.id)} aria-label="Delete prompt">✕</button>
    </li>
  );

  return (
    <Modal open wide onClose={onClose} title="Essay prompts">
      <div className="mb-5 space-y-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
        <Field label={editing ? 'Edit prompt' : 'Add prompt'} hint="Use {topic} as a placeholder in generic templates.">
          <textarea className="input min-h-[70px]" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Scope" className="min-w-[14rem] flex-1">
            <TopicSelect data={data} value={topicId} onChange={setTopicId} allowEmpty emptyLabel="Generic template (all topics)" />
          </Field>
          {editing && <button className="btn-ghost" onClick={() => { setEditing(null); setText(''); setTopicId(''); }}>Cancel</button>}
          <button className="btn-primary" disabled={!text.trim()} onClick={add}>{editing ? 'Update' : 'Add'}</button>
        </div>
      </div>
      <div className="label">Generic templates</div>
      <ul className="mb-4 divide-y divide-slate-100 dark:divide-slate-800">{templates.map((p) => <Row key={p.id} p={p} />)}</ul>
      <div className="label">Topic-specific prompts</div>
      {specific.length ? <ul className="divide-y divide-slate-100 dark:divide-slate-800">{specific.map((p) => <Row key={p.id} p={p} />)}</ul> : <p className="muted text-sm">None yet.</p>}
    </Modal>
  );
}
