import { useEffect, useRef, type ReactNode } from 'react';
import { cx } from '../lib/utils';

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx('card p-4 sm:p-5', className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="h2">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="h1">{title}</h1>
        {subtitle && <p className="muted mt-1 text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
    </label>
  );
}

export function ProgressBar({ value, className, tone = 'brand' }: { value: number; className?: string; tone?: 'brand' | 'amber' | 'rose' }) {
  const color = tone === 'brand' ? 'bg-brand-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className={cx('h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800', className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full transition-all', color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">{value}</div>
      {sub && <div className="muted mt-0.5 text-xs">{sub}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
      <div className="font-medium text-slate-700 dark:text-slate-200">{title}</div>
      {children && <div className="muted mt-1 text-sm">{children}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', h);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={cx('card flex max-h-[92vh] w-full flex-col rounded-b-none sm:rounded-b-xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="h2">{title}</h2>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="overflow-y-auto px-4 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Delete', onConfirm, onClose, danger = true }: { open: boolean; title: string; message: ReactNode; confirmLabel?: string; onConfirm: () => void; onClose: () => void; danger?: boolean }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
        </>
      }
    >
      <div className="text-sm">{message}</div>
    </Modal>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; badge?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="inline-flex min-w-full gap-1 border-b border-slate-200 dark:border-slate-800">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={cx(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              value === t.id
                ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
            )}
          >
            {t.label}
            {t.badge ? <span className="ml-1.5 rounded-full bg-brand-100 px-1.5 text-xs text-brand-700 dark:bg-brand-900 dark:text-brand-200">{t.badge}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ConfidenceStars({ value, onChange, size = 'md' }: { value: number; onChange?: (v: number) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex items-center gap-0.5" aria-label={`Confidence ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(value === n ? 0 : n)}
          className={cx(
            'rounded transition-colors disabled:cursor-default',
            size === 'sm' ? 'h-2.5 w-2.5' : 'h-4 w-4',
            n <= value ? 'bg-brand-500' : 'bg-slate-200 dark:bg-slate-700',
            onChange && 'hover:ring-2 hover:ring-brand-300',
          )}
          title={`${n}/5`}
          aria-label={`Set confidence ${n}`}
        />
      ))}
    </div>
  );
}

export function SaveStatus({ state }: { state: 'saved' | 'saving' | 'dirty' }) {
  const map = {
    saved: { text: 'Saved', cls: 'text-emerald-600 dark:text-emerald-400' },
    saving: { text: 'Saving…', cls: 'text-slate-500' },
    dirty: { text: 'Unsaved changes', cls: 'text-amber-600 dark:text-amber-400' },
  } as const;
  return <span className={cx('text-xs font-medium', map[state].cls)}>{map[state].text}</span>;
}
