import { useState, useEffect, useCallback } from 'react';
import { Tag, Plus, Trash2, ExternalLink, X } from 'lucide-react';

export default function Deals() {
  const [watches, setWatches] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [query, setQuery] = useState('');
  const [maxPrice, setMaxPrice] = useState('');

  const refresh = useCallback(async () => {
    if (!window.api) return;
    try {
      setWatches(await window.api.getDealWatches());
      setAlerts(await window.api.getDealAlerts());
    } catch (e) { /* db not ready */ }
  }, []);

  useEffect(() => {
    refresh();
    if (!window.api) return;
    const un1 = window.api.onDealAlert(() => refresh());
    const un2 = window.api.onDealWatchesChanged(() => refresh());
    return () => { un1 && un1(); un2 && un2(); };
  }, [refresh]);

  const addWatch = async () => {
    if (!query.trim() || !maxPrice) return;
    await window.api.addDealWatch({ query: query.trim(), maxPrice: parseFloat(maxPrice) });
    setQuery(''); setMaxPrice('');
    refresh();
  };

  return (
    <div className="max-w-5xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-5">
        <Tag className="w-6 h-6 text-space-violet" strokeWidth={1.8} />
        <h2 className="font-display text-xl font-bold text-ink">Deals & Preis-Alerts</h2>
      </div>

      {/* Add watch */}
      <div className="bg-obsidian-800 border border-line rounded-xl p-4 mb-6">
        <div className="text-[11px] uppercase tracking-widest text-ink-faint mb-2">Neuer Watch</div>
        <div className="flex flex-wrap gap-2">
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addWatch()}
            placeholder='Suchbegriff, z.B. "Prismatic Evolutions Display"'
            className="flex-1 min-w-[240px] bg-obsidian border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-space-violet"
          />
          <div className="flex items-center bg-obsidian border border-line rounded-lg px-3">
            <span className="text-ink-faint text-sm mr-1">≤</span>
            <input
              value={maxPrice} onChange={(e) => setMaxPrice(e.target.value.replace(/[^0-9.]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && addWatch()}
              placeholder="Preis" inputMode="decimal"
              className="w-20 bg-transparent py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
            />
            <span className="text-ink-faint text-sm ml-1">€</span>
          </div>
          <button
            onClick={addWatch}
            className="flex items-center gap-1.5 bg-space-violet/20 border border-space-violet/40 text-violet-soft hover:bg-space-violet/30 rounded-lg px-4 py-2 text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> Watch
          </button>
        </div>

        {watches.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {watches.map((w) => (
              <span key={w.id} className="group flex items-center gap-2 bg-obsidian border border-line rounded-full pl-3 pr-2 py-1 text-xs text-ink">
                <span className="text-ink-muted">{w.query}</span>
                <span className="font-mono text-gold">≤{w.max_price}€</span>
                <button onClick={() => window.api.deleteDealWatch(w.id).then(refresh)}
                  className="text-ink-faint hover:text-red-400" title="Watch löschen">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Alerts feed */}
      <div className="text-[11px] uppercase tracking-widest text-ink-faint mb-2">
        Gefundene Deals {alerts.length > 0 && <span className="text-space-violet">({alerts.length})</span>}
      </div>
      {alerts.length === 0 ? (
        <div className="text-center text-ink-faint py-16 text-sm">
          Noch keine Deals. Lege einen Watch an — der Desktop prüft alle paar Minuten und meldet Treffer unter deinem Preis.
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => (
            <div key={a.id} className="flex items-center gap-3 bg-obsidian-800 border border-line rounded-xl p-3 hover:border-space-violet/40 transition-colors">
              {a.image_url
                ? <img src={a.image_url} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0 bg-obsidian" />
                : <div className="w-14 h-14 rounded-lg bg-obsidian grid place-items-center text-ink-faint shrink-0"><Tag className="w-5 h-5" /></div>}
              <div className="min-w-0 flex-1">
                <div className="text-sm text-ink truncate">{a.title}</div>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-ink-faint">
                  <span className="uppercase tracking-wider bg-obsidian border border-line rounded px-1.5 py-px">{a.source}</span>
                  <span>{a.found_at}</span>
                </div>
              </div>
              <div className="font-mono text-lg text-gold shrink-0">{a.price != null ? `${a.price}€` : '—'}</div>
              <button onClick={() => window.api.openExternal(a.url)}
                className="p-2 text-ink-muted hover:text-space-violet" title="Angebot öffnen">
                <ExternalLink className="w-4.5 h-4.5" />
              </button>
              <button onClick={() => window.api.dismissDealAlert(a.id).then(refresh)}
                className="p-2 text-ink-faint hover:text-red-400" title="Ausblenden">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
