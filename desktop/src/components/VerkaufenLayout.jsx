// desktop/src/components/VerkaufenLayout.jsx -- Spec I §5.3. Die vier Stationen ziehen in Task 4 hier ein.
import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import { VERKAUFEN_SEGMENTS, T } from '../utils/i18n-de';

export default function VerkaufenLayout() {
  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-wrap items-center gap-4 mb-5 shrink-0">
        <h1 className="font-display font-semibold text-2xl text-text">{T.verkaufen}</h1>
        <div className="flex flex-wrap bg-surface-2 border border-line rounded-xl p-1 gap-1">
          {VERKAUFEN_SEGMENTS.map(s => (
            <NavLink key={s.id} to={s.to}
              className={({ isActive }) => clsx('px-4 py-1.5 rounded-lg font-display text-sm font-medium transition-colors',
                isActive ? 'bg-accent text-accent-fg' : 'text-muted hover:text-text')}>
              {s.label}
            </NavLink>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0"><Outlet /></div>
    </div>
  );
}

// Platzhalter fuer Task 4 -- fuellt die vier Stationen mit den bestehenden Listen.
export function KandidatenPanel() {
  return <div className="text-muted">Kommt in Task 4.</div>;
}

export function ZumVerkaufPanel() {
  return <div className="text-muted">Kommt in Task 4.</div>;
}

export function AngebotePanel() {
  return <div className="text-muted">Kommt in Task 4.</div>;
}

export function VerkaeufePanel() {
  return <div className="text-muted">Kommt in Task 4.</div>;
}
