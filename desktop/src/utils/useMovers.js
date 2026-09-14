import { useState, useEffect } from 'react';

// Laedt get-movers und laedt bei Preis- oder Sammlungsaenderung neu. Kein Nullwert beim Laden (Spec §4.8).
// Der Zustand traegt sein Fenster (`days`) mit; passt es nicht zum aktuell angeforderten Fenster
// (Wechsel z.B. von 7 auf 30 Tage, IPC noch nicht zurueck), wird ein abgeleiteter Ladezustand
// zurueckgegeben statt der alten Liste unter dem neuen Label -- ohne synchrones setState im Effekt.
export function useMovers(days) {
  const [state, setState] = useState(() => (window.api?.getMovers
    ? { days, loading: true, error: null, data: null }
    : { days, loading: false, error: 'Bewegungen konnten nicht geladen werden.', data: null }));
  useEffect(() => {
    if (!window.api?.getMovers) return undefined;
    let alive = true;
    const load = () => window.api.getMovers(days)
      .then((data) => { if (alive) setState({ days, loading: false, error: null, data }); })
      .catch(() => { if (alive) setState((s) => ({ days, loading: false, error: 'Bewegungen konnten nicht geladen werden.', data: s.days === days ? s.data : null })); });
    load();
    const offPrice = window.api.onPriceUpdate?.(() => load());
    const offColl = window.api.onCollectionChanged?.(() => load());
    return () => { alive = false; offPrice?.(); offColl?.(); };
  }, [days]);
  return state.days === days ? state : { loading: true, error: null, data: null };
}
