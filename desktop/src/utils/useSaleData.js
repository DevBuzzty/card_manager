import { useState, useEffect, useCallback, useRef } from 'react';
import { keepPerCard } from './duplicates.js';

const LOAD_ERROR = 'Verkaufsdaten konnten nicht geladen werden.';

// Spec H1 §5 -- lebende Exemplare fuer Duplikate und Verkaufsliste (list-sale-copies) plus keep_per_card.
// Laedt beim Einhaengen, bei Sammlungsaenderung (Sync) und bei 'collection-dirty' (Karten-Detail) neu; reload()
// liefert ein Promise, damit ein Schreibvorgang erst nach dem frischen Stand freigibt.
// data null = laedt noch: die Oberflaeche zeigt "…", nie "0 Karten". Ein Ladefehler behaelt den letzten Stand.
export function useSaleData() {
  const [state, setState] = useState(() => ({ data: null, error: window.api?.listSaleCopies ? null : LOAD_ERROR }));
  const alive = useRef(true);
  const reload = useCallback(() => {
    if (!window.api?.listSaleCopies) return Promise.resolve();
    return Promise.all([window.api.listSaleCopies(), window.api.getSettings()])
      .then(([copies, settings]) => {
        if (alive.current) setState({ data: { copies: Array.isArray(copies) ? copies : [], keep: keepPerCard(settings?.keep_per_card) }, error: null });
      })
      .catch(() => { if (alive.current) setState((s) => ({ data: s.data, error: LOAD_ERROR })); });
  }, []);
  useEffect(() => {
    alive.current = true;
    reload();
    const onDirty = () => { reload(); };
    const off = window.api?.onCollectionChanged?.(onDirty);
    window.addEventListener('collection-dirty', onDirty);
    return () => { alive.current = false; off?.(); window.removeEventListener('collection-dirty', onDirty); };
  }, [reload]);
  return { data: state.data, error: state.error, reload };
}
