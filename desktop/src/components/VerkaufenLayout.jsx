// desktop/src/components/VerkaufenLayout.jsx -- Spec I §5.3. Die vier Stationen der Reiterzeile.
import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { AlertCircle } from 'lucide-react';
import { VERKAUFEN_SEGMENTS, T } from '../utils/i18n-de';
import { cardRoute } from '../utils/routes';
import { duplicates } from '../utils/duplicates';
import { useSaleData } from '../hooks/useSaleData';
import { useListingsData } from '../hooks/useListings';
import { useNavCounts } from '../hooks/useNavCounts';
import { verkaufenCounts, SALES_DEFAULT_PERIOD } from '../utils/verkaufenCounts';
import { todayLocal } from '../utils/today';
import DuplicatesList from './DuplicatesList';
import ForSaleList from './ForSaleList';
import ListingsList from './ListingsList';
import SalesPanel from './SalesPanel';

// Abschlussreview B1 / Restrunde 2: die Eintraege der Verkaufsliste im Standard-Zeitraum ueber den
// vorhandenen Kanal sales-overview; neu bei Verkaufs-/Sammlungsaenderung wie SalesPanel. null = laedt.
function useSalesDefaultPeriod() {
  const [sales, setSales] = useState(null);
  useEffect(() => {
    let lebt = true;
    const laden = () => window.api?.salesOverview?.({ period: SALES_DEFAULT_PERIOD, today: todayLocal() })
      .then((d) => { if (lebt && d) setSales(Array.isArray(d.sales) ? d.sales : []); }).catch(() => {});
    laden();
    const offs = [window.api?.onSalesChanged?.(laden), window.api?.onCollectionChanged?.(laden)];
    window.addEventListener('collection-dirty', laden);
    return () => {
      lebt = false;
      offs.forEach((off) => { if (typeof off === 'function') off(); });
      window.removeEventListener('collection-dirty', laden);
    };
  }, []);
  return sales;
}

export default function VerkaufenLayout() {
  // Spec I §5.3: jede Station mit Anzahl in der Reiterzeile (Definition in utils/verkaufenCounts.js).
  const sale = useSaleData();
  const nav = useNavCounts();
  const salesInDefaultPeriod = useSalesDefaultPeriod();
  const duplicateGroups = useMemo(() => {
    if (!sale.data) return null;
    const mainIds = new Map(sale.data.copies.map(c => [String(c.card_id), c.main_id]));
    return duplicates(sale.data.copies, sale.data.keep, (id) => mainIds.get(id));
  }, [sale.data]);
  const counts = verkaufenCounts({ duplicateGroups, saleCopies: sale.data ? sale.data.copies : null, nav, salesInDefaultPeriod });
  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-wrap items-center gap-4 mb-5 shrink-0">
        <h1 className="font-display font-semibold text-2xl text-text">{T.verkaufen}</h1>
        <div className="flex flex-wrap bg-surface-2 border border-line rounded-xl p-1 gap-1">
          {VERKAUFEN_SEGMENTS.map(s => (
            <NavLink key={s.id} to={s.to}
              className={({ isActive }) => clsx('px-4 py-1.5 rounded-lg font-display text-sm font-medium transition-colors',
                isActive ? 'bg-accent text-accent-fg' : 'text-muted hover:text-text')}>
              {({ isActive }) => (
                <>
                  {s.label}
                  {/* Auf der Akzentflaeche des aktiven Reiters waere text-muted unlesbar -- dort accent-fg. */}
                  {counts[s.id] != null && <span className={clsx('ml-1.5 text-[11px] font-normal', isActive ? 'text-accent-fg' : 'text-muted')}>{counts[s.id]}</span>}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0"><Outlet /></div>
    </div>
  );
}

// Kandidaten/Zum Verkauf/Angebote oeffnen ein Exemplar ins Karten-Detail des Printings dieses
// Exemplars -- wie zuvor CollectionList#openSaleCopy, hier gemeinsam fuer alle drei Panels.
function useOpenSaleCopy() {
  const navigate = useNavigate();
  const location = useLocation();
  return (copy) => {
    if (!copy || copy.card_id == null) return;
    navigate(cardRoute({ id: copy.card_id, set_code: copy.set_code, language: copy.language, rarity: copy.rarity }), { state: { background: location, list: [] } });
  };
}

// Spec H1 §4: Duplikate je Haupt-Passcode (main_id kommt aus list-sale-copies) -- wie zuvor in
// CollectionList#saleDuplicates.
export function KandidatenPanel() {
  const sale = useSaleData();
  const onOpenCard = useOpenSaleCopy();
  const saleDuplicates = useMemo(() => {
    if (!sale.data) return null;
    const mainIds = new Map(sale.data.copies.map(c => [String(c.card_id), c.main_id]));
    return duplicates(sale.data.copies, sale.data.keep, (id) => mainIds.get(id));
  }, [sale.data]);
  return (
    <div className="h-full flex flex-col">
      {sale.error && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 mb-3 rounded-xl border border-bad/40 bg-bad/10 text-sm text-text">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{sale.error}</span>
        </div>
      )}
      <DuplicatesList list={saleDuplicates} copies={sale.data ? sale.data.copies : null} reload={sale.reload} onOpenCard={onOpenCard} />
    </div>
  );
}

// ForSaleList zeigt den Standort je Exemplar -- dafuer reicht das Behaelter-Vokabular
// (listContainers), Tags braucht diese Liste anders als CollectionList nicht.
export function ZumVerkaufPanel() {
  const sale = useSaleData();
  const onOpenCard = useOpenSaleCopy();
  const [containers, setContainers] = useState([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const c = await window.api?.listContainers?.();
        if (alive) setContainers(Array.isArray(c) ? c : []);
      } catch { /* Standort-Chip bleibt dann leer -- keine kritische Datenquelle fuer diese Liste */ }
    })();
    return () => { alive = false; };
  }, []);
  return (
    <div className="h-full flex flex-col">
      {sale.error && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 mb-3 rounded-xl border border-bad/40 bg-bad/10 text-sm text-text">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{sale.error}</span>
        </div>
      )}
      <ForSaleList copies={sale.data ? sale.data.copies : null} containers={containers} reload={sale.reload} onOpenCard={onOpenCard} />
    </div>
  );
}

export function AngebotePanel() {
  const listingsData = useListingsData();
  const onOpenCard = useOpenSaleCopy();
  return <ListingsList data={listingsData.data} error={listingsData.error} reload={listingsData.reload} onOpenCard={onOpenCard} />;
}

// SalesPanel ist selbst nicht h-full/scrollend (wie im frueheren Insights-Reiter, dort wrappte
// Insights.jsx alle Reiter gemeinsam mit flex-1 overflow-auto).
export function VerkaeufePanel() {
  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <SalesPanel />
    </div>
  );
}
