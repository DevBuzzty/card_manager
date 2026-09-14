import { useNavigate, useLocation } from 'react-router-dom';
import { cardRoute } from '../utils/routes';
import { fmtEUR, fmtSignedEUR } from '../utils/format';

// Spec G1 §4.6 — eine Liste Gewinner oder Verlierer. `full` zeigt alt → neu und Exemplare (Insights).
export default function MoversList({ movers, full = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  if (movers.length === 0) return <div className="text-xs text-ink-faint py-2">—</div>;
  const list = movers.map((m) => cardRoute(m));
  return (
    <div className="divide-y divide-line">
      {movers.map((m) => {
        const up = m.deltaHolding > 0;
        return (
          <button key={m.key} type="button"
            onClick={() => navigate(cardRoute(m), { state: { background: location, list } })}
            className="w-full flex items-center gap-3 py-2 text-left hover:bg-white/5 rounded-lg px-2 transition-colors">
            {m.image_url
              ? <img src={m.image_url} alt="" className="w-7 h-10 object-cover rounded border border-line shrink-0" />
              : <div className="w-7 h-10 rounded border border-line bg-obsidian-800 shrink-0" />}
            <div className="min-w-0 flex-1">
              <div className="text-sm text-ink truncate">{m.name || m.id}</div>
              <div className="text-[11px] text-ink-faint font-mono truncate">
                {m.set_code} · {m.rarity}{full ? ` · ${fmtEUR(m.oldPrice)} → ${fmtEUR(m.newPrice)} · ${m.copies}×` : ''}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className={`font-mono text-sm ${up ? 'text-good' : 'text-crit'}`}>{fmtSignedEUR(m.deltaHolding)}</div>
              <div className={`font-mono text-[11px] ${up ? 'text-good' : 'text-crit'}`}>{up ? '+' : ''}{m.pct.toFixed(1)} %</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function MoversSkeleton({ rows = 3 }) {
  return (
    <div className="space-y-2 py-1">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="h-10 rounded-lg bg-obsidian-800 animate-pulse" />)}
    </div>
  );
}
