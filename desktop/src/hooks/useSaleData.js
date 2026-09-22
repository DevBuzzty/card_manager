import { useState, useEffect, useCallback, useRef } from 'react';
import { keepPerCard } from '../utils/duplicates.js';
import { createLatestOnly } from '../utils/busyGate.js';

const LOAD_ERROR = 'Verkaufsdaten konnten nicht geladen werden.';

// Spec H1 §5 -- lebende Exemplare fuer Duplikate und Verkaufsliste (list-sale-copies) plus keep_per_card.
// Laedt beim Einhaengen, bei Sammlungsaenderung (Sync) und bei 'collection-dirty' (Karten-Detail) neu; reload()
// liefert ein Promise, damit ein Schreibvorgang erst nach dem frischen Stand freigibt.
// data null = laedt noch: die Oberflaeche zeigt "…", nie "0 Karten". Ein Ladefehler behaelt den letzten Stand.
// Review Runde 1 -- createLatestOnly() schuetzt gegen sich ueberschneidende reload()-Aufrufe: kommt eine aeltere
// Antwort spaeter an als eine neuere, wird sie verworfen.
export function useSaleData() {
  const [state, setState] = useState(() => ({ data: null, error: window.api?.listSaleCopies ? null : LOAD_ERROR }));
  const alive = useRef(true);
  const latest = useRef(createLatestOnly());
  const reload = useCallback(() => {
    if (!window.api?.listSaleCopies) return Promise.resolve();
    const token = latest.current.start();
    return Promise.all([window.api.listSaleCopies(), window.api.getSettings()])
      .then(([copies, settings]) => {
        if (alive.current && latest.current.isCurrent(token)) setState({ data: { copies: Array.isArray(copies) ? copies : [], keep: keepPerCard(settings?.keep_per_card) }, error: null });
      })
      .catch(() => { if (alive.current && latest.current.isCurrent(token)) setState((s) => ({ data: s.data, error: LOAD_ERROR })); });
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
