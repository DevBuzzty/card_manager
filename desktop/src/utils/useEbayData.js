import { useState, useEffect, useCallback, useRef } from 'react';
import { createLatestOnly } from './busyGate.js';

// Spec H3b1 §5.4 -- eBay-Stand (Zwischenspeicher der Ansicht ebay_status) und eBay-Zeilen je Angebot.
// status: undefined = lädt ("…"), null = kein Stand (Tabellen fehlen / nie gezogen). Die zuletzt gestartete Abfrage gewinnt.
// Nur lesen: onEbayChanged/listings-dirty loesen hier ausschliesslich reload() aus, nie ebaySyncNow (sonst Schleife).
// Abschluss-Fix B2: { pending: true } (Hauptprozess hat noch nie gezogen) -> undefined = Ladezustand „…“.
export function statusFromReply(s) {
  if (s?.pending) return undefined;
  return s?.status ?? null;
}

export function useEbayData() {
  const [state, setState] = useState(() => ({ status: undefined, rows: {} }));
  const latest = useRef(createLatestOnly());
  const reload = useCallback(() => {
    const token = latest.current.start();
    if (!window.api?.ebayStatus) return Promise.resolve().then(() => setState({ status: null, rows: {} }));
    return Promise.all([window.api.ebayStatus(), window.api.ebayListings()])
      .then(([s, rows]) => { if (latest.current.isCurrent(token)) setState({ status: statusFromReply(s), rows: rows || {} }); })
      .catch(() => { if (latest.current.isCurrent(token)) setState((x) => ({ status: x.status === undefined ? null : x.status, rows: x.rows })); });
  }, []);
  useEffect(() => {
    const seq = latest.current;
    reload();
    const onDirty = () => { reload(); };
    const off = window.api?.onEbayChanged?.(onDirty);
    window.addEventListener('listings-dirty', onDirty);
    return () => { seq.start(); off?.(); window.removeEventListener('listings-dirty', onDirty); };
  }, [reload]);
  return { status: state.status, rows: state.rows, reload };
}
