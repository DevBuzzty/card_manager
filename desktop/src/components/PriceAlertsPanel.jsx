import { useState } from 'react';
import { CheckCheck } from 'lucide-react';
import PriceAlertsList from './PriceAlertsList';
import { MoversSkeleton } from './MoversList';
import { usePriceAlertEvents } from '../utils/usePriceAlertEvents';

// Spec G2 §6.3 — Insights-Reiter "Alarme": alle offenen Treffer, oben "Alle erledigt".
export default function PriceAlertsPanel() {
  const { loading, error, events } = usePriceAlertEvents();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Nur die gerade angezeigten Treffer (events sind neueste zuerst; Math.max zur Sicherheit).
  const dismissAll = () => {
    setBusy(true);
    const maxId = Math.max(...events.map((e) => e.id));
    window.api.dismissAllPriceAlertEvents(maxId)
      .then(() => setFailed(false))
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };
  return (
    <div className="bg-surface border border-line rounded-2xl p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-sm tracking-[0.12em] uppercase text-muted">Preis-Alarme</h3>
        {events && events.length > 0 && (
          <button onClick={dismissAll} disabled={busy}
            className="flex items-center gap-1 text-xs text-muted hover:text-text border border-line rounded-lg px-2 py-1 disabled:opacity-50">
            <CheckCheck className="w-3 h-3" /> Alle erledigt
          </button>
        )}
      </div>
      {failed && <div className="text-klein text-bad mb-2">Erledigen fehlgeschlagen.</div>}
      {!events && loading && <MoversSkeleton rows={4} />}
      {!events && !loading && error && <div className="text-sm text-bad">{error}</div>}
      {events && error && <div className="text-klein text-muted mb-2">Stand von zuvor — Aktualisieren fehlgeschlagen.</div>}
      {events && events.length === 0 && <div className="text-sm text-muted">Keine offenen Preis-Alarme</div>}
      {events && events.length > 0 && <PriceAlertsList events={events} />}
    </div>
  );
}
