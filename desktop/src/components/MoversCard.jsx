import { useNavigate } from 'react-router-dom';
import { TrendingUp, ArrowRight } from 'lucide-react';
import MoversList, { MoversSkeleton } from './MoversList';
import { useMovers } from '../utils/useMovers';
import { moversMessage } from '../utils/moversText';
import { ROUTES } from '../utils/routes';

export default function MoversCard() {
  const navigate = useNavigate();
  const { loading, error, data } = useMovers(7);
  const message = data ? moversMessage(data, 7) : null;
  return (
    <div className="bg-surface border border-line rounded-2xl p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-sm tracking-[0.12em] uppercase text-muted flex items-center gap-2">
          <TrendingUp className="w-4 h-4" strokeWidth={1.8} /> Bewegungen · 7 Tage
        </h3>
        <button onClick={() => navigate(ROUTES.insights, { state: { tab: 'bewegungen' } })}
          className="text-xs text-accent hover:underline flex items-center gap-1">Alle <ArrowRight className="w-3 h-3" /></button>
      </div>
      {!data && loading && <MoversSkeleton />}
      {!data && !loading && error && <div className="text-sm text-bad">{error}</div>}
      {data && error && <div className="text-[11px] text-muted mb-2">Stand von zuvor — Aktualisieren fehlgeschlagen.</div>}
      {data && message && <div className="text-sm text-muted">{message}</div>}
      {data && !message && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div><div className="text-[11px] uppercase tracking-wide text-muted mb-1">Gewinner</div><MoversList movers={data.winners.slice(0, 3)} /></div>
          <div><div className="text-[11px] uppercase tracking-wide text-muted mb-1">Verlierer</div><MoversList movers={data.losers.slice(0, 3)} /></div>
        </div>
      )}
    </div>
  );
}
