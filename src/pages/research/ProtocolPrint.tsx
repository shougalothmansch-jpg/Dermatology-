import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { db } from '../../db/db';
import { completionPct, PROSPERO_TEMPLATE } from '../../lib/prospero';
import { formatDate, formatDateTime } from '../../lib/utils';

/** Clean, printable view — use the browser's “Save as PDF” to export. */
export default function ProtocolPrint() {
  const { id = '' } = useParams();
  const p = useLiveQuery(() => db.protocols.get(id).then((x) => x ?? null), [id]);

  useEffect(() => {
    if (p) document.title = `${p.id} — ${p.fields.title || p.name}`;
    return () => {
      document.title = 'Derm Path';
    };
  }, [p]);

  if (p === undefined) return null;
  if (p === null) return <div className="p-8">Protocol not found. <Link to="/research" className="underline">Back</Link></div>;

  return (
    <div className="min-h-screen bg-slate-100 py-6 dark:bg-slate-950 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-3xl flex-wrap items-center gap-2 px-4">
        <Link to={`/research/${p.id}`} className="btn-ghost">← Back to editor</Link>
        <span className="muted text-sm">Use “Save as PDF” in the print dialog.</span>
        <button className="btn-primary ml-auto" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      <article className="print-area mx-auto max-w-3xl bg-white px-8 py-10 text-slate-900 shadow-sm sm:px-12 print:max-w-none print:shadow-none">
        <header className="mb-8 border-b-2 border-slate-900 pb-4">
          <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">Systematic review protocol</div>
          <h1 className="mt-1 text-2xl font-bold leading-tight">{p.fields.title?.trim() || p.name}</h1>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
            <span><b>ID:</b> {p.id}</span>
            <span><b>Working name:</b> {p.name}</span>
            <span><b>Last edited:</b> {formatDateTime(p.updatedAt)}</span>
            <span><b>Completion:</b> {completionPct(p.fields)}%</span>
          </div>
        </header>
        {PROSPERO_TEMPLATE.map((g) => (
          <section key={g.title} className="mb-7 break-inside-avoid-page">
            <h2 className="mb-3 border-b border-slate-300 pb-1 text-lg font-bold">{g.title}</h2>
            <dl className="space-y-3">
              {g.fields.map((f) => {
                const v = (p.fields[f.key] ?? '').trim();
                return (
                  <div key={f.key} className="break-inside-avoid">
                    <dt className="text-sm font-semibold">{f.label}</dt>
                    <dd className={v ? 'whitespace-pre-wrap text-sm' : 'text-sm italic text-slate-400'}>
                      {v ? (f.kind === 'date' ? formatDate(v) : v) : 'Not yet completed'}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ))}
      </article>
    </div>
  );
}
