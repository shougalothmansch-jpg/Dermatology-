import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { Card, Empty, ProgressBar, Stat } from '../../components/ui';
import { pct } from '../../lib/utils';
import type { StudyData } from './useStudyData';

const WEEKS = 8;

function weekIndex(dateIso: string, now: number): number {
  return Math.floor((now - new Date(dateIso).getTime()) / (7 * 86400000));
}

interface TopicStat {
  topicId: string;
  attempts: number;
  correct: number;
  recentAttempts: number;
  recentCorrect: number;
  weekly: ({ a: number; c: number } | null)[]; // oldest -> newest
}

/** Single-series accuracy sparkline; each point has a hover tooltip. */
function Sparkline({ weekly }: { weekly: TopicStat['weekly'] }) {
  const w = 120;
  const h = 32;
  const pad = 4;
  const step = (w - pad * 2) / (WEEKS - 1);
  const pts = weekly
    .map((v, i) => (v && v.a ? { x: pad + i * step, y: pad + (1 - v.c / v.a) * (h - pad * 2), v, i } : null))
    .filter((p): p is NonNullable<typeof p> => p !== null);
  if (!pts.length) return <span className="muted text-xs">—</span>;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" role="img" aria-label="Weekly accuracy trend, last 8 weeks">
      <line x1={pad} x2={w - pad} y1={h / 2} y2={h / 2} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth={1} strokeDasharray="2 3" />
      <path d={d} fill="none" className="stroke-brand-600 dark:stroke-brand-400" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p) => (
        <g key={p.i}>
          <circle cx={p.x} cy={p.y} r={3} className="fill-brand-600 stroke-white dark:fill-brand-400 dark:stroke-slate-900" strokeWidth={1.5} />
          {/* larger invisible hit target for hover */}
          <circle cx={p.x} cy={p.y} r={8} fill="transparent">
            <title>{`${WEEKS - 1 - p.i === 0 ? 'This week' : `${WEEKS - 1 - p.i} wk ago`}: ${pct(p.v.c, p.v.a)}% (${p.v.c}/${p.v.a})`}</title>
          </circle>
        </g>
      ))}
    </svg>
  );
}

export default function Progress({ data }: { data: StudyData }) {
  const attempts = useLiveQuery(() => db.attempts.toArray(), []);
  const essays = useLiveQuery(() => db.essays.toArray(), []);
  const [sort, setSort] = useState<'weakest' | 'most' | 'name'>('weakest');

  const stats = useMemo(() => {
    const now = Date.now();
    const m = new Map<string, TopicStat>();
    for (const a of attempts ?? []) {
      let s = m.get(a.topicId);
      if (!s) {
        s = { topicId: a.topicId, attempts: 0, correct: 0, recentAttempts: 0, recentCorrect: 0, weekly: Array(WEEKS).fill(null) };
        m.set(a.topicId, s);
      }
      s.attempts++;
      if (a.correct) s.correct++;
      const wk = weekIndex(a.date, now);
      if (wk < 4) {
        s.recentAttempts++;
        if (a.correct) s.recentCorrect++;
      }
      if (wk < WEEKS) {
        const i = WEEKS - 1 - wk;
        const cell = s.weekly[i] ?? { a: 0, c: 0 };
        cell.a++;
        if (a.correct) cell.c++;
        s.weekly[i] = cell;
      }
    }
    const arr = [...m.values()].filter((s) => data.topicById.has(s.topicId));
    arr.sort((a, b) =>
      sort === 'weakest'
        ? a.correct / a.attempts - b.correct / b.attempts
        : sort === 'most'
          ? b.attempts - a.attempts
          : (data.topicById.get(a.topicId)?.name ?? '').localeCompare(data.topicById.get(b.topicId)?.name ?? ''),
    );
    return arr;
  }, [attempts, data, sort]);

  if (!attempts || !essays) return null;

  const total = attempts.length;
  const correct = attempts.filter((a) => a.correct).length;
  const assessed = essays.filter((e) => Object.keys(e.rubric).length);
  const avgEssay = assessed.length ? Math.round(assessed.reduce((s, e) => s + e.score, 0) / assessed.length) : 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Questions answered" value={total} />
        <Stat label="Overall accuracy" value={`${pct(correct, total)}%`} />
        <Stat label="Topics practised" value={stats.length} sub={`of ${data.topics.length}`} />
        <Stat label="Avg essay score" value={assessed.length ? `${avgEssay}%` : '—'} sub={`${assessed.length} assessed`} />
      </div>

      <Card
        title="Accuracy by topic"
        actions={
          <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
            <option value="weakest">Weakest first</option>
            <option value="most">Most practised</option>
            <option value="name">A–Z</option>
          </select>
        }
      >
        {stats.length === 0 ? (
          <Empty title="No quiz history yet">Take a quiz to start tracking accuracy over time.</Empty>
        ) : (
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2 font-semibold sm:pl-0">Topic</th>
                  <th className="px-2 py-2 text-right font-semibold">Attempts</th>
                  <th className="px-2 py-2 font-semibold">All-time accuracy</th>
                  <th className="px-2 py-2 text-right font-semibold">Last 4 wk</th>
                  <th className="px-2 py-2 font-semibold">Weekly trend (8 wk)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {stats.map((s) => {
                  const acc = pct(s.correct, s.attempts);
                  const t = data.topicById.get(s.topicId)!;
                  return (
                    <tr key={s.topicId}>
                      <td className="px-4 py-2 sm:pl-0">
                        <div className="font-medium">{t.name}</div>
                        <div className="muted text-xs">{data.sectionById.get(t.sectionId)?.name}</div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{s.attempts}</td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          <ProgressBar value={acc} className="w-24" tone={acc < 50 ? 'rose' : acc < 75 ? 'amber' : 'brand'} />
                          <span className="tabular-nums">{acc}%</span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{s.recentAttempts ? `${pct(s.recentCorrect, s.recentAttempts)}%` : '—'}</td>
                      <td className="px-2 py-2"><Sparkline weekly={s.weekly} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
