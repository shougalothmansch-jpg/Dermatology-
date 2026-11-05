import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { Card } from '../../components/ui';
import { cx, formatDate, nowIso, todayStr, uid } from '../../lib/utils';

export default function TaskTracker({ protocolId }: { protocolId: string }) {
  const tasks = useLiveQuery(() => db.protocolTasks.where('protocolId').equals(protocolId).toArray(), [protocolId]);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [milestone, setMilestone] = useState(false);
  const today = todayStr();

  const add = async () => {
    if (!title.trim()) return;
    await db.protocolTasks.add({ id: uid(), protocolId, title: title.trim(), due, done: false, isMilestone: milestone, createdAt: nowIso() });
    setTitle('');
    setDue('');
    setMilestone(false);
  };

  const sorted = (tasks ?? []).slice().sort((a, b) => Number(a.done) - Number(b.done) || (a.due || '9999').localeCompare(b.due || '9999'));
  const done = sorted.filter((t) => t.done).length;

  return (
    <Card title="Tasks & milestones" actions={<span className="muted text-xs">{done}/{sorted.length} done</span>}>
      <div className="space-y-2">
        <input className="input" placeholder="e.g. Finalise search strategy" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" className="input w-auto flex-1" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" className="accent-brand-600" checked={milestone} onChange={(e) => setMilestone(e.target.checked)} /> Milestone
          </label>
          <button className="btn-primary btn-sm" onClick={add} disabled={!title.trim()}>Add</button>
        </div>
      </div>
      <ul className="mt-4 space-y-1">
        {sorted.map((t) => {
          const overdue = !t.done && t.due && t.due < today;
          return (
            <li key={t.id} className="group flex items-start gap-2 rounded-md px-1 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">
              <input type="checkbox" className="mt-1 accent-brand-600" checked={t.done} onChange={(e) => db.protocolTasks.update(t.id, { done: e.target.checked })} aria-label="Done" />
              <div className="min-w-0 flex-1">
                <div className={cx('text-sm', t.done && 'muted line-through')}>
                  {t.isMilestone && <span className="mr-1 text-amber-500" title="Milestone">◆</span>}
                  {t.title}
                </div>
                {t.due && <div className={cx('text-xs', overdue ? 'font-medium text-rose-600' : 'muted')}>{overdue ? 'Overdue · ' : 'Due '}{formatDate(t.due)}</div>}
              </div>
              <button className="btn-ghost btn-sm opacity-60 group-hover:opacity-100" onClick={() => db.protocolTasks.delete(t.id)} aria-label="Delete task">✕</button>
            </li>
          );
        })}
        {sorted.length === 0 && <li className="muted text-sm">No tasks yet.</li>}
      </ul>
    </Card>
  );
}
