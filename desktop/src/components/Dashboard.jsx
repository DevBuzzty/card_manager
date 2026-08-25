import { useState, useEffect, useMemo } from 'react';
import { Search, Plus, ScanLine, ArrowRight, Clock, TriangleAlert, FileWarning } from 'lucide-react';
import CardTile from './CardTile';
import SetCompletion from './SetCompletion';

export default function Dashboard({ setActiveTab }) {
  const [stats, setStats] = useState({ totalValue: 0, totalCards: 0, uniqueCards: 0 });
  const [cards, setCards] = useState([]);
  const [history, setHistory] = useState([]);
  const [quickAddCode, setQuickAddCode] = useState('');

  useEffect(() => {
    if (!window.api) return;
    window.api.getPortfolio().then(d => setStats(d || { totalValue: 0, totalCards: 0, uniqueCards: 0 }));
    window.api.getCollection().then(c => setCards(c || []));
    window.api.getPriceHistory().then(h => setHistory(h || []));
  }, []);

  const recent = useMemo(
    () => [...cards].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6),
    [cards]
  );

  const unknownCount = useMemo(
    () => cards.filter(c => c.set_code === 'Unknown').reduce((n, c) => n + (c.quantity || 1), 0),
    [cards]
  );

  const incompleteCount = useMemo(() => cards.filter(c => {
    const isMonster = c.type && !c.type.includes('Spell') && !c.type.includes('Trap');
    const isLink = c.type && c.type.includes('Link');
    if (isMonster) {
      if (c.atk == null) return true;
      if (!isLink && c.def == null) return true;
      if (c.level == null) return true;
      return false;
    }
    return !c.image_url;
  }).length, [cards]);

  const spark = useMemo(() => {
    const vals = history.map(h => h.total_value).filter(v => typeof v === 'number');
    if (vals.length < 2) return null;
    const w = 400, h = 52, min = Math.min(...vals), max = Math.max(...vals), range = (max - min) || 1;
    const pts = vals.map((v, i) => [(i / (vals.length - 1)) * w, h - ((v - min) / range) * (h - 6) - 3]);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    return { line, area: `${line} L${w} ${h} L0 ${h} Z`, last: pts[pts.length - 1] };
  }, [history]);

  const handleQuickAdd = (e) => {
    e.preventDefault();
    if (quickAddCode.length >= 4 && window.api) {
      window.api.manualScan(quickAddCode);
      setQuickAddCode('');
      setActiveTab('staging');
    }
  };

  const money = v => `$${(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="font-display text-[11px] tracking-[0.16em] uppercase text-gold">Welcome back, Duelist</div>
          <h1 className="font-display font-semibold text-3xl text-ink mt-1">Your Collection</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveTab('collection')}
            className="flex items-center gap-2 bg-obsidian-700 border border-line rounded-xl px-3.5 py-2.5 text-sm text-ink-faint hover:text-ink transition-colors min-w-[260px]"
          >
            <Search className="w-4 h-4" strokeWidth={1.8} />
            Search card, set…
            <span className="ml-auto font-mono text-[10px] text-ink-muted border border-line rounded px-1.5 py-0.5">Ctrl K</span>
          </button>
          <form onSubmit={handleQuickAdd} className="flex bg-obsidian-700 border border-line rounded-xl overflow-hidden focus-within:border-space-violet transition-colors">
            <input
              type="text"
              placeholder="Passcode…"
              className="bg-transparent text-ink px-3 py-2.5 outline-none w-32 font-mono text-sm"
              value={quickAddCode}
              onChange={(e) => { if (e.target.value.length <= 8 && /^\d*$/.test(e.target.value)) setQuickAddCode(e.target.value); }}
            />
            <button type="submit" disabled={quickAddCode.length < 4} className="bg-obsidian-600 hover:bg-space-violet text-ink px-3 transition-colors disabled:opacity-40"><Plus className="w-4 h-4" /></button>
          </form>
        </div>
      </div>

      {/* Hero row */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-5">
        {/* Value panel */}
        <div className="relative overflow-hidden bg-obsidian-700 border border-line rounded-2xl p-6"
          style={{ backgroundImage: 'linear-gradient(150deg, rgba(245,197,66,.10), transparent 45%), linear-gradient(210deg, rgba(157,0,255,.12), transparent 50%)' }}>
          <div className="font-display text-[11px] tracking-[0.14em] uppercase text-ink-muted">Collection Value</div>
          <div className="font-display font-bold text-4xl text-ink mt-2">{money(stats.totalValue)}</div>
          {spark ? (
            <svg className="mt-4 w-full h-[52px]" viewBox="0 0 400 52" preserveAspectRatio="none">
              <defs><linearGradient id="dashSpark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9D00FF" stopOpacity=".35" /><stop offset="1" stopColor="#9D00FF" stopOpacity="0" /></linearGradient></defs>
              <path d={spark.area} fill="url(#dashSpark)" />
              <path d={spark.line} fill="none" stroke="#b957ff" strokeWidth="2" />
              <circle cx={spark.last[0]} cy={spark.last[1]} r="3.5" fill="#F5C542" />
            </svg>
          ) : (
            <div className="mt-4 h-[52px] flex items-center text-xs text-ink-faint">Price history will appear as values change.</div>
          )}
          <div className="flex gap-3 mt-4">
            {[{ l: 'Cards', v: stats.totalCards || 0 }, { l: 'Unique', v: stats.uniqueCards || 0 }, { l: 'Sets', v: new Set(cards.filter(c => c.set_code && c.set_code !== 'Unknown').map(c => c.set_code.split('-')[0])).size }].map(m => (
              <div key={m.l} className="flex-1 bg-obsidian-800 border border-line rounded-xl px-3.5 py-2.5">
                <div className="font-display text-[10px] uppercase tracking-wide text-ink-faint">{m.l}</div>
                <div className="font-display font-bold text-xl text-ink mt-0.5">{m.v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Scan + attention */}
        <div className="bg-obsidian-700 border border-line rounded-2xl p-6 flex flex-col gap-4">
          <div className="font-display text-[11px] tracking-[0.14em] uppercase text-ink-muted">Scan Status</div>
          <div className="flex items-center gap-3 bg-obsidian-800 border border-line rounded-xl px-4 py-3">
            <div className="w-9 h-9 rounded-lg grid place-items-center bg-good/10 border border-good/30"><ScanLine className="w-5 h-5 text-good" strokeWidth={1.8} /></div>
            <div><div className="text-sm font-bold text-ink">Ready to scan</div><div className="text-xs text-ink-muted">Point your phone camera at a card</div></div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setActiveTab('collection')} className="flex-1 text-left rounded-xl p-3 border border-space-violet/30 bg-space-violet/5 hover:bg-space-violet/10 transition-colors">
              <div className="flex items-center gap-1.5 font-display font-bold text-2xl text-violet-soft"><TriangleAlert className="w-4 h-4" />{unknownCount}</div>
              <div className="text-[11px] text-ink-muted mt-0.5">Unknown set</div>
            </button>
            <button onClick={() => setActiveTab('collection')} className="flex-1 text-left rounded-xl p-3 border border-gold/30 bg-gold/5 hover:bg-gold/10 transition-colors">
              <div className="flex items-center gap-1.5 font-display font-bold text-2xl text-gold"><FileWarning className="w-4 h-4" />{incompleteCount}</div>
              <div className="text-[11px] text-ink-muted mt-0.5">Incomplete</div>
            </button>
          </div>
          <button onClick={() => setActiveTab('staging')} className="mt-auto flex items-center justify-center gap-2 bg-gradient-to-br from-space-violet to-space-violet-dark text-white font-display font-semibold text-sm py-3 rounded-xl shadow-[0_10px_24px_-10px_#9D00FF]">
            <Plus className="w-4 h-4" strokeWidth={2} /> Start Scanning
          </button>
        </div>
      </div>

      {/* Recently added */}
      <div className="bg-obsidian-700 border border-line rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-sm tracking-[0.12em] uppercase text-ink-muted flex items-center gap-2"><Clock className="w-4 h-4" strokeWidth={1.8} /> Recently Added</h3>
          <button onClick={() => setActiveTab('collection')} className="text-xs text-violet-soft hover:underline flex items-center gap-1">View all <ArrowRight className="w-3 h-3" /></button>
        </div>
        {recent.length === 0 ? (
          <div className="text-center text-ink-faint py-8">No cards yet — start scanning to build your collection.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {recent.map((card, idx) => (
              <CardTile key={`${card.id}-${card.set_code}-${idx}`} card={card} onClick={() => setActiveTab('collection')} />
            ))}
          </div>
        )}
      </div>

      {/* Set completion */}
      <div className="h-[380px]"><SetCompletion /></div>
    </div>
  );
}
