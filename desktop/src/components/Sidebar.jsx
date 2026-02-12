import { Layers, Library, Wifi, TrendingUp, BookOpen, AlertTriangle, Settings, Heart, LayoutDashboard } from 'lucide-react';
import { useState, useEffect } from 'react';
import clsx from 'clsx';

const NavItem = ({ id, icon, label, activeTab, setActiveTab }) => {
  const Icon = icon;
  return (
    <button
      onClick={() => setActiveTab(id)}
      className={clsx(
        "flex items-center w-full px-4 py-3 mb-2 rounded-lg transition-colors cursor-pointer",
        activeTab === id
          ? "bg-space-violet text-white shadow-[0_0_15px_rgba(157,0,255,0.4)]"
          : "text-gray-400 hover:bg-space-charcoal hover:text-white"
      )}
    >
      <Icon className="w-5 h-5 mr-3" />
      <span className="font-medium">{label}</span>
    </button>
  );
};

export default function Sidebar({ activeTab, setActiveTab }) {
  const [ipAddress, setIpAddress] = useState('Loading...');

  useEffect(() => {
    if(window.api) {
        window.api.getIpAddress().then(setIpAddress);
    }
  }, []);

  return (
    <div className="w-64 bg-[#1a1a1a] border-r border-gray-800 flex flex-col p-4 shrink-0">
      <div className="mb-8 px-2 mt-2">
        <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-space-violet to-purple-400 tracking-wider">CARD DEX</h1>
        <p className="text-xs text-gray-500 mt-1 uppercase tracking-widest">Yu-Gi-Oh! Manager</p>
      </div>

      <nav className="flex-1">
        <NavItem id="dashboard" icon={LayoutDashboard} label="Dashboard" activeTab={activeTab} setActiveTab={setActiveTab} />
        <NavItem id="staging" icon={Layers} label="Staging Area" activeTab={activeTab} setActiveTab={setActiveTab} />
        <NavItem id="collection" icon={Library} label="My Collection" activeTab={activeTab} setActiveTab={setActiveTab} />
        <NavItem id="portfolio" icon={TrendingUp} label="Portfolio" activeTab={activeTab} setActiveTab={setActiveTab} />
        <NavItem id="deckbuilder" icon={BookOpen} label="Deck Builder" activeTab={activeTab} setActiveTab={setActiveTab} />
        <NavItem id="unknown" icon={AlertTriangle} label="Unknown Cards" activeTab={activeTab} setActiveTab={setActiveTab} />
        <NavItem id="missing" icon={AlertTriangle} label="Missing Data" activeTab={activeTab} setActiveTab={setActiveTab} />
        <NavItem id="wishlist" icon={Heart} label="Wishlist" activeTab={activeTab} setActiveTab={setActiveTab} />
        <NavItem id="settings" icon={Settings} label="Settings" activeTab={activeTab} setActiveTab={setActiveTab} />
      </nav>

      <div className="mt-auto p-4 bg-black/40 rounded-xl border border-gray-800/50 backdrop-blur-sm">
        <div className="flex items-center text-space-violet mb-3">
          <Wifi className="w-4 h-4 mr-2" />
          <span className="text-xs font-bold uppercase tracking-wider">Scanner Link</span>
        </div>
        <div className="text-sm text-gray-300">
            <span className="block text-xs text-gray-500 mb-1">Connect Mobile App to:</span>
            <code className="block bg-black/50 px-2 py-1.5 rounded border border-gray-800 text-center font-mono text-purple-300 select-all cursor-pointer hover:bg-black/70 transition-colors" title="Click to copy" onClick={() => navigator.clipboard.writeText(ipAddress)}>
              {ipAddress}
            </code>
        </div>
      </div>
    </div>
  );
}
