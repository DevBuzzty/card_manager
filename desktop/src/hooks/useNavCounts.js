import { useEffect, useState } from 'react';

// Spec I §3.1 -- Zaehler aus nav-counts (Unbekannte als Karten, vorgemerkte Exemplare, aktive Angebote).
// Ein Hook fuer Seitenleiste, Scannen, Start und Verkaufen, damit alle dieselbe Zahl zeigen.
// Neu geladen bei Cloud-Abgleich (Angebote, Sammlung, Verkaeufe) und bei den lokalen Fenster-Ereignissen
// 'collection-dirty'/'listings-dirty' (Karten-Detail, Verkauf, Angebot, Scannen) -- Muster useListings.js.
// null = laedt noch.
export function useNavCounts() {
  const [counts, setCounts] = useState(null);
  useEffect(() => {
    let lebt = true;
    const laden = () => window.api?.navCounts?.().then((c) => { if (lebt && c) setCounts(c); }).catch(() => {});
    laden();
    const offs = [window.api?.onListingsChanged?.(laden), window.api?.onCollectionChanged?.(laden), window.api?.onSalesChanged?.(laden)];
    window.addEventListener('collection-dirty', laden);
    window.addEventListener('listings-dirty', laden);
    return () => {
      lebt = false;
      offs.forEach((off) => { if (typeof off === 'function') off(); });
      window.removeEventListener('collection-dirty', laden);
      window.removeEventListener('listings-dirty', laden);
    };
  }, []);
  return counts;
}
