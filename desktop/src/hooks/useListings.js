import { useState, useEffect, useCallback, useRef } from 'react';
import { createLatestOnly } from '../utils/busyGate.js';
import { todayLocal } from '../utils/today.js';

const LOAD_ERROR = 'Angebote konnten nicht geladen werden.';

// Spec H3a §6 -- Uebersicht aller Angebote (listings-overview). Laedt beim Einhaengen, bei Abgleich (Angebote,
// Sammlung, Verkaeufe) und bei den Fenster-Ereignissen 'listings-dirty'/'collection-dirty'. data null = laedt ("…").
// Ein Ladefehler behaelt den letzten Stand. Die zuletzt gestartete Abfrage gewinnt (wie useSaleData).
export function useListingsData() {
  const [state, setState] = useState(() => ({ data: null, error: window.api?.listingsOverview ? null : LOAD_ERROR }));
  const alive = useRef(true);
  const latest = useRef(createLatestOnly());
  const reload = useCallback(() => {
    if (!window.api?.listingsOverview) return Promise.resolve();
    const token = latest.current.start();
    return window.api.listingsOverview({ today: todayLocal() })
      .then((d) => { if (alive.current && latest.current.isCurrent(token)) setState({ data: d, error: null }); })
      .catch(() => { if (alive.current && latest.current.isCurrent(token)) setState((s) => ({ data: s.data, error: LOAD_ERROR })); });
  }, []);
  useEffect(() => {
    alive.current = true;
    reload();
    const onDirty = () => { reload(); };
    const offs = [window.api?.onListingsChanged?.(onDirty), window.api?.onCollectionChanged?.(onDirty), window.api?.onSalesChanged?.(onDirty)];
    window.addEventListener('listings-dirty', onDirty);
    window.addEventListener('collection-dirty', onDirty);
    return () => {
      alive.current = false;
      offs.forEach((off) => off?.());
      window.removeEventListener('listings-dirty', onDirty);
      window.removeEventListener('collection-dirty', onDirty);
    };
  }, [reload]);
  return { data: state.data, error: state.error, reload };
}
