import { useState, useEffect, useCallback } from 'react';
import { sortNotices } from './saleNotices.js';

const DISMISS_ERROR = 'Wegtippen braucht die Cloud-Verbindung – bitte später erneut.';

// Spec H3b §7.6 (H3b2) -- offene eBay-Hinweise. Lädt neu, wenn der Hauptprozess sale-notices-changed meldet (Sync-Zyklus
// oder ein eigenes „Erledigt“). Wegtippen nimmt den Hinweis sofort aus der Liste; scheitert es, kommt er zurück.
export function useSaleNotices() {
  const [state, setState] = useState({ notices: null, error: null });
  const load = useCallback(() => {
    if (!window.api?.saleNotices) return Promise.resolve();
    return window.api.saleNotices()
      .then((list) => setState((s) => ({ ...s, notices: sortNotices(list) })))
      .catch(() => setState((s) => ({ ...s, notices: s.notices ?? [] })));
  }, []);
  useEffect(() => {
    load();
    const off = window.api?.onSaleNoticesChanged?.(() => { load(); });
    return () => { off?.(); };
  }, [load]);
  const dismiss = useCallback((noticeId) => {
    setState((s) => ({ error: null, notices: (s.notices ?? []).filter((n) => n.notice_id !== noticeId) }));
    return window.api.dismissSaleNotice(noticeId)
      .catch(() => { setState((s) => ({ ...s, error: DISMISS_ERROR })); return load(); });
  }, [load]);
  return { notices: state.notices, error: state.error, dismiss };
}

// sale_id -> { status, fees_final } für die Marke „Gebühren vorläufig“; lädt bei ebay-changed neu.
export function useEbayOrders() {
  const [orders, setOrders] = useState({});
  useEffect(() => {
    if (!window.api?.ebayOrders) return undefined;
    let alive = true;
    const load = () => window.api.ebayOrders().then((o) => { if (alive) setOrders(o || {}); }).catch(() => {});
    load();
    const off = window.api.onEbayChanged?.(() => { load(); });
    return () => { alive = false; off?.(); };
  }, []);
  return orders;
}
