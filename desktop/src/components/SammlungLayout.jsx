import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import { ROUTES } from '../utils/routes';
import { T } from '../utils/i18n-de';

const SEGMENTS = [
  { to: ROUTES.karten, label: T.karten },
  { to: ROUTES.wunschliste, label: T.wunschliste },
  { to: ROUTES.sets, label: T.sets },
  { to: ROUTES.decks, label: T.decks },
];

// Everything that is "my collection" lives on one page; the segments swap the content below.
export default function SammlungLayout() {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-4 mb-5 shrink-0">
        <h1 className="font-display font-semibold text-2xl text-ink">{T.sammlung}</h1>
        <div className="inline-flex bg-obsidian-700 border border-line rounded-xl p-1 gap-1">
          {SEGMENTS.map(s => (
            <NavLink
              key={s.to}
              to={s.to}
              className={({ isActive }) => clsx(
                'px-4 py-1.5 rounded-lg font-display text-sm font-medium transition-colors',
                isActive ? 'bg-space-violet text-white shadow-[0_6px_16px_-8px_#9D00FF]' : 'text-ink-muted hover:text-ink'
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
