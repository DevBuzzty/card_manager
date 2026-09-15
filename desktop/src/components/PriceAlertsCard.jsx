import { useNavigate } from 'react-router-dom';
import { BellRing, ArrowRight } from 'lucide-react';
import PriceAlertsList from './PriceAlertsList';
import { usePriceAlertEvents } from '../utils/usePriceAlertEvents';
import { ROUTES } from '../utils/routes';

// Spec G2 §6.3 — Start-Karte "Preis-Alarme (N)", nur bei bekannten offenen Treffern. Laden oder Fehler
// zeigen hier nichts; der Insights-Reiter "Alarme" zeigt beides ausdruecklich.
export default function PriceAlertsCard() {
  const navigate = useNavigate();
  const { events } = usePriceAlertEvents();
  if (!events || events.length === 0) return null;
  return (
    <div className="bg-obsidian-700 border border-line rounded-2xl p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-sm tracking-[0.12em] uppercase text-ink-muted flex items-center gap-2">
          <BellRing className="w-4 h-4" strokeWidth={1.8} /> Preis-Alarme ({events.length})
        </h3>
        <button onClick={() => navigate(ROUTES.insights, { state: { tab: 'alarme' } })}
          className="text-xs text-violet-soft hover:underline flex items-center gap-1">Alle <ArrowRight className="w-3 h-3" /></button>
      </div>
      <PriceAlertsList events={events.slice(0, 2)} />
    </div>
  );
}
