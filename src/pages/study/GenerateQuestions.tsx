import { useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../../db/db';
import type { Question } from '../../db/types';
import { Field, Modal } from '../../components/ui';
import { toast } from '../../components/Toast';
import { getApiKey } from '../../lib/settings';
import { blankQuestion, normalizeQuestion, QuestionFields, validateQuestion } from './QuestionForm';
import { TopicSelect, type StudyData } from './useStudyData';

interface Draft {
  q: Question;
  keep: boolean;
}

export default function GenerateQuestions({ data, defaultTopicId, onClose }: { data: StudyData; defaultTopicId?: string; onClose: () => void }) {
  const [topicId, setTopicId] = useState(defaultTopicId ?? '');
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState('Intermediate (residency level)');
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const apiKey = getApiKey();

  const run = async () => {
    const topic = data.topicById.get(topicId);
    if (!topic || !apiKey) return;
    setBusy(true);
    setError(null);
    const api = await import('../../lib/anthropic');
    try {
      const result = await api.generateQuestions({
        apiKey,
        topic: topic.name,
        section: data.sectionById.get(topic.sectionId)?.name ?? '',
        count,
        difficulty,
        focus: focus.trim() || undefined,
      });
      setDrafts(
        result.map((r) => ({
          keep: true,
          q: { ...blankQuestion(topicId), stem: r.stem, options: r.options.slice(0, 5), correctIndex: Math.min(r.correctIndex, 4), explanation: r.explanation, tags: ['ai-draft'] },
        })),
      );
      if (!result.length) setError('No questions were returned. Try again.');
    } catch (e) {
      setError(api.describeApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const saveKept = async () => {
    const kept = drafts.filter((d) => d.keep);
    for (const [i, d] of kept.entries()) {
      const err = validateQuestion(d.q);
      if (err) return setError(`Draft ${i + 1}: ${err}`);
    }
    await db.questions.bulkPut(kept.map((d) => normalizeQuestion(d.q)));
    toast(`${kept.length} question${kept.length === 1 ? '' : 's'} saved`);
    onClose();
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Generate questions (AI draft)"
      footer={
        drafts.length ? (
          <>
            {error && <span className="mr-auto self-center text-sm text-rose-600">{error}</span>}
            <button className="btn-secondary" onClick={() => setDrafts([])}>Back</button>
            <button className="btn-primary" disabled={!drafts.some((d) => d.keep)} onClick={saveKept}>
              Save {drafts.filter((d) => d.keep).length} reviewed
            </button>
          </>
        ) : (
          <>
            {error && <span className="mr-auto self-center text-sm text-rose-600">{error}</span>}
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={!topicId || !apiKey || busy} onClick={run}>
              {busy ? 'Generating…' : 'Generate drafts'}
            </button>
          </>
        )
      }
    >
      {!apiKey ? (
        <p className="text-sm">
          Add your Anthropic API key in <Link to="/settings" className="text-brand-600 underline" onClick={onClose}>Settings</Link> first.
        </p>
      ) : drafts.length === 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Topic" className="sm:col-span-2"><TopicSelect data={data} value={topicId} onChange={setTopicId} /></Field>
          <Field label="Number of questions">
            <input type="number" min={1} max={10} className="input" value={count} onChange={(e) => setCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
          </Field>
          <Field label="Difficulty">
            <select className="input" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option>Foundational (medical student)</option>
              <option>Intermediate (residency level)</option>
              <option>Advanced (board exam level)</option>
            </select>
          </Field>
          <Field label="Focus (optional)" className="sm:col-span-2" hint="e.g. histopathology, first-line treatment, associated syndromes">
            <input className="input" value={focus} onChange={(e) => setFocus(e.target.value)} />
          </Field>
          <p className="muted text-xs sm:col-span-2">
            Your key is sent directly from this browser to the Anthropic API. Drafts may contain errors — review every question against your textbooks before saving.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="muted text-sm">Review and edit each draft. Untick any you don't want to keep.</p>
          {drafts.map((d, i) => (
            <div key={d.q.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
              <label className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={d.keep} onChange={(e) => setDrafts((ds) => ds.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} />
                Draft {i + 1}
              </label>
              {d.keep && <QuestionFields data={data} q={d.q} onChange={(q) => setDrafts((ds) => ds.map((x, j) => (j === i ? { ...x, q } : x)))} />}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
