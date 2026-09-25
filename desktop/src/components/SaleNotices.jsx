import { useNavigate } from 'react-router-dom';
import { Store, ArrowRight } from 'lucide-react';
import { noticeLabel, noticesTitle } from '../utils/saleNotices';
import { useSaleNotices } from '../utils/useSaleNotices';
import { ROUTES } from '../utils/routes';

const TONE = { bad: 'bg-bad/20', warn: 'bg-warn/15', neutral: 'border border-line' };

// Spec H3b §7.6 (H3b2) -- Liste offener eBay-Hinweise mit „Erledigt“ je Hinweis.
export function SaleNoticesList({ notices, onDismiss }) {
  return (
    <ul className="divide-y divide-line">
      {notices.map((n) => {
        const l = noticeLabel(n.kind);
        return (
          <li key={n.notice_id} className="flex items-start gap-3 py-2 text-sm">
            <span className={`shrink-0 inline-block text-klein px-1.5 py-0.5 rounded text-text ${TONE[l.tone]}`}>{l.label}</span>
            <span className="flex-1 min-w-0 text-text">{n.text}</span>
            <button type="button" onClick={() => onDismiss(n.notice_id)} className="shrink-0 text-xs text-accent hover:underline">Erledigt</button>
          </li>
        );
      })}
    </ul>
  );
}

// Start: Karte nur bei offenen Hinweisen; höchstens drei, „Alle“ führt zu den Angeboten (dort das Banner mit allen).
export function SaleNoticesCard() {
  const navigate = useNavigate();
  const { notices, error, dismiss } = useSaleNotices();
  if (!notices || notices.length === 0) return null;
  return (
    <div className="bg-surface border border-line rounded-2xl p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-display text-sm tracking-[0.12em] uppercase text-muted flex items-center gap-2">
          <Store className="w-4 h-4" strokeWidth={1.8} /> {noticesTitle(notices.length)}
        </h3>
        <button onClick={() => navigate(ROUTES.angebote)} className="text-xs text-accent hover:underline flex items-center gap-1">
          Alle <ArrowRight className="w-3 h-3" />
        </button>
      </div>
      {error && <p className="text-xs text-bad mb-1">{error}</p>}
      <SaleNoticesList notices={notices.slice(0, 3)} onDismiss={dismiss} />
    </div>
  );
}

// Angebote: Banner über der Summenzeile mit allen offenen Hinweisen.
export function SaleNoticesBanner() {
  const { notices, error, dismiss } = useSaleNotices();
  if (!notices || notices.length === 0) return null;
  return (
    <div className="bg-surface border border-warn/40 rounded-xl px-4 py-2 shrink-0">
      <p className="text-xs text-muted">{noticesTitle(notices.length)}</p>
      {error && <p className="text-xs text-bad">{error}</p>}
      <SaleNoticesList notices={notices} onDismiss={dismiss} />
    </div>
  );
}
