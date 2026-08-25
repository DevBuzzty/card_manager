import { useState, lazy, Suspense } from 'react';
import { TrendingUp, BarChart3, Loader2 } from 'lucide-react';
import Statistics from './Statistics';

const Portfolio = lazy(() => import('./Portfolio'));

const Tab = ({ id, icon, label, view, setView }) => {
  const Icon = icon;
  return (
    <button
      onClick={() => setView(id)}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg font-display text-sm font-medium transition-colors ${
        view === id ? 'bg-space-violet text-white shadow-[0_6px_16px_-8px_#9D00FF]' : 'text-ink-muted hover:text-ink'
      }`}
    >
      <Icon className="w-4 h-4" strokeWidth={1.8} /> {label}
    </button>
  );
};

export default function Insights() {
  const [view, setView] = useState('value');

  return (
    <div className="max-w-7xl mx-auto h-full flex flex-col">
      <div className="inline-flex self-start bg-obsidian-700 border border-line rounded-xl p-1 gap-1 mb-5">
        <Tab id="value" icon={TrendingUp} label="Value" view={view} setView={setView} />
        <Tab id="breakdown" icon={BarChart3} label="Breakdown" view={view} setView={setView} />
      </div>
      <div className="flex-1 overflow-auto">
        {view === 'value' ? (
          <Suspense fallback={<div className="flex items-center justify-center h-64 text-space-violet"><Loader2 className="w-8 h-8 animate-spin" /></div>}>
            <Portfolio />
          </Suspense>
        ) : (
          <Statistics />
        )}
      </div>
    </div>
  );
}
