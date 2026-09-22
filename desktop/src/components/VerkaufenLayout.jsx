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
import DuplicatesList from './DuplicatesList';
import ForSaleList from './ForSaleList';
import ListingsList from './ListingsList';
import SalesPanel from './SalesPanel';

export default function VerkaufenLayout() {
  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-wrap items-center gap-4 mb-5 shrink-0">
        <h1 className="font-display font-semibold text-2xl text-text">{T.verkaufen}</h1>
        <div className="flex flex-wrap bg-surface-2 border border-line rounded-xl p-1 gap-1">
          {VERKAUFEN_SEGMENTS.map(s => (
            <NavLink key={s.id} to={s.to}
              className={({ isActive }) => clsx('px-4 py-1.5 rounded-lg font-display text-sm font-medium transition-colors',
                isActive ? 'bg-accent text-accent-fg' : 'text-muted hover:text-text')}>
              {s.label}
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
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 mb-3 rounded-xl border border-crit/40 bg-crit/10 text-sm text-crit">
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
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 mb-3 rounded-xl border border-crit/40 bg-crit/10 text-sm text-crit">
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
