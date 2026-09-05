import { Home, ScanLine, Library, Tag, BarChart3, Settings as SettingsIcon, Wifi } from 'lucide-react';
import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { NAV, T } from '../utils/i18n-de';

const ICONS = { start: Home, scannen: ScanLine, sammlung: Library, deals: Tag, insights: BarChart3 };

const NavItem = ({ to, icon, label, match }) => {
  // eslint in this project doesn't see a destructured `icon: Icon` as used — bind it in the body.
  const Icon = icon;
  const { pathname } = useLocation();
  const forcedActive = match ? pathname.startsWith(match) : false;
  return (
    <NavLink
      to={to}
      className={({ isActive }) => clsx(
        'flex items-center w-full gap-3 px-3 py-2.5 rounded-[10px] transition-colors cursor-pointer text-[13.5px] font-medium relative',
        (isActive || forcedActive)
          ? 'text-white bg-gradient-to-r from-space-violet/25 to-transparent shadow-[inset_0_0_0_1px_rgba(157,0,255,0.35)]'
          : 'text-ink-muted hover:bg-obsidian-700 hover:text-ink'
      )}
    >
      {({ isActive }) => {
        const active = isActive || forcedActive;
        return (
          <>
            {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded bg-violet-soft shadow-[0_0_10px_#9D00FF]" />}
            <Icon className="w-[17px] h-[17px] shrink-0" strokeWidth={1.8} />
            <span>{label}</span>
          </>
        );
      }}
    </NavLink>
  );
};

export default function Sidebar() {
  const [phoneOnline, setPhoneOnline] = useState(false);

  useEffect(() => window.api?.onPhoneStatus?.(setPhoneOnline), []);

  return (
    <div className="w-64 bg-obsidian-800 border-r border-line flex flex-col p-3.5 shrink-0">
      <div className="flex items-center gap-3 px-2 pt-2 pb-4">
        <div className="w-[34px] h-[34px] rounded-[9px] grid place-items-center font-display font-bold text-obsidian bg-gradient-to-br from-gold to-[#ffe08a] shadow-[0_0_18px_rgba(245,197,66,0.4)]">CD</div>
        <div>
          <h1 className="font-display font-bold tracking-[0.08em] text-[16px] text-transparent bg-clip-text bg-gradient-to-r from-white to-violet-soft">CARD DEX</h1>
          <span className="block text-[9px] tracking-[0.24em] text-ink-faint uppercase font-display">Duel Manager</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto custom-scrollbar space-y-0.5">
        {NAV.map(n => <NavItem key={n.key} to={n.to} icon={ICONS[n.key]} label={n.label} match={n.key === 'sammlung' ? '/sammlung' : undefined} />)}
      </nav>

      <NavItem to="/einstellungen" icon={SettingsIcon} label={T.einstellungen} />

      <NavLink to="/einstellungen"
        className="mt-3 flex items-center gap-2.5 bg-obsidian-700 border border-line rounded-xl px-3 py-2.5 hover:border-space-violet/40 transition-colors">
        <span className={clsx('w-2 h-2 rounded-full', phoneOnline ? 'bg-good shadow-[0_0_8px_#39d98a]' : 'bg-ink-faint')} />
        <span className="text-[12px] text-ink-muted">{phoneOnline ? 'Handy verbunden' : 'Kein Handy'}</span>
        <Wifi className="w-3.5 h-3.5 ml-auto text-ink-faint" strokeWidth={1.8} />
      </NavLink>
    </div>
  );
}
