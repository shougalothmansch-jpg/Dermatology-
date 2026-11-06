import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import type { Protocol } from '../../db/types';
import { Card, ConfirmDialog, Empty, Field, Modal, PageHeader, ProgressBar } from '../../components/ui';
import { toast } from '../../components/Toast';
import { completionPct, PROSPERO_TEMPLATE } from '../../lib/prospero';
import { createProtocol, deleteProtocol, duplicateProtocol } from '../../lib/protocols';
import { formatDateTime } from '../../lib/utils';

type NameDialog = { kind: 'new' } | { kind: 'rename'; p: Protocol } | { kind: 'duplicate'; p: Protocol };

export default function ResearchPage() {
  const protocols = useLiveQuery(() => db.protocols.orderBy('updatedAt').reverse().toArray(), []);
  const taskStats = useLiveQuery(async () => {
    const m = new Map<string, { total: number; done: number }>();
    await db.protocolTasks.each((t) => {
      const s = m.get(t.protocolId) ?? { total: 0, done: 0 };
      s.total++;
      if (t.done) s.done++;
      m.set(t.protocolId, s);
    });
    return m;
  }, []);
  const [dialog, setDialog] = useState<NameDialog | null>(null);
  const [deleting, setDeleting] = useState<Protocol | null>(null);
  const [showTemplate, setShowTemplate] = useState(false);
  const navigate = useNavigate();

  if (!protocols) return null;

  return (
    <div>
      <PageHeader
        title="Research"
        subtitle="Build PROSPERO-style systematic review protocols from a master template."
        actions={
          <>
            <button className="btn-secondary" onClick={() => setShowTemplate(true)}>View master template</button>
            <button className="btn-primary" onClick={() => setDialog({ kind: 'new' })}>+ New protocol from template</button>
          </>
        }
      />

      {protocols.length === 0 ? (
        <Empty title="No protocols yet">Create a copy of the master PROSPERO template to start drafting your first systematic review.</Empty>
      ) : (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {protocols.map((p) => {
              const c = completionPct(p.fields);
              const ts = taskStats?.get(p.id);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
                  <Link to={`/research/${p.id}`} className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-mono text-xs font-semibold text-brand-700 dark:text-brand-300">{p.id}</span>
                      <span className="truncate font-medium text-slate-900 dark:text-white">{p.name}</span>
                    </div>
                    {p.fields.title && <div className="muted truncate text-sm">{p.fields.title}</div>}
                    <div className="muted text-xs">
                      Last edited {formatDateTime(p.updatedAt)}
                      {p.fields.status && ` · ${p.fields.status}`}
                      {ts && ` · ${ts.done}/${ts.total} tasks`}
                    </div>
                  </Link>
                  <div className="flex w-36 items-center gap-2">
                    <ProgressBar value={c} />
                    <span className="w-9 text-right text-xs tabular-nums">{c}%</span>
                  </div>
                  <div className="flex gap-1">
                    <Link to={`/research/${p.id}`} className="btn-secondary btn-sm">Open</Link>
                    <button className="btn-ghost btn-sm" onClick={() => setDialog({ kind: 'duplicate', p })}>Duplicate</button>
                    <button className="btn-ghost btn-sm" onClick={() => setDialog({ kind: 'rename', p })}>Rename</button>
                    <button className="btn-ghost btn-sm text-rose-600" onClick={() => setDeleting(p)}>Delete</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {dialog && (
        <NameModal
          title={dialog.kind === 'new' ? 'New protocol from template' : dialog.kind === 'rename' ? 'Rename protocol' : 'Duplicate protocol'}
          initial={dialog.kind === 'new' ? '' : dialog.kind === 'rename' ? dialog.p.name : `${dialog.p.name} (copy)`}
          confirm={dialog.kind === 'new' ? 'Create' : dialog.kind === 'rename' ? 'Rename' : 'Duplicate'}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            if (dialog.kind === 'new') {
              const p = await createProtocol(name);
              toast(`Created ${p.id}`);
              navigate(`/research/${p.id}`);
            } else if (dialog.kind === 'rename') {
              await db.protocols.update(dialog.p.id, { name: name.trim() || dialog.p.name, updatedAt: new Date().toISOString() });
              toast('Renamed');
            } else {
              const p = await duplicateProtocol(dialog.p, name);
              toast(`Duplicated as ${p.id}`);
            }
            setDialog(null);
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete protocol?"
        message={<>Permanently delete <b>{deleting?.id}</b> “{deleting?.name}” and its tasks? This cannot be undone.</>}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await deleteProtocol(deleting.id);
          toast('Protocol deleted');
        }}
      />
      <Modal open={showTemplate} onClose={() => setShowTemplate(false)} title="Master PROSPERO template (read-only)" wide>
        <p className="muted mb-4 text-sm">The master template is never edited. Each new protocol is a separate copy with its own ID.</p>
        {PROSPERO_TEMPLATE.map((g) => (
          <div key={g.title} className="mb-4">
            <div className="label">{g.title}</div>
            <ul className="space-y-2">
              {g.fields.map((f) => (
                <li key={f.key} className="text-sm">
                  <span className="font-medium">{f.label}</span>
                  <span className="muted"> — {f.hint}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Modal>
    </div>
  );
}

function NameModal({ title, initial, confirm, onClose, onSubmit }: { title: string; initial: string; confirm: string; onClose: () => void; onSubmit: (name: string) => void }) {
  const [name, setName] = useState(initial);
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!name.trim()} onClick={() => onSubmit(name)}>{confirm}</button>
        </>
      }
    >
      <Field label="Protocol name" hint="A short working name — the formal review title is a field inside the protocol.">
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSubmit(name)} />
      </Field>
    </Modal>
  );
}
