import { useState, lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { TrendingUp, BarChart3, ArrowUpDown, BellRing, Loader2, Receipt } from 'lucide-react';
import Statistics from './Statistics';
import MoversPanel from './MoversPanel';
import ValueBreakdown from './ValueBreakdown';
import PriceAlertsPanel from './PriceAlertsPanel';
import SalesPanel from './SalesPanel';

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
  const location = useLocation();
  // Spec G2 §6.2: der Klick auf die Benachrichtigung navigiert mit state.tab = 'alarme', auch wenn
  // Insights schon offen ist. Eine Reiterwahl gilt deshalb nur fuer den Navigationseintrag, auf dem
  // sie getroffen wurde (location.key) — ein neuer Eintrag nimmt wieder seinen state.tab, ohne setState
  // im Effekt.
  const requested = location.state?.tab || 'value';
  const [pick, setPick] = useState({ key: location.key, view: requested });
  const view = pick.key === location.key ? pick.view : requested;
  const setView = (v) => setPick({ key: location.key, view: v });
  const [metric, setMetric] = useState('count');

  return (
    <div className="max-w-7xl mx-auto h-full flex flex-col">
      <div className="inline-flex self-start bg-obsidian-700 border border-line rounded-xl p-1 gap-1 mb-5">
        <Tab id="value" icon={TrendingUp} label="Wert" view={view} setView={setView} />
        <Tab id="bewegungen" icon={ArrowUpDown} label="Bewegungen" view={view} setView={setView} />
        <Tab id="breakdown" icon={BarChart3} label="Aufteilung" view={view} setView={setView} />
        <Tab id="alarme" icon={BellRing} label="Alarme" view={view} setView={setView} />
        <Tab id="verkaeufe" icon={Receipt} label="Verkäufe" view={view} setView={setView} />
      </div>
      <div className="flex-1 overflow-auto">
        {view === 'value' && (
          <Suspense fallback={<div className="flex items-center justify-center h-64 text-space-violet"><Loader2 className="w-8 h-8 animate-spin" /></div>}>
            <Portfolio />
          </Suspense>
        )}
        {view === 'bewegungen' && <MoversPanel />}
        {view === 'breakdown' && (
          <div className="space-y-4">
            <div className="inline-flex bg-obsidian-700 border border-line rounded-xl p-1 gap-1">
              {[{ id: 'count', label: 'Anzahl' }, { id: 'value', label: 'Wert' }].map((m) => (
                <button key={m.id} onClick={() => setMetric(m.id)}
                  className={`px-4 py-1.5 rounded-lg text-sm ${metric === m.id ? 'bg-space-violet text-white' : 'text-ink-muted hover:text-ink'}`}>{m.label}</button>
              ))}
            </div>
            {metric === 'count' ? <Statistics /> : <ValueBreakdown />}
          </div>
        )}
        {view === 'alarme' && <PriceAlertsPanel />}
        {view === 'verkaeufe' && <SalesPanel />}
      </div>
    </div>
  );
}
