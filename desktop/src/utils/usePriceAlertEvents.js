import { useState, useEffect } from 'react';

const LOAD_ERROR = 'Preis-Alarme konnten nicht geladen werden.';

// Spec G2 §6.3 — offene Preis-Alarme. Laedt neu, wenn der Hauptprozess price-alerts-changed meldet
// (Sync-Zyklus oder ein eigenes "Erledigt"). Bei einem Fehler bleibt der letzte Stand stehen.
export function usePriceAlertEvents() {
  const [state, setState] = useState(() => (window.api?.listPriceAlertEvents
    ? { loading: true, error: null, events: null }
    : { loading: false, error: LOAD_ERROR, events: null }));
  useEffect(() => {
    if (!window.api?.listPriceAlertEvents) return undefined;
    let alive = true;
    const load = () => window.api.listPriceAlertEvents()
      .then((events) => { if (alive) setState({ loading: false, error: null, events: events || [] }); })
      .catch(() => { if (alive) setState((s) => ({ loading: false, error: LOAD_ERROR, events: s.events })); });
    load();
    const off = window.api.onPriceAlertsChanged?.(() => load());
    return () => { alive = false; off?.(); };
  }, []);
  return state;
}
