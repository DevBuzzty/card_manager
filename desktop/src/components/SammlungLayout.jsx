import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import { SAMMLUNG_SEGMENTS, T } from '../utils/i18n-de';

// Everything that is "my collection" lives on one page; the segments swap the content below.
export default function SammlungLayout() {
  return (
    <div className="h-full flex flex-col">
      {/* Wraps instead of overflowing — in a narrow window the heading and the segments together
          are wider than the column, and the page would otherwise scroll sideways. */}
      <div className="flex flex-wrap items-center gap-4 mb-5 shrink-0">
        <h1 className="font-display font-semibold text-2xl text-ink">{T.sammlung}</h1>
        <div className="flex flex-wrap bg-obsidian-700 border border-line rounded-xl p-1 gap-1">
          {SAMMLUNG_SEGMENTS.map(s => (
            <NavLink
              key={s.id}
              to={s.to}
              className={({ isActive }) => clsx(
                'px-4 py-1.5 rounded-lg font-display text-sm font-medium transition-colors',
                isActive ? 'bg-accent text-accent-fg' : 'text-ink-muted hover:text-ink'
              )}
            >
              {s.label}
            </NavLink>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <Outlet />
      </div>
    </div>
  );
}
