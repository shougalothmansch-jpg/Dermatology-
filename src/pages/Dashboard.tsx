import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../db/db';
import { Card, Empty, PageHeader, ProgressBar, Stat } from '../components/ui';
import { completionPct } from '../lib/prospero';
import { useDueCounts } from '../lib/queue';
import { formatDate, formatDateTime, pct } from '../lib/utils';
import { useStudyData } from './study/useStudyData';

export default function Dashboard() {
  const data = useStudyData();
  const counts = useDueCounts();
  const due = counts?.total;
  const totalQuestions = useLiveQuery(() => db.questions.count(), []);
  const essays = useLiveQuery(() => db.essays.orderBy('createdAt').reverse().limit(5).toArray(), []);
  const club = useLiveQuery(() => db.clubEntries.toArray(), []);
  const protocols = useLiveQuery(() => db.protocols.orderBy('updatedAt').reverse().toArray(), []);
  const recentAttempts = useLiveQuery(() => {
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    return db.attempts.where('date').aboveOrEqual(since).toArray();
  }, []);

  if (!data.loaded || due === undefined || !essays || !club || !protocols || !recentAttempts || totalQuestions === undefined) return null;

  const mastered = data.topics.filter((t) => t.status === 'Mastered').length;
  const started = data.topics.filter((t) => t.status !== 'Not started').length;
  const clubHours = club.reduce((s, e) => s + (e.hours || 0), 0);
  const activeProtocols = protocols.filter((p) => !['Completed and published', 'Discontinued'].includes(p.fields.status ?? ''));
  const weekAcc = pct(recentAttempts.filter((a) => a.correct).length, recentAttempts.length);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-5">
      <PageHeader title={greeting} subtitle={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Topics mastered" value={`${pct(mastered, data.topics.length)}%`} sub={`${mastered} of ${data.topics.length} · ${started} started`} />
        <Link to="/study?tab=quiz&mode=due" className="block">
          <Stat label="Due today" value={due} sub={totalQuestions ? `${counts?.reviews} reviews · ${counts?.fresh} new →` : 'Add questions to begin'} />
        </Link>
        <Link to="/club" className="block">
          <Stat label="Club hours" value={clubHours} sub={`${club.length} activities logged`} />
        </Link>
        <Link to="/research" className="block">
          <Stat label="Active protocols" value={activeProtocols.length} sub={`${protocols.length} total`} />
        </Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card title="Study progress by section" actions={<Link to="/study" className="btn-ghost btn-sm">Topic map →</Link>}>
          <ul className="space-y-3">
            {data.grouped.map(({ section, topics }) => {
              const m = topics.filter((t) => t.status === 'Mastered').length;
              const inProgress = topics.filter((t) => t.status !== 'Not started' && t.status !== 'Mastered').length;
              return (
                <li key={section.id}>
                  <div className="mb-1 flex justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{section.name}</span>
                    <span className="muted shrink-0 tabular-nums">
                      {m}/{topics.length} mastered{inProgress ? ` · ${inProgress} in progress` : ''}
                    </span>
                  </div>
                  <ProgressBar value={pct(m, topics.length)} />
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="space-y-5">
          <Card title="Today">
            {due > 0 ? (
              <div>
                <p className="mb-3 text-sm">You have <b>{counts?.reviews}</b> review{counts?.reviews === 1 ? '' : 's'} and <b>{counts?.fresh}</b> new card{counts?.fresh === 1 ? '' : 's'} for today.</p>
                <Link to="/study?tab=quiz&mode=due" className="btn-primary">Start review</Link>
              </div>
            ) : (
              <p className="muted text-sm">No reviews due. {totalQuestions ? 'Try a weak-areas quiz or write an essay.' : 'Write some questions to start building your review queue.'}</p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/study?tab=quiz&mode=weak" className="btn-secondary btn-sm">Weak areas quiz</Link>
              <Link to="/study?tab=essays" className="btn-secondary btn-sm">Write an essay</Link>
              <Link to="/study?tab=questions" className="btn-secondary btn-sm">Add questions</Link>
            </div>
            {recentAttempts.length > 0 && (
              <p className="muted mt-4 text-xs">Last 7 days: {recentAttempts.length} answers, {weekAcc}% correct.</p>
            )}
          </Card>

          <Card title="Recent essays" actions={<Link to="/study?tab=essays" className="btn-ghost btn-sm">All →</Link>}>
            {essays.length === 0 ? (
              <p className="muted text-sm">No essays yet.</p>
            ) : (
              <ul className="space-y-2">
                {essays.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{data.topicById.get(e.topicId)?.name ?? 'Unknown topic'}</div>
                      <div className="muted text-xs">{formatDate(e.createdAt)} · {e.wordCount} words</div>
                    </div>
                    <span className="shrink-0 tabular-nums">{Object.keys(e.rubric).length ? `${e.score}%` : '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card title="Active research protocols" actions={<Link to="/research" className="btn-ghost btn-sm">Research →</Link>}>
        {activeProtocols.length === 0 ? (
          <Empty title="No active protocols">Start one from the PROSPERO master template on the Research page.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {activeProtocols.slice(0, 6).map((p) => {
              const c = completionPct(p.fields);
              return (
                <li key={p.id}>
                  <Link to={`/research/${p.id}`} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className="font-mono text-xs font-semibold text-brand-700 dark:text-brand-300">{p.id}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                    <span className="muted hidden text-xs sm:inline">{formatDateTime(p.updatedAt)}</span>
                    <div className="flex w-32 items-center gap-2">
                      <ProgressBar value={c} />
                      <span className="w-9 text-right text-xs tabular-nums">{c}%</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
