import { useState, useEffect } from 'react';
import clsx from 'clsx';
import { X, Search, Loader2 } from 'lucide-react';
import { fmtEUR } from '../utils/format';
import { T } from '../utils/i18n-de';

const NO_PRODUCTS = 'Produktliste nicht verfügbar — Cardmarket-Preise einmal aktualisieren.';
const SAVE_ERROR = 'Speichern fehlgeschlagen.';

// Spec G3 §7.3 — Hinzufügen-Dialog: Suche in der Cardmarket-Produktliste (sealed-products-search), Treffer mit
// Name, Art und Trend, Feld „Menge“, „Hinzufügen“ (sealed-add). Name, Art und Startpreis setzt der Hauptprozess.
export default function SealedAddDialog({ onClose, onAdded }) {
  const [query, setQuery] = useState('');
  const [available, setAvailable] = useState(null); // null = noch unbekannt
  const [search, setSearch] = useState({ busy: false, results: null, error: null });
  const [selected, setSelected] = useState(null);
  const [quantity, setQuantity] = useState('1');
  const [save, setSave] = useState({ busy: false, error: null });

  // Ohne Cardmarket-Cache soll der Hinweis sofort stehen, nicht erst nach der ersten Suche.
  useEffect(() => {
    let alive = true;
    window.api.searchSealedProducts('')
      .then((r) => { if (alive) setAvailable(!!r?.available); })
      .catch(() => { if (alive) setAvailable(false); });
    return () => { alive = false; };
  }, []);

  const runSearch = (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearch((s) => ({ ...s, busy: true, error: null }));
    window.api.searchSealedProducts(query)
      .then((r) => {
        setAvailable(!!r?.available);
        setSearch({ busy: false, results: r?.results || [], error: null });
        setSelected(null);
      })
      .catch(() => setSearch({ busy: false, results: null, error: 'Suche fehlgeschlagen.' }));
  };

  const qty = Number(quantity);
  const qtyValid = Number.isInteger(qty) && qty >= 1;

  const add = () => {
    if (!selected || !qtyValid) return;
    setSave({ busy: true, error: null });
    window.api.addSealed({ cm_product_id: selected.cm_product_id, quantity: qty })
      .then((r) => {
        if (r?.success) onAdded();
        else setSave({ busy: false, error: r?.error || SAVE_ERROR });
      })
      .catch(() => setSave({ busy: false, error: SAVE_ERROR }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg bg-obsidian-700 border border-line rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-ink">Sealed hinzufügen</h3>
          <button type="button" onClick={onClose} className="text-ink-faint hover:text-ink"><X className="w-4 h-4" /></button>
        </div>

        {available === false && <p className="text-sm text-crit">{NO_PRODUCTS}</p>}

        <form onSubmit={runSearch} className="flex gap-2">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Produktname, z. B. Booster Box"
            className="flex-1 bg-obsidian border border-line text-ink rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-space-violet"
          />
          <button type="submit" disabled={search.busy || !query.trim() || available === false}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-line text-sm text-ink-muted hover:text-ink disabled:opacity-50">
            {search.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} {T.suchen}
          </button>
        </form>

        {search.error && <p className="text-sm text-crit">{search.error}</p>}
        {search.results && search.results.length === 0 && available !== false && (
          <p className="text-sm text-ink-faint">{T.keineTreffer}</p>
        )}
        {search.results && search.results.length > 0 && (
          <div className="max-h-72 overflow-auto divide-y divide-line border border-line rounded-xl">
            {search.results.map((p) => (
              <button key={p.cm_product_id} type="button" onClick={() => setSelected(p)}
                      className={clsx('w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
                        selected?.cm_product_id === p.cm_product_id ? 'bg-space-violet/15' : 'hover:bg-white/5')}>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-ink truncate">{p.name}</span>
                  <span className="block text-[11px] text-ink-faint">{p.kindLabel}</span>
                </span>
                <span className="font-mono text-sm text-ink-muted">{p.trend == null ? '—' : fmtEUR(p.trend)}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-3">
          <div>
            <label className="block text-xs font-bold text-ink-muted mb-1 uppercase tracking-wider">Menge</label>
            <input
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-24 bg-obsidian border border-line text-ink rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-space-violet"
            />
          </div>
          <div className="flex-1 min-w-0 text-sm text-ink-muted truncate pb-2">{selected ? selected.name : 'Kein Produkt gewählt'}</div>
        </div>

        {!qtyValid && <p className="text-sm text-crit">Die Menge muss mindestens 1 sein.</p>}
        {save.error && <p className="text-sm text-crit">{save.error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-ink-muted hover:text-ink">{T.abbrechen}</button>
          <button type="button" onClick={add} disabled={!selected || !qtyValid || save.busy}
                  className="px-4 py-2 rounded-lg bg-space-violet hover:bg-space-violet-dark text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {save.busy ? 'Wird gespeichert…' : 'Hinzufügen'}
          </button>
        </div>
      </div>
    </div>
  );
}
