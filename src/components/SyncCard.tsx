import { useEffect, useState } from 'react';
import { Card, ConfirmDialog, Field } from './ui';
import { toast } from './Toast';
import { cx, formatDateTime } from '../lib/utils';
import type { SyncStatus } from '../lib/sync/engine';

type Step = 'form' | 'exists' | 'join-choice';

export default function SyncCard() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [first, setFirst] = useState(true);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [joinMode, setJoinMode] = useState<'join-replace' | 'join-merge'>('join-replace');
  const [step, setStep] = useState<Step>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);

  useEffect(() => {
    let off = () => {};
    import('../lib/sync/engine').then((m) => {
      setStatus(m.getSyncStatus());
      off = m.onSyncStatus(setStatus) as () => void;
      void m.refreshStatus();
    });
    return () => off();
  }, []);

  const passError = first && pass.length > 0 && pass.length < 12 ? 'Use at least 12 characters.' : first && pass2 && pass !== pass2 ? 'The passphrases don’t match.' : null;
  const canSubmit = !!user.trim() && pass.length >= (first ? 12 : 1) && (!first || pass === pass2) && !busy;

  const submit = async (mode: 'first' | 'join-replace' | 'join-merge') => {
    setBusy(true);
    setError(null);
    try {
      const m = await import('../lib/sync/engine');
      const r = await m.enableSync(user, pass, mode);
      if (r.status === 'exists') setStep('exists');
      else if (r.status === 'not-found') setError('No synced data found for this username and passphrase. Check both (they’re case- and space-sensitive for the passphrase), or choose “This is my first device”.');
      else {
        toast('Sync is on');
        setPass('');
        setPass2('');
        setStep('form');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn on sync.');
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;

  if (status.enabled) {
    return (
      <Card title="Sync (end-to-end encrypted)">
        <div className="space-y-2 text-sm">
          <p>
            Syncing as <b>{status.user}</b>.{' '}
            <span className="muted">{status.running ? status.message ?? 'Syncing…' : status.lastSync ? `Last synced ${formatDateTime(status.lastSync)}` : 'Not synced yet'}</span>
          </p>
          {status.lastError && !status.running && <p className="text-rose-600">{status.lastError}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              className="btn-primary"
              disabled={status.running}
              onClick={async () => {
                const m = await import('../lib/sync/engine');
                await m.syncNow().then(() => toast('Synced')).catch(() => undefined);
              }}
            >
              {status.running ? 'Syncing…' : 'Sync now'}
            </button>
            <button className="btn-secondary" onClick={() => setConfirmOff(true)}>Turn off on this device</button>
            <button className="btn-ghost text-rose-600" onClick={() => setConfirmErase(true)}>Delete synced copy…</button>
          </div>
          <p className="muted pt-2 text-xs">
            Syncs automatically while the app is open. Topics, questions, Anki cards and progress, essays, club log and protocols sync; textbook PDFs and Anki images stay on each device — add them on each one (the same PDF links up automatically).
          </p>
        </div>
        <ConfirmDialog
          open={confirmOff}
          title="Turn off sync on this device?"
          danger={false}
          confirmLabel="Turn off"
          message="This device keeps all its data and stops syncing. The synced copy stays for your other devices."
          onClose={() => setConfirmOff(false)}
          onConfirm={async () => {
            const m = await import('../lib/sync/engine');
            await m.disableSync();
            toast('Sync turned off on this device');
          }}
        />
        <ConfirmDialog
          open={confirmErase}
          title="Delete the synced copy?"
          confirmLabel="Delete synced copy"
          message="This permanently deletes your encrypted data from the sync service and turns sync off here. Data on each device stays. Other devices will stop syncing."
          onClose={() => setConfirmErase(false)}
          onConfirm={async () => {
            try {
              const m = await import('../lib/sync/engine');
              await m.eraseSyncedCopy();
              toast('Synced copy deleted');
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Could not delete');
            }
          }}
        />
      </Card>
    );
  }

  return (
    <Card title="Sync between devices (end-to-end encrypted)">
      <div className="space-y-4 text-sm">
        <p className="muted">
          Keep your iPhone and Mac in step. Everything is encrypted on your device with a key made from your username and passphrase before it's uploaded — the sync service only ever stores unreadable data, and your passphrase never leaves your device.
        </p>
        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <b>Keep your passphrase safe.</b> Nobody — including the app — can recover it. If you lose it, your devices keep their data but the synced copy can't be opened. Saving it in your iPhone's Passwords app is a good idea.
        </p>

        {step === 'exists' ? (
          <div className="space-y-3">
            <p>You already have a synced copy for <b>{user}</b>. What should happen to this device's data?</p>
            <JoinChoice value={joinMode} onChange={setJoinMode} />
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => setStep('form')}>Back</button>
              <button className="btn-primary" disabled={busy} onClick={() => submit(joinMode)}>{busy ? 'Working…' : 'Continue'}</button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) void submit(first ? 'first' : joinMode);
            }}
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { v: true, t: 'This is my first device', d: 'Upload this device’s data to start syncing.' },
                { v: false, t: 'I already sync another device', d: 'Get your data from your other device.' },
              ].map((o) => (
                <button
                  key={String(o.v)}
                  type="button"
                  onClick={() => setFirst(o.v)}
                  className={cx('rounded-lg border p-3 text-left', first === o.v ? 'border-brand-500 bg-brand-50 dark:bg-brand-950' : 'border-slate-200 dark:border-slate-700')}
                >
                  <div className="text-sm font-semibold">{o.t}</div>
                  <div className="muted text-xs">{o.d}</div>
                </button>
              ))}
            </div>
            <Field label="Username" hint="Any name you'll remember — e.g. your email. It's never stored in readable form.">
              <input className="input" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={user} onChange={(e) => setUser(e.target.value)} />
            </Field>
            <Field label="Passphrase" hint={first ? 'At least 12 characters. Your iPhone can suggest a strong one and save it.' : undefined}>
              <input className="input" type="password" autoComplete={first ? 'new-password' : 'current-password'} value={pass} onChange={(e) => setPass(e.target.value)} />
            </Field>
            {first && (
              <Field label="Passphrase again">
                <input className="input" type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} />
              </Field>
            )}
            {passError && <p className="text-xs text-rose-600">{passError}</p>}
            {!first && <JoinChoice value={joinMode} onChange={setJoinMode} />}
            {error && <p className="text-rose-600">{error}</p>}
            {busy && <p className="muted text-xs">{status.message ?? 'Working…'}</p>}
            <button type="submit" className="btn-primary" disabled={!canSubmit}>{busy ? 'Working…' : 'Turn on sync'}</button>
          </form>
        )}
      </div>
    </Card>
  );
}

function JoinChoice({ value, onChange }: { value: 'join-replace' | 'join-merge'; onChange: (v: 'join-replace' | 'join-merge') => void }) {
  return (
    <div className="space-y-2">
      {[
        { v: 'join-replace' as const, t: 'Use my synced data (recommended for a new device)', d: 'Replaces this device’s topics, questions and progress with the synced copy. PDFs and Anki images on this device are kept.' },
        { v: 'join-merge' as const, t: 'Combine both', d: 'Keeps this device’s data and adds the synced data. On a fresh install this duplicates the default syllabus.' },
      ].map((o) => (
        <label key={o.v} className={cx('flex cursor-pointer items-start gap-2 rounded-lg border p-3', value === o.v ? 'border-brand-500 bg-brand-50 dark:bg-brand-950' : 'border-slate-200 dark:border-slate-700')}>
          <input type="radio" className="mt-1 accent-brand-600" checked={value === o.v} onChange={() => onChange(o.v)} />
          <span>
            <span className="block text-sm font-semibold">{o.t}</span>
            <span className="muted block text-xs">{o.d}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
