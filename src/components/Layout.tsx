import { NavLink, Outlet } from 'react-router-dom';
import { useTheme } from '../lib/settings';
import { cx } from '../lib/utils';
import { ToastHost } from './Toast';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◎', end: true },
  { to: '/study', label: 'Study', icon: '✎' },
  { to: '/club', label: 'Interest Group', short: 'Club', icon: '◇' },
  { to: '/research', label: 'Research', icon: '▤' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

export default function Layout() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="min-h-screen md:flex">
      {/* Sidebar (desktop) */}
      <aside className="no-print sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-5 dark:border-slate-800 dark:bg-slate-900 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
          <div>
            <div className="font-semibold text-slate-900 dark:text-white">Derm Path</div>
            <div className="text-xs text-slate-500">Dermatology training</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
                  isActive
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                )
              }
            >
              <span className="w-4 text-center" aria-hidden>{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <button className="btn-ghost justify-start" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? '☀ Light mode' : '☾ Dark mode'}
        </button>
      </aside>

      {/* Top bar (mobile) */}
      <header className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 md:hidden">
        <div className="flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <span className="font-semibold text-slate-900 dark:text-white">Derm Path</span>
        </div>
        <button className="btn-ghost btn-sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </header>

      <main className="min-w-0 flex-1 px-4 pb-24 pt-5 sm:px-6 md:pb-10 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>

      {/* Bottom nav (mobile) */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-slate-800 dark:bg-slate-900 md:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              cx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-brand-600 dark:text-brand-300' : 'text-slate-500')
            }
          >
            <span className="text-base" aria-hidden>{n.icon}</span>
            {n.short ?? n.label}
          </NavLink>
        ))}
      </nav>
      <ToastHost />
    </div>
  );
}
