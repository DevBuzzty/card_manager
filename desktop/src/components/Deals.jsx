import { useState, useEffect, useCallback } from 'react';
import { Tag, Plus, Trash2, ExternalLink, X, RefreshCw } from 'lucide-react';
import { fmtEUR } from '../utils/format';

export default function Deals() {
  const [watches, setWatches] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [query, setQuery] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [condition, setCondition] = useState('any');
  const [error, setError] = useState(null);
  const [scraping, setScraping] = useState(false);

  const refresh = useCallback(async () => {
    if (!window.api) return;
    try {
      setWatches(await window.api.getDealWatches());
      setAlerts(await window.api.getDealAlerts());
      setError(null);
    } catch (e) {
      setError(e.message || 'Laden fehlgeschlagen — in den Einstellungen bei der Cloud anmelden.');
    }
  }, []);

  // Ask the cloud to scrape now, then reload — the same "fetch fresh on open" the phone does.
  const scrapeAndRefresh = useCallback(async () => {
    if (!window.api) return;
    setScraping(true);
    try {
      await window.api.triggerDealScrape();
      await refresh();
    } catch (e) {
      setError(e.message || 'Aktualisieren fehlgeschlagen.');
    } finally {
      setScraping(false);
    }
  }, [refresh]);

  useEffect(() => {
    refresh().then(scrapeAndRefresh); // show cached alerts fast, then scrape for new ones
  }, [refresh, scrapeAndRefresh]);

  const addWatch = async () => {
    if (!query.trim() || !maxPrice) return;
    try {
      await window.api.addDealWatch({ query: query.trim(), maxPrice: parseFloat(maxPrice), condition });
      setQuery(''); setMaxPrice('');
      await scrapeAndRefresh();
    } catch (e) {
      setError(e.message || 'Watch anlegen fehlgeschlagen.');
    }
  };

  const fmtTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'gerade eben';
    if (mins < 60) return `vor ${mins} Min`;
    if (mins < 1440) return `vor ${Math.round(mins / 60)} Std`;
    return d.toLocaleDateString('de-DE');
  };

  return (
    <div className="max-w-5xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-5">
        <Tag className="w-6 h-6 text-accent" strokeWidth={1.8} />
        <h2 className="font-display text-xl font-bold text-text flex-1">Deals</h2>
        <button
          onClick={scrapeAndRefresh}
          disabled={scraping}
          className="flex items-center gap-2 bg-bg border border-line hover:border-accent/40 text-muted hover:text-text rounded-lg px-3 py-2 text-sm disabled:opacity-60"
          title="Jetzt nach neuen Deals suchen"
        >
          <RefreshCw className={`w-4 h-4 ${scraping ? 'animate-spin' : ''}`} />
          {scraping ? 'Suche…' : 'Aktualisieren'}
        </button>
      </div>

      {error && (
        <div className="bg-bad/10 border border-bad/30 text-bad rounded-lg px-4 py-2 mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Add watch */}
      <div className="bg-bg border border-line rounded-xl p-4 mb-6">
        <div className="text-[11px] uppercase tracking-widest text-muted mb-2">Neuer Watch</div>
        <div className="flex flex-wrap gap-2">
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addWatch()}
            placeholder='Suchbegriff, z.B. "Prismatic Evolutions Display"'
            className="flex-1 min-w-[240px] bg-bg border border-line rounded-lg px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:border-accent"
          />
          <div className="flex items-center bg-bg border border-line rounded-lg px-3">
            <span className="text-muted text-sm mr-1">≤</span>
            <input
              value={maxPrice} onChange={(e) => setMaxPrice(e.target.value.replace(/[^0-9.]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && addWatch()}
              placeholder="Preis" inputMode="decimal"
              className="w-20 bg-transparent py-2 text-sm text-text placeholder:text-muted focus:outline-none"
            />
            <span className="text-muted text-sm ml-1">€</span>
          </div>
          <select
            value={condition} onChange={(e) => setCondition(e.target.value)}
            title="Zustand (nur eBay wertet das aus)"
            className="bg-bg border border-line rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
          >
            <option value="any">Zustand: Egal</option>
            <option value="new">Neu</option>
            <option value="used">Gebraucht</option>
          </select>
          <button
            onClick={addWatch}
            className="flex items-center gap-1.5 bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30 rounded-lg px-4 py-2 text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> Watch
          </button>
        </div>

        {watches.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {watches.map((w) => (
              <span key={w.id} className="group flex items-center gap-2 bg-bg border border-line rounded-full pl-3 pr-2 py-1 text-xs text-text">
                <span className="text-muted">{w.query}</span>
                <span className="font-mono text-text">≤{w.max_price}€</span>
                <button onClick={() => window.api.deleteDealWatch(w.id).then(refresh)}
                  className="text-muted hover:text-bad" title="Watch löschen">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Alerts feed */}
      <div className="text-[11px] uppercase tracking-widest text-muted mb-2">
        Gefundene Deals {alerts.length > 0 && <span className="text-accent">({alerts.length})</span>}
      </div>
      {alerts.length === 0 ? (
        <div className="text-center text-muted py-16 text-sm">
          Noch keine Deals. Lege einen Watch an — die Cloud durchsucht die Marktplätze regelmäßig (und sofort beim Öffnen) und meldet Treffer unter deinem Preis.
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => (
            <div key={a.id} className="flex items-center gap-3 bg-bg border border-line rounded-xl p-3 hover:border-accent/40 transition-colors">
              {a.image_url
                ? <img src={a.image_url} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0 bg-bg" />
                : <div className="w-14 h-14 rounded-lg bg-bg grid place-items-center text-muted shrink-0"><Tag className="w-5 h-5" /></div>}
              <div className="min-w-0 flex-1">
                <div className="text-sm text-text truncate">{a.title}</div>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted">
                  <span className="uppercase tracking-wider bg-bg border border-line rounded px-1.5 py-px">{a.source}</span>
                  <span>{fmtTime(a.found_at)}</span>
                </div>
              </div>
              <div className="font-mono text-lg text-text shrink-0">{a.price != null ? fmtEUR(a.price) : '—'}</div>
              <button onClick={() => window.api.openExternal(a.url)}
                className="p-2 text-muted hover:text-accent" title="Angebot öffnen">
                <ExternalLink className="w-4.5 h-4.5" />
              </button>
              <button onClick={() => window.api.dismissDealAlert(a.id).then(refresh)}
                className="p-2 text-muted hover:text-bad" title="Ausblenden">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
