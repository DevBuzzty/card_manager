import { Home, ScanLine, Library, Layers, Tag, BarChart3, Settings as SettingsIcon, Banknote, Wifi } from 'lucide-react';
import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { NAV_GROUPS } from '../utils/i18n-de';
import { useNavCounts } from '../hooks/useNavCounts';

const ICONS = { start: Home, scannen: ScanLine, sammlung: Library, decks: Layers, verkaufen: Banknote, deals: Tag, insights: BarChart3, einstellungen: SettingsIcon };

const NavItem = ({ to, icon, label, match, badge }) => {
  // eslint in this project doesn't see a destructured `icon: Icon` as used — bind it in the body.
  const Icon = icon;
  const location = useLocation();
  // The sidebar renders outside <Routes>, so while the card panel is open its pathname is the
  // /karte/… overlay route and NavLink's own isActive would light nothing up. The page behind the
  // panel is the background — highlight that, so the sidebar agrees with the segment bar.
  const pathname = location.state?.background?.pathname || location.pathname;
  const base = match || to;
  const active = pathname === base || pathname.startsWith(`${base}/`);
  return (
    <NavLink
      to={to}
      className={clsx(
        'flex items-center w-full gap-3 px-3 py-2.5 rounded-[10px] transition-colors cursor-pointer text-xs font-medium relative',
        active
          ? 'text-text bg-accent/10'
          : 'text-muted hover:bg-surface hover:text-text'
      )}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded bg-accent" />}
      <Icon className="w-[17px] h-[17px] shrink-0" strokeWidth={1.8} />
      <span>{label}</span>
      {/* Abnahme I1: auf der getoenten aktiven Flaeche erreicht text-muted hell nur 4,35:1 -- dort Textfarbe. */}
      {badge > 0 && <span className={clsx('ml-auto text-klein', active ? 'text-text' : 'text-muted')}>{badge}</span>}
    </NavLink>
  );
};

export default function Sidebar() {
  const [phoneOnline, setPhoneOnline] = useState(false);
  // Spec I §3.1: Zaehler an "Scannen" (offene Unbekannte) und "Verkaufen" (vorgemerkte Exemplare +
  // laufende Angebote), aus dem nav-counts-Kanal. Abschlussreview B6: gemeinsamer Hook, der auch bei
  // Sammlungs- und Verkaufsaenderung aus dem Abgleich neu laedt.
  const counts = useNavCounts() || { unknown: 0, forSale: 0, listingsOpen: 0 };
  const badge = (key) => (key === 'scannen' ? counts.unknown : key === 'verkaufen' ? counts.forSale + counts.listingsOpen : 0);

  useEffect(() => window.api?.onPhoneStatus?.(setPhoneOnline), []);

  return (
    <div className="w-64 bg-bg border-r border-line flex flex-col p-3.5 shrink-0">
      <div className="flex items-center gap-3 px-2 pt-2 pb-4">
        <div className="w-[34px] h-[34px] rounded-[9px] grid place-items-center font-display font-bold text-accent-fg bg-accent">CD</div>
        <div>
          <h1 className="font-display font-bold tracking-[0.08em] text-base text-text">CARD DEX</h1>
          <span className="block text-klein tracking-[0.24em] text-muted uppercase font-display">Duel Manager</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto custom-scrollbar">
        {NAV_GROUPS.map(g => (
          <div key={g.group} className="mb-4">
            <div className="px-3 mb-1 text-klein uppercase tracking-wider text-muted">{g.group}</div>
            <div className="space-y-0.5">
              {g.items.map(n => (
                <NavItem key={n.key} to={n.to} icon={ICONS[n.key]} label={n.label} badge={badge(n.key)}
                  match={n.key === 'sammlung' ? '/sammlung' : n.key === 'verkaufen' ? '/verkaufen' : n.key === 'einstellungen' ? '/einstellungen' : undefined} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <NavLink to="/einstellungen/verbindung"
        className="mt-3 flex items-center gap-2.5 bg-surface border border-line rounded-xl px-3 py-2.5 hover:border-accent/40 transition-colors">
        <span className={clsx('w-2 h-2 rounded-full', phoneOnline ? 'bg-good' : 'bg-muted')} />
        <span className="text-klein text-muted">{phoneOnline ? 'Handy verbunden' : 'Kein Handy'}</span>
        <Wifi className="w-3.5 h-3.5 ml-auto text-muted" strokeWidth={1.8} />
      </NavLink>
    </div>
  );
}
