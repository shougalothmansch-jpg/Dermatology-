import { useEffect, useState } from 'react';

export function toast(message: string) {
  window.dispatchEvent(new CustomEvent('dermpath-toast', { detail: message }));
}

export function ToastHost() {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);
  useEffect(() => {
    const h = (e: Event) => {
      const id = Date.now() + Math.random();
      setItems((xs) => [...xs, { id, msg: (e as CustomEvent<string>).detail }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 2600);
    };
    window.addEventListener('dermpath-toast', h);
    return () => window.removeEventListener('dermpath-toast', h);
  }, []);
  return (
    <div className="no-print pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="pointer-events-auto rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
          {t.msg}
        </div>
      ))}
    </div>
  );
}
