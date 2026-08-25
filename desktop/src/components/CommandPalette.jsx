import { useState, useEffect, useMemo, useRef } from 'react';
import { Search, Layers, Library, TrendingUp, BookOpen, Heart, CornerDownLeft } from 'lucide-react';
import CardDetailModal from './CardDetailModal';

export default function CommandPalette({ open, onClose, setActiveTab }) {
  const [query, setQuery] = useState('');
  const [cards, setCards] = useState([]);
  const [sel, setSel] = useState(0);
  const [detail, setDetail] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSel(0);
    setDetail(null);
    if (window.api) window.api.getCollection().then(rows => setCards(rows || []));
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // Group raw rows by passcode into the shape CardDetailModal expects (with `variants`).
  const grouped = useMemo(() => {
    const g = {};
    cards.forEach(c => {
      if (!g[c.id]) g[c.id] = { ...c, variants: [], quantity: 0, sets: new Set() };
      g[c.id].variants.push(c);
      g[c.id].quantity += (c.quantity || 1);
      if (c.set_code) g[c.id].sets.add(c.set_code);
    });
    return Object.values(g);
  }, [cards]);

  const go = (tab) => { setActiveTab(tab); onClose(); };
  const actions = useMemo(() => [
    { id: 'a-scan', label: 'Start Scanning', icon: Layers, run: () => go('staging') },
    { id: 'a-collection', label: 'Open Collection', icon: Library, run: () => go('collection') },
    { id: 'a-insights', label: 'Open Insights', icon: TrendingUp, run: () => go('insights') },
    { id: 'a-decks', label: 'Open Deck Builder', icon: BookOpen, run: () => go('deckbuilder') },
    { id: 'a-wishlist', label: 'Open Wishlist', icon: Heart, run: () => go('wishlist') },
  ], []); // eslint-disable-line react-hooks/exhaustive-deps

  const q = query.trim().toLowerCase();
  const actionResults = useMemo(
    () => actions.filter(a => !q || a.label.toLowerCase().includes(q)),
    [actions, q]
  );
  const cardResults = useMemo(() => {
    if (!q) return [];
    return grouped.filter(c =>
      (c.name && c.name.toLowerCase().includes(q)) ||
      String(c.id).includes(query.trim()) ||
      Array.from(c.sets).some(s => s.toLowerCase().includes(q))
    ).slice(0, 8);
  }, [grouped, q, query]);

  const flat = useMemo(
    () => [...actionResults.map(a => ({ type: 'action', ...a })), ...cardResults.map(c => ({ type: 'card', card: c }))],
    [actionResults, cardResults]
  );

  useEffect(() => { setSel(0); }, [query]);

  const runItem = (item) => {
    if (!item) return;
    if (item.type === 'action') item.run();
    else setDetail(item.card);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { if (detail) setDetail(null); else onClose(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, flat.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); runItem(flat[sel]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, flat, sel, detail]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  let rowIndex = -1;
  const Row = ({ item, children }) => {
    rowIndex += 1;
    const i = rowIndex;
    const active = i === sel;
    return (
      <button
        onMouseEnter={() => setSel(i)}
        onClick={() => runItem(item)}
        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${active ? 'bg-space-violet/15 text-white' : 'text-ink-muted'}`}
      >
        {children}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center pt-[12vh] px-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150" onClick={onClose}>
      <div className="w-full max-w-xl bg-obsidian-800 border border-line rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-4 border-b border-line">
          <Search className="w-5 h-5 text-violet-soft" strokeWidth={1.8} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Jump to a card, set or action…"
            className="flex-1 bg-transparent outline-none text-ink text-base"
          />
          <span className="font-mono text-[10px] text-ink-faint border border-line rounded px-1.5 py-0.5">ESC</span>
        </div>

        <div className="max-h-[52vh] overflow-y-auto custom-scrollbar py-2">
          {actionResults.length > 0 && (
            <div className="font-display text-[9.5px] tracking-[0.16em] uppercase text-ink-faint px-4 pt-2 pb-1">Actions</div>
          )}
          {actionResults.map(a => (
            <Row key={a.id} item={{ type: 'action', ...a }}>
              <a.icon className="w-4 h-4 shrink-0" strokeWidth={1.8} />
              <span className="flex-1">{a.label}</span>
            </Row>
          ))}

          {cardResults.length > 0 && (
            <div className="font-display text-[9.5px] tracking-[0.16em] uppercase text-ink-faint px-4 pt-3 pb-1">Cards</div>
          )}
          {cardResults.map(c => (
            <Row key={c.id} item={{ type: 'card', card: c }}>
              <div className="w-7 h-10 rounded overflow-hidden bg-obsidian-600 shrink-0">
                {c.image_url && <img src={c.image_url} alt="" className="w-full h-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-ink truncate">{c.name}</div>
                <div className="font-mono text-[10px] text-ink-faint">{c.id} · ×{c.quantity}</div>
              </div>
              <CornerDownLeft className="w-3.5 h-3.5 opacity-40" />
            </Row>
          ))}

          {q && flat.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-ink-faint">No matches.</div>
          )}
          {!q && (
            <div className="px-4 py-2 text-[11px] text-ink-faint">Type to search your collection…</div>
          )}
        </div>
      </div>

      {detail && <CardDetailModal card={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
