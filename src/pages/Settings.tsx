import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, TABLE_NAMES } from '../db/db';
import { exportAll, importAll, resetAll, validateBackup, type BackupFile } from '../db/backup';
import { Card, ConfirmDialog, Field, PageHeader } from '../components/ui';
import { toast } from '../components/Toast';
import { useAiEnabled, useApiKey, useTheme } from '../lib/settings';
import { downloadFile, formatDateTime, todayStr } from '../lib/utils';

export default function Settings() {
  const [theme, setTheme] = useTheme();
  const [aiEnabled, setAiEnabled] = useAiEnabled();
  const [apiKey, setApiKey] = useApiKey();
  const [keyDraft, setKeyDraft] = useState('');
  const [pending, setPending] = useState<BackupFile | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const counts = useLiveQuery(async () => {
    const out: Record<string, number> = {};
    for (const t of TABLE_NAMES) out[t] = await db.table(t).count();
    return out;
  }, []);

  const doExport = async () => {
    const backup = await exportAll();
    await downloadFile(`derm-path-backup-${todayStr()}.json`, JSON.stringify(backup, null, 2));
    toast('Backup ready');
  };

  const onFile = async (f: File | undefined) => {
    setImportError(null);
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text());
      setPending(validateBackup(parsed));
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Could not read file.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" />

      <Card title="Appearance">
        <div className="flex gap-2">
          {(['light', 'dark'] as const).map((t) => (
            <button key={t} className={theme === t ? 'btn-primary' : 'btn-secondary'} onClick={() => setTheme(t)}>
              {t === 'light' ? '☀ Light' : '☾ Dark'}
            </button>
          ))}
        </div>
      </Card>

      <Card title="Backup & restore">
        <p className="muted mb-4 text-sm">
          All data lives only in this browser (IndexedDB). Export a backup regularly — clearing site data or switching browsers/devices will not carry it over.
        </p>
        {counts && (
          <div className="muted mb-4 text-xs">
            {counts.topics} topics · {counts.questions} questions · {counts.attempts} quiz answers · {counts.essays} essays · {counts.clubEntries} club entries · {counts.protocols} protocols
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={doExport}>Export all data (.json)</button>
          <button className="btn-secondary" onClick={() => fileRef.current?.click()}>Import backup…</button>
          <input ref={fileRef} type="file" accept="application/json,text/plain,.json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
        {importError && <p className="mt-3 text-sm text-rose-600">{importError}</p>}
        <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
          <button className="btn-ghost text-rose-600" onClick={() => setConfirmReset(true)}>Reset all data…</button>
        </div>
      </Card>

      <Card title="AI question drafting (optional)">
        <label className="mb-4 flex items-center gap-3 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />
          Show the “Generate questions” button in the Question bank
        </label>
        {aiEnabled && (
          <div className="space-y-3">
            <Field
              label="Anthropic API key"
              hint="Stored only in this browser's localStorage (not in backups) and sent directly to api.anthropic.com. Anyone with access to this browser profile could read it — use a key with a spending limit."
            >
              <div className="flex gap-2">
                <input
                  type="password"
                  className="input"
                  autoComplete="off"
                  placeholder={apiKey ? `Saved (…${apiKey.slice(-4)})` : 'sk-ant-…'}
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                />
                <button
                  className="btn-primary"
                  disabled={!keyDraft.trim()}
                  onClick={() => {
                    setApiKey(keyDraft.trim());
                    setKeyDraft('');
                    toast('API key saved');
                  }}
                >
                  Save
                </button>
              </div>
            </Field>
            {apiKey && (
              <button className="btn-ghost btn-sm text-rose-600" onClick={() => { setApiKey(null); toast('API key removed'); }}>
                Remove saved key
              </button>
            )}
          </div>
        )}
      </Card>

      <Card title="About">
        <p className="muted text-sm">
          Derm Path stores only your own notes, questions, essays, logs and protocols. It contains no textbook text. Works offline once loaded; no account, no server.
        </p>
      </Card>

      <ConfirmDialog
        open={!!pending}
        title="Replace all data?"
        danger
        confirmLabel="Replace with backup"
        message={
          pending && (
            <>
              <p>
                Backup from <b>{formatDateTime(pending.exportedAt)}</b> containing{' '}
                {Object.entries(pending.data).map(([k, v]) => `${v.length} ${k}`).join(', ')}.
              </p>
              <p className="mt-2 font-medium text-rose-600">All current data in this browser will be replaced. Export a backup first if unsure.</p>
            </>
          )
        }
        onClose={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return;
          try {
            await importAll(pending);
            toast('Backup restored');
          } catch (e) {
            setImportError(e instanceof Error ? e.message : 'Import failed.');
          }
        }}
      />
      <ConfirmDialog
        open={confirmReset}
        title="Reset all data?"
        confirmLabel="Erase everything"
        message="This permanently erases every topic, question, essay, club entry and protocol, then restores the default syllabus. Export a backup first if you might need it."
        onClose={() => setConfirmReset(false)}
        onConfirm={async () => {
          await resetAll();
          toast('Data reset');
          window.location.reload();
        }}
      />
    </div>
  );
}
