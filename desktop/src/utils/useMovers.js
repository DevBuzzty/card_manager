import { useState, useEffect } from 'react';

// Laedt get-movers und laedt bei Preis- oder Sammlungsaenderung neu. Kein Nullwert beim Laden (Spec §4.8).
export function useMovers(days) {
  const [state, setState] = useState(() => (window.api?.getMovers
    ? { loading: true, error: null, data: null }
    : { loading: false, error: 'Bewegungen konnten nicht geladen werden.', data: null }));
  useEffect(() => {
    if (!window.api?.getMovers) return undefined;
    let alive = true;
    const load = () => window.api.getMovers(days)
      .then((data) => { if (alive) setState({ loading: false, error: null, data }); })
      .catch(() => { if (alive) setState((s) => ({ loading: false, error: 'Bewegungen konnten nicht geladen werden.', data: s.data })); });
    load();
    const offPrice = window.api.onPriceUpdate?.(() => load());
    const offColl = window.api.onCollectionChanged?.(() => load());
    return () => { alive = false; offPrice?.(); offColl?.(); };
  }, [days]);
  return state;
}
