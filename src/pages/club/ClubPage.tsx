import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, setMeta } from '../../db/db';
import type { ClubEntry } from '../../db/types';
import { SEED_ACTIVITY_TYPES, SEED_CLUB_ROLES } from '../../db/seed';
import { Card, ConfirmDialog, Empty, Field, Modal, PageHeader, Stat, Tabs } from '../../components/ui';
import { toast } from '../../components/Toast';
import { copyText, formatDate, nowIso, todayStr, uid } from '../../lib/utils';

type View = 'log' | 'timeline' | 'summary';

function useList(key: 'clubRoles' | 'activityTypes', fallback: string[]) {
  const row = useLiveQuery(() => db.meta.get(key), [key]);
  return (row?.value as string[] | undefined) ?? fallback;
}

export default function ClubPage() {
  const entries = useLiveQuery(() => db.clubEntries.orderBy('date').reverse().toArray(), []);
  const roles = useList('clubRoles', SEED_CLUB_ROLES);
  const types = useList('activityTypes', SEED_ACTIVITY_TYPES);
  const [view, setView] = useState<View>('log');
  const [role, setRole] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ClubEntry | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ClubEntry | null>(null);
  const [listsOpen, setListsOpen] = useState(false);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (entries ?? []).filter(
      (e) =>
        (!role || e.role === role) &&
        (!type || e.activityType === type) &&
        (!from || e.date >= from) &&
        (!to || e.date <= to) &&
        (!s || [e.title, e.description, e.people, e.outcome].some((x) => x.toLowerCase().includes(s))),
    );
  }, [entries, role, type, from, to, search]);

  if (!entries) return null;

  const hasFilters = role || type || from || to || search;

  return (
    <div>
      <PageHeader
        title="Interest Group"
        subtitle="Log club roles, events and hours for your CV and residency application."
        actions={
          <>
            <button className="btn-secondary" onClick={() => setListsOpen(true)}>Edit roles & types</button>
            <button className="btn-primary" onClick={() => setEditing('new')}>+ Log activity</button>
          </>
        }
      />

      <div className="card mb-5 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Search"><input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Title, people…" /></Field>
        <Field label="Role">
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">All roles</option>
            {roles.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Activity type">
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {types.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="From"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        {hasFilters && (
          <div className="sm:col-span-2 lg:col-span-5">
            <button className="btn-ghost btn-sm" onClick={() => { setRole(''); setType(''); setFrom(''); setTo(''); setSearch(''); }}>Clear filters</button>
            <span className="muted ml-2 text-sm">{filtered.length} of {entries.length} entries</span>
          </div>
        )}
      </div>

      <Tabs
        value={view}
        onChange={setView}
        tabs={[
          { id: 'log', label: 'Log' },
          { id: 'timeline', label: 'Roles timeline' },
          { id: 'summary', label: 'CV summary' },
        ]}
      />

      {view === 'log' && <EntryList entries={filtered} total={entries.length} onEdit={setEditing} onDelete={setDeleting} />}
      {view === 'timeline' && <RolesTimeline entries={filtered} />}
      {view === 'summary' && <Summary entries={filtered} filtered={!!hasFilters} />}

      {editing && <EntryForm entry={editing === 'new' ? null : editing} roles={roles} types={types} onClose={() => setEditing(null)} />}
      {listsOpen && <ListsEditor roles={roles} types={types} onClose={() => setListsOpen(false)} />}
      <ConfirmDialog
        open={!!deleting}
        title="Delete entry?"
        message={<>Delete “{deleting?.title}”? This cannot be undone.</>}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await db.clubEntries.delete(deleting.id);
          toast('Entry deleted');
        }}
      />
    </div>
  );
}

function EntryList({ entries, total, onEdit, onDelete }: { entries: ClubEntry[]; total: number; onEdit: (e: ClubEntry) => void; onDelete: (e: ClubEntry) => void }) {
  if (!entries.length) return <Empty title={total ? 'No entries match the filters' : 'No activities logged yet'}>{!total && 'Log meetings, events, talks and committee work as they happen.'}</Empty>;
  return (
    <ul className="space-y-3">
      {entries.map((e) => (
        <li key={e.id} className="card p-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="w-24 shrink-0 text-sm">
              <div className="font-semibold">{formatDate(e.date)}</div>
              <div className="muted text-xs">{e.hours} h</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-slate-900 dark:text-white">{e.title}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <span className="badge bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300">{e.role}</span>
                {e.activityType && <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{e.activityType}</span>}
              </div>
              {e.description && <p className="mt-2 whitespace-pre-wrap text-sm">{e.description}</p>}
              {e.people && <p className="muted mt-1 text-sm"><b>With:</b> {e.people}</p>}
              {e.outcome && <p className="muted mt-1 text-sm"><b>Outcome / skills:</b> {e.outcome}</p>}
              {e.links.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2 text-sm">
                  {e.links.map((l, i) => (
                    <a key={i} href={/^https?:\/\//.test(l) ? l : undefined} target="_blank" rel="noreferrer" className="truncate text-brand-600 underline dark:text-brand-400">
                      {l}
                    </a>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-1">
              <button className="btn-secondary btn-sm" onClick={() => onEdit(e)}>Edit</button>
              <button className="btn-ghost btn-sm text-rose-600" onClick={() => onDelete(e)} aria-label="Delete">✕</button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

interface RoleSpan {
  role: string;
  first: string;
  last: string;
  hours: number;
  count: number;
}

function roleSpans(entries: ClubEntry[]): RoleSpan[] {
  const m = new Map<string, RoleSpan>();
  for (const e of entries) {
    const s = m.get(e.role) ?? { role: e.role, first: e.date, last: e.date, hours: 0, count: 0 };
    if (e.date < s.first) s.first = e.date;
    if (e.date > s.last) s.last = e.date;
    s.hours += e.hours || 0;
    s.count++;
    m.set(e.role, s);
  }
  return [...m.values()].sort((a, b) => a.first.localeCompare(b.first));
}

function RolesTimeline({ entries }: { entries: ClubEntry[] }) {
  if (!entries.length) return <Empty title="Nothing to show yet" />;
  const spans = roleSpans(entries);
  const min = new Date(spans[0].first).getTime();
  const max = Math.max(new Date(spans.reduce((a, s) => (s.last > a ? s.last : a), spans[0].last)).getTime(), min + 86400000);
  const pos = (d: string) => ((new Date(d).getTime() - min) / (max - min)) * 100;

  const byMonth = new Map<string, ClubEntry[]>();
  for (const e of [...entries].sort((a, b) => b.date.localeCompare(a.date))) {
    const k = e.date.slice(0, 7);
    byMonth.set(k, [...(byMonth.get(k) ?? []), e]);
  }

  return (
    <div className="space-y-5">
      <Card title="Roles held">
        <div className="space-y-3">
          {spans.map((s) => (
            <div key={s.role} className="grid grid-cols-[7rem_1fr] items-center gap-3 sm:grid-cols-[10rem_1fr_9rem]">
              <div className="truncate text-sm font-medium" title={s.role}>{s.role}</div>
              <div className="relative h-3 rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className="absolute top-0 h-3 rounded-full bg-brand-500"
                  style={{ left: `${pos(s.first)}%`, width: `max(${pos(s.last) - pos(s.first)}%, 0.75rem)` }}
                  title={`${s.role}: ${formatDate(s.first)} – ${formatDate(s.last)}, ${s.count} activities, ${s.hours} h`}
                />
              </div>
              <div className="muted col-span-2 text-xs sm:col-span-1 sm:text-right">
                {formatDate(s.first)}{s.first !== s.last && ` – ${formatDate(s.last)}`} · {s.hours} h
              </div>
            </div>
          ))}
        </div>
        <div className="muted mt-3 flex justify-between text-xs sm:ml-[10.75rem] sm:mr-[9.75rem]">
          <span>{formatDate(spans[0].first)}</span>
          <span>{formatDate(new Date(max).toISOString())}</span>
        </div>
      </Card>

      <Card title="Chronology">
        <ol className="relative ml-2 border-l-2 border-slate-200 dark:border-slate-700">
          {[...byMonth.entries()].map(([month, list]) => (
            <li key={month} className="mb-5 ml-5">
              <span className="absolute -left-[7px] mt-1 h-3 w-3 rounded-full border-2 border-white bg-brand-500 dark:border-slate-900" />
              <div className="label">{new Date(month + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div>
              <ul className="space-y-1.5">
                {list.map((e) => (
                  <li key={e.id} className="text-sm">
                    <span className="font-medium">{e.title}</span>{' '}
                    <span className="badge bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300">{e.role}</span>{' '}
                    <span className="muted">· {formatDate(e.date)} · {e.hours} h</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

function Summary({ entries, filtered }: { entries: ClubEntry[]; filtered: boolean }) {
  const totalHours = entries.reduce((s, e) => s + (e.hours || 0), 0);
  const spans = roleSpans(entries);
  const types = new Map<string, number>();
  entries.forEach((e) => types.set(e.activityType || 'Other', (types.get(e.activityType || 'Other') ?? 0) + 1));
  const outcomes = entries.map((e) => e.outcome.trim()).filter(Boolean);

  const text = [
    'Dermatology Interest Group — Involvement Summary',
    entries.length ? `${formatDate(entries[entries.length - 1].date)} – ${formatDate(entries[0].date)}` : '',
    '',
    `Total: ${entries.length} activities, ${totalHours} hours`,
    '',
    'Roles held:',
    ...spans.map((s) => `• ${s.role} (${formatDate(s.first)}${s.first !== s.last ? ` – ${formatDate(s.last)}` : ''}): ${s.count} activities, ${s.hours} h`),
    '',
    'Activities by type:',
    ...[...types.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `• ${t}: ${n}`),
    '',
    'Key activities:',
    ...entries.slice(0, 15).map((e) => `• ${formatDate(e.date)} — ${e.title} (${e.role}, ${e.hours} h)${e.outcome ? `: ${e.outcome}` : ''}`),
    ...(outcomes.length ? ['', 'Skills & outcomes:', ...[...new Set(outcomes)].slice(0, 12).map((o) => `• ${o}`)] : []),
  ]
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === ''))
    .join('\n');

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Total hours" value={totalHours} />
        <Stat label="Roles held" value={spans.length} />
        <Stat label="Events" value={entries.length} />
      </div>
      <Card
        title="Copy for CV / application"
        actions={
          <button className="btn-primary" disabled={!entries.length} onClick={async () => toast((await copyText(text)) ? 'Copied to clipboard' : 'Copy failed')}>
            Copy text
          </button>
        }
      >
        {filtered && <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">Filters are applied — the summary covers only the matching entries.</p>}
        <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 font-sans text-sm dark:bg-slate-800">{entries.length ? text : 'Log some activities to generate a summary.'}</pre>
      </Card>
    </div>
  );
}

function EntryForm({ entry, roles, types, onClose }: { entry: ClubEntry | null; roles: string[]; types: string[]; onClose: () => void }) {
  const [d, setD] = useState<ClubEntry>(
    entry ?? {
      id: uid(),
      date: todayStr(),
      title: '',
      role: roles[0] ?? 'Member',
      activityType: types[0] ?? '',
      description: '',
      hours: 1,
      people: '',
      outcome: '',
      links: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  );
  const [linksText, setLinksText] = useState((entry?.links ?? []).join('\n'));
  const set = <K extends keyof ClubEntry>(k: K, v: ClubEntry[K]) => setD((x) => ({ ...x, [k]: v }));

  const save = async () => {
    if (!d.title.trim() || !d.date) return;
    await db.clubEntries.put({
      ...d,
      title: d.title.trim(),
      hours: Number(d.hours) || 0,
      links: linksText.split('\n').map((l) => l.trim()).filter(Boolean),
      updatedAt: nowIso(),
    });
    toast(entry ? 'Entry updated' : 'Activity logged');
    onClose();
  };

  const roleOptions = roles.includes(d.role) ? roles : [d.role, ...roles];
  const typeOptions = !d.activityType || types.includes(d.activityType) ? types : [d.activityType, ...types];

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={entry ? 'Edit activity' : 'Log activity'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!d.title.trim() || !d.date} onClick={save}>Save</button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Activity / event title" className="sm:col-span-2"><input className="input" autoFocus value={d.title} onChange={(e) => set('title', e.target.value)} /></Field>
        <Field label="Date"><input type="date" className="input" value={d.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label="Hours spent"><input type="number" step="0.25" min={0} className="input" value={d.hours} onChange={(e) => set('hours', Number(e.target.value))} /></Field>
        <Field label="My role">
          <select className="input" value={d.role} onChange={(e) => set('role', e.target.value)}>
            {roleOptions.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Type of activity">
          <select className="input" value={d.activityType} onChange={(e) => set('activityType', e.target.value)}>
            {typeOptions.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Description" className="sm:col-span-2"><textarea className="input min-h-[90px]" value={d.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="People / mentors involved" className="sm:col-span-2"><input className="input" value={d.people} onChange={(e) => set('people', e.target.value)} placeholder="e.g. Dr. A (faculty advisor), B (co-organizer)" /></Field>
        <Field label="Outcome / skills gained" className="sm:col-span-2"><textarea className="input min-h-[70px]" value={d.outcome} onChange={(e) => set('outcome', e.target.value)} placeholder="e.g. Led a 40-person workshop; public speaking; event planning" /></Field>
        <Field label="Attachments / links" hint="One per line — URLs to slides, photos, certificates, or a note of where a file is stored." className="sm:col-span-2">
          <textarea className="input min-h-[60px]" value={linksText} onChange={(e) => setLinksText(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function ListsEditor({ roles, types, onClose }: { roles: string[]; types: string[]; onClose: () => void }) {
  const [r, setR] = useState(roles.join('\n'));
  const [t, setT] = useState(types.join('\n'));
  const clean = (s: string) => [...new Set(s.split('\n').map((x) => x.trim()).filter(Boolean))];
  const save = async () => {
    await setMeta('clubRoles', clean(r));
    await setMeta('activityTypes', clean(t));
    toast('Lists updated');
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Roles & activity types"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save}>Save</button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Roles" hint="One per line. Existing entries keep their role even if removed here.">
          <textarea className="input min-h-[220px]" value={r} onChange={(e) => setR(e.target.value)} />
        </Field>
        <Field label="Activity types" hint="One per line.">
          <textarea className="input min-h-[220px]" value={t} onChange={(e) => setT(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
