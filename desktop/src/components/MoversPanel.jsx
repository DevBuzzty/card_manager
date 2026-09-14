import { useState } from 'react';
import MoversList, { MoversSkeleton } from './MoversList';
import { useMovers } from '../utils/useMovers';
import { moversMessage } from '../utils/moversText';

// Spec G1 §4.6 — Insights-Reiter Bewegungen: 7 oder 30 Tage, je Top 10.
export default function MoversPanel() {
  const [days, setDays] = useState(7);
  const { loading, error, data } = useMovers(days);
  const message = data ? moversMessage(data, days) : null;
  return (
    <div className="space-y-4">
      <div className="inline-flex bg-obsidian-700 border border-line rounded-xl p-1 gap-1">
        {[7, 30].map((d) => (
          <button key={d} onClick={() => setDays(d)}
            className={`px-4 py-1.5 rounded-lg text-sm ${days === d ? 'bg-space-violet text-white' : 'text-ink-muted hover:text-ink'}`}>
            {d} Tage
          </button>
        ))}
      </div>
      {!data && loading && <MoversSkeleton rows={6} />}
      {!data && !loading && error && <div className="text-sm text-crit">{error}</div>}
      {data && error && <div className="text-[11px] text-ink-faint">Stand von zuvor — Aktualisieren fehlgeschlagen.</div>}
      {data && message && <div className="text-sm text-ink-faint">{message}</div>}
      {data && !message && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-obsidian-700 border border-line rounded-2xl p-5">
            <h3 className="font-display text-sm uppercase tracking-[0.12em] text-ink-muted mb-2">Gewinner</h3>
            <MoversList movers={data.winners} full />
          </div>
          <div className="bg-obsidian-700 border border-line rounded-2xl p-5">
            <h3 className="font-display text-sm uppercase tracking-[0.12em] text-ink-muted mb-2">Verlierer</h3>
            <MoversList movers={data.losers} full />
          </div>
        </div>
      )}
    </div>
  );
}
