import { useMemo, useState } from 'react';
import ListingDetail, { ListingMarks, EbayMark } from './ListingDetail';
import { LOADING } from '../utils/duplicates';
import { toCents, euroCentsText, diffText } from '../utils/saleMath';
import { listingsSummary, summaryText, sinceText } from '../utils/listingText';
import { ebayMark } from '../utils/ebayMarks';
import { useEbayData } from '../utils/useEbayData';

const STATUS = [{ id: 'aktiv', label: 'Aktiv' }, { id: 'verkauft', label: 'Verkauft' }, { id: 'beendet', label: 'Beendet' }, { id: 'alle', label: 'Alle' }];
const ALL_CHANNELS = '__alle__';

// Spec H3a §6 -- Sammlung › Karten › Angebote. data aus useListingsData (null = laedt), reload(): Promise,
// onOpenCard(position) oeffnet das Karten-Detail des Drucks. Die Reihenfolge kommt sortiert aus listings-overview.
export default function ListingsList({ data, error, reload, onOpenCard }) {
  const [status, setStatus] = useState('aktiv');
  const [channel, setChannel] = useState(ALL_CHANNELS);
  const [openId, setOpenId] = useState(null);
  const ebay = useEbayData();

  // Je vorkommendem Kanal der Name des juengsten Angebots (die Liste ist schon juengste zuerst).
  const channels = useMemo(() => {
    const m = new Map();
    for (const l of data?.listings || []) if (!m.has(l.channel_id)) m.set(l.channel_id, l.channel_name);
    return [...m.entries()];
  }, [data]);
  const rows = useMemo(() => (data?.listings || []).filter((l) => (status === 'alle' || l.status === status)
    && (channel === ALL_CHANNELS || l.channel_id === channel)), [data, status, channel]);

  return (
    <div className="h-full flex flex-col gap-3">
      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {STATUS.map((s) => (
          <button key={s.id} type="button" onClick={() => setStatus(s.id)}
            className={`px-3 py-1 rounded-full text-xs border ${status === s.id ? 'bg-accent/20 border-accent/50 text-text' : 'bg-surface border-line text-muted hover:text-text'}`}>
            {s.label}
          </button>
        ))}
        <select value={channel} onChange={(e) => setChannel(e.target.value)}
          className="bg-surface border border-line rounded-lg px-2 py-1 text-xs text-text">
          <option value={ALL_CHANNELS}>Alle Kanäle</option>
          {channels.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </div>
      {!data ? (
        <div className="flex-1 flex items-center justify-center text-muted">{LOADING}</div>
      ) : (
        <>
          {(status === 'aktiv' || status === 'alle') && (
            <div className="bg-surface border border-line rounded-xl px-4 py-3 text-sm text-text shrink-0">
              {summaryText(listingsSummary(rows, data.items))}
            </div>
          )}
          {rows.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-muted">Keine Angebote.</div>
          ) : (
            <div className="flex-1 overflow-y-auto custom-scrollbar bg-surface border border-line rounded-xl divide-y divide-line">
              {rows.map((l) => {
                const active = l.status === 'aktiv';
                const price = toCents(l.price) || 0;
                return (
                  <button key={l.listing_id} type="button" onClick={() => setOpenId(l.listing_id)}
                    className={`w-full flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-left text-sm hover:bg-bg ${active ? 'text-text' : 'text-muted'}`}>
                    <span>{l.channel_name}</span>
                    <span className="min-w-0 truncate">{l.rowTitle}</span>
                    <span className="text-muted">{l.cards} {l.cards === 1 ? 'Karte' : 'Karten'}</span>
                    <span className="text-muted">{sinceText(l.days)}</span>
                    {!active && <span className="text-xs">{l.status}</span>}
                    <ListingMarks marks={l.marks} />
                    <EbayMark mark={ebayMark(l, ebay.rows[l.listing_id] ?? null, ebay.status)} />
                    <span className="ml-auto font-mono">{euroCentsText(price)}</span>
                    {active && (
                      <span className={`font-mono ${price >= l.marketCents ? 'text-good' : 'text-bad'}`}>
                        {diffText(price, l.marketCents)} gegenüber Marktwert
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
      {openId && <ListingDetail listingId={openId} onClose={() => setOpenId(null)} onChanged={reload} onOpenCard={onOpenCard} />}
    </div>
  );
}
