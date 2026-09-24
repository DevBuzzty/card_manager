import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, ScanLine, ArrowRight, Clock, TriangleAlert, FileWarning, Award, PackageOpen, Tag, Copy, Store } from 'lucide-react';
import CardTile from './CardTile';
import SetCompletion from './SetCompletion';
import MoversCard from './MoversCard';
import PriceAlertsCard from './PriceAlertsCard';
import { fmtEUR, fmtSignedEUR } from '../utils/format';
import { ROUTES } from '../utils/routes';
import { T } from '../utils/i18n-de';
import { LOADING, duplicates, duplicatesSummary, forSaleSummary, startSaleText, startDuplicatesText, saleShareText } from '../utils/duplicates';
import { useSaleData } from '../hooks/useSaleData';
import { useListingsData } from '../hooks/useListings';
import { listingsSummary, startText } from '../utils/listingText';
import { countPresetGroups } from '../utils/cardFilters';
import { useNavCounts } from '../hooks/useNavCounts';

export default function Start({ onOpenPalette }) {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ totalValue: 0, totalCards: 0, uniqueCards: 0 });
  // Bis der erste getPortfolio-Aufruf zurueck ist, darf die Wertkarte kein "0,00 €" zeigen --
  // das saehe wie ein echter Nullwert aus statt wie eine noch ladende Sammlung.
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [cards, setCards] = useState([]);
  const [history, setHistory] = useState([]);
  const [quickAddCode, setQuickAddCode] = useState('');
  const [unsortedCount, setUnsortedCount] = useState(0);
  // list-unsorted-copies WIRFT bei einem DB-Fehler statt {success:false} zu liefern (main.cjs) --
  // ohne diesen eigenen Fehlerzustand saehe ein Ladefehler wie "0 nicht einsortiert" aus, genau
  // der Fehler, der bei Binders.jsx (Task 5) erst nachtraeglich behoben werden musste.
  const [unsortedError, setUnsortedError] = useState(false);
  // Spec H1 §5.3: Zaehler "Zum Verkauf"/"Duplikate" und "davon zum Verkauf"; data null = laedt ("…").
  const sale = useSaleData();
  const listingsData = useListingsData(); // Spec H3a §6: "Angebote: N aktiv", data null = laedt
  const saleSummary = useMemo(() => (sale.data ? forSaleSummary(sale.data.copies) : null), [sale.data]);
  const duplicateSummary = useMemo(() => {
    if (!sale.data) return null;
    const mainIds = new Map(sale.data.copies.map(c => [String(c.card_id), c.main_id]));
    return duplicatesSummary(duplicates(sale.data.copies, sale.data.keep, (id) => mainIds.get(id)));
  }, [sale.data]);

  useEffect(() => {
    if (!window.api) return;
    window.api.getPortfolio().then(d => { setStats(d || { totalValue: 0, totalCards: 0, uniqueCards: 0 }); setStatsLoaded(true); });
    window.api.getCollection().then(c => setCards(c || []));
    window.api.getPriceHistory().then(h => setHistory(h || []));
    (window.api.listUnsortedCopies?.() ?? Promise.resolve([]))
      .then(u => { setUnsortedCount(Array.isArray(u) ? u.length : 0); setUnsortedError(false); })
      .catch(() => setUnsortedError(true));
    // Spec G3: Sealed-Änderungen (Sync, Bulk-Schritt C) ändern Gesamtwert und Unterzeile.
    const offSealed = window.api.onSealedChanged?.(() => window.api.getPortfolio().then(d => d && setStats(d)));
    return () => offSealed?.();
  }, []);

  const recent = useMemo(
    () => [...cards].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6),
    [cards]
  );

  // Abschlussreview B6: Unbekannte als Karten (nicht Exemplare), dieselbe Zahl wie Seitenleiste und Scannen.
  const nav = useNavCounts();
  const unknownCount = nav ? nav.unknown : 0;

  // Abschlussreview B5: dieselbe Regel wie die Voreinstellung "Unvollständige Daten" der Kartenliste.
  const incompleteCount = useMemo(() => countPresetGroups(cards, 'unvollstaendig'), [cards]);

  const spark = useMemo(() => {
    const vals = history.map(h => h.total_value).filter(v => typeof v === 'number');
    if (vals.length < 2) return null;
    const w = 400, h = 52, min = Math.min(...vals), max = Math.max(...vals), range = (max - min) || 1;
    const pts = vals.map((v, i) => [(i / (vals.length - 1)) * w, h - ((v - min) / range) * (h - 6) - 3]);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    return { line, area: `${line} L${w} ${h} L0 ${h} Z`, last: pts[pts.length - 1] };
  }, [history]);

  const delta = useMemo(() => {
    const pts = history.filter(h => typeof h.total_value === 'number');
    const at = (days) => {
      // eslint-disable-next-line react-hooks/purity -- cutoff only gates which history row we pick; a stale memoized "now" is harmless.
      const cutoff = Date.now() - days * 86400000;
      const before = pts.filter(h => new Date(String(h.timestamp).replace(' ', 'T') + 'Z').getTime() <= cutoff);
      return before.length ? before[before.length - 1].total_value : (pts[0]?.total_value ?? null);
    };
    const now = stats.totalValue || 0;
    const mk = (base) => (base == null || base === 0 ? null : { abs: now - base, pct: ((now - base) / base) * 100 });
    return { d7: mk(at(7)), d30: mk(at(30)) };
  }, [history, stats.totalValue]);

  const handleQuickAdd = (e) => {
    e.preventDefault();
    if (quickAddCode.length >= 4 && window.api) {
      window.api.manualScan(quickAddCode);
      setQuickAddCode('');
      navigate(ROUTES.scannen);
    }
  };

  const money = fmtEUR;

  const renderDelta = (d, label) => (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-muted">{label}</span>
      {d ? (
        <span className={d.abs >= 0 ? 'text-good' : 'text-bad'}>
          {fmtSignedEUR(d.abs)} ({d.pct >= 0 ? '+' : ''}{d.pct.toFixed(1).replace('.', ',')} %)
        </span>
      ) : (
        <span className="text-muted">—</span>
      )}
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-semibold text-3xl text-text">{T.start}</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onOpenPalette && onOpenPalette()}
            className="flex items-center gap-2 bg-surface border border-line rounded-xl px-3.5 py-2.5 text-sm text-muted hover:text-text transition-colors min-w-[260px]"
          >
            <Search className="w-4 h-4" strokeWidth={1.8} />
            Karte, Set oder Aktion suchen…
            <span className="ml-auto font-mono text-klein text-muted border border-line rounded px-1.5 py-0.5">Strg K</span>
          </button>
          <form onSubmit={handleQuickAdd} className="flex bg-surface border border-line rounded-xl overflow-hidden focus-within:border-accent transition-colors">
            <input
              type="text"
              placeholder="Passcode…"
              className="bg-transparent text-text px-3 py-2.5 outline-none w-32 font-mono text-sm"
              value={quickAddCode}
              onChange={(e) => { if (e.target.value.length <= 8 && /^\d*$/.test(e.target.value)) setQuickAddCode(e.target.value); }}
            />
            <button type="submit" disabled={quickAddCode.length < 4} className="bg-surface-2 hover:bg-accent text-text hover:text-accent-fg px-3 transition-colors disabled:opacity-40"><Plus className="w-4 h-4" /></button>
          </form>
        </div>
      </div>

      {/* Hero row */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-5">
        {/* Value panel */}
        <div className="relative overflow-hidden bg-surface border border-line rounded-2xl p-6">
          <div className="font-display text-klein tracking-[0.14em] uppercase text-muted">Sammlungswert</div>
          <div className="font-display font-bold text-4xl text-text mt-2">
            {statsLoaded ? money(stats.totalValue) : <span className="inline-block h-9 w-40 rounded-lg bg-bg animate-pulse align-middle" />}
          </div>
          {/* Spec G3 §7.3: Aufteilung nur bei Sealed-Bestand */}
          {stats.hasSealed && (
            <div className="text-xs text-muted mt-1">Karten {money(stats.cardValue)} · Sealed {money(stats.sealedValue)}</div>
          )}
          {/* Spec H1 §5.3: markierte Exemplare zaehlen weiter zum Wert */}
          {saleSummary && saleSummary.copies > 0 && (
            <div className="text-xs text-muted mt-1">{saleShareText(saleSummary)}</div>
          )}
          <div className="flex gap-4 mt-1.5">
            {renderDelta(delta.d7, '7T')}
            {renderDelta(delta.d30, '30T')}
          </div>
          {spark ? (
            <svg className="mt-4 w-full h-[52px]" viewBox="0 0 400 52" preserveAspectRatio="none">
              <path d={spark.area} fill="var(--accent)" fillOpacity="0.15" />
              <path d={spark.line} fill="none" stroke="var(--accent)" strokeWidth="2" />
              <circle cx={spark.last[0]} cy={spark.last[1]} r="3.5" fill="var(--accent)" />
            </svg>
          ) : (
            <div className="mt-4 h-[52px] flex items-center text-xs text-muted">Preisverlauf erscheint, sobald sich Werte ändern.</div>
          )}
          <div className="flex gap-3 mt-4">
            {[{ l: 'Karten', v: stats.totalCards || 0 }, { l: 'Einzigartig', v: stats.uniqueCards || 0 }, { l: 'Sets', v: new Set(cards.filter(c => c.set_code && c.set_code !== 'Unknown').map(c => c.set_code.split('-')[0])).size }].map(m => (
              <div key={m.l} className="flex-1 bg-bg border border-line rounded-xl px-3.5 py-2.5">
                <div className="font-display text-klein uppercase tracking-wide text-muted">{m.l}</div>
                <div className="font-display font-bold text-xl text-text mt-0.5">{m.v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Scan + attention */}
        <div className="bg-surface border border-line rounded-2xl p-6 flex flex-col gap-4">
          <div className="font-display text-klein tracking-[0.14em] uppercase text-muted">Scan-Status</div>
          <div className="flex items-center gap-3 bg-bg border border-line rounded-xl px-4 py-3">
            <div className="w-9 h-9 rounded-lg grid place-items-center bg-good/10 border border-good/30"><ScanLine className="w-5 h-5 text-good" strokeWidth={1.8} /></div>
            <div><div className="text-sm font-bold text-text">Bereit zum Scannen</div><div className="text-xs text-muted">Handy-Kamera auf eine Karte richten</div></div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => navigate(ROUTES.scannen)} className="flex-1 text-left rounded-xl p-3 border border-accent/30 bg-accent/5 hover:bg-accent/10 transition-colors">
              <div className="flex items-center gap-1.5 font-display font-bold text-2xl text-accent"><TriangleAlert className="w-4 h-4" />{unknownCount}</div>
              <div className="text-klein text-muted mt-0.5">Unbekanntes Set</div>
            </button>
            <button onClick={() => navigate(ROUTES.karten, { state: { preset: 'unvollstaendig' } })} className="flex-1 text-left rounded-xl p-3 border border-warn/30 bg-warn/5 hover:bg-warn/10 transition-colors">
              <div className="flex items-center gap-1.5 font-display font-bold text-2xl text-warn"><FileWarning className="w-4 h-4" />{incompleteCount}</div>
              <div className="text-klein text-muted mt-0.5">Fehlende Daten</div>
            </button>
            <button onClick={() => navigate(ROUTES.binder)} className="flex-1 text-left rounded-xl p-3 border border-warn/30 bg-warn/5 hover:bg-warn/10 transition-colors">
              <div className="flex items-center gap-1.5 font-display font-bold text-2xl text-warn"><PackageOpen className="w-4 h-4" />{unsortedError ? '—' : unsortedCount}</div>
              <div className="text-klein text-muted mt-0.5">Nicht einsortiert{unsortedError ? ' (Ladefehler)' : ''}</div>
            </button>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => navigate(ROUTES.zumVerkauf)} className="flex-1 flex items-center gap-2 text-left rounded-xl px-3 py-2.5 border border-line bg-surface-2 hover:bg-bg transition-colors text-xs text-text">
              <Tag className="w-4 h-4 text-muted shrink-0" />{saleSummary ? startSaleText(saleSummary) : sale.error ? 'Zum Verkauf: —' : `Zum Verkauf: ${LOADING}`}
            </button>
            <button onClick={() => navigate(ROUTES.kandidaten)} className="flex-1 flex items-center gap-2 text-left rounded-xl px-3 py-2.5 border border-accent/30 bg-accent/5 hover:bg-accent/10 transition-colors text-xs text-text">
              <Copy className="w-4 h-4 text-accent shrink-0" />{duplicateSummary ? startDuplicatesText(duplicateSummary) : sale.error ? 'Duplikate: —' : `Duplikate: ${LOADING}`}
            </button>
            <button onClick={() => navigate(ROUTES.angebote)} className="flex-1 flex items-center gap-2 text-left rounded-xl px-3 py-2.5 border border-line bg-surface-2 hover:bg-bg transition-colors text-xs text-text">
              <Store className="w-4 h-4 text-muted shrink-0" />{listingsData.data ? startText(listingsSummary(listingsData.data.listings, listingsData.data.items).listings) : listingsData.error ? 'Angebote: —' : `Angebote: ${LOADING}`}
            </button>
          </div>
          <button onClick={() => navigate(ROUTES.scannen)} className="mt-auto flex items-center justify-center gap-2 bg-accent text-accent-fg font-display font-semibold text-sm py-3 rounded-xl">
            <Plus className="w-4 h-4" strokeWidth={2} /> {T.scannen}
          </button>
        </div>
      </div>

      {/* Spec G2: Preis-Alarme direkt über den Bewegungen, nur bei offenen Treffern */}
      <PriceAlertsCard />

      {/* Spec G1: Bewegungen */}
      <MoversCard />

      {/* Recently added */}
      <div className="bg-surface border border-line rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-sm tracking-[0.12em] uppercase text-muted flex items-center gap-2"><Clock className="w-4 h-4" strokeWidth={1.8} /> Zuletzt hinzugefügt</h3>
          <button onClick={() => navigate(ROUTES.karten)} className="text-xs text-accent hover:underline flex items-center gap-1">Alle ansehen <ArrowRight className="w-3 h-3" /></button>
        </div>
        {recent.length === 0 ? (
          <div className="text-center text-muted py-8">Noch keine Karten — scanne welche, um zu starten.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {recent.map((card, idx) => (
              <CardTile key={`${card.id}-${card.set_code}-${idx}`} card={card} onClick={() => navigate(ROUTES.karten)} />
            ))}
          </div>
        )}
      </div>

      {/* Set completion */}
      <div className="bg-surface border border-line rounded-2xl p-6 flex flex-col">
        <div className="mb-4">
          <h3 className="font-display text-sm tracking-[0.12em] uppercase text-muted flex items-center gap-2"><Award className="w-4 h-4" strokeWidth={1.8} /> Set-Fortschritt</h3>
        </div>
        <div className="h-[380px]"><SetCompletion /></div>
      </div>
    </div>
  );
}
