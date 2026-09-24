import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, Layers, Library, TrendingUp, BookOpen, Heart, CornerDownLeft, Banknote, Copy, Tag, Store, Receipt } from 'lucide-react';
import { ROUTES, cardRoute } from '../utils/routes';
import { formatPasscode, passcodeMatches } from '../utils/passcode';
import { T } from '../utils/i18n-de';

export default function CommandPalette({ open, onClose }) {
  const [query, setQuery] = useState('');
  const [cards, setCards] = useState([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);

  // The palette mounts fresh each time it opens (conditional render in App), so initial
  // state is already clean — this effect only loads data and focuses the input.
  useEffect(() => {
    if (!open) return;
    if (window.api) window.api.getCollection().then(rows => setCards(rows || []));
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // Derived values are recomputed each render (cheap; query changes every keystroke anyway).
  const groupedMap = {};
  cards.forEach(c => {
    if (!groupedMap[c.id]) groupedMap[c.id] = { ...c, variants: [], quantity: 0, sets: new Set() };
    groupedMap[c.id].variants.push(c);
    groupedMap[c.id].quantity += (c.quantity || 1);
    if (c.set_code) groupedMap[c.id].sets.add(c.set_code);
  });
  const grouped = Object.values(groupedMap);

  const navigate = useNavigate();
  const location = useLocation();
  // The palette renders outside <Routes>, so its location is the real one — while the card panel
  // is open that is the /karte/… route itself. Reuse the background it already carries, otherwise
  // the next card would get a card route as its background and <Routes> would match nothing.
  const bg = location.state?.background ?? location;
  const go = (to) => { navigate(to); onClose(); };
  const actions = [
    { id: 'a-scan', label: 'Scannen', icon: Layers, run: () => go(ROUTES.scannen) },
    { id: 'a-collection', label: 'Sammlung öffnen', icon: Library, run: () => go(ROUTES.karten) },
    { id: 'a-insights', label: 'Insights öffnen', icon: TrendingUp, run: () => go(ROUTES.insights) },
    { id: 'a-decks', label: 'Decks öffnen', icon: BookOpen, run: () => go(ROUTES.decks) },
    { id: 'a-wishlist', label: 'Wunschliste öffnen', icon: Heart, run: () => go(ROUTES.wunschliste) },
    // Abschlussreview B9: Bereich Verkaufen und seine vier Stationen (Spec I §5.3).
    { id: 'a-verkaufen', label: `${T.verkaufen} öffnen`, icon: Banknote, run: () => go(ROUTES.verkaufen) },
    { id: 'a-kandidaten', label: `${T.kandidaten} öffnen`, icon: Copy, run: () => go(ROUTES.kandidaten) },
    { id: 'a-zum-verkauf', label: `${T.zumVerkauf} öffnen`, icon: Tag, run: () => go(ROUTES.zumVerkauf) },
    { id: 'a-angebote', label: `${T.angebote} öffnen`, icon: Store, run: () => go(ROUTES.angebote) },
    { id: 'a-verkaeufe', label: `${T.verkaeufe} öffnen`, icon: Receipt, run: () => go(ROUTES.verkaeufe) },
  ];

  const q = query.trim().toLowerCase();
  const actionResults = actions.filter(a => !q || a.label.toLowerCase().includes(q));
  const cardResults = !q ? [] : grouped.filter(c =>
    (c.name && c.name.toLowerCase().includes(q)) ||
    (c.name_de && c.name_de.toLowerCase().includes(q)) ||
    passcodeMatches(query, c.id) ||
    Array.from(c.sets).some(s => s.toLowerCase().includes(q))
  ).slice(0, 8);

  const flat = [...actionResults.map(a => ({ type: 'action', ...a })), ...cardResults.map(c => ({ type: 'card', card: c }))];

  const runItem = (item) => {
    if (!item) return;
    if (item.type === 'action') item.run();
    else { navigate(cardRoute(item.card.variants?.[0] || item.card), { state: { background: bg } }); onClose(); }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, flat.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); runItem(flat[sel]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, flat, sel]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const rowClass = (active) =>
    `w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${active ? 'bg-accent/15 text-text' : 'text-muted'}`;

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center pt-[12vh] px-4 bg-bg/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div className="w-full max-w-xl bg-bg border border-line rounded-2xl shadow-sm overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-4 border-b border-line">
          <Search className="w-5 h-5 text-accent" strokeWidth={1.8} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSel(0); }}
            placeholder="Karte, Set oder Aktion suchen…"
            className="flex-1 bg-transparent outline-none text-text text-base"
          />
          <span className="font-mono text-klein text-muted border border-line rounded px-1.5 py-0.5">ESC</span>
        </div>

        <div className="max-h-[52vh] overflow-y-auto custom-scrollbar py-2">
          {actionResults.length > 0 && (
            <div className="font-display text-klein tracking-[0.16em] uppercase text-muted px-4 pt-2 pb-1">Aktionen</div>
          )}
          {actionResults.map((a, i) => (
            <button key={a.id} onMouseEnter={() => setSel(i)} onClick={() => runItem({ type: 'action', ...a })} className={rowClass(i === sel)}>
              <a.icon className="w-4 h-4 shrink-0" strokeWidth={1.8} />
              <span className="flex-1">{a.label}</span>
            </button>
          ))}

          {cardResults.length > 0 && (
            <div className="font-display text-klein tracking-[0.16em] uppercase text-muted px-4 pt-3 pb-1">Karten</div>
          )}
          {cardResults.map((c, ci) => {
            const i = actionResults.length + ci;
            return (
              <button key={c.id} onMouseEnter={() => setSel(i)} onClick={() => runItem({ type: 'card', card: c })} className={rowClass(i === sel)}>
                <div className="w-7 h-10 rounded overflow-hidden bg-surface-2 shrink-0">
                  {c.image_url && <img src={c.image_url} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-text truncate">{c.name}</div>
                  <div className="font-mono text-klein text-muted">{formatPasscode(c.id)} · ×{c.quantity}</div>
                </div>
                <CornerDownLeft className="w-3.5 h-3.5 opacity-40" />
              </button>
            );
          })}

          {q && flat.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted">Keine Treffer.</div>
          )}
          {!q && (
            <div className="px-4 py-2 text-klein text-muted">Tippen, um die Sammlung zu durchsuchen…</div>
          )}
        </div>
      </div>
    </div>
  );
}
