import { Home, Layers, Library, BarChart3, BookOpen, Settings, Heart, Wifi, Tag } from 'lucide-react';
import { useState, useEffect } from 'react';
import clsx from 'clsx';

const NavItem = ({ id, icon, label, badge, badgeTone, activeTab, setActiveTab }) => {
  const Icon = icon;
  return (
  <button
    onClick={() => setActiveTab(id)}
    className={clsx(
      'flex items-center w-full gap-3 px-3 py-2.5 rounded-[10px] transition-colors cursor-pointer text-[13.5px] font-medium relative',
      activeTab === id
        ? 'text-white bg-gradient-to-r from-space-violet/25 to-transparent shadow-[inset_0_0_0_1px_rgba(157,0,255,0.35)]'
        : 'text-ink-muted hover:bg-obsidian-700 hover:text-ink'
    )}
  >
    {activeTab === id && (
      <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded bg-violet-soft shadow-[0_0_10px_#9D00FF]" />
    )}
    <Icon className="w-[17px] h-[17px] shrink-0" strokeWidth={1.8} />
    <span>{label}</span>
    {badge != null && (
      <span className={clsx(
        'ml-auto font-mono text-[10px] px-[7px] py-px rounded-full',
        badgeTone === 'warn' ? 'bg-gold/15 text-gold' : 'bg-obsidian-600 text-ink-muted'
      )}>{badge}</span>
    )}
  </button>
  );
};

const GroupLabel = ({ children }) => (
  <div className="font-display text-[9.5px] tracking-[0.2em] uppercase text-ink-faint px-2.5 pt-3 pb-1.5">{children}</div>
);

export default function Sidebar({ activeTab, setActiveTab }) {
  const [ipAddress, setIpAddress] = useState('Loading...');

  useEffect(() => {
    if (window.api) window.api.getIpAddress().then(setIpAddress);
  }, []);

  return (
    <div className="w-64 bg-obsidian-800 border-r border-line flex flex-col p-3.5 shrink-0">
      <div className="flex items-center gap-3 px-2 pt-2 pb-4">
        <div className="w-[34px] h-[34px] rounded-[9px] grid place-items-center font-display font-bold text-obsidian bg-gradient-to-br from-gold to-[#ffe08a] shadow-[0_0_18px_rgba(245,197,66,0.4)]">CD</div>
        <div>
          <h1 className="font-display font-bold tracking-[0.08em] text-[16px] text-transparent bg-clip-text bg-gradient-to-r from-white to-violet-soft">CARD DEX</h1>
          <span className="block text-[9px] tracking-[0.24em] text-ink-faint uppercase font-display">Duel Manager</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto custom-scrollbar">
        <NavItem id="dashboard" icon={Home} label="Home" activeTab={activeTab} setActiveTab={setActiveTab} />

        <GroupLabel>Sammeln</GroupLabel>
        <NavItem id="staging" icon={Layers} label="Scan" activeTab={activeTab} setActiveTab={setActiveTab} />
        <NavItem id="collection" icon={Library} label="Collection" activeTab={activeTab} setActiveTab={setActiveTab} />
        <NavItem id="wishlist" icon={Heart} label="Wishlist" activeTab={activeTab} setActiveTab={setActiveTab} />

        <GroupLabel>Schnäppchen</GroupLabel>
        <NavItem id="deals" icon={Tag} label="Deals" activeTab={activeTab} setActiveTab={setActiveTab} />

        <GroupLabel>Analysieren</GroupLabel>
        <NavItem id="insights" icon={BarChart3} label="Insights" activeTab={activeTab} setActiveTab={setActiveTab} />

        <GroupLabel>Bauen</GroupLabel>
        <NavItem id="deckbuilder" icon={BookOpen} label="Deck Builder" activeTab={activeTab} setActiveTab={setActiveTab} />
      </nav>

      <NavItem id="settings" icon={Settings} label="Settings" activeTab={activeTab} setActiveTab={setActiveTab} />

      <div className="mt-3 bg-gradient-to-br from-obsidian-700 to-obsidian-800 border border-line rounded-[13px] p-3.5">
        <div className="flex items-center gap-2 font-display text-[10px] tracking-[0.14em] uppercase text-good">
          <Wifi className="w-4 h-4" strokeWidth={1.8} /> Scanner-Server aktiv
        </div>
        <code
          className="block bg-obsidian border border-line rounded-lg px-2.5 py-2 text-center font-mono text-[13px] text-ink mt-2.5 select-all cursor-pointer hover:bg-black/60 transition-colors"
          title="Zum Kopieren klicken"
          onClick={() => navigator.clipboard.writeText(ipAddress)}
        >{ipAddress}</code>
        <div className="text-[10px] text-ink-faint mt-1.5 text-center">Handy-App mit dieser Adresse verbinden</div>
      </div>
    </div>
  );
}
