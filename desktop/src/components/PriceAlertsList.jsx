import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Check } from 'lucide-react';
import { cardRoute } from '../utils/routes';
import { fmtDayDE } from '../utils/priceSteps';

// Spec G2 §6.3 — Zeilen offener Preis-Alarme (Start-Karte und Insights-Reiter). Der Text kommt fertig
// aus dem Hauptprozess (electron/alert-text.cjs), damit es nur eine JS-Fassung gibt.
const printingOf = (e) => ({ id: e.card_id, set_code: e.set_code, language: e.language, rarity: e.rarity });

export default function PriceAlertsList({ events }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [failed, setFailed] = useState(false);
  const list = events.map((e) => cardRoute(printingOf(e)));
  const dismiss = (id) => window.api.dismissPriceAlertEvent(id)
    .then(() => setFailed(false))
    .catch(() => setFailed(true));
  return (
    <div>
      {failed && <div className="text-[11px] text-bad mb-1">Erledigen fehlgeschlagen.</div>}
      <div className="divide-y divide-line">
        {events.map((e) => (
          <div key={e.id} className="flex items-center gap-3 py-2">
            <button type="button"
              onClick={() => navigate(cardRoute(printingOf(e)), { state: { background: location, list } })}
              className="min-w-0 flex-1 flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-2 py-1 transition-colors">
              <span className="font-mono text-[11px] text-muted shrink-0">{fmtDayDE(String(e.day))}</span>
              <span className="text-sm text-text truncate">{e.text}</span>
            </button>
            <button type="button" onClick={() => dismiss(e.id)}
              className="shrink-0 flex items-center gap-1 text-xs text-muted hover:text-text border border-line rounded-lg px-2 py-1">
              <Check className="w-3 h-3" /> Erledigt
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
